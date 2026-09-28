/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { bindThis } from '@/decorators.js';
import {
	DRAW_CHAT_MAX_LENGTH,
	DRAW_ROOM_PRESENCE_HEARTBEAT_MS,
	DRAW_LAYER_MAX_STROKES,
	DRAW_USER_MAX_LAYERS,
	DRAW_STROKE_MAX_POINTS,
	DRAW_STROKE_MAX_SIZE,
	DRAW_STROKE_PART_MAX_POINTS,
	DrawRoomService,
	decodeDrawPoints,
} from '@/core/DrawRoomService.js';
import type { MiDrawRoom } from '@/models/DrawRoom.js';
import { DRAW_LAYER_BLENDS, type DrawLayerBlend, type DrawLayerMeta, type DrawStroke } from '@/models/DrawRoomLayer.js';
import type { GlobalEvents } from '@/core/GlobalEventService.js';
import { isJsonObject } from '@/misc/json-value.js';
import type { JsonObject, JsonValue } from '@/misc/json-value.js';
import Channel, { type ChannelRequest } from '../channel.js';

// JUICE: 接続したまま公開範囲から外れた(フォローを外された・ブロックされた)場合や、管理者が機能を
// 無効にした場合に備えて、見られるかどうかをこの間隔で確認し直す
const RECHECK_INTERVAL_MS = 1000 * 30;

/**
 * JUICE: 絵チャの部屋のストリーム。線・チャットの送信を受け付け、部屋の全員に配信する。
 * 部屋を見られない人は接続しても何も受け取れない。線を描けるのはメンバーだけで、
 * 自分のレイヤー以外には書き込めない(線は常に接続しているユーザー自身のレイヤーに入る)
 */
@Injectable({ scope: Scope.TRANSIENT })
export class DrawRoomChannel extends Channel {
	public readonly chName = 'drawRoom';
	public static shouldShare = false;
	public static requireCredential = true as const;
	public static kind = 'read:draw-rooms';

	private room: MiDrawRoom | null = null;
	private isMember = false;
	private lastCheckedAt = 0;
	// JUICE: 部屋を開いている人(オンライン)として記録するときの、この接続のid
	private readonly presenceId = randomUUID();
	private presenceTimer: NodeJS.Timeout | null = null;
	// 画面を離れている(別のタブ・アプリを見ている)ならオフラインとして扱う
	private away = false;
	// JUICE: モデレーターが公開範囲の外から確認のために開いている。見るだけで、チャット・カーソル・
	// オンライン表示など部屋の人に見えることはしない
	private viewOnly = false;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		private drawRoomService: DrawRoomService,
	) {
		super(request);
	}

	@bindThis
	public async init(params: JsonObject) {
		if (typeof params.roomId !== 'string' || this.user == null) return;
		const room = await this.drawRoomService.getRoom(params.roomId, this.user).catch(() => null);
		if (room == null) return;
		this.room = room;
		this.isMember = await this.drawRoomService.isMember(room.id, this.user.id);
		this.lastCheckedAt = Date.now();
		this.viewOnly = !await this.drawRoomService.canView(room, this.user);
		this.subscriber.on(`drawRoomStream:${room.id}`, this.onEvent);
		if (this.viewOnly) return;
		await this.drawRoomService.enterPresence(room.id, this.user.id, this.presenceId);
		this.presenceTimer = setInterval(this.heartbeat, DRAW_ROOM_PRESENCE_HEARTBEAT_MS);
	}

	@bindThis
	private async heartbeat() {
		if (this.room == null || this.user == null) return;
		// 見られなくなっていたら(フォローを外されたなど)、ここで購読をやめてオフラインにする
		if (!await this.stillAllowed()) return;
		if (this.away) return;
		await this.drawRoomService.heartbeatPresence(this.room.id, this.user.id, this.presenceId).catch(() => {});
	}

	@bindThis
	private stopPresence(roomId: MiDrawRoom['id']) {
		if (this.presenceTimer != null) clearInterval(this.presenceTimer);
		this.presenceTimer = null;
		if (this.user != null) this.drawRoomService.leavePresence(roomId, this.user.id, this.presenceId).catch(() => {});
	}

	// JUICE: 自分に関わる出来事(参加・キック・終了)で、描けるかどうかの状態を更新してからクライアントへ流す
	@bindThis
	private onEvent(data: GlobalEvents['drawRoom']['payload']) {
		if (this.room == null || this.user == null) return;
		if (data.type === 'memberJoined' && data.body.user.id === this.user.id) this.isMember = true;
		if (data.type === 'memberLeft' && data.body.userId === this.user.id) this.isMember = false;
		if (data.type === 'ended' || data.type === 'deleted') this.room = { ...this.room, isEnded: true };
		if (data.type === 'updated') {
			const { title, maxMembers, canvasWidth, canvasHeight } = data.body.room;
			// 大きさが変わったら、線の座標の確認もその大きさで行う
			this.room = { ...this.room, title, maxMembers, canvasWidth, canvasHeight };
		}
		// JUICE: ほかの人の下描き(本人だけに見える)のレイヤーの線と、レイヤーそのものは流さない
		if ('userId' in data.body && data.body.userId !== this.user.id) {
			if (data.type === 'strokePart' || data.type === 'stroke') {
				const strokeId = data.type === 'stroke' ? data.body.stroke.id : data.body.strokeId;
				if (data.body.private) {
					// 描いている途中で下描きに変わった線は、途中まで届いていた分をこの人の画面から消してもらう
					if (this.forwardedPartIds.delete(strokeId)) this.send('strokeCancel', { userId: data.body.userId, strokeId });
					return;
				}
				if (data.type === 'strokePart') this.rememberForwardedPart(strokeId);
				else this.forwardedPartIds.delete(strokeId);
			}
			if (data.type === 'clearLayer' && data.body.private) return;
			if (data.type === 'strokesPatched' && data.body.privateLayers != null) {
				// 戻す線のうち、下描きのレイヤーの線だけを除く(消す・ずらす線のidは、持っていなければ何も起きないのでそのまま)
				const hidden = new Set(data.body.privateLayers);
				const steps = data.body.steps
					.map(step => (step.t === 'ins' ? { ...step, items: step.items.filter(item => !hidden.has(item.stroke.layer ?? '0')) } : step))
					.filter(step => step.t !== 'ins' || step.items.length > 0);
				if (steps.length > 0) this.send({ type: 'strokesPatched', body: { userId: data.body.userId, steps } });
				return;
			}
			if (data.type === 'layersUpdated' && data.body.layers.some(layer => layer.private)) {
				this.send({ type: 'layersUpdated', body: { ...data.body, layers: data.body.layers.filter(layer => !layer.private) } });
				return;
			}
			if (data.type === 'strokesSplit' && data.body.privateLayers != null) {
				// 線ごとに、下描きのレイヤーの線だけを除く(元の線のidは残し、この人の画面からも元の線を取り除いてもらう)
				const hidden = new Set(data.body.privateLayers);
				const splits = data.body.splits.map(split => ({ id: split.id, pieces: split.pieces.filter(piece => !hidden.has(piece.layer ?? '0')) }));
				this.send({ type: 'strokesSplit', body: { userId: data.body.userId, splits } });
				return;
			}
		}
		this.send(data);
	}

	// JUICE: この接続に途中まで流した、ほかの人の描いている途中の線のid(下描きに変わったときに取り消してもらうため)。
	// 取り消し・確定が届かなかった分で増え続けないよう、古いものから捨てる
	private forwardedPartIds = new Set<string>();

	private rememberForwardedPart(strokeId: string): void {
		if (this.forwardedPartIds.has(strokeId)) return;
		this.forwardedPartIds.add(strokeId);
		if (this.forwardedPartIds.size > 500) {
			const oldest = this.forwardedPartIds.values().next().value;
			if (oldest != null) this.forwardedPartIds.delete(oldest);
		}
	}

	// JUICE: 書き込み系の操作はwrite:draw-roomsの権限が必要(サードパーティーのトークンがread権限だけの場合)
	@bindThis
	private hasWritePermission(): boolean {
		const token = this.connection.token;
		return token == null || token.permission.includes('write:draw-rooms');
	}

	/**
	 * 一定間隔で、まだ部屋を見られるか(と機能が有効か)を確認し直す。見られなくなっていたら購読をやめる
	 */
	@bindThis
	private async stillAllowed(): Promise<boolean> {
		if (this.room == null || this.user == null) return false;
		if (Date.now() - this.lastCheckedAt < RECHECK_INTERVAL_MS) return true;
		this.lastCheckedAt = Date.now();
		const allowed = await this.drawRoomService.getRoom(this.room.id, this.user).then(() => true, () => false);
		if (!allowed) {
			this.subscriber.off(`drawRoomStream:${this.room.id}`, this.onEvent);
			this.stopPresence(this.room.id);
			this.room = null;
			this.isMember = false;
		}
		return allowed;
	}

	@bindThis
	private canDraw(): boolean {
		// JUICE: 引っ越し済みのアカウントは、すでにメンバーでも描けない(参加もできない)
		return this.room != null && !this.room.isEnded && this.isMember && this.user?.movedToUri == null;
	}

	/**
	 * 線の内容を検証する。座標はキャンバスの少し外側まで許す(はみ出して描いた線の端)
	 */
	@bindThis
	private parseStrokeBody(body: JsonObject, maxPoints: number, margin: number = DRAW_STROKE_MAX_SIZE): Omit<DrawStroke, 'id'> | null {
		if (this.room == null) return null;
		const { tool, color, size, opacity, points, brush, clip, layer, lock } = body;
		// JUICE: どのレイヤーの線か(省略したら最初のレイヤー)
		if (layer !== undefined && !this.isValidLayerId(layer)) return null;
		if (tool !== 'pen' && tool !== 'eraser' && tool !== 'fill') return null;
		if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) return null;
		if (typeof size !== 'number' || !Number.isFinite(size) || size < 0.5 || size > DRAW_STROKE_MAX_SIZE) return null;
		// 不透明度は省略できる(省略・1なら不透明)
		if (opacity !== undefined && (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0.05 || opacity > 1)) return null;
		// 筆の種類・線の中だけ塗る範囲は省略できる
		if (brush !== undefined && brush !== 'soft' && brush !== 'dot' && brush !== 'area') return null;
		// JUICE: 囲った範囲を消すのは消しゴムだけ(ペンで囲って塗るのはtool: 'fill')
		if (brush === 'area' && tool !== 'eraser') return null;
		if (clip !== undefined && (typeof clip !== 'string' || decodeDrawPoints(clip, DRAW_STROKE_MAX_POINTS) == null)) return null;
		// JUICE: 透明度ロックは省略できる(消しゴムには付けない)
		if (lock !== undefined && typeof lock !== 'boolean') return null;
		if (typeof points !== 'string') return null;
		const decoded = decodeDrawPoints(points, maxPoints);
		if (decoded == null) return null;
		for (let i = 0; i < decoded.length; i += 3) {
			const x = decoded[i];
			const y = decoded[i + 1];
			if (x < -margin || x > this.room.canvasWidth + margin || y < -margin || y > this.room.canvasHeight + margin) return null;
		}
		return {
			tool,
			color: color.toLowerCase(),
			size,
			...(opacity !== undefined && opacity < 1 ? { opacity: Math.round(opacity * 100) / 100 } : {}),
			...(brush !== undefined ? { brush } : {}),
			...(clip !== undefined ? { clip } : {}),
			...(layer !== undefined && layer !== '0' ? { layer } : {}),
			...(lock === true && tool !== 'eraser' ? { lock: true } : {}),
			points,
		};
	}

	@bindThis
	private isValidLayerId(id: JsonValue | undefined): id is string {
		return typeof id === 'string' && /^[0-9a-zA-Z_-]{1,16}$/.test(id);
	}

	/**
	 * JUICE: 自分のレイヤーの一覧を検証する(1〜DRAW_USER_MAX_LAYERS枚、idが重ならない、名前は32文字まで、濃さは0〜1)。不正ならnull
	 */
	@bindThis
	private parseLayers(value: JsonValue | undefined): DrawLayerMeta[] | null {
		if (!Array.isArray(value) || value.length < 1 || value.length > DRAW_USER_MAX_LAYERS) return null;
		const ids = new Set<string>();
		const layers: DrawLayerMeta[] = [];
		for (const item of value) {
			if (!isJsonObject(item) || !this.isValidLayerId(item.id) || ids.has(item.id)) return null;
			const { visible, opacity } = item;
			if (typeof item.name !== 'string' || typeof visible !== 'boolean') return null;
			if (item.private !== undefined && typeof item.private !== 'boolean') return null;
			// JUICE: 合成モード(省略・'normal'なら通常)
			const blend = item.blend;
			if (blend !== undefined && blend !== 'normal' && !(typeof blend === 'string' && (DRAW_LAYER_BLENDS as readonly string[]).includes(blend))) return null;
			// 名前は改行などの制御文字を除き、前後の空白を取ってから長さを確かめる
			const name = item.name.replace(/\p{Cc}/gu, '').trim();
			if (name.length > 32) return null;
			if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) return null;
			ids.add(item.id);
			layers.push({
				id: item.id,
				name,
				visible,
				opacity: Math.round(opacity * 100) / 100,
				...(item.private === true ? { private: true } : {}),
				...(typeof blend === 'string' && blend !== 'normal' ? { blend: blend as DrawLayerBlend } : {}),
			});
		}
		return layers;
	}

	/**
	 * JUICE: 選択範囲の境目で切った線(元の線のidと、置き換える線の並び)を検証する。
	 * 移動ツールで動かした線はキャンバスの外寄りにあることもあるので、座標の範囲は広めに許す。不正ならundefined
	 */
	@bindThis
	private parseSplits(value: JsonValue | undefined, limits: { strokes: number; bytes: number }): { id: string; pieces: DrawStroke[] }[] | undefined {
		// JUICE: 1回の操作で置き換える線の本数・大きさも、その人が描ける上限までにする
		if (this.room == null || !Array.isArray(value) || value.length > limits.strokes) return undefined;
		const margin = Math.max(this.room.canvasWidth, this.room.canvasHeight);
		const splits: { id: string; pieces: DrawStroke[] }[] = [];
		let total = 0;
		// JUICE: 点の列の大きさの合計を、1つのレイヤーに入る大きさまでに抑える(Redisへ送る前に断り、
		// 大きなメッセージでサーバーを止められないようにする)。置き換える線のidは重ならないこと
		let bytes = 0;
		const pieceIds = new Set<string>();
		for (const split of value) {
			if (!isJsonObject(split) || !this.isValidStrokeId(split.id) || !Array.isArray(split.pieces)) return undefined;
			// 1本への置き換えは回転など形を変える操作、2本以上は選択範囲の境目で切る操作
			if (split.pieces.length < 1 || split.pieces.length > 200) return undefined;
			const pieces: DrawStroke[] = [];
			for (const piece of split.pieces) {
				if (!isJsonObject(piece) || !this.isValidStrokeId(piece.id) || pieceIds.has(piece.id)) return undefined;
				bytes += (typeof piece.points === 'string' ? piece.points.length : 0) + (typeof piece.clip === 'string' ? piece.clip.length : 0);
				if (bytes > limits.bytes) return undefined;
				pieceIds.add(piece.id);
				const parsed = this.parseStrokeBody(piece, DRAW_STROKE_MAX_POINTS, margin);
				if (parsed == null) return undefined;
				// idを先頭にする(Redisの処理で、大きな点の列をたどらずにidを取り出せるように)
				pieces.push({ id: piece.id, ...parsed });
			}
			total += pieces.length;
			if (total > limits.strokes) return undefined;
			splits.push({ id: split.id, pieces });
		}
		return splits;
	}

	/**
	 * 線のidの配列を検証する(1〜レイヤーの線の上限まで)。不正ならundefined
	 */
	@bindThis
	private parseStrokeIds(value: JsonValue | undefined): string[] | undefined {
		if (!Array.isArray(value) || value.length === 0 || value.length > DRAW_LAYER_MAX_STROKES) return undefined;
		if (!value.every(id => this.isValidStrokeId(id))) return undefined;
		return value as string[];
	}

	/**
	 * JUICE: 線の移動・削除・置き換えを断ったことを、送った本人にだけ知らせる。
	 * 本人の画面では送る前に反映しているので、これを受けたら線を取り直してサーバーの状態に合わせてもらう
	 */
	@bindThis
	private rejectOperation(): void {
		this.send('operationRejected', {});
	}

	@bindThis
	private isValidStrokeId(id: JsonValue | undefined): id is string {
		return typeof id === 'string' && /^[0-9a-zA-Z_-]{1,32}$/.test(id);
	}

	@bindThis
	public async onMessage(type: string, body: JsonValue) {
		// JUICE: カーソル以外の操作は、届いた順に1つずつ処理する(描いた直後の取り消しが、線より先に処理されて
		// 1つ前の操作を戻してしまわないように)。カーソルは順番が関係なく頻繁なので、待たせない
		if (type === 'cursor') return await this.handleMessage(type, body);
		const run = this.messageQueue.then(() => this.handleMessage(type, body));
		this.messageQueue = run.catch(() => {});
		return await run;
	}

	private messageQueue: Promise<void> = Promise.resolve();

	@bindThis
	private async handleMessage(type: string, body: JsonValue) {
		if (this.room == null || this.user == null) return;
		if (!this.hasWritePermission()) return;
		if (!await this.stillAllowed()) return;
		const room = this.room;
		const user = this.user;
		if (room == null || user == null) return;
		// 確認のために開いているモデレーターは、部屋に何も書き込まない
		if (this.viewOnly) return;
		const rate = (kind: 'cursor' | 'strokePart' | 'stroke' | 'chat' | 'other') => this.drawRoomService.withinRateLimit(room.id, user.id, kind);

		switch (type) {
			case 'visibility': {
				// JUICE: 画面を離れた・戻ってきたことの知らせ。離れている間はオフラインとして扱う
				if (!isJsonObject(body) || typeof body.visible !== 'boolean') return;
				const away = !body.visible;
				if (away === this.away || !await rate('other')) return;
				this.away = away;
				if (away) {
					// 本人からの知らせなので、待たずにすぐオフラインとして配る
					await this.drawRoomService.leavePresence(room.id, user.id, this.presenceId, true);
				} else {
					await this.drawRoomService.enterPresence(room.id, user.id, this.presenceId);
				}
				break;
			}
			case 'cursor': {
				// JUICE: カーソルは見学者も含め、部屋を見ている全員が送れる(誰がどこを見ているか分かるように)
				if (room.isEnded || !isJsonObject(body)) return;
				const { x, y, pet } = body;
				if (x === null && y === null) {
					if (!await rate('cursor')) return;
					this.drawRoomService.publishCursor(room.id, user.id, null, null);
					return;
				}
				if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
				if (x < -DRAW_STROKE_MAX_SIZE || x > room.canvasWidth + DRAW_STROKE_MAX_SIZE || y < -DRAW_STROKE_MAX_SIZE || y > room.canvasHeight + DRAW_STROKE_MAX_SIZE) return;
				if (pet !== undefined && typeof pet !== 'boolean') return;
				if (!await rate('cursor')) return;
				// JUICE: なでるツール(見学者もなでられる。絵は変わらない)
				this.drawRoomService.publishCursor(room.id, user.id, Math.round(x), Math.round(y), pet === true);
				break;
			}
			case 'strokePart': {
				if (!this.canDraw() || !isJsonObject(body) || !this.isValidStrokeId(body.strokeId)) return;
				const part = this.parseStrokeBody(body, DRAW_STROKE_PART_MAX_POINTS);
				if (part == null || !await rate('strokePart')) return;
				await this.drawRoomService.publishStrokePart(room.id, user.id, { ...part, strokeId: body.strokeId });
				break;
			}
			case 'strokeCancel': {
				if (!this.canDraw() || !isJsonObject(body) || !this.isValidStrokeId(body.strokeId)) return;
				if (!await rate('other')) return;
				this.drawRoomService.publishStrokeCancel(room.id, user.id, body.strokeId);
				break;
			}
			case 'stroke': {
				if (!this.canDraw() || !isJsonObject(body) || !this.isValidStrokeId(body.id)) return;
				const stroke = this.parseStrokeBody(body, DRAW_STROKE_MAX_POINTS);
				if (stroke == null || !await rate('stroke')) {
					// 受け付けなかった線は、途中まで表示されている分を皆の画面から消してもらう
					this.drawRoomService.publishStrokeCancel(room.id, user.id, body.id);
					return;
				}
				// idを先頭にする(Redisの処理で、大きな点の列をたどらずにidを取り出せるように)
				const result = await this.drawRoomService.addStroke(room.id, user.id, { id: body.id, ...stroke });
				if (result === 'added') break;
				this.drawRoomService.publishStrokeCancel(room.id, user.id, body.id);
				// JUICE: 上限に達して描けなかったことを、描いた本人に知らせる(黙って線が消えないように)
				// 上限の値(本数、またはMB)も一緒に送る
				if (result === 'strokes' || result === 'bytes') {
					const limits = await this.drawRoomService.strokeLimits(user.id);
					this.send('strokeLimitReached', { kind: result, limit: result === 'strokes' ? limits.strokes : Math.round(limits.bytes / 1024 / 1024) });
				} else if (result === 'room') {
					this.send('strokeLimitReached', { kind: result, limit: Math.round(await this.drawRoomService.maxRoomBytes() / 1024 / 1024) });
				}
				break;
			}
			case 'undo':
			case 'redo': {
				// JUICE: 自分の最後の操作を取り消す・やり直す。上限を超えて戻せなければ本人に知らせる
				if (!this.canDraw() || !await rate('other')) return;
				if (!await this.drawRoomService.undoRedo(room.id, user.id, type)) this.rejectOperation();
				break;
			}
			case 'clearLayer': {
				// JUICE: layerを指定したら、自分のそのレイヤーだけを消去する
				const layer = isJsonObject(body) ? body.layer : undefined;
				if (layer !== undefined && !this.isValidLayerId(layer)) return;
				if (!this.canDraw() || !await rate('other')) return;
				this.drawRoomService.clearLayer(room.id, user.id, layer);
				break;
			}
			case 'setLayers': {
				// JUICE: 自分のレイヤーの一覧(追加・削除・名前・並び・表示・濃さ)を置き換える
				if (!this.canDraw() || !isJsonObject(body)) return;
				const layers = this.parseLayers(body.layers);
				if (layers == null || !await rate('other')) return;
				if (!await this.drawRoomService.setUserLayers(room.id, user.id, layers)) this.rejectOperation();
				break;
			}
			case 'moveStrokes': {
				// JUICE: 移動ツール。自分のレイヤーの、選んだ線(strokeIdsがnullならレイヤー全体)をずらす
				if (!this.canDraw() || !isJsonObject(body)) return;
				const { strokeIds, dx, dy } = body;
				const limit = Math.max(room.canvasWidth, room.canvasHeight) * 2;
				if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
				if (Math.abs(dx) > limit || Math.abs(dy) > limit) return;
				// JUICE: 大きなメッセージを読み解く前に、回数制限を確かめる
				if (!await rate('other')) return;
				const ids = strokeIds === null ? null : this.parseStrokeIds(strokeIds);
				// 選択範囲の境目で切った線があれば、先に置き換えてから動かす(同じ操作の中で順に行う)
				const splits = body.splits === undefined ? [] : this.parseSplits(body.splits, await this.drawRoomService.strokeLimits(user.id));
				// 送った本人の画面では既に動かしているので、断るときは知らせて線を取り直してもらう
				if (ids === undefined || splits === undefined) return this.rejectOperation();
				// 境目で切ってから動かしたときは、取り消しで1回に戻せるよう、履歴を1件にまとめる
				let splitRecorded = false;
				if (splits.length > 0) {
					const split = await this.drawRoomService.splitStrokes(room.id, user.id, splits);
					if (!split.ok) return this.rejectOperation();
					splitRecorded = split.recorded;
				}
				// 送る形式と同じ細かさ(1/8px)にそろえる
				const mx = Math.round(dx * 8) / 8;
				const my = Math.round(dy * 8) / 8;
				if ((mx !== 0 || my !== 0) && !await this.drawRoomService.moveStrokes(room.id, user.id, ids, mx, my, splitRecorded)) return this.rejectOperation();
				break;
			}
			case 'replaceStrokes': {
				// JUICE: 選んだ線を回転するなど、線を別の線(の並び)に置き換える
				if (!this.canDraw() || !isJsonObject(body)) return;
				if (!await rate('other')) return;
				const replacements = this.parseSplits(body.replacements, await this.drawRoomService.strokeLimits(user.id));
				if (replacements == null || replacements.length === 0) return this.rejectOperation();
				if (!(await this.drawRoomService.splitStrokes(room.id, user.id, replacements)).ok) return this.rejectOperation();
				break;
			}
			case 'deleteStrokes': {
				if (!this.canDraw() || !isJsonObject(body)) return;
				if (!await rate('other')) return;
				const ids = this.parseStrokeIds(body.strokeIds);
				const splits = body.splits === undefined ? [] : this.parseSplits(body.splits, await this.drawRoomService.strokeLimits(user.id));
				if (ids == null || splits === undefined) return this.rejectOperation();
				let splitRecorded = false;
				if (splits.length > 0) {
					const split = await this.drawRoomService.splitStrokes(room.id, user.id, splits);
					if (!split.ok) return this.rejectOperation();
					splitRecorded = split.recorded;
				}
				await this.drawRoomService.deleteStrokes(room.id, user.id, ids, splitRecorded);
				break;
			}
			case 'clearLayerOf': {
				// JUICE: 部屋主は、ほかの人のレイヤーも消去できる
				if (room.isEnded || room.ownerId !== user.id || user.movedToUri != null || !isJsonObject(body)) return;
				if (typeof body.userId !== 'string' || !/^[0-9a-zA-Z]{1,32}$/.test(body.userId)) return;
				if (!await rate('other')) return;
				this.drawRoomService.clearLayer(room.id, body.userId);
				break;
			}
			case 'chat': {
				// JUICE: チャットは見学者(メンバーでない人)も発言できる
				if (room.isEnded || user.movedToUri != null || !isJsonObject(body) || typeof body.text !== 'string') return;
				const text = body.text.trim();
				if (text.length === 0 || text.length > DRAW_CHAT_MAX_LENGTH || !await rate('chat')) return;
				this.drawRoomService.postChat(room.id, user, text);
				break;
			}
		}
	}

	@bindThis
	public dispose() {
		if (this.room != null) {
			this.subscriber.off(`drawRoomStream:${this.room.id}`, this.onEvent);
			this.stopPresence(this.room.id);
		}
	}
}
