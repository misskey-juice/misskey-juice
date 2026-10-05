/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 落書きのタイムラプス。保存してある線を、描いた順に少しずつ描き直して見せる(線の操作の記録は持たないので、
// 取り消した線・動かす前の位置などは出ない)。レイヤーの表示・非表示・濃さは、変えた記録(DrawLayerEvent)があれば、
// 描いている途中の見え方を追う(下描きのレイヤーを途中で隠した、など)。動画にするときも同じ絵を使う。
// 大きなキャンバスでもメモリを使いすぎないよう、線の座標・太さを縮めてから、小さい絵として描く

import type * as Misskey from 'misskey-js';
import { decodeStroke, drawStroke } from '@/utility/draw-canvas.js';
import type { CanvasStroke, DrawLayerGroup } from '@/utility/draw-canvas.js';
import { applyHistorySteps } from '@/utility/draw-room-local.js';
import type { DrawLayerEvent, DrawStrokeEdit } from '@/utility/draw-room-local.js';

// まとまりの入れ子の深さの上限(draw-canvas.ts の DRAW_LAYER_GROUP_MAX_DEPTH と同じ)
const GROUP_MAX_DEPTH = 16;
// 塗りつぶし・囲って消す線の、再生にかける長さ(点の数に換算)。点の列は輪郭なので、点の数では決めない
const FILL_UNITS = 12;
// 線1本の、再生にかける長さの下限・上限(点の数に換算)。点が1つの線にも少し時間を取り、とても長い線に時間を取られすぎないように
const STROKE_MIN_UNITS = 4;
const STROKE_MAX_UNITS = 400;
// レイヤーの表示・非表示などを切り替えたところで、次へ進む前に止めておく長さの下限(点の数に換算)。実際の長さは全体の長さから決める
const LAYER_EVENT_MIN_UNITS = 16;
// 再生で追う、線の操作(動かす・回す・取り消しなど)の回数の上限。これより前の操作は追わず、その時点の絵から始める
// (操作のたびに線を持ち直すので、メモリを使いすぎないように)
const MAX_PLAY_EDITS = 300;
const MAX_PLAY_REBUILT_STROKES = 40000;

type PlayStroke = CanvasStroke & { g?: string };
// レイヤーの、ある時点の見え方
type LayerView = { opacity: number; blend: GlobalCompositeOperation };

function createCanvas(width: number, height: number): HTMLCanvasElement {
	const canvas = window.document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

// 点の列(x, y, 筆圧)を、横・縦それぞれの倍率で縮める
function scalePoints(points: number[], sx: number, sy: number): number[] {
	return sx === 1 && sy === 1 ? points : points.map((v, i) => (i % 3 === 0 ? v * sx : i % 3 === 1 ? v * sy : v));
}

// 途中まで描くときに描き直すのが重い線(線全体を作り直して描くもの)。途中の見せ方を粗くする
function isHeavy(stroke: PlayStroke): boolean {
	return stroke.lock === true || stroke.brush === 'soft' || stroke.pressure === 'opacity' || stroke.pressure === 'both' || (stroke.opacity != null && stroke.opacity < 1);
}

// 途中まで描けるのは、点を順につないで描く線だけ(塗りつぶし・囲って消すのは、形が決まってから一度に出す)
function isProgressive(stroke: PlayStroke): boolean {
	return stroke.tool !== 'fill' && stroke.brush !== 'area' && stroke.points.length >= 6;
}

function unitsOf(stroke: PlayStroke): number {
	if (!isProgressive(stroke)) return stroke.points.length < 6 ? STROKE_MIN_UNITS : FILL_UNITS;
	return Math.min(STROKE_MAX_UNITS, Math.max(STROKE_MIN_UNITS, stroke.points.length / 3));
}

/**
 * レイヤー1枚ぶん。線を順に足していける形で持つ。
 * 結合したレイヤーの線(gがまとまりを指す)は、draw-canvas.ts の GroupedStrokeDrawer と同じく、まとまりごとの絵に描いてから
 * まとまりの濃さ・合成モードで親に重ねる。まとまりが続いている間はその絵を開いたままにして、見せるときだけ重ねた絵を作る
 */
class LayerPlayer {
	public readonly base: HTMLCanvasElement;
	private readonly baseCtx: CanvasRenderingContext2D;
	private stack: { id: string; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D }[] = [];
	// まとまりの絵の置き場(入れ子の深さごと。使い回す)
	private pool: HTMLCanvasElement[] = [];
	private readonly paths = new Map<string, string[]>();

	constructor(
		private readonly width: number,
		private readonly height: number,
		private readonly groups: ReadonlyMap<string, DrawLayerGroup>,
	) {
		this.base = createCanvas(width, height);
		this.baseCtx = this.base.getContext('2d')!;
	}

	private pathOf(g: string | undefined): string[] {
		if (g == null || !this.groups.has(g)) return [];
		let path = this.paths.get(g);
		if (path == null) {
			path = [];
			for (let group = this.groups.get(g); group != null && path.length < GROUP_MAX_DEPTH && !path.includes(group.id); group = group.parent != null ? this.groups.get(group.parent) : undefined) {
				path.unshift(group.id);
			}
			this.paths.set(g, path);
		}
		return path;
	}

	private composite(target: CanvasRenderingContext2D, source: HTMLCanvasElement, groupId: string): void {
		const group = this.groups.get(groupId);
		if (group == null || group.opacity <= 0) return;
		target.save();
		target.globalAlpha = Math.min(1, group.opacity);
		target.globalCompositeOperation = group.blend ?? 'source-over';
		target.drawImage(source, 0, 0);
		target.restore();
	}

	private topCtx(): CanvasRenderingContext2D {
		return this.stack.at(-1)?.ctx ?? this.baseCtx;
	}

	// 線のまとまりに合わせて、まとまりの絵を閉じる(親に重ねる)・開く。今開いているまとまりと同じなら何もしない
	private enter(path: string[]): void {
		let common = 0;
		while (common < path.length && common < this.stack.length && this.stack[common].id === path[common]) common++;
		while (this.stack.length > common) {
			const top = this.stack.pop()!;
			this.composite(this.topCtx(), top.canvas, top.id);
		}
		for (let i = this.stack.length; i < path.length; i++) {
			const canvas = this.pool[i] ??= createCanvas(this.width, this.height);
			const ctx = canvas.getContext('2d')!;
			ctx.clearRect(0, 0, this.width, this.height);
			this.stack.push({ id: path[i], canvas, ctx });
		}
	}

	/** 線を1本、最後まで描く */
	public draw(stroke: PlayStroke): void {
		this.enter(this.pathOf(stroke.g));
		drawStroke(this.topCtx(), stroke);
	}

	/**
	 * 今の見た目の絵を返す。partialを渡すと、その線(途中まで)も描いたものにする。
	 * 開いているまとまりも途中の線も無ければ、持っている絵をそのまま返す(作業用の絵に写さない)
	 */
	public view(scratch: [HTMLCanvasElement, HTMLCanvasElement], partial: PlayStroke | null): HTMLCanvasElement {
		// 途中の線のまとまりを、先に開いておく(この線を描き終えるときに行うのと同じ。間にほかの線は入らない)
		if (partial != null) this.enter(this.pathOf(partial.g));
		const showPartial = partial != null;
		if (this.stack.length === 0 && !showPartial) return this.base;
		let [cur, next] = scratch;
		const copy = (target: HTMLCanvasElement, source: HTMLCanvasElement) => {
			const ctx = target.getContext('2d')!;
			ctx.clearRect(0, 0, this.width, this.height);
			ctx.drawImage(source, 0, 0);
			return ctx;
		};
		const top = this.stack.at(-1)?.canvas ?? this.base;
		const topCtx = copy(cur, top);
		if (showPartial) drawStroke(topCtx, partial);
		// 開いているまとまりを、内側から順に親へ重ねる
		for (let i = this.stack.length - 1; i >= 0; i--) {
			const parent = i > 0 ? this.stack[i - 1].canvas : this.base;
			this.composite(copy(next, parent), cur, this.stack[i].id);
			[cur, next] = [next, cur];
		}
		return cur;
	}

	public reset(): void {
		this.stack = [];
		this.baseCtx.clearRect(0, 0, this.width, this.height);
	}

	public dispose(): void {
		// 大きなキャンバスは、ガベージコレクションを待たずに小さくしてメモリを返す
		for (const canvas of [this.base, ...this.pool]) {
			canvas.width = 1;
			canvas.height = 1;
		}
		this.stack = [];
		this.pool = [];
	}
}

export class DrawTimelapse {
	public readonly width: number;
	public readonly height: number;
	/** 再生の長さ(点の数に換算した合計)。0なら描くものが無い */
	public readonly totalUnits: number;
	private readonly strokes: { stroke: PlayStroke; layer: number; start: number; end: number }[] = [];
	private readonly layers: { id: string; player: LayerPlayer; opacity: number; blend: GlobalCompositeOperation }[] = [];
	// レイヤーの見え方を変えた記録(再生の位置の順)。viewsは、this.layers と同じ並びの、その時点の見え方。
	// 記録が無ければ空で、最後の見え方(this.layers)のまま再生する
	private readonly changes: { at: number; views: LayerView[]; order: number[] }[] = [];
	// 線の操作(動かす・回す・取り消しなど)で区切った区間。atは区間の始まりの位置、baseは始まりの時点で描いてある線(操作の直後の絵)、
	// firstは、この区間で描いていく線の、this.strokes の中の始まりの番号。操作の記録が無ければ、区間は1つ
	private readonly segments: { at: number; base: { stroke: PlayStroke; layer: number }[]; first: number }[] = [];
	// 今描いてある区間の番号(まだ何も描いていなければ -1)
	private segment = -1;
	private readonly scratch: [HTMLCanvasElement, HTMLCanvasElement];
	// 最後まで描き終えた線の数(this.strokes の先頭からの本数)
	private done = 0;
	// 前に描いたコマ(描き終えた線の数・途中の線の点の数・出力先)。同じなら描き直さない
	private lastFrame: { done: number; count: number; change: number; segment: number; target: CanvasRenderingContext2D } | null = null;

	/**
	 * maxSize: 出す絵の長い辺の上限(これより大きいキャンバスは縮める)
	 */
	constructor(canvasWidth: number, canvasHeight: number, strokes: readonly Misskey.entities.DrawStroke[], layers: readonly Misskey.entities.DrawLayer[], maxSize: number, layerEvents: readonly DrawLayerEvent[] = [], strokeEdits: readonly DrawStrokeEdit[] = []) {
		const scale = Math.min(1, maxSize / Math.max(canvasWidth, canvasHeight));
		// 動画にするとき、縦横が奇数だと受け付けない形式があるので偶数にする
		const even = (v: number) => Math.max(2, Math.round(v * scale / 2) * 2);
		this.width = even(canvasWidth);
		this.height = even(canvasHeight);
		// 偶数にそろえた分(最大1px)は、絵のほうを合わせる(端に白い筋が出たり、端が切れたりしないように)
		const sx = this.width / canvasWidth;
		const sy = this.height / canvasHeight;
		this.scratch = [createCanvas(this.width, this.height), createCanvas(this.width, this.height)];

		// 表示しているレイヤーだけを、下から順に重ねる(画像の保存と同じ)
		const metas = layers.length > 0 ? layers : [{ id: '0', name: '', visible: true, opacity: 1 }];
		const layerIndex = new Map<string, number>();
		// 見えない線(濃さ0のレイヤー・濃さ0のまとまりの中の線)は、再生の時間に入れない
		const hiddenGroups = new Map<string, Set<string>>();
		// 途中で見えていたことのあるレイヤー(今は隠していても、見えていた間は再生に出す)
		const shownOnce = new Set(layerEvents.flatMap(event => event.layers.filter(layer => layer.visible && layer.opacity > 0).map(layer => layer.id)));
		for (const meta of metas) {
			// 下描きのレイヤーは、保存する画像と同じく入れない
			if (meta.private === true) continue;
			const shownNow = meta.visible && meta.opacity > 0;
			if (!shownNow && !shownOnce.has(meta.id)) continue;
			const groups = new Map((meta.groups ?? []).map(group => [group.id, group]));
			const hidden = new Set<string>();
			for (const id of groups.keys()) {
				let depth = 0;
				for (let group = groups.get(id); group != null && depth < GROUP_MAX_DEPTH; group = group.parent != null ? groups.get(group.parent) : undefined, depth++) {
					if (group.opacity <= 0) {
						hidden.add(id);
						break;
					}
				}
			}
			hiddenGroups.set(meta.id, hidden);
			layerIndex.set(meta.id, this.layers.length);
			this.layers.push({
				id: meta.id,
				player: new LayerPlayer(this.width, this.height, new Map((meta.groups ?? []).map(group => [group.id, group]))),
				opacity: shownNow ? Math.min(1, Math.max(0, meta.opacity)) : 0,
				blend: meta.blend ?? 'source-over',
			});
		}

		const viewsOf = (event: DrawLayerEvent): LayerView[] => {
			const byId = new Map(event.layers.map(layer => [layer.id, layer]));
			return this.layers.map(layer => {
				const view = byId.get(layer.id);
				// 記録に無いレイヤー(その後に作ったもの)は、最後の見え方にする
				if (view == null) return { opacity: layer.opacity, blend: layer.blend };
				return { opacity: view.visible ? Math.min(1, Math.max(0, view.opacity)) : 0, blend: view.blend ?? 'source-over' };
			});
		};
		// その時点のレイヤーの重ね順(this.layers の番号を、下から順に)。記録に無いレイヤー(その後に作ったもの)は上に置く
		const orderOf = (event: DrawLayerEvent): number[] => {
			const position = new Map(event.layers.map((layer, index) => [layer.id, index]));
			return this.layers.map((_, index) => index).sort((a, b) => (position.get(this.layers[a].id) ?? Infinity) - (position.get(this.layers[b].id) ?? Infinity) || a - b);
		};

		// 線を、再生用の形(縮めた座標・レイヤーの番号)にする。再生に出さない線(無いレイヤー・濃さ0のまとまりの中)はnull。
		// 同じ線は、操作の前後の並びで使い回されるので、一度作ったものを覚えておく
		const playCache = new Map<Misskey.entities.DrawStroke, { stroke: PlayStroke; layer: number } | null>();
		const playOf = (encoded: Misskey.entities.DrawStroke): { stroke: PlayStroke; layer: number } | null => {
			let item = playCache.get(encoded);
			if (item !== undefined) return item;
			const layer = layerIndex.get(encoded.layer ?? '0');
			if (layer == null || (encoded.g != null && hiddenGroups.get(encoded.layer ?? '0')?.has(encoded.g) === true)) {
				item = null;
			} else {
				const decoded = decodeStroke(encoded);
				item = {
					layer,
					stroke: {
						...decoded,
						size: decoded.size * scale,
						points: scalePoints(decoded.points, sx, sy),
						...(decoded.clip != null ? { clip: scalePoints(decoded.clip, sx, sy) } : {}),
					},
				};
			}
			playCache.set(encoded, item);
			return item;
		};

		// 線の操作の記録から、「操作の直後にあった線の並び(base)」と「次の操作までに描いた線(fresh)」の区間に分ける。
		// 今の並びから、新しい操作の順に手順を戻していく。記録と並びが合わなくなったら、そこより前は分からないものとして、
		// その時点の絵を最初から順に描く
		const parts: { seq: number; base: readonly Misskey.entities.DrawStroke[]; fresh: readonly Misskey.entities.DrawStroke[] }[] = [];
		let upper: readonly Misskey.entities.DrawStroke[] = strokes;
		// 操作を戻すたびに、変わった線を持ち直す。持ち直した本数が多くなりすぎたら、それより前は追わない(メモリを使いすぎないように)
		let rebuilt = 0;
		for (let i = strokeEdits.length - 1; i >= 0 && parts.length < MAX_PLAY_EDITS; i--) {
			const edit = strokeEdits[i];
			if (!(edit.after >= 0 && edit.after <= upper.length)) break;
			rebuilt += edit.u.reduce((sum, step) => sum + (step.t === 'ins' ? step.items.length : step.t === 'mv' ? (step.ids === '*' ? edit.after : step.ids.length) : 0), 0);
			if (rebuilt > MAX_PLAY_REBUILT_STROKES) break;
			const base = upper.slice(0, edit.after);
			const before = applyHistorySteps(base, edit.u);
			if (before.length !== edit.before) break;
			parts.unshift({ seq: edit.seq, base, fresh: upper.slice(edit.after) });
			upper = before;
		}
		parts.unshift({ seq: -Infinity, base: [], fresh: upper });

		// 位置は、線の長さの合計(units)と、その前にあった切り替え・操作の回数(gaps)に分けて数えておき、
		// 1回ぶんの止める長さを全体の長さから決めた後で、1つの位置に直す
		let units = 0;
		let gaps = 0;
		let current: LayerView[] | null = null;
		let currentOrder = this.layers.map((_, index) => index);
		const pendingChanges: { units: number; gaps: number; views: LayerView[]; order: number[] }[] = [];
		const pendingStrokes: { stroke: PlayStroke; layer: number; startUnits: number; startGaps: number; endUnits: number }[] = [];
		const pendingSegments: { units: number; gaps: number; base: { stroke: PlayStroke; layer: number }[]; first: number }[] = [];
		// 最後に止める分を足したのが、最後の線より後か(後なら、最後のコマと同じ絵なので、その分は取らない)
		let trailingGap = false;
		let firstEvent = true;
		// レイヤーの記録を1件進める。見え方が実際に変わるなら、変わった絵を少しの間見せてから次へ進む
		const applyEvent = (event: DrawLayerEvent) => {
			const views = viewsOf(event);
			const before: LayerView[] = current ?? this.layers;
			// 重ね順は、見えているレイヤー同士の順が変わったときだけ「変わった」とする
			const order = orderOf(event);
			const shown = (list: number[], of: LayerView[]) => list.filter(i => of[i].opacity > 0).join(',');
			// 最初の1件(記録を始める前の見え方)は、切り替えではないので止めない
			const differs = !firstEvent && (views.some((view, i) => view.opacity !== before[i].opacity || (view.opacity > 0 && view.blend !== before[i].blend)) || shown(order, views) !== shown(currentOrder, views));
			firstEvent = false;
			current = views;
			currentOrder = order;
			pendingChanges.push({ units, gaps, views, order });
			if (differs) {
				gaps++;
				trailingGap = true;
			}
		};
		for (const [p, part] of parts.entries()) {
			const base = part.base.map(playOf).filter(item => item != null);
			pendingSegments.push({ units, gaps, base, first: pendingStrokes.length });
			// 線の操作(動かす・回す・取り消しなど)の後の絵も、少しの間見せてから次へ進む
			if (p > 0) {
				gaps++;
				trailingGap = true;
			}
			// この区間の間に変えたレイヤーの記録を、「この区間の線を何本描いた後か」に直す。目印の線がこの区間に無ければ、
			// そのときの線の本数から決める。記録は起きた順なので、後の記録より後ろにはしない
			const nextSeq = parts[p + 1]?.seq ?? Infinity;
			const events = layerEvents.filter(event => (event.seq ?? -1) > part.seq && (event.seq ?? -1) < nextSeq);
			const freshIndex = new Map(part.fresh.map((stroke, index) => [stroke.id, index]));
			const counts = events.map(event => {
				const anchored = event.after != null ? freshIndex.get(event.after) : undefined;
				return anchored != null ? anchored + 1 : Math.min(Math.max(0, Math.floor(event.index) - part.base.length), part.fresh.length);
			});
			for (let i = counts.length - 2; i >= 0; i--) counts[i] = Math.min(counts[i], counts[i + 1]);
			let next = 0;
			for (const [index, encoded] of part.fresh.entries()) {
				for (; next < events.length && counts[next] <= index; next++) applyEvent(events[next]);
				const item = playOf(encoded);
				if (item == null) continue;
				// 描いたときに隠れていたレイヤーの線には、再生の時間を取らない(何も変わらないコマが続かないように)
				const startUnits = units;
				if (current == null || (current as LayerView[])[item.layer].opacity > 0) units += unitsOf(item.stroke);
				pendingStrokes.push({ stroke: item.stroke, layer: item.layer, startUnits, startGaps: gaps, endUnits: units });
				trailingGap = false;
			}
			for (; next < events.length; next++) applyEvent(events[next]);
		}
		// 描く線が無ければ、切り替えだけの再生にはしない(「まだ何も描かれていません」のまま)
		if (pendingStrokes.length === 0 && pendingSegments.every(segment => segment.base.length === 0)) {
			this.totalUnits = 0;
			return;
		}
		// 全ての線が、隠れているレイヤーに描かれていた(再生の時間を1つも取っていない)なら、隠れていたかは見ずに時間を取る
		if (units === 0) {
			for (const item of pendingStrokes) {
				item.startUnits = units;
				units += unitsOf(item.stroke);
				item.endUnits = units;
			}
			// 線が1本も無く、操作の直後の絵だけがある(全て描いてから操作した)ときも、最後の絵は出す
			if (units === 0) units = STROKE_MIN_UNITS;
		}
		// 描き終えた後の最後の切り替え・操作は、今の絵(最後のコマ)と同じはずなので、止める分は取らない
		const totalGaps = trailingGap ? gaps - 1 : gaps;
		// 1回で止める長さ。全体の2%(20秒の動画で0.4秒)を目安に、短い絵では下限まで取り、
		// 回数が多いときは全部合わせて全体の3割までに収める
		const gap = totalGaps > 0 ? Math.max(LAYER_EVENT_MIN_UNITS, Math.min(units * 0.02, units * 0.3 / totalGaps)) : 0;
		for (const item of pendingStrokes) {
			this.strokes.push({ stroke: item.stroke, layer: item.layer, start: item.startUnits + item.startGaps * gap, end: item.endUnits + item.startGaps * gap });
		}
		for (const change of pendingChanges) this.changes.push({ at: change.units + change.gaps * gap, views: change.views, order: change.order });
		for (const segment of pendingSegments) this.segments.push({ at: segment.units + segment.gaps * gap, base: segment.base, first: segment.first });
		this.totalUnits = units + totalGaps * gap;
	}

	// 再生の位置での、レイヤーの見え方の記録の番号(記録が無い・描き終えた後は -1 = 最後の見え方)
	private changeAt(units: number): number {
		if (this.changes.length === 0 || units >= this.totalUnits) return -1;
		let index = -1;
		for (let i = 0; i < this.changes.length && this.changes[i].at <= units; i++) index = i;
		// 最初の記録より前は、最初の記録(記録を始める前の見え方)を使う
		return Math.max(0, index);
	}

	/**
	 * 再生の位置(0〜totalUnits)まで進めた絵を、出力先に描く。前より手前の位置を渡したら、最初から描き直す。
	 * forceを渡すと、前のコマから変わっていなくても描き直す(録画は、キャンバスに描いたときだけコマが入るので、
	 * 描き終えた絵で止めている間もコマを入れるために使う)。
	 * 出力先に描いたらtrue(前のコマのままならfalse)
	 */
	public render(target: CanvasRenderingContext2D, units: number, force = false): boolean {
		// 今の位置の区間(線の操作で区切ったもの)。区間が変わった・手前へ戻ったら、その区間の始まりの絵から描き直す
		let segment = 0;
		for (let i = 1; i < this.segments.length && this.segments[i].at <= units; i++) segment = i;
		const first = this.segments[segment]?.first ?? 0;
		const end = this.segments[segment + 1]?.first ?? this.strokes.length;
		if (segment !== this.segment || this.done < first || this.done > end || (this.done > first && units < this.strokes[this.done - 1].end)) {
			this.reset();
			this.segment = segment;
			this.done = first;
			for (const item of this.segments[segment]?.base ?? []) this.layers[item.layer].player.draw(item.stroke);
		}
		while (this.done < end && this.strokes[this.done].end <= units) {
			const item = this.strokes[this.done++];
			this.layers[item.layer].player.draw(item.stroke);
		}
		// 描いている途中の線(点を、進んだ分だけ)
		let partial: { stroke: PlayStroke; layer: number } | null = null;
		const current = this.done < end ? this.strokes[this.done] : undefined;
		if (current != null && isProgressive(current.stroke)) {
			// 線の前にレイヤーの切り替えで止めている間は、まだ描き始めない
			const fraction = Math.max(0, (units - current.start) / (current.end - current.start));
			const total = current.stroke.points.length / 3;
			// 途中の線は毎回最初から描き直すので、点の多い線・描くのが重い線は、何点かずつまとめて進める
			// (1本の線を描き直す回数を、重い線は24回・ほかは120回までにする)
			const step = Math.max(1, Math.ceil(total / (isHeavy(current.stroke) ? 24 : 120)));
			const count = Math.floor(total * fraction / step) * step;
			if (count >= 2) partial = { stroke: { ...current.stroke, points: current.stroke.points.slice(0, count * 3) }, layer: current.layer };
		}
		// 前のコマから変わっていなければ、描き直さない(出力先には前のコマが残っている)
		const count = partial != null ? partial.stroke.points.length / 3 : 0;
		const change = this.changeAt(units);
		if (!force && this.lastFrame != null && this.lastFrame.done === this.done && this.lastFrame.count === count && this.lastFrame.change === change && this.lastFrame.segment === segment && this.lastFrame.target === target) return false;
		this.lastFrame = { done: this.done, count, change, segment, target };
		const views = change >= 0 ? this.changes[change].views : null;

		target.save();
		target.setTransform(1, 0, 0, 1, 0, 0);
		target.globalAlpha = 1;
		target.globalCompositeOperation = 'source-over';
		target.fillStyle = '#ffffff';
		target.fillRect(0, 0, this.width, this.height);
		const order = change >= 0 ? this.changes[change].order : this.layers.map((_, index) => index);
		for (const i of order) {
			const layer = this.layers[i];
			const view = views != null ? views[i] : layer;
			if (view.opacity <= 0) continue;
			target.globalAlpha = view.opacity;
			target.globalCompositeOperation = view.blend;
			target.drawImage(layer.player.view(this.scratch, partial != null && partial.layer === i ? partial.stroke : null), 0, 0);
		}
		target.restore();
		return true;
	}

	public reset(): void {
		this.done = 0;
		this.segment = -1;
		this.lastFrame = null;
		for (const layer of this.layers) layer.player.reset();
	}

	public dispose(): void {
		for (const layer of this.layers) layer.player.dispose();
		for (const canvas of this.scratch) {
			canvas.width = 1;
			canvas.height = 1;
		}
	}
}

/** このブラウザで録れる動画の形式(WebMを優先し、録れないブラウザ(Safari等)だけmp4にする)。録れなければnull */
export function timelapseVideoType(): { mimeType: string; ext: string } | null {
	if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
	const candidates = [
		{ mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
		{ mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
		{ mimeType: 'video/webm', ext: 'webm' },
		{ mimeType: 'video/mp4;codecs=avc1', ext: 'mp4' },
		{ mimeType: 'video/mp4', ext: 'mp4' },
	];
	return candidates.find(candidate => MediaRecorder.isTypeSupported(candidate.mimeType)) ?? null;
}
