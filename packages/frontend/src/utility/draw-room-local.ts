/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 落書き(1人で描く絵チャ)用の、サーバーの代わりに手元で動く部屋。
// 絵チャの部屋の画面(pages/draw-room/room.vue)が使うストリームのつながりと同じ形で、送った操作を手元で処理し、
// サーバーと同じ出来事を返す(線の追加・取り消しとやり直し・レイヤー・結合・移動・置き換え・削除・消去)。
// 処理の中身は、サーバー(backend/src/core/DrawRoomService.ts)のRedisの処理と同じにしてある

import type * as Misskey from 'misskey-js';

type DrawStroke = Misskey.entities.DrawStroke;
type DrawLayer = Misskey.entities.DrawLayer;
type DrawLayerGroup = NonNullable<DrawLayer['groups']>[number];

// 取り消し・やり直しの手順(サーバーのHISTORY_LUAと同じ)
export type DrawHistoryStep =
	| { t: 'del'; ids: string[] }
	| { t: 'mv'; ids: string[] | '*'; dx: number; dy: number }
	| { t: 'ins'; items: { a: string | null; s: DrawStroke }[] }
	// サーバーのaddLayer・rmLayerの代わりに、レイヤーの一覧をまるごと置き換える(消したレイヤーの代わりに作ったレイヤーも、取り消しで消せるように)
	| { t: 'layers'; layers: DrawLayer[] };
type HistoryStep = DrawHistoryStep;
type HistoryEntry = { u: HistoryStep[]; r: HistoryStep[] };

/**
 * レイヤーの見え方(表示・濃さ・合成モード)を変えた記録。タイムラプスで、描いている途中のレイヤーの表示・非表示を追うために持つ。
 * after・index は、変えた時点で最後に描いてあった線のidと、線の本数(その線の後で変えた、という目印)。
 * 先頭の1件(after: null, index: 0)は、記録を始める前の見え方
 */
export type DrawLayerEvent = {
	// 線の操作の記録(DrawStrokeEdit)と合わせた、起きた順の番号(前の版で残した記録には無い)
	seq?: number;
	after: string | null;
	index: number;
	layers: { id: string; visible: boolean; opacity: number; blend?: DrawLayer['blend'] }[];
};

/**
 * 線を描く以外の操作(動かす・回す・拡大縮小・反転・消す・取り消し・やり直しなど)の記録。タイムラプスで、操作の前の絵から順に見せるために持つ。
 * before・after は、操作の直前・直後の線の本数。u は、操作の後の並び(の先頭 after 本)を、操作の前の並びに戻す手順
 */
export type DrawStrokeEdit = {
	seq: number;
	before: number;
	after: number;
	u: DrawHistoryStep[];
};

export type LocalDrawRoomState = {
	strokes: DrawStroke[];
	layers: DrawLayer[];
	layerEvents?: DrawLayerEvent[];
	strokeEdits?: DrawStrokeEdit[];
};

const DEFAULT_LAYERS: DrawLayer[] = [{ id: '0', name: '', visible: true, opacity: 1 }];
// サーバーと同じ上限
const MAX_LAYERS = 8;
const HISTORY_MAX_ENTRIES = 100;
const GROUP_MAX_DEPTH = 16;
const MAX_GROUPS = 128;
// レイヤーの見え方の記録の上限(超えたら古いものから捨てる。先頭の1件は残す)
const MAX_LAYER_EVENTS = 1000;
// 線の操作の記録の上限(件数と、記録の中に持っている前の線の本数。超えたら古いものから捨てる)
const MAX_STROKE_EDITS = 2000;
const MAX_STROKE_EDIT_STROKES = 30000;

/**
 * 取り消し・やり直しの手順を、線の並びに当てはめる(レイヤーの一覧を戻す手順は飛ばす)。
 * 戻す線は、目印の線(同じレイヤーで次にあった線)の前に入れ、目印が無ければ最後に入れる
 */
export function applyHistorySteps(strokes: readonly DrawStroke[], steps: readonly DrawHistoryStep[]): DrawStroke[] {
	let list = [...strokes];
	for (const step of steps) {
		if (step.t === 'del') {
			const ids = new Set(step.ids);
			list = list.filter(s => !ids.has(s.id));
		} else if (step.t === 'mv') {
			const ids = step.ids === '*' ? null : new Set(step.ids);
			list = list.map(s => (ids == null || ids.has(s.id) ? { ...s, dx: (s.dx ?? 0) + step.dx, dy: (s.dy ?? 0) + step.dy } : s));
		} else if (step.t === 'ins') {
			const present = new Set(list.map(s => s.id));
			const items = step.items.filter(item => {
				if (present.has(item.s.id)) return false;
				present.add(item.s.id);
				return true;
			});
			if (items.length === 0) continue;
			const beforeAnchor = new Map<string, DrawStroke[]>();
			for (const item of items) {
				if (item.a == null) continue;
				const waiting = beforeAnchor.get(item.a) ?? [];
				waiting.push(item.s);
				beforeAnchor.set(item.a, waiting);
			}
			const result: DrawStroke[] = [];
			const placed = new Set<string>();
			for (const s of list) {
				const waiting = beforeAnchor.get(s.id);
				if (waiting != null) {
					result.push(...waiting);
					placed.add(s.id);
				}
				result.push(s);
			}
			for (const item of items) {
				if (!(item.a != null && placed.has(item.a))) result.push(item.s);
			}
			list = result;
		}
	}
	return list;
}

/**
 * 操作の後の並び(after)を、操作の前の並び(before)に戻す手順を作る。変わっていなければnull。
 * 取り消しの履歴の手順(同じレイヤーの線を目印にする)と違い、レイヤーをまたいだ全体の順番もそのまま戻るよう、
 * 全ての線の中で次にある(この操作で変わらない)線を目印にする。変わらなかった線は、前後で同じオブジェクトのまま
 */
function editStepsOf(before: readonly DrawStroke[], after: readonly DrawStroke[]): DrawHistoryStep[] | null {
	const beforeSet = new Set(before);
	const afterSet = new Set(after);
	const removed = before.filter(s => !afterSet.has(s));
	const inserted = after.filter(s => !beforeSet.has(s));
	if (removed.length === 0 && inserted.length === 0) return null;
	// 同じ線を同じだけ動かしただけなら、動かした量だけを持つ(前の線をまるごと持たない)
	if (removed.length === inserted.length && before.length === after.length) {
		const dx = (removed[0].dx ?? 0) - (inserted[0].dx ?? 0);
		const dy = (removed[0].dy ?? 0) - (inserted[0].dy ?? 0);
		const movedOnly = removed.every((old, index) => {
			const now = inserted[index];
			if (old.id !== now.id || (old.dx ?? 0) - (now.dx ?? 0) !== dx || (old.dy ?? 0) - (now.dy ?? 0) !== dy) return false;
			const { dx: _oldDx, dy: _oldDy, ...oldRest } = old;
			const { dx: _nowDx, dy: _nowDy, ...nowRest } = now;
			const keys = Object.keys(oldRest) as (keyof typeof oldRest)[];
			return keys.length === Object.keys(nowRest).length && keys.every(key => oldRest[key] === nowRest[key]);
		}) && before.every((s, index) => s.id === after[index].id);
		if (movedOnly) return [{ t: 'mv', ids: removed.length === before.length ? '*' : removed.map(s => s.id), dx, dy }];
	}
	const items: { a: string | null; s: DrawStroke }[] = [];
	let nextKept: string | null = null;
	for (let i = before.length - 1; i >= 0; i--) {
		if (afterSet.has(before[i])) nextKept = before[i].id;
		else items.unshift({ a: nextKept, s: before[i] });
	}
	const steps: DrawHistoryStep[] = [];
	if (inserted.length > 0) steps.push({ t: 'del', ids: inserted.map(s => s.id) });
	if (items.length > 0) steps.push({ t: 'ins', items });
	return steps;
}

/** 線の操作の記録の中に持っている前の線を、ずらす(キャンバスを切り抜いて、全ての線をずらしたとき) */
export function shiftStrokeEdits(edits: readonly DrawStrokeEdit[], dx: number, dy: number): DrawStrokeEdit[] {
	if (dx === 0 && dy === 0) return [...edits];
	return edits.map(edit => ({
		...edit,
		u: edit.u.map(step => (step.t === 'ins' ? { ...step, items: step.items.map(item => ({ a: item.a, s: { ...item.s, dx: (item.s.dx ?? 0) + dx, dy: (item.s.dy ?? 0) + dy } })) } : step)),
	}));
}

const layerViewOf = (layers: DrawLayer[]): DrawLayerEvent['layers'] => layers.map(layer => ({
	id: layer.id,
	visible: layer.visible !== false,
	opacity: layer.opacity,
	...(layer.blend != null ? { blend: layer.blend } : {}),
}));

const layerOf = (stroke: DrawStroke) => stroke.layer ?? '0';
// 線の中身を比べるための文字列(同じ線でも、動かした・切ったら変わる)
const keyOf = (stroke: DrawStroke) => JSON.stringify(stroke);

function randomId(): string {
	const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
	return Array.from(window.crypto.getRandomValues(new Uint8Array(8)), b => chars[b % 36]).join('');
}

// 操作の前後の線の並びから、その操作の履歴を作る(サーバーのdiffEntryと同じ)。変わっていなければnull
function diffEntry(before: DrawStroke[], after: DrawStroke[]): HistoryEntry | null {
	const beforeById = new Map(before.map(s => [s.id, keyOf(s)]));
	const afterById = new Map(after.map(s => [s.id, keyOf(s)]));
	const removed = new Set<number>();
	const inserted = new Set<number>();
	before.forEach((s, i) => { if (afterById.get(s.id) !== keyOf(s)) removed.add(i); });
	after.forEach((s, i) => { if (beforeById.get(s.id) !== keyOf(s)) inserted.add(i); });
	if (removed.size === 0 && inserted.size === 0) return null;
	// 戻す線ごとに、同じレイヤーで次にある(この操作で変わらない)線を目印にする
	const withAnchors = (list: DrawStroke[], marked: Set<number>) => {
		const items: { a: string | null; s: DrawStroke }[] = [];
		const nextOfLayer = new Map<string, string>();
		for (let i = list.length - 1; i >= 0; i--) {
			const s = list[i];
			if (marked.has(i)) items.unshift({ a: nextOfLayer.get(layerOf(s)) ?? null, s });
			else nextOfLayer.set(layerOf(s), s.id);
		}
		return items;
	};
	const removedIds = before.filter((_, i) => removed.has(i)).map(s => s.id);
	const insertedIds = after.filter((_, i) => inserted.has(i)).map(s => s.id);
	const u: HistoryStep[] = [];
	const r: HistoryStep[] = [];
	if (insertedIds.length > 0) u.push({ t: 'del', ids: insertedIds });
	if (removedIds.length > 0) u.push({ t: 'ins', items: withAnchors(before, removed) });
	if (removedIds.length > 0) r.push({ t: 'del', ids: removedIds });
	if (insertedIds.length > 0) r.push({ t: 'ins', items: withAnchors(after, inserted) });
	return { u, r };
}

type Handler = (payload: any) => void;

/**
 * 絵チャのストリームのつながり(IChannelConnection)と同じ使い方ができる、手元の部屋
 */
export class LocalDrawRoomConnection {
	private handlers = new Map<string, Set<Handler>>();
	private history: HistoryEntry[] = [];
	private redoHistory: HistoryEntry[] = [];
	private disposed = false;
	public strokes: DrawStroke[];
	public layers: DrawLayer[];
	public layerEvents: DrawLayerEvent[];
	public strokeEdits: DrawStrokeEdit[];
	// 記録に付ける、起きた順の番号(次に使う番号)
	private seq: number;
	// 今処理している操作の種類と、最後に記録を確かめたときの線の並び(線の操作の記録を作るのに使う)
	private currentOp: string | null = null;
	private loggedStrokes: DrawStroke[];

	constructor(
		private readonly userId: string,
		state: LocalDrawRoomState,
		// 線・レイヤーが変わったときに呼ぶ(保存する)
		private readonly onChange: (state: LocalDrawRoomState) => void,
		// 描ける線の本数の上限(絵チャと同じく、ロールの値)
		private readonly maxStrokes: number,
	) {
		this.strokes = state.strokes;
		this.layers = state.layers.length > 0 ? state.layers : DEFAULT_LAYERS.map(l => ({ ...l }));
		this.layerEvents = Array.isArray(state.layerEvents) ? state.layerEvents : [];
		this.strokeEdits = Array.isArray(state.strokeEdits) ? state.strokeEdits : [];
		this.seq = 1 + Math.max(0, ...this.layerEvents.map(event => event.seq ?? 0), ...this.strokeEdits.map(edit => edit.seq));
		this.loggedStrokes = this.strokes;
	}

	/** 取り消せる回数と、やり直せる回数(デバッグ情報の表示用) */
	public get historyCounts(): { undo: number; redo: number } {
		return { undo: this.history.length, redo: this.redoHistory.length };
	}

	public on(type: string, handler: Handler): void {
		let set = this.handlers.get(type);
		if (set == null) {
			set = new Set();
			this.handlers.set(type, set);
		}
		set.add(handler);
	}

	public off(type: string, handler: Handler): void {
		this.handlers.get(type)?.delete(handler);
	}

	public dispose(): void {
		this.disposed = true;
		this.handlers.clear();
	}

	// サーバーから届くのと同じく、少し後に知らせる(送った側の処理が終わってから)
	private emit(type: string, payload: unknown): void {
		window.queueMicrotask(() => {
			if (this.disposed) return;
			for (const handler of this.handlers.get(type) ?? []) handler(payload);
		});
	}

	private changed(): void {
		this.logStrokeEdit();
		this.onChange({ strokes: this.strokes, layers: this.layers, layerEvents: this.layerEvents, strokeEdits: this.strokeEdits });
	}

	// レイヤーの見え方(表示・濃さ・合成モード・並び)が変わっていたら記録する。1回の操作を1件として残す(タイムラプスで、
	// 隠した・また出した、濃さを変えて戻した、などが分かるように。濃さのスライダーは、離したときに1回だけ送られてくる)
	private recordLayerEvent(before: DrawLayer[]): void {
		// 同じ操作で線も変わっていたら(レイヤーを消した、など)、そちらを先に記録する
		this.logStrokeEdit();
		const prev = layerViewOf(before);
		const next = layerViewOf(this.layers);
		if (JSON.stringify(prev) === JSON.stringify(next)) return;
		const events = [...this.layerEvents];
		if (events.length === 0) events.push({ after: null, index: 0, layers: prev });
		events.push({ seq: this.seq++, after: this.strokes.at(-1)?.id ?? null, index: this.strokes.length, layers: next });
		while (events.length > MAX_LAYER_EVENTS) events.splice(1, 1);
		this.layerEvents = events;
	}

	// 線を描く以外の操作で線の並びが変わっていたら、その操作を記録する(操作の前の並びに戻す手順を持っておく)
	private logStrokeEdit(): void {
		const before = this.loggedStrokes;
		const after = this.strokes;
		if (after === before) return;
		this.loggedStrokes = after;
		const op = this.currentOp;
		if (op == null || op === 'stroke') return;
		// 全て消した・レイヤーを結合した後は、前の操作の記録を使えない(線の並びがつながらない)ので捨てる
		if ((op === 'clearLayer' && after.length === 0 && this.history.length === 0) || op === 'mergeLayer') {
			this.strokeEdits = [];
			return;
		}
		const u = editStepsOf(before, after);
		if (u == null) return;
		// 手順で前の並びに(順番も含めて)戻らないなら、それより前の操作は追えないので、記録を捨てる
		const restored = applyHistorySteps(after, u);
		if (restored.length !== before.length || restored.some((stroke, index) => stroke.id !== before[index].id)) {
			this.strokeEdits = [];
			return;
		}
		const edits = [...this.strokeEdits, { seq: this.seq++, before: before.length, after: after.length, u }];
		const heldOf = (edit: DrawStrokeEdit) => edit.u.reduce((sum, step) => sum + (step.t === 'ins' ? step.items.length : 0), 0);
		let held = edits.reduce((sum, edit) => sum + heldOf(edit), 0);
		while (edits.length > 1 && (edits.length > MAX_STROKE_EDITS || held > MAX_STROKE_EDIT_STROKES)) held -= heldOf(edits.shift()!);
		this.strokeEdits = edits;
	}

	private reject(): void {
		this.emit('operationRejected', {});
	}

	// 履歴に1件積む(新しい操作をしたら、やり直しの履歴は捨てる)。mergeなら、直前の1件とまとめる
	private record(entry: HistoryEntry, merge = false): void {
		this.redoHistory = [];
		if (merge) {
			const prev = this.history.pop();
			if (prev != null) entry = { u: [...entry.u, ...prev.u], r: [...prev.r, ...entry.r] };
		}
		this.history.push(entry);
		while (this.history.length > HISTORY_MAX_ENTRIES) this.history.shift();
	}

	private hasLayer(id: string): boolean {
		return this.layers.some(layer => layer.id === id);
	}

	private isPrivateLayer(id: string): boolean {
		return this.layers.find(layer => layer.id === id)?.private === true;
	}

	public send(type: string, body: any): void {
		if (this.disposed) return;
		this.currentOp = type;
		try {
			this.dispatch(type, body);
		} finally {
			// 保存を知らせなかった操作(断った操作など)でも、線の並びが変わっていたら記録しておく
			this.logStrokeEdit();
			this.currentOp = null;
		}
	}

	private dispatch(type: string, body: any): void {
		switch (type) {
			case 'stroke': return this.addStroke(body as DrawStroke);
			case 'undo': return this.undoRedo('u');
			case 'redo': return this.undoRedo('r');
			case 'clearLayer': return this.clearLayer(body?.layer);
			case 'setLayers': return this.setLayers(body.layers as DrawLayer[]);
			case 'mergeLayer': return this.mergeLayer(body.from, body.into);
			case 'moveStrokes': return this.moveStrokes(body.strokeIds ?? null, body.dx, body.dy, body.splits ?? []);
			case 'replaceStrokes': return this.replaceStrokes(body.replacements ?? []);
			case 'deleteStrokes': return this.deleteStrokes(body.strokeIds ?? [], body.splits ?? []);
			// 途中の線・カーソル・画面を見ているか・チャットは、1人なので配らない
			default: return;
		}
	}

	private addStroke(stroke: DrawStroke): void {
		if (!this.hasLayer(layerOf(stroke)) || this.strokes.length >= this.maxStrokes) {
			this.emit('strokeCancel', { userId: this.userId, strokeId: stroke.id });
			if (this.strokes.length >= this.maxStrokes) this.emit('strokeLimitReached', { kind: 'strokes', limit: this.maxStrokes });
			return;
		}
		this.strokes = [...this.strokes, stroke];
		this.record({ u: [{ t: 'del', ids: [stroke.id] }], r: [{ t: 'ins', items: [{ a: null, s: stroke }] }] });
		this.changed();
		this.emit('stroke', { userId: this.userId, stroke, ...(this.isPrivateLayer(layerOf(stroke)) ? { private: true } : {}) });
	}

	private undoRedo(direction: 'u' | 'r'): void {
		const from = direction === 'u' ? this.history : this.redoHistory;
		const to = direction === 'u' ? this.redoHistory : this.history;
		const entry = from.pop();
		if (entry == null) return;
		let list = this.strokes;
		let layersChanged = false;
		const applied: unknown[] = [];
		for (const step of entry[direction]) {
			if (step.t === 'del') {
				const ids = new Set(step.ids);
				const kept = list.filter(s => !ids.has(s.id));
				if (kept.length !== list.length) applied.push({ t: 'del', ids: step.ids });
				list = kept;
			} else if (step.t === 'mv') {
				const ids = step.ids === '*' ? null : new Set(step.ids);
				list = list.map(s => (ids == null || ids.has(s.id) ? { ...s, dx: (s.dx ?? 0) + step.dx, dy: (s.dy ?? 0) + step.dy } : s));
				applied.push({ t: 'mv', ids: step.ids === '*' ? null : step.ids, dx: step.dx, dy: step.dy });
			} else if (step.t === 'ins') {
				const present = new Set(list.map(s => s.id));
				// 無くなったレイヤーの線・もうある線は戻さない
				const items = step.items.filter(item => {
					if (present.has(item.s.id) || !this.hasLayer(layerOf(item.s))) return false;
					present.add(item.s.id);
					return true;
				});
				if (items.length > 0) {
					const beforeAnchor = new Map<string, DrawStroke[]>();
					for (const item of items) {
						if (item.a == null) continue;
						const waiting = beforeAnchor.get(item.a) ?? [];
						waiting.push(item.s);
						beforeAnchor.set(item.a, waiting);
					}
					const result: DrawStroke[] = [];
					const placed = new Set<string>();
					for (const s of list) {
						const waiting = beforeAnchor.get(s.id);
						if (waiting != null) {
							result.push(...waiting);
							placed.add(s.id);
						}
						result.push(s);
					}
					// 目印の無い線と、目印の線が無くなっていた線は、手順の順に最後に入れる
					for (const item of items) {
						if (!(item.a != null && placed.has(item.a))) result.push(item.s);
					}
					list = result;
					applied.push({ t: 'ins', items: items.map(item => ({ before: item.a, stroke: item.s })) });
				}
			} else if (step.t === 'layers') {
				// 名前・表示・濃さなど(履歴に積まない変更)は、今のものを残す
				const current = new Map(this.layers.map(layer => [layer.id, layer]));
				const layersBefore = this.layers;
				this.layers = step.layers.map(layer => current.get(layer.id) ?? layer);
				this.strokes = list;
				this.recordLayerEvent(layersBefore);
				layersChanged = true;
			}
		}
		this.strokes = list;
		to.push(entry);
		this.changed();
		if (layersChanged) this.emit('layersUpdated', { userId: this.userId, layers: this.layers });
		if (applied.length > 0) this.emit('strokesPatched', { userId: this.userId, steps: applied });
	}

	private clearLayer(layer: string | undefined): void {
		if (layer == null) {
			this.history = [];
			this.redoHistory = [];
			if (this.strokes.length === 0) return;
			this.strokes = [];
			this.changed();
			this.emit('clearLayer', { userId: this.userId });
			return;
		}
		if (!this.hasLayer(layer)) return;
		const before = this.strokes;
		const after = before.filter(s => layerOf(s) !== layer);
		if (after.length === before.length) return;
		const isPrivate = this.isPrivateLayer(layer);
		this.strokes = after;
		// 1人で描いているので、サーバーでは取り消せない皆に見えるレイヤーの消去も、取り消せるようにする
		const entry = diffEntry(before, after);
		if (entry != null) this.record(entry);
		this.changed();
		this.emit('clearLayer', { userId: this.userId, layer, ...(isPrivate ? { private: true } : {}) });
	}

	private setLayers(next: DrawLayer[]): void {
		if (!Array.isArray(next) || next.length < 1 || next.length > MAX_LAYERS) return this.reject();
		const before = this.layers;
		// 結合したレイヤーの中のまとまりは引き継ぐ(画面からは送られてこないため)
		const groupsOf = new Map(before.filter(layer => layer.groups != null && layer.groups.length > 0).map(layer => [layer.id, layer.groups!]));
		const saved = next.map(layer => (groupsOf.has(layer.id) ? { ...layer, groups: groupsOf.get(layer.id) } : layer));
		const keep = new Set(saved.map(layer => layer.id));
		const dropped = before.some(layer => !keep.has(layer.id));
		const added = saved.some(layer => !before.some(b => b.id === layer.id));
		// 下描き⇔皆に見せるを切り替えたら、やり直しの履歴は捨てる
		if (saved.some(layer => { const old = before.find(b => b.id === layer.id); return old != null && (old.private === true) !== (layer.private === true); })) {
			this.redoHistory = [];
		}
		this.layers = saved;
		// レイヤーを追加・削除したら、レイヤーと線を戻せるよう履歴に積む(1人で描いているので、サーバーと違い皆に見えるレイヤーでも取り消せる)。
		// 追加も積むのは、取り消しで一覧を前の状態に戻したときに、後から追加したレイヤー(とその線)を消してしまわないようにするため
		if (dropped || added) {
			const strokesBefore = this.strokes;
			const strokesAfter = strokesBefore.filter(s => keep.has(layerOf(s)));
			this.strokes = strokesAfter;
			const entry = diffEntry(strokesBefore, strokesAfter) ?? { u: [], r: [] };
			this.record({
				// 取り消すときはレイヤーを先に戻してから線を戻し、やり直すときは線を消してからレイヤーを変える
				u: [{ t: 'layers', layers: before }, ...entry.u],
				r: [...entry.r, { t: 'layers', layers: saved }],
			});
		}
		this.recordLayerEvent(before);
		this.changed();
		this.emit('layersUpdated', { userId: this.userId, layers: saved });
	}

	private mergeLayer(from: string, into: string): void {
		const layers = this.layers;
		const fromIndex = layers.findIndex(layer => layer.id === from);
		const intoIndex = layers.findIndex(layer => layer.id === into);
		if (fromIndex === -1 || intoIndex === -1 || Math.abs(fromIndex - intoIndex) !== 1) return this.reject();
		const fromLayer = layers[fromIndex];
		const intoLayer = layers[intoIndex];
		if ((fromLayer.private === true) !== (intoLayer.private === true)) return this.reject();
		const below = intoIndex < fromIndex;
		const visible = fromLayer.visible || intoLayer.visible;
		const clamp = (v: number) => Math.min(1, Math.max(0, v));
		const intoOpacity = intoLayer.visible || !visible ? 1 : 0;
		const fromOpacity = fromLayer.visible || !visible ? clamp(fromLayer.opacity) : 0;
		const gB = randomId();
		const gA = below && intoOpacity === 1 ? null : randomId();

		// 今の線が使っているまとまり(と、その親)だけを残す
		const used = new Set(this.strokes.filter(s => layerOf(s) === from || layerOf(s) === into).flatMap(s => (s.g != null ? [s.g] : [])));
		const byId = new Map([...(intoLayer.groups ?? []), ...(fromLayer.groups ?? [])].map(group => [group.id, group]));
		const keep = new Set<string>();
		for (const id of used) {
			let g = byId.get(id);
			for (let depth = 0; g != null && !keep.has(g.id) && depth < GROUP_MAX_DEPTH; depth++) {
				keep.add(g.id);
				g = g.parent != null ? byId.get(g.parent) : undefined;
			}
		}
		const fromIds = new Set((fromLayer.groups ?? []).map(group => group.id));
		const groups: DrawLayerGroup[] = [
			...(intoLayer.groups ?? []).filter(group => keep.has(group.id)).map(group => (gA != null && group.parent == null ? { ...group, parent: gA } : group)),
			...(gA != null ? [{ id: gA, opacity: intoOpacity }] : []),
			{ id: gB, opacity: fromOpacity, ...(fromLayer.blend != null ? { blend: fromLayer.blend } : {}) },
			...(fromLayer.groups ?? []).filter(group => keep.has(group.id)).map(group => (group.parent == null || !fromIds.has(group.parent) ? { ...group, parent: gB } : group)),
		];
		if (groups.length > MAX_GROUPS) return this.reject();
		const mergedGroups = new Map(groups.map(group => [group.id, group]));
		for (const group of groups) {
			let depth = 0;
			for (let g: DrawLayerGroup | undefined = group; g != null; g = g.parent != null ? mergedGroups.get(g.parent) : undefined) {
				if (++depth > GROUP_MAX_DEPTH) return this.reject();
			}
		}

		// fromの線をintoの線にし(まとまりの無い線だけgBを付ける)、intoの線にもgAを付ける。下へ結合ならintoの線の後ろ、上へならintoの線の前に並べる
		const tag = (s: DrawStroke, g: string | null) => (g == null || s.g != null ? s : { ...s, g });
		const moved: DrawStroke[] = [];
		const rest: DrawStroke[] = [];
		for (const s of this.strokes) {
			const layer = layerOf(s);
			if (layer === from) moved.push(tag({ ...s, layer: into }, gB));
			else if (layer === into) rest.push(tag(s, gA));
			else rest.push(s);
		}
		let at = rest.length;
		if (below) {
			for (let i = rest.length - 1; i >= 0; i--) {
				if (layerOf(rest[i]) === into) { at = i + 1; break; }
			}
		} else {
			const i = rest.findIndex(s => layerOf(s) === into);
			if (i !== -1) at = i;
		}
		this.strokes = [...rest.slice(0, at), ...moved, ...rest.slice(at)];
		this.layers = layers.filter(layer => layer.id !== from).map(layer => (layer.id === into ? { ...layer, visible, groups } : layer));
		// 前の記録は、結合した後のレイヤーに合わせて書き直す(どちらかが見えていた間は、結合先を見えていたことにする。
		// そうしないと、結合先だけを隠していた間、結合元の線まで隠れていたことになる)
		this.layerEvents = this.layerEvents.map(event => {
			const fromView = event.layers.find(layer => layer.id === from);
			const intoView = event.layers.find(layer => layer.id === into);
			if (fromView == null) return event;
			const rest = event.layers.filter(layer => layer.id !== from);
			if (intoView == null || intoView.visible || !fromView.visible) return { ...event, layers: rest };
			return { ...event, layers: rest.map(layer => (layer.id === into ? { ...fromView, id: into } : layer)) };
		});
		this.recordLayerEvent(layers.filter(layer => layer.id !== from).map(layer => (layer.id === into ? { ...layer, visible: intoLayer.visible || fromLayer.visible } : layer)));
		// 結合は取り消せない(サーバーと同じ)
		this.history = [];
		this.redoHistory = [];
		this.changed();
		this.emit('layersUpdated', { userId: this.userId, layers: this.layers });
		this.emit('layerMerged', { userId: this.userId, layer: into, strokes: this.strokes.filter(s => layerOf(s) === into), ...(intoLayer.private ? { private: true } : {}) });
	}

	// 選択範囲の境目で切った線を、切った後の線に置き換える。積んだ履歴があればtrue、断るならnull
	private split(splits: { id: string; pieces: DrawStroke[] }[]): boolean | null {
		if (splits.length === 0) return false;
		const byId = new Map(splits.map(split => [split.id, split.pieces]));
		const pieceIds = new Set(splits.flatMap(split => split.pieces.map(piece => piece.id)));
		if (splits.some(split => split.pieces.some(piece => !this.hasLayer(layerOf(piece))))) return null;
		const result: DrawStroke[] = [];
		let replaced = 0;
		for (const s of this.strokes) {
			const pieces = byId.get(s.id);
			if (pieces != null) {
				replaced++;
				result.push(...pieces);
			} else {
				// 置き換えない線と同じidの線ができるなら断る
				if (pieceIds.has(s.id)) return null;
				result.push(s);
			}
		}
		if (replaced === 0) return null;
		if (result.length > this.maxStrokes && result.length > this.strokes.length) return null;
		const entry = diffEntry(this.strokes, result);
		this.strokes = result;
		if (entry != null) this.record(entry);
		this.emit('strokesSplit', { userId: this.userId, splits });
		return entry != null;
	}

	private moveStrokes(strokeIds: string[] | null, dx: number, dy: number, splits: { id: string; pieces: DrawStroke[] }[]): void {
		const recorded = this.split(splits);
		if (recorded === null) return this.reject();
		// 送る形式と同じ細かさ(1/8px)にそろえる
		const mx = Math.round(dx * 8) / 8;
		const my = Math.round(dy * 8) / 8;
		if (mx !== 0 || my !== 0) {
			const ids = strokeIds == null ? null : new Set(strokeIds);
			let count = 0;
			this.strokes = this.strokes.map(s => {
				if (ids != null && !ids.has(s.id)) return s;
				count++;
				return { ...s, dx: (s.dx ?? 0) + mx, dy: (s.dy ?? 0) + my };
			});
			if (count > 0) {
				const movedIds = strokeIds ?? '*';
				this.record({ u: [{ t: 'mv', ids: movedIds, dx: -mx, dy: -my }], r: [{ t: 'mv', ids: movedIds, dx: mx, dy: my }] }, recorded);
				this.emit('strokesMoved', { userId: this.userId, strokeIds, dx: mx, dy: my });
			}
		}
		this.changed();
	}

	private replaceStrokes(replacements: { id: string; pieces: DrawStroke[] }[]): void {
		if (replacements.length === 0 || this.split(replacements) === null) return this.reject();
		this.changed();
	}

	private deleteStrokes(strokeIds: string[], splits: { id: string; pieces: DrawStroke[] }[]): void {
		const recorded = this.split(splits);
		if (recorded === null) return this.reject();
		const ids = new Set(strokeIds);
		const before = this.strokes;
		const after = before.filter(s => !ids.has(s.id));
		if (after.length !== before.length) {
			this.strokes = after;
			const entry = diffEntry(before, after);
			if (entry != null) this.record(entry, recorded);
			this.emit('strokesDeleted', { userId: this.userId, strokeIds });
		}
		this.changed();
	}
}
