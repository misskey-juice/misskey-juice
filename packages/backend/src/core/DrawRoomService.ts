/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import * as Redis from 'ioredis';
import { DataSource, In, LessThan } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import type { DrawRoomMembersRepository, DrawRoomLayersRepository, DrawRoomsRepository } from '@/models/_.js';
import { MiDrawRoom, type DrawRoomChatMessage, type DrawRoomVisibility } from '@/models/DrawRoom.js';
import { MiDrawRoomMember } from '@/models/DrawRoomMember.js';
import { MiDrawRoomLayer, DEFAULT_DRAW_LAYERS, type DrawLayerMeta, type DrawStroke } from '@/models/DrawRoomLayer.js';
import type { MiUser } from '@/models/User.js';
import type { Packed } from '@/misc/json-schema.js';
import { IdService } from '@/core/IdService.js';
import { CacheService } from '@/core/CacheService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { RoleService } from '@/core/RoleService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { resolveDrawRoomSettings } from '@/models/JuiceSettings.js';

export const DRAW_ROOM_CANVAS_PRESETS = {
	landscape: [1600, 900],
	portrait: [900, 1600],
	square: [1200, 1200],
	// JUICE: 大きい正方形。点の座標の形式(1/8px単位のint16)で扱えるのは約4095pxまで
	square2048: [2048, 2048],
	square3840: [3840, 3840],
} as const;
export type DrawRoomCanvasPreset = keyof typeof DRAW_ROOM_CANVAS_PRESETS;

// JUICE: 部屋主が自由に決められるキャンバスの大きさの範囲(点の座標の形式で扱える大きさに収める)
export const DRAW_ROOM_CANVAS_MIN_SIZE = 100;
export const DRAW_ROOM_CANVAS_MAX_SIZE = 3840;

export const DRAW_ROOM_MIN_MEMBERS = 2;
export const DRAW_ROOM_MAX_MEMBERS = 512;
// 1本の線の点の最大数(1点 = x, y, 筆圧の3要素)
export const DRAW_STROKE_MAX_POINTS = 5000;
// 描いている途中の線を分割送信するときの、1回あたりの点の最大数
export const DRAW_STROKE_PART_MAX_POINTS = 500;
export const DRAW_STROKE_MAX_SIZE = 200;

// JUICE: 線の点の形式。1点5バイトで、x・yはキャンバス座標を8倍したint16(1/8px単位)、筆圧は0〜255のuint8(リトルエンディアン)。
// これを並べたバイト列をbase64にして送り・保存する(数値のJSON配列の約3分の1の大きさ)
export const DRAW_POINT_BYTES = 5;

// JUICE: 部屋を開いている接続が生きていることを確かめる間隔と、確認が途切れてからオフラインとみなすまでの時間
export const DRAW_ROOM_PRESENCE_HEARTBEAT_MS = 1000 * 30;
export const DRAW_ROOM_PRESENCE_TIMEOUT_MS = 1000 * 90;
export const DRAW_POINT_SCALE = 8;

/**
 * base64の点の列を [x, y, 筆圧(0〜1), …] に戻す。形式が不正ならnull
 */
export function decodeDrawPoints(encoded: string, maxPoints: number): number[] | null {
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return null;
	if (encoded.length > Math.ceil((maxPoints * DRAW_POINT_BYTES) / 3) * 4) return null;
	const buf = Buffer.from(encoded, 'base64');
	if (buf.length === 0 || buf.length % DRAW_POINT_BYTES !== 0) return null;
	const points: number[] = [];
	for (let i = 0; i < buf.length; i += DRAW_POINT_BYTES) {
		points.push(buf.readInt16LE(i) / DRAW_POINT_SCALE, buf.readInt16LE(i + 2) / DRAW_POINT_SCALE, buf.readUInt8(i + 4) / 255);
	}
	return points;
}
export const DRAW_CHAT_MAX_LENGTH = 500;
// 1人が1つの部屋に置ける線の本数と、線のデータ量(JSONのバイト数)の上限。描き続けてRedisや
// 終了時のDB保存(1人=1行)が際限なく膨らまないようにする。
// JUICE: 上限はロールのポリシー(drawRoomMaxStrokes・drawRoomMaxStrokeMegabytes)で決め、ここはその最大値(ロールでもこれより大きくはできない)
export const DRAW_LAYER_MAX_STROKES = 200000;
export const DRAW_LAYER_MAX_BYTES = 512 * 1024 * 1024;
// JUICE: 1人が持てるレイヤーの数の上限
export const DRAW_USER_MAX_LAYERS = 8;
// JUICE: 取り消し・やり直しの履歴の上限(1人・1部屋ごと。取り消しとやり直しの両方を合わせた大きさ)。
// 履歴は線の写しを持つので、Redisの使用量が増えすぎないよう、レイヤーの上限の半分にする
const HISTORY_MAX_BYTES = 4 * 1024 * 1024;
const HISTORY_MAX_ENTRIES = 100;
const CHAT_LOG_LENGTH = 100;
// 終了した「保存しない」部屋を消すまでの猶予(PNG保存・投稿のため)
const UNKEPT_ROOM_RETENTION_MS = 1000 * 60 * 60;
// この時間なにも描かれず・発言もされなかった開催中の部屋は自動で終了する
const IDLE_ROOM_TIMEOUT_MS = 1000 * 60 * 60 * 24;
// Redisのキーの有効期限。開催中は描くたびに延長され、放置された部屋は上の自動終了で先に片付くので、
// これは部屋の行が別経路(ユーザーの削除によるCASCADE等)で消えたときの取り残し対策
const REDIS_KEY_TTL_SEC = 60 * 60 * 24 * 7;

// 1秒あたりに受け付ける操作の上限(ユーザー×部屋ごと。接続を増やしても合算される)
export const DRAW_ROOM_RATE_LIMITS = {
	cursor: 20,
	strokePart: 40,
	stroke: 20,
	chat: 3,
	other: 5,
} as const;

export class DrawRoomError extends Error {
	constructor(public readonly reason:
		'disabled' | 'noSuchRoom' | 'forbidden' | 'ended' | 'full' | 'alreadyHosting' | 'notOwner' | 'notMember' | 'notEnded' | 'kicked' | 'canvasTooLarge' | 'cannotCreate' | 'cannotKickOwner') {
		super(reason);
	}
}

// JUICE: 線(JSON)のレイヤーのid(無ければ'0')。線を丸ごと読み解くと重いので、文字列から取り出す
// (線の中の文字列は、base64の点の列・色・idなどで、"layer":"を含むことは無い)
const LAYER_OF_STROKE_LUA = `
local function layerOf(raw)
	return string.match(raw, '"layer":"([%w_%-]+)"') or '0'
end
`;

// JUICE: 取り消し・やり直しの履歴。1回の操作を1件として、取り消す手順(u)とやり直す手順(r)を持つ。手順は順に行う:
// - {t='del', ids}: 線を消す
// - {t='mv', ids(配列か'*'), dx, dy}: 線をずらす
// - {t='ins', items={{a=次の線のid(無ければ最後), s=線のJSON}, …}}: 線を戻す(同じレイヤーの、次にあった線の前に入れる)
// - {t='addLayer', layer=レイヤー, index}, {t='rmLayer', id}: 下描きのレイヤーを戻す・消す
// 線は本人しか変えないので、戻すときは本人の今の線の並びに対して、idで場所を決めて行う
// (途中で消えた線・レイヤーへの手順は、飛ばすだけで壊れない)
const HISTORY_LUA = `
-- 線のid。点の列(大きい)を正規表現でたどらないよう、"id":" の位置を文字列のまま探してから取り出す
local function strokeIdOf(raw)
	local _, e = string.find(raw, '"id":"', 1, true)
	if not e then return nil end
	return string.match(raw, '^[%w_%-]+', e + 1)
end
-- レイヤーの一覧(JSON。無ければnil)に、そのidの下描きのレイヤーがあるか
local function isPrivateLayer(layersRaw, id)
	if not layersRaw then return false end
	for _, layer in ipairs(cjson.decode(layersRaw)) do
		if layer.id == id then return layer.private == true end
	end
	return false
end
-- 操作の前後の線の並びから、その操作の履歴(取り消す手順とやり直す手順)を作る。変わっていなければnil
local function diffEntry(before, after)
	-- 線のidは1回だけ取り出す
	local beforeIds = {}
	local afterIds = {}
	local beforeById = {}
	local afterById = {}
	for i, raw in ipairs(before) do
		beforeIds[i] = strokeIdOf(raw)
		beforeById[beforeIds[i]] = raw
	end
	for i, raw in ipairs(after) do
		afterIds[i] = strokeIdOf(raw)
		afterById[afterIds[i]] = raw
	end
	local removed = {}
	local inserted = {}
	local removedIds = {}
	local insertedIds = {}
	for i, raw in ipairs(before) do
		if afterById[beforeIds[i]] ~= raw then
			removed[i] = true
			table.insert(removedIds, beforeIds[i])
		end
	end
	for i, raw in ipairs(after) do
		if beforeById[afterIds[i]] ~= raw then
			inserted[i] = true
			table.insert(insertedIds, afterIds[i])
		end
	end
	if #removedIds == 0 and #insertedIds == 0 then return nil end
	-- 戻す線ごとに、同じレイヤーで次にある(この操作で変わらない)線を目印にする
	local function withAnchors(list, ids, marked)
		local items = {}
		local nextOfLayer = {}
		for i = #list, 1, -1 do
			local raw = list[i]
			local layer = layerOf(raw)
			if marked[i] then
				table.insert(items, 1, { a = nextOfLayer[layer], s = raw })
			else
				nextOfLayer[layer] = ids[i]
			end
		end
		return items
	end
	local u = {}
	local r = {}
	if #insertedIds > 0 then table.insert(u, { t = 'del', ids = insertedIds }) end
	if #removedIds > 0 then table.insert(u, { t = 'ins', items = withAnchors(before, beforeIds, removed) }) end
	if #removedIds > 0 then table.insert(r, { t = 'del', ids = removedIds }) end
	if #insertedIds > 0 then table.insert(r, { t = 'ins', items = withAnchors(after, afterIds, inserted) }) end
	return { u = u, r = r }
end
-- 履歴に1件積む(新しい操作をしたら、やり直しの履歴は捨てる)。mergeなら、直前の1件とまとめて1回の操作にする
-- (選択範囲の境目で線を切ってから動かす・消す操作)。大きすぎる1件は積めないので、それより前の履歴も捨てる
local function record(hk, rk, hbk, rbk, entry, merge, ttl)
	redis.call('DEL', rk, rbk)
	if merge then
		local last = redis.call('RPOP', hk)
		if last then
			redis.call('DECRBY', hbk, string.len(last))
			local prev = cjson.decode(last)
			local u = {}
			for _, step in ipairs(entry.u) do table.insert(u, step) end
			for _, step in ipairs(prev.u) do table.insert(u, step) end
			local r = {}
			for _, step in ipairs(prev.r) do table.insert(r, step) end
			for _, step in ipairs(entry.r) do table.insert(r, step) end
			entry = { u = u, r = r }
		end
	end
	local encoded = cjson.encode(entry)
	if string.len(encoded) > ${HISTORY_MAX_BYTES} then
		redis.call('DEL', hk, hbk)
		return
	end
	redis.call('RPUSH', hk, encoded)
	local total = redis.call('INCRBY', hbk, string.len(encoded))
	while total > ${HISTORY_MAX_BYTES} or redis.call('LLEN', hk) > ${HISTORY_MAX_ENTRIES} do
		local oldest = redis.call('LPOP', hk)
		if not oldest then break end
		total = redis.call('DECRBY', hbk, string.len(oldest))
	end
	redis.call('EXPIRE', hk, ttl)
	redis.call('EXPIRE', hbk, ttl)
end
`;

// 線を自分のレイヤーに追加する。部屋が終了していれば何もしない(終了処理と同時に届いた線が、
// 保存し終わった後のRedisにキーを作り直して取り残されないように、確認と書き込みを1回で行う)
// KEYS: ended, strokes, bytes, drawers, lastActivity, layers, history, redo, historyBytes, redoBytes / ARGV: stroke(JSON), userId, now, maxStrokes, maxBytes, ttl, layerId, strokeId
// 返り値: 1=追加した・3=追加した(下描きのレイヤー)・0=終了済み・-1=本数の上限・-3=データ量の上限・-2=無いレイヤー
const ADD_STROKE_SCRIPT = LAYER_OF_STROKE_LUA + HISTORY_LUA + `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
-- JUICE: 描いた人のレイヤーの一覧に無いレイヤーへの線は入れない(消したレイヤーに線が残り続けないように)。
-- 一覧が無ければ最初のレイヤー('0')だけ。下描き(本人だけに見える)かどうかも、ここで一緒に決める
-- (一覧を変えるのと同時に届いた線が、古い判定で皆に配られないように)
local layers = redis.call('GET', KEYS[6])
local isPrivate = false
if layers then
	local found = false
	for _, layer in ipairs(cjson.decode(layers)) do
		if layer.id == ARGV[7] then
			found = true
			isPrivate = layer.private == true
		end
	end
	if not found then return -2 end
elseif ARGV[7] ~= '0' then
	return -2
end
if redis.call('LLEN', KEYS[2]) >= tonumber(ARGV[4]) then return -1 end
local bytes = tonumber(redis.call('GET', KEYS[3]) or '0')
-- JUICE: 本数の上限(-1)と、データ量の上限(-3)を分けて返す(描いた人に、どちらの上限か知らせるため)
if bytes + string.len(ARGV[1]) > tonumber(ARGV[5]) then return -3 end
redis.call('RPUSH', KEYS[2], ARGV[1])
redis.call('INCRBY', KEYS[3], string.len(ARGV[1]))
redis.call('SADD', KEYS[4], ARGV[2])
redis.call('SET', KEYS[5], ARGV[3])
for i = 2, 5 do redis.call('EXPIRE', KEYS[i], tonumber(ARGV[6])) end
-- 描き続けている間に、レイヤーの一覧だけ期限切れにならないように
if layers then redis.call('EXPIRE', KEYS[6], tonumber(ARGV[6])) end
-- JUICE: 取り消し・やり直しの履歴
record(KEYS[7], KEYS[8], KEYS[9], KEYS[10], { u = { { t = 'del', ids = { ARGV[8] } } }, r = { { t = 'ins', items = { { s = ARGV[1] } } } } }, false, tonumber(ARGV[6]))
if isPrivate then return 3 end
return 1
`;

// JUICE: 取り消し(ARGV[1]='u')・やり直し(ARGV[1]='r')。履歴の最後の1件の手順を行い、もう一方の履歴へ移す。
// 返り値は {1, 行った手順(JSON), 今のレイヤーの一覧(JSON), レイヤーの一覧を変えたか(1/0)}。
// 履歴が無い・終了済みなら {0, '', ''}、線の数・大きさの上限を超えるなら {-2, '', ''}(履歴はそのまま)
// KEYS: ended, strokes, bytes, layers, history, redo, historyBytes, redoBytes / ARGV: 'u'|'r', maxStrokes, maxBytes, ttl, maxLayers
const UNDO_REDO_SCRIPT = LAYER_OF_STROKE_LUA + HISTORY_LUA + `
if redis.call('EXISTS', KEYS[1]) == 1 then return { 0, '', '', 0 } end
local undo = ARGV[1] == 'u'
local fromKey = undo and KEYS[5] or KEYS[6]
local toKey = undo and KEYS[6] or KEYS[5]
local fromBytes = undo and KEYS[7] or KEYS[8]
local toBytes = undo and KEYS[8] or KEYS[7]
local ttl = tonumber(ARGV[4])
local raw = redis.call('RPOP', fromKey)
if not raw then return { 0, '', '', 0 } end
local entry = cjson.decode(raw)
local list = redis.call('LRANGE', KEYS[2], 0, -1)
local layersRaw = redis.call('GET', KEYS[4])
local layers = layersRaw and cjson.decode(layersRaw) or { { id = '0', name = '', visible = true, opacity = 1 } }
local layersChanged = false
local applied = {}
local function hasLayer(id)
	for _, layer in ipairs(layers) do
		if layer.id == id then return true end
	end
	return false
end
for _, step in ipairs(entry[ARGV[1]]) do
	if step.t == 'del' then
		local ids = {}
		for _, id in ipairs(step.ids) do ids[id] = true end
		local kept = {}
		for _, s in ipairs(list) do
			if not ids[strokeIdOf(s)] then table.insert(kept, s) end
		end
		if #kept ~= #list then table.insert(applied, step) end
		list = kept
	elseif step.t == 'mv' then
		local all = step.ids == '*'
		local ids = {}
		if not all then
			for _, id in ipairs(step.ids) do ids[id] = true end
		end
		for i, s in ipairs(list) do
			if all or ids[strokeIdOf(s)] then
				local stroke = cjson.decode(s)
				stroke.dx = (stroke.dx or 0) + step.dx
				stroke.dy = (stroke.dy or 0) + step.dy
				list[i] = cjson.encode(stroke)
			end
		end
		table.insert(applied, step)
	elseif step.t == 'ins' then
		-- 目印の線ごとにまとめてから、並びを1回たどって入れる(線が多くても重くならないように)
		local present = {}
		for _, s in ipairs(list) do present[strokeIdOf(s)] = true end
		local items = {}
		local beforeAnchor = {}
		for _, item in ipairs(step.items) do
			local id = strokeIdOf(item.s)
			-- 無くなったレイヤーの線・もうある線は戻さない
			if not present[id] and hasLayer(layerOf(item.s)) then
				present[id] = true
				table.insert(items, item)
				if item.a then
					if beforeAnchor[item.a] == nil then beforeAnchor[item.a] = {} end
					table.insert(beforeAnchor[item.a], item.s)
				end
			end
		end
		if #items > 0 then
			local result = {}
			local placed = {}
			for _, s in ipairs(list) do
				local sid = strokeIdOf(s)
				local waiting = beforeAnchor[sid]
				if waiting then
					for _, w in ipairs(waiting) do table.insert(result, w) end
					placed[sid] = true
				end
				table.insert(result, s)
			end
			-- 目印の無い線と、目印の線が無くなっていた線は、手順の順に最後に入れる
			for _, item in ipairs(items) do
				if not (item.a and placed[item.a]) then table.insert(result, item.s) end
			end
			list = result
			table.insert(applied, { t = 'ins', items = items })
		end
	elseif step.t == 'addLayer' then
		if not hasLayer(step.layer.id) and #layers < tonumber(ARGV[5]) then
			table.insert(layers, math.min(step.index, #layers + 1), step.layer)
			layersChanged = true
		end
	elseif step.t == 'rmLayer' then
		for i, layer in ipairs(layers) do
			if layer.id == step.id and #layers > 1 then
				table.remove(layers, i)
				layersChanged = true
				break
			end
		end
	end
end
local bytes = 0
for _, s in ipairs(list) do bytes = bytes + string.len(s) end
if #list > tonumber(ARGV[2]) or bytes > tonumber(ARGV[3]) then
	redis.call('RPUSH', fromKey, raw)
	return { -2, '', '', 0 }
end
redis.call('DEL', KEYS[2])
for i = 1, #list, 500 do
	redis.call('RPUSH', KEYS[2], unpack(list, i, math.min(i + 499, #list)))
end
redis.call('SET', KEYS[3], bytes, 'EX', ttl)
if #list > 0 then redis.call('EXPIRE', KEYS[2], ttl) end
if layersChanged then redis.call('SET', KEYS[4], cjson.encode(layers), 'EX', ttl) elseif layersRaw then redis.call('EXPIRE', KEYS[4], ttl) end
redis.call('DECRBY', fromBytes, string.len(raw))
redis.call('RPUSH', toKey, raw)
redis.call('INCRBY', toBytes, string.len(raw))
for i = 5, 8 do redis.call('EXPIRE', KEYS[i], ttl) end
-- 行った手順・今のレイヤーの一覧(下描きの線をほかの人に配らないため、同じ処理の中で読んだもの)・一覧を変えたか
local layersNow = (layersChanged or not layersRaw) and cjson.encode(layers) or layersRaw
if #applied == 0 then return { 1, '', layersNow, layersChanged and 1 or 0 } end
return { 1, cjson.encode(applied), layersNow, layersChanged and 1 or 0 }
`;

// JUICE: 線の一覧から、shouldRemove(レイヤーのid)が真の線を消す。返り値は消した線の数
// KEYS[2]: strokes, KEYS[3]: bytes を使う
const REMOVE_STROKES_BY_LAYER_LUA = `
local function removeStrokes(shouldRemove, ttl)
	local list = redis.call('LRANGE', KEYS[2], 0, -1)
	local kept = {}
	local bytes = 0
	local removed = 0
	for _, raw in ipairs(list) do
		if shouldRemove(layerOf(raw)) then
			removed = removed + 1
		else
			table.insert(kept, raw)
			bytes = bytes + string.len(raw)
		end
	end
	if removed == 0 then return 0, list, kept end
	redis.call('DEL', KEYS[2])
	for i = 1, #kept, 500 do
		redis.call('RPUSH', KEYS[2], unpack(kept, i, math.min(i + 499, #kept)))
	end
	redis.call('SET', KEYS[3], bytes)
	if #kept > 0 then redis.call('EXPIRE', KEYS[2], ttl) end
	redis.call('EXPIRE', KEYS[3], ttl)
	return removed, list, kept
end
`;

// JUICE: 指定したレイヤー(1人が持つレイヤーのid。線にlayerが無ければ'0')の線だけを消す。
// 返り値は消した線の数(終了済みなら-1)
// JUICE: 下描きのレイヤーなら、取り消せるよう履歴に積む。皆に見えるレイヤーの消去は取り消せないので、それより前の履歴も捨てる
// (消した線が、前の操作の取り消し・やり直しで戻ってこないように)。下描きかは、消すのと同じ処理の中で決める。
// 返り値は {消した線の数(終了済みなら-1), 下描きのレイヤーか(1/0)}
// KEYS: ended, strokes, bytes, layers, history, redo, historyBytes, redoBytes / ARGV: layerId, ttl
const REMOVE_LAYER_STROKES_SCRIPT = LAYER_OF_STROKE_LUA + REMOVE_STROKES_BY_LAYER_LUA + HISTORY_LUA + `
if redis.call('EXISTS', KEYS[1]) == 1 then return { -1, 0 } end
local isPrivate = isPrivateLayer(redis.call('GET', KEYS[4]), ARGV[1])
local removed, before, after = removeStrokes(function(id) return id == ARGV[1] end, tonumber(ARGV[2]))
if removed > 0 then
	if isPrivate then
		local entry = diffEntry(before, after)
		if entry then record(KEYS[5], KEYS[6], KEYS[7], KEYS[8], entry, false, tonumber(ARGV[2])) end
	else
		redis.call('DEL', KEYS[5], KEYS[6], KEYS[7], KEYS[8])
	end
end
return { removed, isPrivate and 1 or 0 }
`;

// JUICE: 自分のレイヤーの一覧を置き換え、一覧に無いレイヤーの線を消す(途中で部屋が終わったり、
// 消したレイヤーへの線が割り込んだりしないよう、まとめて行う)。返り値は消した線の数(終了済みなら-1)
// JUICE: 返り値は {消した線の数, 変える前の一覧(JSON。無ければ'')}(終了済みなら {-1, ''})。前の一覧は、下描きから皆に見せる
// ようにしたレイヤーを見つけるのに使う(一覧を変えるのと同じ処理の中で読み、ほかの変更と混ざらないようにする)
// JUICE: 消したレイヤーが全て下描きなら、取り消せるよう履歴に積む(レイヤーそのものと、その線を戻せるように)
// KEYS: ended, strokes, bytes, layers, drawers, history, redo, historyBytes, redoBytes / ARGV: layers(JSON), keepIds(JSON), userId, ttl
const SET_LAYERS_SCRIPT = LAYER_OF_STROKE_LUA + REMOVE_STROKES_BY_LAYER_LUA + HISTORY_LUA + `
if redis.call('EXISTS', KEYS[1]) == 1 then return { -1, '' } end
local ttl = tonumber(ARGV[4])
local keep = {}
for _, id in ipairs(cjson.decode(ARGV[2])) do keep[id] = true end
-- 前の一覧のレイヤーが全て残るなら、線を見なくてよい(線は一覧にあるレイヤーにしか入らないため)
local before = redis.call('GET', KEYS[4])
local dropped = false
if before then
	for _, layer in ipairs(cjson.decode(before)) do
		if not keep[layer.id] then dropped = true end
	end
elseif not keep['0'] then
	dropped = true
end
-- JUICE: 下描き⇔皆に見せるを切り替えたら、やり直しの履歴は捨てる(切り替える前の状態に向けたやり直しで、
-- 皆に見えるレイヤーを消したり、下描きに戻したりしないように)
local beforePrivate = {}
if before then
	for _, layer in ipairs(cjson.decode(before)) do beforePrivate[layer.id] = layer.private == true end
end
for _, layer in ipairs(cjson.decode(ARGV[1])) do
	if beforePrivate[layer.id] ~= nil and beforePrivate[layer.id] ~= (layer.private == true) then
		redis.call('DEL', KEYS[7], KEYS[9])
		break
	end
end
redis.call('SET', KEYS[4], ARGV[1], 'EX', ttl)
-- 線を描いていなくてもレイヤーの一覧を配れるよう、描いた人の集合に入れておく
redis.call('SADD', KEYS[5], ARGV[3])
redis.call('EXPIRE', KEYS[5], ttl)
if not dropped then return { 0, before or '' } end
local removed, beforeList, afterList = removeStrokes(function(id) return not keep[id] end, ttl)
-- 消したレイヤーと、その元の場所
local droppedLayers = {}
local allPrivate = true
local beforeLayers = before and cjson.decode(before) or { { id = '0', name = '', visible = true, opacity = 1 } }
for i, layer in ipairs(beforeLayers) do
	if not keep[layer.id] then
		table.insert(droppedLayers, { layer = layer, index = i })
		if layer.private ~= true then allPrivate = false end
	end
end
if allPrivate and #droppedLayers > 0 then
	local entry = diffEntry(beforeList, afterList) or { u = {}, r = {} }
	-- 取り消すときはレイヤーを先に戻してから線を戻し、やり直すときは線を消してからレイヤーを消す
	local u = {}
	for _, dropped in ipairs(droppedLayers) do table.insert(u, { t = 'addLayer', layer = dropped.layer, index = dropped.index }) end
	for _, step in ipairs(entry.u) do table.insert(u, step) end
	local r = {}
	for _, step in ipairs(entry.r) do table.insert(r, step) end
	for _, dropped in ipairs(droppedLayers) do table.insert(r, { t = 'rmLayer', id = dropped.layer.id }) end
	record(KEYS[6], KEYS[7], KEYS[8], KEYS[9], { u = u, r = r }, false, ttl)
elseif #droppedLayers > 0 then
	-- 皆に見えるレイヤーの削除は取り消せないので、それより前の履歴も捨てる(同じidのレイヤーを作り直したときに、
	-- 前の取り消しで古い線がそこへ戻らないように)
	redis.call('DEL', KEYS[6], KEYS[7], KEYS[8], KEYS[9])
end
return { removed, before or '' }
`;

// 自分のレイヤーの線を全て消す。返り値は、消したなら1・終了済みなら0・消す線が無かったなら2
// JUICE: 部屋主が消したときなので、取り消し・やり直しの履歴も捨てる(消された線を本人が取り消しで戻せないように)
// KEYS: ended, strokes, bytes, history, redo, historyBytes, redoBytes
const CLEAR_LAYER_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('DEL', KEYS[4], KEYS[5], KEYS[6], KEYS[7])
if redis.call('DEL', KEYS[2], KEYS[3]) == 0 then return 2 end
return 1
`;

// JUICE: 自分のレイヤーの線を移動する(点の列はそのままで、ずらした量dx・dyだけを足す)。
// ARGV[3]が'*'ならレイヤーの全ての線、そうでなければidのJSON配列の線だけ。
// 返り値は動かした線の数(終了済みなら-1、ずらした量を書き足すとレイヤーの大きさの上限を超えるなら-2)
// JUICE: 取り消せるよう履歴に積む。ARGV[6]が'1'なら直前の履歴(境目で切った操作)とまとめる
// KEYS: ended, strokes, bytes, history, redo, historyBytes, redoBytes / ARGV: dx, dy, ids(JSON)|'*', ttl, maxBytes, merge('1'|'0')
const MOVE_STROKES_SCRIPT = LAYER_OF_STROKE_LUA + HISTORY_LUA + `
if redis.call('EXISTS', KEYS[1]) == 1 then return -1 end
local dx = tonumber(ARGV[1])
local dy = tonumber(ARGV[2])
local all = ARGV[3] == '*'
local ids = {}
if not all then
	for _, id in ipairs(cjson.decode(ARGV[3])) do ids[id] = true end
end
local list = redis.call('LRANGE', KEYS[2], 0, -1)
local updates = {}
local delta = 0
for i, raw in ipairs(list) do
	if all or ids[strokeIdOf(raw)] then
		local s = cjson.decode(raw)
		s.dx = (s.dx or 0) + dx
		s.dy = (s.dy or 0) + dy
		local encoded = cjson.encode(s)
		table.insert(updates, { i - 1, encoded })
		delta = delta + string.len(encoded) - string.len(raw)
	end
end
if #updates == 0 then return 0 end
if (tonumber(redis.call('GET', KEYS[3]) or '0') + delta) > tonumber(ARGV[5]) then return -2 end
for _, u in ipairs(updates) do redis.call('LSET', KEYS[2], u[1], u[2]) end
if delta ~= 0 then redis.call('INCRBY', KEYS[3], delta) end
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[4]))
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[4]))
local movedIds = '*'
if not all then movedIds = cjson.decode(ARGV[3]) end
record(KEYS[4], KEYS[5], KEYS[6], KEYS[7], {
	u = { { t = 'mv', ids = movedIds, dx = -dx, dy = -dy } },
	r = { { t = 'mv', ids = movedIds, dx = dx, dy = dy } },
}, ARGV[6] == '1', tonumber(ARGV[4]))
return #updates
`;

// JUICE: 選択範囲の境目で切った線を、切った後の線の並びに置き換える(同じ位置に入れて重なり順を保つ)。
// 返り値は {置き換えた線の数, レイヤーの一覧(JSON)}。置き換えた線の数は、終了済みなら-1、線の数・大きさの上限を超えるか、
// 置き換えた後に同じidの線ができるか、一覧に無いレイヤーの線にするなら-2
// JUICE: 置き換える線のレイヤーも、描いた人のレイヤーの一覧にあるものに限る(-2で断る)
// JUICE: 取り消せるよう履歴に積み、返り値の3つ目に積んだか(1/0)を返す(続けて動かす・消す操作とまとめるため)
// KEYS: ended, strokes, bytes, layers, history, redo, historyBytes, redoBytes / ARGV: splits(JSON: 元の線のid → 置き換える線のJSON文字列の配列), maxStrokes, maxBytes, ttl, pieceIds(JSON)
const SPLIT_STROKES_SCRIPT = LAYER_OF_STROKE_LUA + HISTORY_LUA + `
if redis.call('EXISTS', KEYS[1]) == 1 then return { -1, '', 0 } end
local splits = cjson.decode(ARGV[1])
local layers = redis.call('GET', KEYS[4])
local known = {}
if layers then
	for _, layer in ipairs(cjson.decode(layers)) do known[layer.id] = true end
else
	known['0'] = true
end
for _, pieces in pairs(splits) do
	for _, piece in ipairs(pieces) do
		if not known[layerOf(piece)] then return { -2, '', 0 } end
	end
end
local pieceIds = {}
for _, id in ipairs(cjson.decode(ARGV[5])) do pieceIds[id] = true end
local list = redis.call('LRANGE', KEYS[2], 0, -1)
local result = {}
local bytes = 0
local replaced = 0
for _, raw in ipairs(list) do
	local s = cjson.decode(raw)
	local pieces = splits[s.id]
	if pieces then
		replaced = replaced + 1
		for _, piece in ipairs(pieces) do
			table.insert(result, piece)
			bytes = bytes + string.len(piece)
		end
	else
		-- 置き換えない線と同じidの線ができると、後の移動・削除で両方が対象になるので断る
		if pieceIds[s.id] then return { -2, '', 0 } end
		table.insert(result, raw)
		bytes = bytes + string.len(raw)
	end
end
if replaced == 0 then return { 0, '', 0 } end
if #result > tonumber(ARGV[2]) or bytes > tonumber(ARGV[3]) then return { -2, '', 0 } end
redis.call('DEL', KEYS[2])
for i = 1, #result, 500 do
	redis.call('RPUSH', KEYS[2], unpack(result, i, math.min(i + 499, #result)))
end
redis.call('SET', KEYS[3], bytes)
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[4]))
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[4]))
local entry = diffEntry(list, result)
if entry then record(KEYS[5], KEYS[6], KEYS[7], KEYS[8], entry, false, tonumber(ARGV[4])) end
-- 置き換えた線の数と、そのときのレイヤーの一覧(下描きの線を、ほかの人に配らないため)
return { replaced, layers or '', entry and 1 or 0 }
`;

// JUICE: 自分のレイヤーの、選んだ線だけを消す。返り値は消した線の数(終了済みなら-1)
// JUICE: 取り消せるよう履歴に積む。ARGV[3]が'1'なら直前の履歴(境目で切った操作)とまとめる
// KEYS: ended, strokes, bytes, history, redo, historyBytes, redoBytes / ARGV: ids(JSON), ttl, merge('1'|'0')
const DELETE_STROKES_SCRIPT = LAYER_OF_STROKE_LUA + HISTORY_LUA + `
if redis.call('EXISTS', KEYS[1]) == 1 then return -1 end
local ids = {}
for _, id in ipairs(cjson.decode(ARGV[1])) do ids[id] = true end
local list = redis.call('LRANGE', KEYS[2], 0, -1)
local kept = {}
local bytes = 0
local removed = 0
for _, raw in ipairs(list) do
	if ids[strokeIdOf(raw)] then
		removed = removed + 1
	else
		table.insert(kept, raw)
		bytes = bytes + string.len(raw)
	end
end
if removed == 0 then return 0 end
redis.call('DEL', KEYS[2])
for i = 1, #kept, 500 do
	redis.call('RPUSH', KEYS[2], unpack(kept, i, math.min(i + 499, #kept)))
end
redis.call('SET', KEYS[3], bytes)
if #kept > 0 then redis.call('EXPIRE', KEYS[2], tonumber(ARGV[2])) end
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[2]))
local entry = diffEntry(list, kept)
if entry then record(KEYS[4], KEYS[5], KEYS[6], KEYS[7], entry, ARGV[3] == '1', tonumber(ARGV[2])) end
return removed
`;

// チャットに発言する / KEYS: ended, chat, lastActivity / ARGV: message(JSON), keep, now, ttl
const POST_CHAT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('RPUSH', KEYS[2], ARGV[1])
redis.call('LTRIM', KEYS[2], -tonumber(ARGV[2]), -1)
redis.call('SET', KEYS[3], ARGV[3])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[4]))
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[4]))
return 1
`;

/**
 * JUICE: 絵チャ(お絵かきチャット)。
 * 部屋・メンバーはDB、開催中の線・チャットはRedis(高頻度・一時的なため)に置く。
 * 線はユーザーごとのレイヤーとして分けて持ち、自分のレイヤー以外には書き込めない。
 */
// JUICE: カーソルをまとめて配る間隔。人数が増えても、1人が受け取る数はこの間隔ごとに1通で済む
const CURSOR_FLUSH_INTERVAL_MS = 100;
// JUICE: 部屋を離れた人をオフラインとして配るまで待つ時間(つなぎ直しでちらつかないように)
const PRESENCE_LEAVE_DELAY_MS = 3000;

@Injectable()
export class DrawRoomService implements OnApplicationShutdown {
	// 部屋ごとの、まだ配っていないカーソルの位置(ユーザーごとに最新の位置だけを持つ)
	private cursorBuffers = new Map<MiDrawRoom['id'], Map<MiUser['id'], { x: number | null; y: number | null; pet: boolean }>>();
	private cursorFlushTimers = new Map<MiDrawRoom['id'], NodeJS.Timeout>();
	private presencePublishTimers = new Map<MiDrawRoom['id'], NodeJS.Timeout>();

	constructor(
		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.drawRoomsRepository)
		private drawRoomsRepository: DrawRoomsRepository,

		@Inject(DI.drawRoomMembersRepository)
		private drawRoomMembersRepository: DrawRoomMembersRepository,

		@Inject(DI.drawRoomLayersRepository)
		private drawRoomLayersRepository: DrawRoomLayersRepository,

		private idService: IdService,
		private roleService: RoleService,
		private moderationLogService: ModerationLogService,
		private cacheService: CacheService,
		private globalEventService: GlobalEventService,
		private userEntityService: UserEntityService,
		private juiceSettingsService: JuiceSettingsService,
	) {
	}

	//#region Redisのキー
	private strokesKey(roomId: MiDrawRoom['id'], userId: MiUser['id']): string {
		return `drawroom:${roomId}:strokes:${userId}`;
	}

	private bytesKey(roomId: MiDrawRoom['id'], userId: MiUser['id']): string {
		return `drawroom:${roomId}:bytes:${userId}`;
	}

	// JUICE: その人のレイヤーの一覧(DrawLayerMetaの配列のJSON)。無ければ最初のレイヤー1枚だけ
	private layersKey(roomId: MiDrawRoom['id'], userId: MiUser['id']): string {
		return `drawroom:${roomId}:layers:${userId}`;
	}

	// JUICE: 取り消し・やり直しの履歴(1件=1回の操作のJSON)と、その大きさの合計
	private historyKeys(roomId: MiDrawRoom['id'], userId: MiUser['id']): [string, string, string, string] {
		return [
			`drawroom:${roomId}:history:${userId}`,
			`drawroom:${roomId}:redo:${userId}`,
			`drawroom:${roomId}:historyBytes:${userId}`,
			`drawroom:${roomId}:redoBytes:${userId}`,
		];
	}

	// 1本でも線を描いたことがあるユーザー(=レイヤーを持つユーザー)の集合。メンバーを抜けても線は残る
	private drawersKey(roomId: MiDrawRoom['id']): string {
		return `drawroom:${roomId}:drawers`;
	}

	private chatKey(roomId: MiDrawRoom['id']): string {
		return `drawroom:${roomId}:chat`;
	}

	private lastActivityKey(roomId: MiDrawRoom['id']): string {
		return `drawroom:${roomId}:lastActivity`;
	}

	// 終了処理を始めたら立てる印。以降の書き込み(線・チャット)は全て拒否される
	private endedKey(roomId: MiDrawRoom['id']): string {
		return `drawroom:${roomId}:ended`;
	}

	// 部屋主に外された人の集合。外された人はその部屋に参加し直せない
	private kickedKey(roomId: MiDrawRoom['id']): string {
		return `drawroom:${roomId}:kicked`;
	}

	// JUICE: 今この部屋を開いている接続。メンバーは「userId:接続ID」、スコアは最後に生きていると確認した時刻
	private presenceKey(roomId: MiDrawRoom['id']): string {
		return `drawroom:${roomId}:presence`;
	}

	/**
	 * JUICE: キャンバスの大きさが、ロールで決まっている上限(drawRoomMaxCanvasSize)以内かを確かめる
	 */
	@bindThis
	private async ensureCanvasSizeAllowed(me: MiUser, width: number, height: number): Promise<void> {
		const { drawRoomMaxCanvasSize } = await this.roleService.getUserPolicies(me.id);
		if (width > drawRoomMaxCanvasSize || height > drawRoomMaxCanvasSize) throw new DrawRoomError('canvasTooLarge');
	}

	@bindThis
	private async touch(roomId: MiDrawRoom['id']): Promise<void> {
		await this.redisClient.set(this.lastActivityKey(roomId), Date.now().toString(), 'EX', REDIS_KEY_TTL_SEC);
	}

	@bindThis
	private async deleteRedisData(roomId: MiDrawRoom['id']): Promise<void> {
		const drawers = await this.redisClient.smembers(this.drawersKey(roomId));
		await this.redisClient.del(
			...drawers.flatMap(userId => [this.strokesKey(roomId, userId), this.bytesKey(roomId, userId), this.layersKey(roomId, userId), ...this.historyKeys(roomId, userId)]),
			this.drawersKey(roomId),
			this.chatKey(roomId),
			this.lastActivityKey(roomId),
			this.endedKey(roomId),
			this.kickedKey(roomId),
			this.presenceKey(roomId),
		);
	}
	//#endregion

	@bindThis
	public async isEnabled(): Promise<boolean> {
		return resolveDrawRoomSettings(await this.juiceSettingsService.fetch()).drawRoomEnabled;
	}

	@bindThis
	private async ensureEnabled(): Promise<void> {
		if (!await this.isEnabled()) throw new DrawRoomError('disabled');
	}

	/**
	 * 部屋を見られるか(見学できるか)。ローカルユーザー限定の機能なので、リモートユーザーは不可。
	 * 部屋主にブロックされている場合も不可
	 */
	@bindThis
	public async canView(room: MiDrawRoom, me: MiUser | null): Promise<boolean> {
		if (me == null || me.host != null) return false;
		if (room.ownerId === me.id) return true;
		// JUICE: 凍結された人の部屋は、本人以外には見せない(一覧にも出さない)
		const owner = await this.cacheService.findUserById(room.ownerId).catch(() => null);
		if (owner == null || owner.isSuspended) return false;
		const blockedByOwner = await this.cacheService.userBlockingCache.fetch(room.ownerId);
		if (blockedByOwner.has(me.id)) return false;
		if (room.visibility === 'local') return true;
		const followings = await this.cacheService.userFollowingsCache.fetch(me.id);
		return followings[room.ownerId] != null;
	}

	@bindThis
	public async getRoom(roomId: MiDrawRoom['id'], me: MiUser | null): Promise<MiDrawRoom> {
		await this.ensureEnabled();
		const room = await this.drawRoomsRepository.findOneBy({ id: roomId });
		if (room == null) throw new DrawRoomError('noSuchRoom');
		// JUICE: モデレーターは、通報された部屋などを確かめられるよう、公開範囲にかかわらず開ける(一覧には出さない)
		if (!await this.canView(room, me) && !(me != null && me.host == null && await this.roleService.isModerator(me))) {
			throw new DrawRoomError('forbidden');
		}
		return room;
	}

	@bindThis
	public async isMember(roomId: MiDrawRoom['id'], userId: MiUser['id']): Promise<boolean> {
		return await this.drawRoomMembersRepository.existsBy({ roomId, userId });
	}

	@bindThis
	public async pack(room: MiDrawRoom, me: MiUser | null): Promise<Packed<'DrawRoom'>> {
		const members = await this.drawRoomMembersRepository.find({
			where: { roomId: room.id },
			relations: { user: true },
			order: { id: 'ASC' },
		});
		const [owner, packedMembers] = await Promise.all([
			this.userEntityService.pack(room.ownerId, me),
			this.userEntityService.packMany(members.map(m => m.user!), me),
		]);
		return {
			id: room.id,
			createdAt: this.idService.parse(room.id).date.toISOString(),
			ownerId: room.ownerId,
			owner,
			title: room.title,
			visibility: room.visibility,
			maxMembers: room.maxMembers,
			canvasWidth: room.canvasWidth,
			canvasHeight: room.canvasHeight,
			keepAfterEnd: room.keepAfterEnd,
			isEnded: room.isEnded,
			endedAt: room.endedAt?.toISOString() ?? null,
			deletesAt: room.isEnded && !room.keepAfterEnd && room.endedAt != null ? new Date(room.endedAt.getTime() + UNKEPT_ROOM_RETENTION_MS).toISOString() : null,
			members: packedMembers,
			isMember: me != null && members.some(m => m.userId === me.id),
			// JUICE: モデレーターが公開範囲の外から確認のために開いている(見るだけで、書き込みはできない)
			viewOnly: me != null && !await this.canView(room, me),
		};
	}

	@bindThis
	public async create(me: MiUser, params: {
		title: string;
		visibility: DrawRoomVisibility;
		maxMembers: number;
		canvasPreset?: DrawRoomCanvasPreset;
		// 大きさを直接指定するとき(canvasPresetより優先)
		canvasSize?: { width: number; height: number };
		keepAfterEnd: boolean;
	}): Promise<MiDrawRoom> {
		await this.ensureEnabled();
		// JUICE: 部屋を作れるのは、ロールで許されている人だけ(見学・参加は誰でもできる)
		if (!(await this.roleService.getUserPolicies(me.id)).canCreateDrawRoom) throw new DrawRoomError('cannotCreate');
		// 1人が同時に開催できる部屋は1つまで(放置された部屋が増え続けないように)。
		// 同時に作成を投げても2つできないよう、確認から作成までを短いロックで囲む
		const lockKey = `drawroom:creating:${me.id}`;
		if (await this.redisClient.set(lockKey, '1', 'EX', 10, 'NX') == null) throw new DrawRoomError('alreadyHosting');
		try {
			if (await this.drawRoomsRepository.existsBy({ ownerId: me.id, isEnded: false })) {
				throw new DrawRoomError('alreadyHosting');
			}
			const [canvasWidth, canvasHeight] = params.canvasSize != null
				? [params.canvasSize.width, params.canvasSize.height]
				: DRAW_ROOM_CANVAS_PRESETS[params.canvasPreset ?? 'landscape'];
			await this.ensureCanvasSizeAllowed(me, canvasWidth, canvasHeight);
			const room = await this.db.transaction(async em => {
				const room = await em.insert(MiDrawRoom, {
					id: this.idService.gen(),
					ownerId: me.id,
					title: params.title,
					visibility: params.visibility,
					maxMembers: params.maxMembers,
					canvasWidth,
					canvasHeight,
					keepAfterEnd: params.keepAfterEnd,
				}).then(x => em.findOneByOrFail(MiDrawRoom, x.identifiers[0]));
				// 部屋主もメンバー(描ける人)の1人として数える
				await em.insert(MiDrawRoomMember, {
					id: this.idService.gen(),
					roomId: room.id,
					userId: me.id,
				});
				return room;
			});
			await this.touch(room.id);
			return room;
		} finally {
			await this.redisClient.del(lockKey);
		}
	}

	/**
	 * 描ける人(メンバー)として参加する。満員なら参加できない(見学はできる)。
	 * 同時に参加が集中しても人数上限を超えないよう、部屋の行をロックしてから数える
	 */
	@bindThis
	public async join(room: MiDrawRoom, me: MiUser): Promise<void> {
		if (room.isEnded) throw new DrawRoomError('ended');
		// モデレーターが公開範囲の外から開いている場合は、見るだけにする(描く人としては参加できない)
		if (!await this.canView(room, me)) throw new DrawRoomError('forbidden');
		if (await this.redisClient.sismember(this.kickedKey(room.id), me.id) === 1) throw new DrawRoomError('kicked');
		const joined = await this.db.transaction(async em => {
			const locked = await em.createQueryBuilder(MiDrawRoom, 'room')
				.setLock('pessimistic_write')
				.where('room.id = :id', { id: room.id })
				.getOne();
			if (locked == null) throw new DrawRoomError('noSuchRoom');
			if (locked.isEnded) throw new DrawRoomError('ended');
			if (await em.existsBy(MiDrawRoomMember, { roomId: room.id, userId: me.id })) return false;
			const count = await em.countBy(MiDrawRoomMember, { roomId: room.id });
			// 観戦に回った部屋主は、満員でも描く人に戻れる
			if (count >= locked.maxMembers && locked.ownerId !== me.id) throw new DrawRoomError('full');
			await em.insert(MiDrawRoomMember, {
				id: this.idService.gen(),
				roomId: room.id,
				userId: me.id,
			});
			return true;
		});
		if (!joined) return;
		this.globalEventService.publishDrawRoomStream(room.id, 'memberJoined', {
			user: await this.userEntityService.pack(me.id, null),
		});
	}

	@bindThis
	public async leave(room: MiDrawRoom, me: MiUser): Promise<void> {
		// JUICE: 部屋主も描く人から抜けて観戦できる(部屋主のままで、部屋の管理は続けられる。また参加し直すこともできる)
		const result = await this.drawRoomMembersRepository.delete({ roomId: room.id, userId: me.id });
		if (result.affected === 0) return;
		this.globalEventService.publishDrawRoomStream(room.id, 'memberLeft', { userId: me.id, kicked: false });
	}

	/**
	 * 部屋主がメンバーを外す。外された人は見学者になり、その部屋には参加し直せない
	 */
	@bindThis
	public async kick(room: MiDrawRoom, me: MiUser, userId: MiUser['id']): Promise<void> {
		if (room.ownerId !== me.id) throw new DrawRoomError('notOwner');
		if (userId === room.ownerId) throw new DrawRoomError('cannotKickOwner');
		// 終了した部屋のメンバーは記録として残す(保存した部屋の表示が後から変わらないように)
		if (room.isEnded) throw new DrawRoomError('ended');
		const result = await this.drawRoomMembersRepository.delete({ roomId: room.id, userId });
		if (result.affected === 0) throw new DrawRoomError('notMember');
		await this.redisClient.pipeline()
			.sadd(this.kickedKey(room.id), userId)
			.expire(this.kickedKey(room.id), REDIS_KEY_TTL_SEC)
			.exec();
		this.globalEventService.publishDrawRoomStream(room.id, 'memberLeft', { userId, kicked: true });
	}

	/**
	 * 部屋主がタイトル・人数上限・終了後の保存を変更する。人数上限を今のメンバー数より下げても、
	 * 既存のメンバーは追い出さない(新しい参加だけ止まる)。
	 * 終了処理と同時に変更されて「終了済みなのに保存の設定だけ変わる」ことがないよう、開催中の行だけを更新する
	 */
	@bindThis
	public async update(room: MiDrawRoom, me: MiUser, params: {
		title?: string;
		maxMembers?: number;
		keepAfterEnd?: boolean;
		// 途中で大きさを変えるときは左上を基準に広げる・切り詰める(線はそのまま残り、はみ出た分は見えなくなるだけ)
		canvasWidth?: number;
		canvasHeight?: number;
	}): Promise<MiDrawRoom> {
		if (room.ownerId !== me.id) throw new DrawRoomError('notOwner');
		if (room.isEnded) throw new DrawRoomError('ended');
		if (params.canvasWidth !== undefined || params.canvasHeight !== undefined) {
			await this.ensureCanvasSizeAllowed(me, params.canvasWidth ?? room.canvasWidth, params.canvasHeight ?? room.canvasHeight);
		}
		const result = await this.drawRoomsRepository.update({ id: room.id, isEnded: false }, {
			...(params.title !== undefined ? { title: params.title } : {}),
			...(params.maxMembers !== undefined ? { maxMembers: params.maxMembers } : {}),
			...(params.keepAfterEnd !== undefined ? { keepAfterEnd: params.keepAfterEnd } : {}),
			...(params.canvasWidth !== undefined ? { canvasWidth: params.canvasWidth } : {}),
			...(params.canvasHeight !== undefined ? { canvasHeight: params.canvasHeight } : {}),
		});
		if (result.affected === 0) throw new DrawRoomError('ended');
		const updated = await this.drawRoomsRepository.findOneByOrFail({ id: room.id });
		this.globalEventService.publishDrawRoomStream(room.id, 'updated', { room: await this.pack(updated, null) });
		return updated;
	}

	/**
	 * 部屋を終了する。keepAfterEndなら線とチャットをDBへ移して閲覧用に残し、そうでなければ
	 * PNG保存・投稿の猶予(UNKEPT_ROOM_RETENTION_MS)の後にcleanupで全て消す。
	 * me=nullはシステム(放置された部屋の自動終了)。
	 *
	 * 先にRedisへ終了の印を立てて以降の書き込みを止めてから、終了状態の更新と線の移行を
	 * 1つのトランザクションで行う(途中で失敗したら終了自体を取り消し、印も外す)
	 */
	@bindThis
	public async end(room: MiDrawRoom, me: MiUser | null): Promise<MiDrawRoom> {
		if (me != null && room.ownerId !== me.id) throw new DrawRoomError('notOwner');
		if (await this.redisClient.set(this.endedKey(room.id), '1', 'EX', REDIS_KEY_TTL_SEC, 'NX') == null) {
			throw new DrawRoomError('ended');
		}

		let ended: MiDrawRoom;
		try {
			ended = await this.db.transaction(async em => {
				const locked = await em.createQueryBuilder(MiDrawRoom, 'room')
					.setLock('pessimistic_write')
					.where('room.id = :id', { id: room.id })
					.getOne();
				if (locked == null) throw new DrawRoomError('noSuchRoom');
				if (locked.isEnded) throw new DrawRoomError('ended');

				const endedAt = new Date();
				if (locked.keepAfterEnd) {
					// JUICE: 下描き(本人だけに見える)のレイヤーと線もそのまま残す(描いた本人は後から見られる)。
					// ほかの人には、読み出すとき(getLayers)に除く
					const layers = await this.getStrokesFromRedis(room.id);
					for (const layer of layers) {
						if (layer.strokes.length === 0) continue;
						await em.insert(MiDrawRoomLayer, {
							id: this.idService.gen(),
							roomId: room.id,
							userId: layer.userId,
							strokes: layer.strokes,
							layers: layer.layers,
						});
					}
					await em.update(MiDrawRoom, room.id, { isEnded: true, endedAt, chatLog: await this.getChatFromRedis(room.id) });
				} else {
					await em.update(MiDrawRoom, room.id, { isEnded: true, endedAt });
				}
				return { ...locked, isEnded: true, endedAt };
			});
		} catch (err) {
			// 既に終了していた場合は、その終了処理が立てた印をそのまま残す
			if (!(err instanceof DrawRoomError && err.reason === 'ended')) {
				await this.redisClient.del(this.endedKey(room.id));
			}
			throw err;
		}

		// 保存した部屋はRedisのデータを消す。保存しない部屋は、猶予の間の画像保存のためにcleanupまで残す
		if (ended.keepAfterEnd) await this.deleteRedisData(room.id);

		this.globalEventService.publishDrawRoomStream(room.id, 'ended', { room: await this.pack(ended, null) });
		return ended;
	}

	/**
	 * 部屋主が、終了済みの部屋(保存したもの)を削除する。開催中の部屋は先に終了させる
	 */
	@bindThis
	public async delete(room: MiDrawRoom, me: MiUser): Promise<void> {
		const isOwner = room.ownerId === me.id;
		// JUICE: モデレーターは、問題のある部屋を開催中でも削除できる(モデレーションログに残す)
		const byModerator = !isOwner && await this.roleService.isModerator(me);
		if (!isOwner && !byModerator) throw new DrawRoomError('notOwner');
		if (isOwner && !room.isEnded) throw new DrawRoomError('notEnded');
		if (!room.isEnded) {
			// 削除の途中に届いた線やチャットで、Redisにキーが作り直されないよう先に書き込みを止める
			await this.redisClient.set(this.endedKey(room.id), '1', 'EX', REDIS_KEY_TTL_SEC);
		}
		await this.deleteRedisData(room.id);
		await this.drawRoomsRepository.delete(room.id);
		// deleteRedisDataは終了の印も消すので、削除の知らせが届くまでの間に書き込まれないよう、しばらく印を残す
		await this.redisClient.set(this.endedKey(room.id), '1', 'EX', 60 * 60);
		// 部屋を開いている人には、部屋が消えたことを知らせる
		this.globalEventService.publishDrawRoomStream(room.id, 'deleted', { byModerator });
		if (byModerator) {
			const owner = await this.cacheService.findUserById(room.ownerId).catch(() => null);
			this.moderationLogService.log(me, 'deleteDrawRoom', {
				roomId: room.id,
				room: {
					id: room.id,
					title: room.title,
					ownerId: room.ownerId,
					ownerUsername: owner?.username ?? '',
					ownerHost: owner?.host ?? null,
					visibility: room.visibility,
					isEnded: room.isEnded,
				},
			});
		}
	}

	/**
	 * 部屋一覧。userIdを指定しない場合は、自分が見られる開催中の部屋と、保存しないで終了してまだ削除されていない部屋
	 * (削除されるまでの間に、画像を保存・投稿できるように)。
	 * userIdを指定した場合は、そのユーザーが部屋主の部屋(開催中+保存された終了済み)。
	 * 公開範囲で見られない部屋を除いた結果がlimit件に届くまで、続きを読み進める
	 */
	@bindThis
	public async list(me: MiUser, params: { userId?: MiUser['id']; limit: number; untilId?: string }): Promise<MiDrawRoom[]> {
		await this.ensureEnabled();
		const visible: MiDrawRoom[] = [];
		let untilId = params.untilId;
		for (let batch = 0; batch < 10 && visible.length < params.limit; batch++) {
			const query = this.drawRoomsRepository.createQueryBuilder('room')
				.orderBy('room.id', 'DESC')
				.limit(params.limit * 2);
			if (untilId) query.andWhere('room.id < :untilId', { untilId });
			if (params.userId) {
				query.andWhere('room.ownerId = :userId', { userId: params.userId });
				query.andWhere('(room.isEnded = FALSE OR room.keepAfterEnd = TRUE)');
			} else {
				query.andWhere('room.isEnded = FALSE');
			}
			const rooms = await query.getMany();
			for (const room of rooms) {
				if (await this.canView(room, me)) visible.push(room);
				if (visible.length >= params.limit) break;
			}
			if (rooms.length < params.limit * 2) break;
			untilId = rooms.at(-1)!.id;
		}
		// JUICE: 保存しないで終了し、まだ削除されていない部屋(1時間以内に終了したものだけなので少ない)は、最初のページに足す
		// (開催中の部屋と1つの条件にまとめると、保存した部屋が増えるほど遅くなるため、別に引く)
		if (params.userId == null && params.untilId == null) {
			const ending = await this.drawRoomsRepository.createQueryBuilder('room')
				.where('room.isEnded = TRUE')
				.andWhere('room.keepAfterEnd = FALSE')
				.andWhere('room.endedAt > :cutoff', { cutoff: new Date(Date.now() - UNKEPT_ROOM_RETENTION_MS) })
				.orderBy('room.endedAt', 'DESC')
				.limit(50)
				.getMany();
			for (const room of ending) {
				if (await this.canView(room, me)) visible.push(room);
			}
		}
		return visible;
	}

	//#region 線(ユーザーごとのレイヤー)
	@bindThis
	private async getStrokesFromRedis(roomId: MiDrawRoom['id']): Promise<{ userId: MiUser['id']; strokes: DrawStroke[]; layers: DrawLayerMeta[] }[]> {
		const drawers = await this.redisClient.smembers(this.drawersKey(roomId));
		return await Promise.all(drawers.map(async userId => ({
			userId,
			strokes: (await this.redisClient.lrange(this.strokesKey(roomId, userId), 0, -1)).map(x => JSON.parse(x) as DrawStroke),
			layers: await this.getUserLayers(roomId, userId),
		})));
	}

	// JUICE: 線を動かす・切る・消すなど、線を足さない操作だけが続いても、レイヤーの一覧が線より先に期限切れにならないようにする
	// (期限切れになると最初のレイヤーだけに戻り、ほかのレイヤーの線が一覧に無いレイヤーの線になってしまうため)
	@bindThis
	private async touchLayers(roomId: MiDrawRoom['id'], userId: MiUser['id']): Promise<void> {
		await this.redisClient.expire(this.layersKey(roomId, userId), REDIS_KEY_TTL_SEC);
	}

	// JUICE: その人のレイヤーの一覧(無ければ最初のレイヤー1枚だけ)
	@bindThis
	private async getUserLayers(roomId: MiDrawRoom['id'], userId: MiUser['id']): Promise<DrawLayerMeta[]> {
		return this.parseLayers(await this.redisClient.get(this.layersKey(roomId, userId)));
	}

	// Redisに置いたレイヤーの一覧(JSON)を読む。無い・壊れているなら最初のレイヤー1枚だけ(共有の初期値は複製して返す)
	private parseLayers(raw: string | null | undefined): DrawLayerMeta[] {
		const defaults = () => DEFAULT_DRAW_LAYERS.map(layer => ({ ...layer }));
		if (raw == null || raw === '') return defaults();
		try {
			const layers = JSON.parse(raw) as DrawLayerMeta[];
			return Array.isArray(layers) && layers.length > 0 ? layers : defaults();
		} catch {
			return defaults();
		}
	}

	/**
	 * JUICE: 自分のレイヤーの一覧を置き換える(追加・削除・名前・並び・表示・濃さ)。一覧から消したレイヤーの線も消す。
	 * 呼び出し側で、一覧の形(1〜DRAW_USER_MAX_LAYERS枚、idが重ならない等)を確認済みであること
	 */
	@bindThis
	public async setUserLayers(roomId: MiDrawRoom['id'], userId: MiUser['id'], layers: DrawLayerMeta[]): Promise<boolean> {
		const [result, beforeRaw] = await this.redisClient.eval(
			SET_LAYERS_SCRIPT, 9,
			this.endedKey(roomId), this.strokesKey(roomId, userId), this.bytesKey(roomId, userId), this.layersKey(roomId, userId), this.drawersKey(roomId), ...this.historyKeys(roomId, userId),
			JSON.stringify(layers), JSON.stringify(layers.map(layer => layer.id)), userId, REDIS_KEY_TTL_SEC.toString(),
		) as [number, string];
		if (result < 0) return false;
		const before = this.parseLayers(beforeRaw);
		await this.touch(roomId);
		// ほかの人のストリームでは、下描きのレイヤーは除いて流す(channels/draw-room.ts)
		this.globalEventService.publishDrawRoomStream(roomId, 'layersUpdated', { userId, layers });
		// JUICE: 下描きから皆に見せるようにしたレイヤーは、今の線をまとめて配る(ほかの人はまだ持っていないため)
		const published = layers.filter(layer => !layer.private && before.some(old => old.id === layer.id && old.private));
		if (published.length > 0) {
			const strokes = (await this.redisClient.lrange(this.strokesKey(roomId, userId), 0, -1)).map(x => JSON.parse(x) as DrawStroke);
			for (const layer of published) {
				this.globalEventService.publishDrawRoomStream(roomId, 'layerPublished', { userId, layer: layer.id, strokes: strokes.filter(stroke => (stroke.layer ?? '0') === layer.id) });
			}
		}
		return true;
	}

	// JUICE: その人の下描き(本人だけに見える)のレイヤーのid。一覧を変えるのと同時に届いた操作で、古い判定のまま
	// 皆に配ってしまわないよう、覚えておかずに毎回読む
	@bindThis
	private async privateLayerIds(roomId: MiDrawRoom['id'], userId: MiUser['id']): Promise<Set<string>> {
		return new Set((await this.getUserLayers(roomId, userId)).filter(layer => layer.private).map(layer => layer.id));
	}

	// JUICE: 見ている人向けに、ほかの人の下描きのレイヤーとその線を除く
	private hidePrivateLayers(entries: { userId: MiUser['id']; strokes: DrawStroke[]; layers: DrawLayerMeta[] }[], viewerId: MiUser['id'] | null) {
		return entries.map(entry => {
			if (entry.userId === viewerId) return entry;
			const privateIds = new Set(entry.layers.filter(layer => layer.private).map(layer => layer.id));
			if (privateIds.size === 0) return entry;
			return {
				...entry,
				layers: entry.layers.filter(layer => !layer.private),
				strokes: entry.strokes.filter(stroke => !privateIds.has(stroke.layer ?? '0')),
			};
		});
	}

	/**
	 * 全員のレイヤーの線。途中参加・再接続・保存された部屋の閲覧用
	 */
	@bindThis
	public async getLayers(room: MiDrawRoom, viewerId: MiUser['id'] | null): Promise<{ userId: MiUser['id']; strokes: DrawStroke[]; layers: DrawLayerMeta[] }[]> {
		if (room.isEnded && room.keepAfterEnd) {
			const layers = await this.drawRoomLayersRepository.findBy({ roomId: room.id });
			return this.hidePrivateLayers(layers.map(layer => ({ userId: layer.userId, strokes: layer.strokes, layers: layer.layers ?? DEFAULT_DRAW_LAYERS.map(meta => ({ ...meta })) })), viewerId);
		}
		return this.hidePrivateLayers(await this.getStrokesFromRedis(room.id), viewerId);
	}

	/**
	 * 操作の回数制限。同じユーザーが同じ部屋へ複数接続しても合算する
	 */
	@bindThis
	public async withinRateLimit(roomId: MiDrawRoom['id'], userId: MiUser['id'], kind: keyof typeof DRAW_ROOM_RATE_LIMITS): Promise<boolean> {
		const key = `drawroom:${roomId}:rate:${userId}:${kind}:${Math.floor(Date.now() / 1000)}`;
		const [[, count]] = await this.redisClient.pipeline().incr(key).expire(key, 2).exec() as [[Error | null, number], unknown];
		return count <= DRAW_ROOM_RATE_LIMITS[kind];
	}

	/**
	 * JUICE: その人が1つの部屋に置ける線の本数・データ量(バイト)の上限(ロールのポリシー)
	 */
	@bindThis
	public async strokeLimits(userId: MiUser['id']): Promise<{ strokes: number; bytes: number }> {
		const { drawRoomMaxStrokes, drawRoomMaxStrokeMegabytes } = await this.roleService.getUserPolicies(userId);
		return {
			strokes: Math.max(1, Math.min(DRAW_LAYER_MAX_STROKES, Math.floor(drawRoomMaxStrokes))),
			bytes: Math.max(1024 * 1024, Math.min(DRAW_LAYER_MAX_BYTES, Math.floor(drawRoomMaxStrokeMegabytes * 1024 * 1024))),
		};
	}

	/**
	 * 描き終わった線を自分のレイヤーに追加する(呼び出し側で、メンバーかを確認済みであること)。
	 * 部屋が終了していたり、上限に達していたりしたら追加しない。
	 * JUICE: 返り値は、追加したか・本数の上限('strokes')・データ量の上限('bytes')・それ以外で断った('rejected')
	 */
	@bindThis
	public async addStroke(roomId: MiDrawRoom['id'], userId: MiUser['id'], stroke: DrawStroke): Promise<'added' | 'strokes' | 'bytes' | 'rejected'> {
		const limits = await this.strokeLimits(userId);
		const result = await this.redisClient.eval(
			ADD_STROKE_SCRIPT, 10,
			this.endedKey(roomId), this.strokesKey(roomId, userId), this.bytesKey(roomId, userId), this.drawersKey(roomId), this.lastActivityKey(roomId), this.layersKey(roomId, userId), ...this.historyKeys(roomId, userId),
			JSON.stringify(stroke), userId, Date.now().toString(), limits.strokes.toString(), limits.bytes.toString(), REDIS_KEY_TTL_SEC.toString(), stroke.layer ?? '0', stroke.id,
		) as number;
		if (result === -1) return 'strokes';
		if (result === -3) return 'bytes';
		// 下描きのレイヤーかどうかは、線を入れたのと同じ処理の中で決めている(3)
		if (result !== 1 && result !== 3) return 'rejected';
		this.globalEventService.publishDrawRoomStream(roomId, 'stroke', { userId, stroke, ...(result === 3 ? { private: true } : {}) });
		return 'added';
	}

	/**
	 * 描いている途中の線を全員に配信する(保存しない)
	 */
	@bindThis
	public async publishStrokePart(roomId: MiDrawRoom['id'], userId: MiUser['id'], part: Omit<DrawStroke, 'id'> & { strokeId: string }): Promise<void> {
		const isPrivate = (await this.privateLayerIds(roomId, userId)).has(part.layer ?? '0');
		this.globalEventService.publishDrawRoomStream(roomId, 'strokePart', { userId, ...part, ...(isPrivate ? { private: true } : {}) });
	}

	/**
	 * カーソル(マウス・ペンの位置)を全員に配信する(保存しない)。null はキャンバスの外に出たこと。
	 * 1件ずつ配ると人数の2乗で配信が増えるので、部屋ごとに一定間隔でまとめて1通にする
	 */
	//#region 部屋を開いている人(オンライン)
	/**
	 * 部屋のストリームにつながったことを記録し、部屋を開いている人の一覧を全員に配る。
	 * 同じ人が複数のタブで開いていてもよいよう、接続ごとに記録する
	 */
	@bindThis
	public async enterPresence(roomId: MiDrawRoom['id'], userId: MiUser['id'], connectionId: string): Promise<void> {
		const key = this.presenceKey(roomId);
		await this.redisClient.pipeline()
			.zadd(key, Date.now(), `${userId}:${connectionId}`)
			.expire(key, REDIS_KEY_TTL_SEC)
			.exec();
		await this.publishPresence(roomId);
	}

	/**
	 * つながっている接続が生きていることを記録する。切断の知らせが届かなかった(サーバーの再起動など)
	 * 古い接続はここで取り除き、変わっていれば一覧を配り直す
	 */
	@bindThis
	public async heartbeatPresence(roomId: MiDrawRoom['id'], userId: MiUser['id'], connectionId: string): Promise<void> {
		const key = this.presenceKey(roomId);
		const [, [, removed]] = await this.redisClient.pipeline()
			.zadd(key, Date.now(), `${userId}:${connectionId}`)
			.zremrangebyscore(key, '-inf', Date.now() - DRAW_ROOM_PRESENCE_TIMEOUT_MS)
			.expire(key, REDIS_KEY_TTL_SEC)
			.exec() as [unknown, [Error | null, number], unknown];
		if (removed > 0) await this.publishPresence(roomId);
	}

	/**
	 * 接続が切れた・画面を離れたことを記録する。
	 * 本人から離れたと知らせがあった(タブを閉じた・別のサイトやタブに移った)ときは、すぐに一覧を配る。
	 * 知らせなしに接続が切れたときは、つなぎ直し(古い接続が切れてから新しい接続が入る)で一瞬オフラインに
	 * 見えないよう、少し待ってから配る(その間に戻ってくればオンラインのまま配られる)
	 */
	@bindThis
	public async leavePresence(roomId: MiDrawRoom['id'], userId: MiUser['id'], connectionId: string, immediate = false): Promise<void> {
		const removed = await this.redisClient.zrem(this.presenceKey(roomId), `${userId}:${connectionId}`);
		if (removed === 0) return;
		if (immediate) {
			await this.publishPresence(roomId);
			return;
		}
		if (this.presencePublishTimers.has(roomId)) return;
		this.presencePublishTimers.set(roomId, setTimeout(() => {
			this.presencePublishTimers.delete(roomId);
			this.publishPresence(roomId).catch(() => {});
		}, PRESENCE_LEAVE_DELAY_MS));
	}

	/**
	 * 今この部屋を開いている人のid
	 */
	@bindThis
	public async getOnlineUserIds(roomId: MiDrawRoom['id']): Promise<MiUser['id'][]> {
		const entries = await this.redisClient.zrangebyscore(this.presenceKey(roomId), Date.now() - DRAW_ROOM_PRESENCE_TIMEOUT_MS, '+inf');
		return [...new Set(entries.map(entry => entry.split(':')[0]))];
	}

	@bindThis
	private async publishPresence(roomId: MiDrawRoom['id']): Promise<void> {
		this.globalEventService.publishDrawRoomStream(roomId, 'presence', { userIds: await this.getOnlineUserIds(roomId) });
	}
	//#endregion

	@bindThis
	public publishCursor(roomId: MiDrawRoom['id'], userId: MiUser['id'], x: number | null, y: number | null, pet = false): void {
		let buffer = this.cursorBuffers.get(roomId);
		if (buffer == null) {
			buffer = new Map();
			this.cursorBuffers.set(roomId, buffer);
		}
		// JUICE: petは、なでるツールで絵をなでているところ
		buffer.set(userId, { x, y, pet });
		if (!this.cursorFlushTimers.has(roomId)) {
			this.cursorFlushTimers.set(roomId, setTimeout(() => this.flushCursors(roomId), CURSOR_FLUSH_INTERVAL_MS));
		}
	}

	@bindThis
	private flushCursors(roomId: MiDrawRoom['id']): void {
		this.cursorFlushTimers.delete(roomId);
		const buffer = this.cursorBuffers.get(roomId);
		this.cursorBuffers.delete(roomId);
		if (buffer == null || buffer.size === 0) return;
		const cursors = [...buffer].map(([userId, { x, y, pet }]) => ({ userId, x, y, ...(pet ? { pet: true } : {}) }));
		this.globalEventService.publishDrawRoomStream(roomId, 'cursors', { cursors });
	}

	@bindThis
	public onApplicationShutdown(): void {
		for (const timer of this.cursorFlushTimers.values()) clearTimeout(timer);
		this.cursorFlushTimers.clear();
		for (const timer of this.presencePublishTimers.values()) clearTimeout(timer);
		this.presencePublishTimers.clear();
		this.cursorBuffers.clear();
	}

	/**
	 * 描いている途中の線を取りやめたことを全員に知らせる(途中まで表示していた線を消してもらう)
	 */
	@bindThis
	public publishStrokeCancel(roomId: MiDrawRoom['id'], userId: MiUser['id'], strokeId: string): void {
		this.globalEventService.publishDrawRoomStream(roomId, 'strokeCancel', { userId, strokeId });
	}

	/**
	 * JUICE: 自分の最後の操作(線を描く・動かす・回す・消す、下描きのレイヤーの消去・削除)を取り消す・やり直す。
	 * 上限を超えて戻せないときはfalseを返す(本人に知らせるため)
	 */
	@bindThis
	public async undoRedo(roomId: MiDrawRoom['id'], userId: MiUser['id'], direction: 'undo' | 'redo'): Promise<boolean> {
		const limits = await this.strokeLimits(userId);
		const [result, stepsRaw, layersRaw, layersChanged] = await this.redisClient.eval(
			UNDO_REDO_SCRIPT, 8,
			this.endedKey(roomId), this.strokesKey(roomId, userId), this.bytesKey(roomId, userId), this.layersKey(roomId, userId), ...this.historyKeys(roomId, userId),
			direction === 'undo' ? 'u' : 'r', limits.strokes.toString(), limits.bytes.toString(), REDIS_KEY_TTL_SEC.toString(), DRAW_USER_MAX_LAYERS.toString(),
		) as [number, string, string, number];
		if (result === -2) return false;
		if (result !== 1) return true;
		await this.touch(roomId);
		const layers = this.parseLayers(layersRaw);
		// レイヤーを戻した・消したときは、線より先にレイヤーの一覧を配る(戻す線のレイヤーを先に用意してもらう)
		if (layersChanged === 1) this.globalEventService.publishDrawRoomStream(roomId, 'layersUpdated', { userId, layers });
		if (stepsRaw === '') return true;
		const steps = (JSON.parse(stepsRaw) as ({ t: 'del'; ids: string[] } | { t: 'mv'; ids: string[] | '*'; dx: number; dy: number } | { t: 'ins'; items: { a?: string; s: string }[] })[]).map(step => {
			if (step.t === 'del') return { t: 'del' as const, ids: step.ids };
			if (step.t === 'mv') return { t: 'mv' as const, ids: step.ids === '*' ? null : step.ids, dx: step.dx, dy: step.dy };
			return { t: 'ins' as const, items: step.items.map(item => ({ before: item.a ?? null, stroke: JSON.parse(item.s) as DrawStroke })) };
		});
		// 下描きのレイヤーの線は、ほかの人のストリームでは除いて流す(channels/draw-room.ts)。
		// 下描きかは、戻したのと同じ処理の中で読んだ一覧で決める(直後に一覧が変わっても、古い判定で配らないように)
		const privateLayers = layers.filter(layer => layer.private).map(layer => layer.id);
		this.globalEventService.publishDrawRoomStream(roomId, 'strokesPatched', { userId, steps, ...(privateLayers.length > 0 ? { privateLayers } : {}) });
		return true;
	}

	/**
	 * JUICE: 自分のレイヤーの線を移動する。strokeIdsがnullならレイヤー全体を動かす
	 */
	@bindThis
	public async moveStrokes(roomId: MiDrawRoom['id'], userId: MiUser['id'], strokeIds: string[] | null, dx: number, dy: number, mergeHistory = false): Promise<boolean> {
		const limits = await this.strokeLimits(userId);
		const moved = await this.redisClient.eval(
			MOVE_STROKES_SCRIPT, 7,
			this.endedKey(roomId), this.strokesKey(roomId, userId), this.bytesKey(roomId, userId), ...this.historyKeys(roomId, userId),
			dx.toString(), dy.toString(), strokeIds == null ? '*' : JSON.stringify(strokeIds), REDIS_KEY_TTL_SEC.toString(), limits.bytes.toString(), mergeHistory ? '1' : '0',
		) as number;
		// 大きさの上限を超える(-2)ときは断ったことを返す(動かした本人の画面を戻すため)
		if (moved === -2) return false;
		if (moved <= 0) return true;
		await this.touch(roomId);
		await this.touchLayers(roomId, userId);
		this.globalEventService.publishDrawRoomStream(roomId, 'strokesMoved', { userId, strokeIds, dx, dy });
		return true;
	}

	/**
	 * JUICE: 選択範囲の境目で切った線を、切った後の線の並びに置き換える(選んだ部分だけを動かす・消すため)
	 */
	@bindThis
	public async splitStrokes(roomId: MiDrawRoom['id'], userId: MiUser['id'], splits: { id: string; pieces: DrawStroke[] }[]): Promise<{ ok: boolean; recorded: boolean }> {
		const limits = await this.strokeLimits(userId);
		const map: Record<string, string[]> = {};
		for (const split of splits) map[split.id] = split.pieces.map(piece => JSON.stringify(piece));
		const [replaced, layersRaw, recorded] = await this.redisClient.eval(
			SPLIT_STROKES_SCRIPT, 8,
			this.endedKey(roomId), this.strokesKey(roomId, userId), this.bytesKey(roomId, userId), this.layersKey(roomId, userId), ...this.historyKeys(roomId, userId),
			JSON.stringify(map), limits.strokes.toString(), limits.bytes.toString(), REDIS_KEY_TTL_SEC.toString(),
			JSON.stringify(splits.flatMap(split => split.pieces.map(piece => piece.id))),
		) as [number, string, number];
		if (replaced <= 0) return { ok: false, recorded: false };
		await this.touchLayers(roomId, userId);
		// 下描きのレイヤーの線は、ほかの人のストリームでは除いて流す(線ごとに。置き換えた時点の一覧で決める)
		const privateLayers = this.parseLayers(layersRaw).filter(layer => layer.private).map(layer => layer.id);
		this.globalEventService.publishDrawRoomStream(roomId, 'strokesSplit', { userId, splits, ...(privateLayers.length > 0 ? { privateLayers } : {}) });
		return { ok: true, recorded: recorded === 1 };
	}

	/**
	 * JUICE: 自分のレイヤーの、選んだ線だけを消す
	 */
	@bindThis
	public async deleteStrokes(roomId: MiDrawRoom['id'], userId: MiUser['id'], strokeIds: string[], mergeHistory = false): Promise<void> {
		const removed = await this.redisClient.eval(
			DELETE_STROKES_SCRIPT, 7,
			this.endedKey(roomId), this.strokesKey(roomId, userId), this.bytesKey(roomId, userId), ...this.historyKeys(roomId, userId),
			JSON.stringify(strokeIds), REDIS_KEY_TTL_SEC.toString(), mergeHistory ? '1' : '0',
		) as number;
		if (removed <= 0) return;
		await this.touch(roomId);
		await this.touchLayers(roomId, userId);
		this.globalEventService.publishDrawRoomStream(roomId, 'strokesDeleted', { userId, strokeIds });
	}

	/**
	 * レイヤーの線を全て消す(自分のレイヤー、または部屋主がほかの人のレイヤーを)
	 */
	@bindThis
	public async clearLayer(roomId: MiDrawRoom['id'], userId: MiUser['id'], layer?: string): Promise<void> {
		// JUICE: レイヤーを指定したら、その人のそのレイヤーの線だけを消す
		if (layer != null) {
			// その人が持っていないレイヤーなら、線を見に行かない(存在しないレイヤーの指定を繰り返して重くされないように)
			const metas = await this.getUserLayers(roomId, userId);
			if (!metas.some(meta => meta.id === layer)) return;
			// 下描きのレイヤーの消去だけ、取り消せるよう履歴に積む(下描きかは、消すのと同じ処理の中で決める)
			const [removed, isPrivate] = await this.redisClient.eval(
				REMOVE_LAYER_STROKES_SCRIPT, 8,
				this.endedKey(roomId), this.strokesKey(roomId, userId), this.bytesKey(roomId, userId), this.layersKey(roomId, userId), ...this.historyKeys(roomId, userId),
				layer, REDIS_KEY_TTL_SEC.toString(),
			) as [number, number];
			if (removed > 0) {
				await this.touchLayers(roomId, userId);
				this.globalEventService.publishDrawRoomStream(roomId, 'clearLayer', { userId, layer, ...(isPrivate === 1 ? { private: true } : {}) });
			}
			return;
		}
		const result = await this.redisClient.eval(
			CLEAR_LAYER_SCRIPT, 7,
			this.endedKey(roomId), this.strokesKey(roomId, userId), this.bytesKey(roomId, userId), ...this.historyKeys(roomId, userId),
		) as number;
		if (result !== 1) return;
		this.globalEventService.publishDrawRoomStream(roomId, 'clearLayer', { userId });
	}
	//#endregion

	//#region チャット
	@bindThis
	private async getChatFromRedis(roomId: MiDrawRoom['id']): Promise<DrawRoomChatMessage[]> {
		return (await this.redisClient.lrange(this.chatKey(roomId), 0, -1)).map(x => JSON.parse(x) as DrawRoomChatMessage);
	}

	@bindThis
	public async getChat(room: MiDrawRoom): Promise<DrawRoomChatMessage[]> {
		if (room.isEnded && room.keepAfterEnd) return room.chatLog;
		return await this.getChatFromRedis(room.id);
	}

	/**
	 * チャットに発言する(見学者も発言できる。呼び出し側で、見られるかを確認済みであること)
	 */
	@bindThis
	public async postChat(roomId: MiDrawRoom['id'], me: MiUser, text: string): Promise<void> {
		const message: DrawRoomChatMessage = {
			id: this.idService.gen(),
			userId: me.id,
			text,
			createdAt: Date.now(),
		};
		const result = await this.redisClient.eval(
			POST_CHAT_SCRIPT, 3,
			this.endedKey(roomId), this.chatKey(roomId), this.lastActivityKey(roomId),
			JSON.stringify(message), CHAT_LOG_LENGTH.toString(), Date.now().toString(), REDIS_KEY_TTL_SEC.toString(),
		) as number;
		if (result !== 1) return;
		this.globalEventService.publishDrawRoomStream(roomId, 'chat', {
			message,
			user: await this.userEntityService.pack(me.id, null),
		});
	}
	//#endregion

	/**
	 * 定期処理: 放置された開催中の部屋を終了し、終了した「保存しない」部屋を猶予の後に削除する
	 */
	@bindThis
	public async cleanup(): Promise<void> {
		const activeRooms = await this.drawRoomsRepository.findBy({ isEnded: false });
		for (const room of activeRooms) {
			const lastActivity = Number(await this.redisClient.get(this.lastActivityKey(room.id)) ?? 0);
			const since = Math.max(lastActivity, this.idService.parse(room.id).date.getTime());
			if (Date.now() - since < IDLE_ROOM_TIMEOUT_MS) continue;
			await this.end(room, null).catch(() => { /* 同時に終了された場合など */ });
		}

		const expired = await this.drawRoomsRepository.findBy({
			isEnded: true,
			keepAfterEnd: false,
			endedAt: LessThan(new Date(Date.now() - UNKEPT_ROOM_RETENTION_MS)),
		});
		for (const room of expired) {
			await this.deleteRedisData(room.id);
		}
		if (expired.length > 0) {
			await this.drawRoomsRepository.delete({ id: In(expired.map(room => room.id)) });
		}
	}
}
