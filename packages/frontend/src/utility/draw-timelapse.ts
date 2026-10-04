/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 落書きのタイムラプス。保存してある線を、描いた順に少しずつ描き直して見せる(操作の記録は持たないので、
// 取り消した線・動かす前の位置などは出ない)。動画にするときも同じ絵を使う。
// 大きなキャンバスでもメモリを使いすぎないよう、線の座標・太さを縮めてから、小さい絵として描く

import type * as Misskey from 'misskey-js';
import { decodeStroke, drawStroke } from '@/utility/draw-canvas.js';
import type { CanvasStroke, DrawLayerGroup } from '@/utility/draw-canvas.js';

// まとまりの入れ子の深さの上限(draw-canvas.ts の DRAW_LAYER_GROUP_MAX_DEPTH と同じ)
const GROUP_MAX_DEPTH = 16;
// 塗りつぶし・囲って消す線の、再生にかける長さ(点の数に換算)。点の列は輪郭なので、点の数では決めない
const FILL_UNITS = 12;
// 線1本の、再生にかける長さの下限・上限(点の数に換算)。点が1つの線にも少し時間を取り、とても長い線に時間を取られすぎないように
const STROKE_MIN_UNITS = 4;
const STROKE_MAX_UNITS = 400;

type PlayStroke = CanvasStroke & { g?: string };

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
	private readonly strokes: { stroke: PlayStroke; layer: number; end: number }[] = [];
	private readonly layers: { player: LayerPlayer; opacity: number; blend: GlobalCompositeOperation }[] = [];
	private readonly scratch: [HTMLCanvasElement, HTMLCanvasElement];
	// 最後まで描き終えた線の数
	private done = 0;
	// 前に描いたコマ(描き終えた線の数・途中の線の点の数・出力先)。同じなら描き直さない
	private lastFrame: { done: number; count: number; target: CanvasRenderingContext2D } | null = null;

	/**
	 * maxSize: 出す絵の長い辺の上限(これより大きいキャンバスは縮める)
	 */
	constructor(canvasWidth: number, canvasHeight: number, strokes: readonly Misskey.entities.DrawStroke[], layers: readonly Misskey.entities.DrawLayer[], maxSize: number) {
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
		for (const meta of metas) {
			// 下描きのレイヤーは、保存する画像と同じく入れない
			if (!meta.visible || meta.private === true || !(meta.opacity > 0)) continue;
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
				player: new LayerPlayer(this.width, this.height, new Map((meta.groups ?? []).map(group => [group.id, group]))),
				opacity: Math.min(1, Math.max(0, meta.opacity)),
				blend: meta.blend ?? 'source-over',
			});
		}

		let units = 0;
		for (const encoded of strokes) {
			const layer = layerIndex.get(encoded.layer ?? '0');
			if (layer == null) continue;
			if (encoded.g != null && hiddenGroups.get(encoded.layer ?? '0')?.has(encoded.g) === true) continue;
			const decoded = decodeStroke(encoded);
			const stroke: PlayStroke = {
				...decoded,
				size: decoded.size * scale,
				points: scalePoints(decoded.points, sx, sy),
				...(decoded.clip != null ? { clip: scalePoints(decoded.clip, sx, sy) } : {}),
			};
			units += unitsOf(stroke);
			this.strokes.push({ stroke, layer, end: units });
		}
		this.totalUnits = units;
	}

	/**
	 * 再生の位置(0〜totalUnits)まで進めた絵を、出力先に描く。前より手前の位置を渡したら、最初から描き直す。
	 * forceを渡すと、前のコマから変わっていなくても描き直す(録画は、キャンバスに描いたときだけコマが入るので、
	 * 描き終えた絵で止めている間もコマを入れるために使う)
	 */
	public render(target: CanvasRenderingContext2D, units: number, force = false): void {
		if (this.done > 0 && (this.done > this.strokes.length || units < (this.strokes[this.done - 1]?.end ?? 0))) this.reset();
		while (this.done < this.strokes.length && this.strokes[this.done].end <= units) {
			const item = this.strokes[this.done++];
			this.layers[item.layer].player.draw(item.stroke);
		}
		// 描いている途中の線(点を、進んだ分だけ)
		let partial: { stroke: PlayStroke; layer: number } | null = null;
		const current = this.strokes[this.done];
		if (current != null && isProgressive(current.stroke)) {
			const start = this.done > 0 ? this.strokes[this.done - 1].end : 0;
			const fraction = (units - start) / (current.end - start);
			const total = current.stroke.points.length / 3;
			// 途中の線は毎回最初から描き直すので、点の多い線・描くのが重い線は、何点かずつまとめて進める
			// (1本の線を描き直す回数を、重い線は24回・ほかは120回までにする)
			const step = Math.max(1, Math.ceil(total / (isHeavy(current.stroke) ? 24 : 120)));
			const count = Math.floor(total * fraction / step) * step;
			if (count >= 2) partial = { stroke: { ...current.stroke, points: current.stroke.points.slice(0, count * 3) }, layer: current.layer };
		}
		// 前のコマから変わっていなければ、描き直さない(出力先には前のコマが残っている)
		const count = partial != null ? partial.stroke.points.length / 3 : 0;
		if (!force && this.lastFrame != null && this.lastFrame.done === this.done && this.lastFrame.count === count && this.lastFrame.target === target) return;
		this.lastFrame = { done: this.done, count, target };

		target.save();
		target.setTransform(1, 0, 0, 1, 0, 0);
		target.globalAlpha = 1;
		target.globalCompositeOperation = 'source-over';
		target.fillStyle = '#ffffff';
		target.fillRect(0, 0, this.width, this.height);
		for (const [i, layer] of this.layers.entries()) {
			if (layer.opacity <= 0) continue;
			target.globalAlpha = layer.opacity;
			target.globalCompositeOperation = layer.blend;
			target.drawImage(layer.player.view(this.scratch, partial != null && partial.layer === i ? partial.stroke : null), 0, 0);
		}
		target.restore();
	}

	public reset(): void {
		this.done = 0;
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
