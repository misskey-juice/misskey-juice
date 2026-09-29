/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type * as Misskey from 'misskey-js';

// JUICE: 絵チャの描画エンジン(Vueから独立させた、キャンバスの状態と描画だけを持つ部品)。
// ユーザーごとにレイヤー(キャンバス)を1枚ずつ持ち、表示用のキャンバスへ重ねて合成する。
// 消しゴムは自分のレイヤーにだけdestination-outで効くので、他人の線は消えない。

// サーバーとやり取りする形の線(点の列はbase64)
export type DrawStroke = Misskey.entities.DrawStroke;
export type DrawTool = DrawStroke['tool'];
// 描画に使う形の線。pointsは [x, y, 筆圧(0〜1), x, y, 筆圧, …] の平らな配列(キャンバス座標)
export type CanvasStroke = Omit<DrawStroke, 'points' | 'clip'> & { points: number[]; clip?: number[] };

type PendingStroke = CanvasStroke;

// JUICE: 描ける人数の上限の範囲(サーバーの DRAW_ROOM_MIN_MEMBERS / DRAW_ROOM_MAX_MEMBERS と同じ)
export const DRAW_ROOM_MIN_MEMBERS = 2;
export const DRAW_ROOM_MAX_MEMBERS = 512;

export function clampMaxMembers(value: number | null | undefined, fallback: number): number {
	if (value == null || !Number.isFinite(value)) return fallback;
	return Math.min(DRAW_ROOM_MAX_MEMBERS, Math.max(DRAW_ROOM_MIN_MEMBERS, Math.round(value)));
}

// JUICE: 部屋主が自由に決められるキャンバスの大きさの範囲(サーバーの DRAW_ROOM_CANVAS_MIN_SIZE / MAX_SIZE と同じ)
export const DRAW_ROOM_CANVAS_MIN_SIZE = 100;
export const DRAW_ROOM_CANVAS_MAX_SIZE = 3840;

/**
 * キャンバスの大きさを範囲内に収める。maxはロールで決まっている上限(drawRoomMaxCanvasSize)
 */
export function clampCanvasSize(value: number | null | undefined, fallback: number, max: number = DRAW_ROOM_CANVAS_MAX_SIZE): number {
	const upper = Math.max(DRAW_ROOM_CANVAS_MIN_SIZE, Math.min(DRAW_ROOM_CANVAS_MAX_SIZE, max));
	const v = value == null || !Number.isFinite(value) ? fallback : Math.round(value);
	return Math.min(upper, Math.max(DRAW_ROOM_CANVAS_MIN_SIZE, v));
}

// JUICE: 太さの上限(サーバーの DRAW_STROKE_MAX_SIZE と同じ)と、標準の大きさ(1600px)のキャンバスでの太さ
export const DRAW_STROKE_MAX_SIZE = 200;
const BASE_CANVAS_SIZE = 1600;
const BASE_MAX_BRUSH_SIZE = 60;
const BASE_DEFAULT_BRUSH_SIZE = 6;

/**
 * キャンバスの大きさに合わせた、太さのスライダーの上限と最初の太さ。
 * 大きいキャンバスでは同じ太さでも細く見えるので、長い辺に比例して大きくする(小さいキャンバスでは下げない)
 */
export function brushSizeRange(width: number, height: number): { max: number; initial: number } {
	const ratio = Math.max(1, Math.max(width, height) / BASE_CANVAS_SIZE);
	return {
		max: Math.min(DRAW_STROKE_MAX_SIZE, Math.round(BASE_MAX_BRUSH_SIZE * ratio)),
		initial: Math.round(BASE_DEFAULT_BRUSH_SIZE * ratio),
	};
}

// JUICE: 点の列の送受信・保存の形式。1点5バイトで、x・yはキャンバス座標を8倍したint16(1/8px単位)、
// 筆圧は0〜255のuint8(リトルエンディアン)。バイト列をbase64にする(サーバーの decodeDrawPoints と同じ形式)
const POINT_BYTES = 5;
export const POINT_SCALE = 8;

export function encodePoints(points: number[]): string {
	const count = Math.floor(points.length / 3);
	const view = new DataView(new ArrayBuffer(count * POINT_BYTES));
	const clampInt16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * POINT_SCALE)));
	for (let i = 0; i < count; i++) {
		const o = i * POINT_BYTES;
		view.setInt16(o, clampInt16(points[i * 3]), true);
		view.setInt16(o + 2, clampInt16(points[i * 3 + 1]), true);
		view.setUint8(o + 4, Math.round(Math.max(0, Math.min(1, points[i * 3 + 2])) * 255));
	}
	let binary = '';
	const bytes = new Uint8Array(view.buffer);
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

export function decodePoints(encoded: string): number[] {
	let binary: string;
	try {
		binary = atob(encoded);
	} catch {
		return [];
	}
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	const view = new DataView(bytes.buffer);
	const points: number[] = [];
	for (let o = 0; o + POINT_BYTES <= bytes.length; o += POINT_BYTES) {
		points.push(view.getInt16(o, true) / POINT_SCALE, view.getInt16(o + 2, true) / POINT_SCALE, view.getUint8(o + 4) / 255);
	}
	return points;
}

/**
 * サーバーから届いた線を描画用の形にする。移動ツールでずらした量(dx・dy)は点の列に足し込む
 */
export function decodeStroke(stroke: DrawStroke): CanvasStroke {
	const { dx, dy, clip, ...rest } = stroke;
	return {
		...rest,
		points: shiftPoints(decodePoints(stroke.points), dx ?? 0, dy ?? 0),
		// 線の中だけ塗る範囲も、線と一緒にずれている
		...(clip != null ? { clip: shiftPoints(decodePoints(clip), dx ?? 0, dy ?? 0) } : {}),
	};
}

/**
 * 描画用の線を、サーバーとやり取りする形にする(点の列・塗れる範囲をbase64に)
 */
export function encodeStroke(stroke: CanvasStroke): DrawStroke {
	const { clip, ...rest } = stroke;
	return { ...rest, points: encodePoints(stroke.points), ...(clip != null ? { clip: encodePoints(clip) } : {}) };
}

function shiftPoints(points: number[], dx: number, dy: number): number[] {
	if (dx === 0 && dy === 0) return points;
	return points.map((v, i) => (i % 3 === 0 ? v + dx : i % 3 === 1 ? v + dy : v));
}

// JUICE: 線が描かれる範囲(キャンバスの座標、右下は含まない)。人数が多いときに、変わった範囲だけを描き直すのに使う
type Rect = { x0: number; y0: number; x1: number; y1: number };

// 点の列(x, y, 筆圧の繰り返し)を囲む範囲。線の太さぶん広げる
function pointsRect(points: number[], pad: number): Rect | null {
	if (points.length < 3) return null;
	let x0 = Infinity;
	let y0 = Infinity;
	let x1 = -Infinity;
	let y1 = -Infinity;
	for (let i = 0; i < points.length; i += 3) {
		x0 = Math.min(x0, points[i]);
		x1 = Math.max(x1, points[i]);
		y0 = Math.min(y0, points[i + 1]);
		y1 = Math.max(y1, points[i + 1]);
	}
	return { x0: Math.floor(x0 - pad), y0: Math.floor(y0 - pad), x1: Math.ceil(x1 + pad), y1: Math.ceil(y1 + pad) };
}

const strokeRectCache = new WeakMap<object, Rect | null>();

function strokeRect(stroke: StrokeShape): Rect | null {
	let rect = strokeRectCache.get(stroke);
	if (rect === undefined) {
		rect = pointsRect(stroke.points, stroke.size + 2);
		strokeRectCache.set(stroke, rect);
	}
	return rect;
}

// 描いている途中の線の範囲(点が増えるのでキャッシュしない)
function pendingRect(entry: { points: number[]; size: number }): Rect | null {
	return pointsRect(entry.points, entry.size + 2);
}

function unionRect(a: Rect | null, b: Rect | null): Rect | null {
	if (a == null) return b;
	if (b == null) return a;
	return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function rectsIntersect(a: Rect, b: Rect): boolean {
	return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

// 点(x, y)が多角形(平らな座標の配列)の内側にあるか
function pointInPolygon(x: number, y: number, polygon: number[]): boolean {
	let inside = false;
	for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
		const xi = polygon[i];
		const yi = polygon[i + 1];
		const xj = polygon[j];
		const yj = polygon[j + 1];
		if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

type PendingEntry = PendingStroke & {
	updatedAt: number;
	// 重ね描き用のキャンバスに描き終えた区間の数
	drawnSegments: number;
	// 半透明の線を不透明で描いておく、この線だけのキャンバス(半透明のときだけ作る)
	canvas: HTMLCanvasElement | null;
};

// JUICE: 描いている途中のペンの線は、表示用のキャンバスとは別の重ね描き用キャンバスに、増えた分だけ描き足す。
// こうすると描いている間に表示用のキャンバス(全レイヤーの合成)を描き直さずに済む。
// 消しゴムは下の絵を消して見せる必要があるので、これまでどおりレイヤーごと描き直す
function isOverlayStroke(stroke: { tool: DrawTool; lock?: boolean; pressure?: StrokeShape['pressure']; brush?: StrokeShape['brush'] }): boolean {
	// JUICE: 透明度ロックの線は、下の絵のある所にだけ描くので、レイヤーに重ねて描く(消しゴムと同じ扱い)。
	// 筆圧で濃さを変える普通の筆の線も、線全体を作り直して描くので、レイヤーに重ねて描く
	if (stroke.brush !== 'soft' && pressureAffectsOpacity(stroke)) return false;
	return stroke.tool === 'pen' && stroke.lock !== true;
}

// JUICE: レイヤーの合成モード(Canvasの合成方法の名前)。無ければ通常
export const DRAW_LAYER_BLENDS = ['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'lighter'] as const;
export type DrawLayerBlend = typeof DRAW_LAYER_BLENDS[number];

// JUICE: 描いている途中の線が、この時間続きも確定も届かなければ消す(描いていた人の切断などで
// 取りやめの知らせが届かなかった場合に、途中までの線がいつまでも残らないように)
const PENDING_STROKE_TIMEOUT_MS = 20 * 1000;

// JUICE: 1人が複数のレイヤーを持てる。レイヤーは「描いた人のid:レイヤーのid」のキーで区別する
export function drawLayerKey(userId: string, layerId: string | undefined): string {
	return `${userId}:${layerId ?? '0'}`;
}

export function ownerOfLayerKey(key: string): string {
	const i = key.indexOf(':');
	return i === -1 ? key : key.slice(0, i);
}

type Layer = {
	// 描いた人のid:レイヤーのid(drawLayerKey)
	key: string;
	ownerId: string;
	// レイヤーの濃さ(0〜1)。表示・保存する画像の両方に効く
	opacity: number;
	// 描き終わった線だけを描いたキャンバス
	committed: HTMLCanvasElement;
	// 消しゴムの途中の線も含めて描いたキャンバス。消しゴム・移動を使っている間だけ持つ。
	// 使い終わったらエンジンの予備の置き場(liveSpare)に戻し、次に使うレイヤーで使い回す
	// (レイヤーごとに持ち続けるとメモリを使いすぎ、作っては捨てるとブラウザが重くなり落ちることもあるため)
	live: HTMLCanvasElement | null;
	// liveのうち描き直しが必要な範囲('full'は全体)
	liveDirty: Rect | 'full' | null;
	strokes: CanvasStroke[];
	// 全体マップ用の縮小したレイヤー(描き終わった線だけ)
	thumb: HTMLCanvasElement;
	pending: Map<string, PendingEntry>;
	visible: boolean;
	// JUICE: 下描き(本人の画面にだけ見える)。保存する画像には入れない
	private: boolean;
	// JUICE: 合成モード(下のレイヤーとの重ね方)
	blend: GlobalCompositeOperation;
};

// JUICE: レイヤーを、その濃さ・合成モードで重ねる
function setLayerComposite(ctx: CanvasRenderingContext2D, layer: Layer): void {
	ctx.globalAlpha = layer.opacity;
	ctx.globalCompositeOperation = layer.blend;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
	const canvas = window.document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas;
}

type StrokeShape = Pick<CanvasStroke, 'tool' | 'color' | 'size' | 'points' | 'opacity' | 'brush' | 'clip' | 'lock' | 'pressure'>;

// JUICE: 筆圧で濃さを変える線か(にじみ筆は筆跡ごとに、普通の筆は線全体で。ドット・塗りつぶしには使わない)
function pressureAffectsOpacity(stroke: Pick<StrokeShape, 'pressure' | 'brush' | 'tool'>): boolean {
	if (stroke.pressure !== 'opacity' && stroke.pressure !== 'both') return false;
	return stroke.tool !== 'fill' && stroke.brush !== 'dot' && stroke.brush !== 'area';
}

// 半透明の線を一旦不透明で描いておく作業用のキャンバス(使い回す)。
// 読み込みのときはWorkerの中でも描くので、documentが無ければOffscreenCanvasにする
let scratch: HTMLCanvasElement | null = null;

function createScratch(): HTMLCanvasElement {
	if (typeof window !== 'undefined') return window.document.createElement('canvas');
	// OffscreenCanvasは、ここで使う機能(大きさ・getContext('2d')・drawImageの元)がcanvas要素と同じ
	return new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement;
}

/**
 * 1本の線を描く。筆圧で線の太さを変え、点の間は中点を通る2次曲線でつないで滑らかにする。
 * 太さが区間ごとに変わるので、区間ごとに線を引いて丸い線端でつなぐ。
 * 半透明の線は、区間の重なりが濃くならないよう作業用キャンバスに不透明で描いてから、まとめて薄く重ねる
 */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: StrokeShape): void {
	// JUICE: 透明度ロックの線は、レイヤーの描いてある所(透明でない所)にだけ描く
	if (stroke.lock === true && stroke.tool !== 'eraser') {
		drawLockedStroke(ctx, stroke);
		return;
	}
	// JUICE: 線の中だけ塗る(はみ出し防止)の線は、塗れる範囲の外には描かない
	if (stroke.clip != null && stroke.clip.length >= 9) {
		ctx.save();
		tracePolygon(ctx, stroke.clip);
		ctx.clip('evenodd');
		drawStrokeUnclipped(ctx, stroke);
		ctx.restore();
		return;
	}
	drawStrokeUnclipped(ctx, stroke);
}

// JUICE: 筆圧で濃さを変える普通の筆の線。
// 区間ごとの濃さ(筆圧)を、灰色の濃淡として線とまったく同じ形(同じつなぎ方・同じ太さ)で描き、その明るさを不透明度にする。
// - 区間(2次曲線)は細かいまっすぐな小区間に分け、端を丸めずに、始まりの濃さから終わりの濃さへのグラデーションで描く
//   (小区間どうしが重ならず、どの境目でも両側の濃さがそろう)
// - 曲がり角のすき間と線の両端は、つなぎ目ごとにそのつなぎ目の濃さの丸を下に敷いて埋める(線の形と同じ丸い形になる)
// - 1本の線の中で重なった所(同じ所で筆圧を変えた・線が交差した)は、濃い方を残す(小区間どうし・丸どうしとも)。
//   丸は小区間の下に敷くので、小区間のある所は小区間の濃さになる
// 線より太く描いたりぼかしたりしないので、ある区間の濃さはその区間の形の中にしか出ない。
// (前は濃淡を線より太く描き「明るい方を残す」重ね方でぼかしていたため、1本の線が回り込んで描き始めの近くに来ると、
// 描き終わりの濃さが描き始めの薄い所まで広がって濃くなっていた)
let pressureScratch: HTMLCanvasElement | null = null;
let pressureField: HTMLCanvasElement | null = null;

function drawPressureOpacityStroke(ctx: CanvasRenderingContext2D, stroke: StrokeShape): void {
	const rect = pointsRect(stroke.points, stroke.size + 2);
	if (rect == null) return;
	const x0 = Math.floor(Math.max(0, rect.x0));
	const y0 = Math.floor(Math.max(0, rect.y0));
	const x1 = Math.ceil(Math.min(ctx.canvas.width, rect.x1));
	const y1 = Math.ceil(Math.min(ctx.canvas.height, rect.y1));
	if (x1 <= x0 || y1 <= y0) return;
	const w = x1 - x0;
	const h = y1 - y0;
	pressureScratch ??= createScratch();
	pressureField ??= createScratch();
	for (const c of [pressureScratch, pressureField]) {
		if (c.width < w) c.width = w;
		if (c.height < h) c.height = h;
	}
	const p = stroke.points;
	const count = Math.floor(p.length / 3);
	const gray = (v: number) => {
		const g = Math.round(Math.min(1, Math.max(0, v)) * 255);
		return `rgb(${g}, ${g}, ${g})`;
	};

	// 濃さの場(灰色)。線の外は透明のまま
	const fctx = pressureField.getContext('2d', { willReadFrequently: true })!;
	fctx.save();
	fctx.globalAlpha = 1;
	fctx.globalCompositeOperation = 'source-over';
	fctx.filter = 'none';
	fctx.clearRect(0, 0, w, h);
	fctx.translate(-x0, -y0);
	fctx.lineJoin = 'round';
	if (count === 1) {
		fctx.fillStyle = gray(p[2]);
		fctx.beginPath();
		fctx.arc(p[0], p[1], strokeWidthAt(stroke, 0) / 2, 0, Math.PI * 2);
		fctx.fill();
	} else {
		// 区間: 前の点との中点から、この点を通って次の点との中点まで(線の形と同じつなぎ方)。端の濃さは、となりの点との平均
		const segments: { sx: number; sy: number; cx: number; cy: number; ex: number; ey: number; width: number; a: number; b: number }[] = [];
		for (let i = 1; i < count; i++) {
			const x = p[i * 3];
			const y = p[i * 3 + 1];
			const tail = i === count - 1;
			segments.push({
				sx: i === 1 ? p[0] : (p[(i - 1) * 3] + x) / 2,
				sy: i === 1 ? p[1] : (p[(i - 1) * 3 + 1] + y) / 2,
				cx: x,
				cy: y,
				ex: tail ? x : (x + p[(i + 1) * 3]) / 2,
				ey: tail ? y : (y + p[(i + 1) * 3 + 1]) / 2,
				width: (strokeWidthAt(stroke, i - 1) + strokeWidthAt(stroke, i)) / 2,
				a: i === 1 ? p[2] : (p[(i - 1) * 3 + 2] + p[i * 3 + 2]) / 2,
				b: tail ? p[i * 3 + 2] : (p[i * 3 + 2] + p[(i + 1) * 3 + 2]) / 2,
			});
		}
		// 区間(2次曲線)を細かいまっすぐな小区間に分ける。小区間ごとに自分の向きにグラデーションをかけるので、
		// 曲がっていても小区間の境目で両側の濃さがそろう
		type Piece = { x0: number; y0: number; x1: number; y1: number; v0: number; v1: number; width: number };
		const pieces: Piece[] = [];
		for (const seg of segments) {
			const approx = Math.hypot(seg.cx - seg.sx, seg.cy - seg.sy) + Math.hypot(seg.ex - seg.cx, seg.ey - seg.cy);
			const n = Math.min(24, Math.max(1, Math.ceil(approx / 3)));
			let px = seg.sx;
			let py = seg.sy;
			for (let k = 1; k <= n; k++) {
				const t = k / n;
				const qx = (1 - t) * (1 - t) * seg.sx + 2 * (1 - t) * t * seg.cx + t * t * seg.ex;
				const qy = (1 - t) * (1 - t) * seg.sy + 2 * (1 - t) * t * seg.cy + t * t * seg.ey;
				pieces.push({ x0: px, y0: py, x1: qx, y1: qy, v0: seg.a + (seg.b - seg.a) * (k - 1) / n, v1: seg.a + (seg.b - seg.a) * t, width: seg.width });
				px = qx;
				py = qy;
			}
		}
		// 下敷き: つなぎ目ごとに、そのつなぎ目の濃さの丸を置く(曲がり角のすき間と、線の両端の丸い所を埋める)
		// 重なった所は濃い方を残す(同じ所で筆圧を変えたとき、後から軽くなっても薄くならないように)
		fctx.globalCompositeOperation = 'lighten';
		const dot = (x: number, y: number, r: number, v: number) => {
			fctx.fillStyle = gray(v);
			fctx.beginPath();
			fctx.arc(x, y, r, 0, Math.PI * 2);
			fctx.fill();
		};
		dot(pieces[0].x0, pieces[0].y0, pieces[0].width / 2, pieces[0].v0);
		for (const piece of pieces) dot(piece.x1, piece.y1, piece.width / 2, piece.v1);
		// 線の両端の丸い所(端より外側の半分)は、端の濃さにする(となりの濃い丸がかぶって、端だけ段になって濃く見えないように)。
		// その場で押した点のように道のりがペン幅より短い線では、外側が決まらないので行わない
		const moving = pieces.filter(piece => piece.x0 !== piece.x1 || piece.y0 !== piece.y1);
		const pathLength = moving.reduce((sum, piece) => sum + Math.hypot(piece.x1 - piece.x0, piece.y1 - piece.y0), 0);
		if (moving.length > 0 && pathLength >= Math.max(...pieces.map(piece => piece.width))) {
			const cap = (x: number, y: number, dx: number, dy: number, r: number, v: number) => {
				const len = Math.hypot(dx, dy);
				const ux = dx / len * (r + 2);
				const uy = dy / len * (r + 2);
				fctx.save();
				fctx.globalCompositeOperation = 'source-over';
				fctx.beginPath();
				fctx.moveTo(x - uy, y + ux);
				fctx.lineTo(x - uy + ux, y + ux + uy);
				fctx.lineTo(x + uy + ux, y - ux + uy);
				fctx.lineTo(x + uy, y - ux);
				fctx.closePath();
				fctx.clip();
				dot(x, y, r, v);
				fctx.restore();
			};
			const first = moving[0];
			const last = moving[moving.length - 1];
			cap(pieces[0].x0, pieces[0].y0, first.x0 - first.x1, first.y0 - first.y1, pieces[0].width / 2, pieces[0].v0);
			const end = pieces[pieces.length - 1];
			cap(end.x1, end.y1, last.x1 - last.x0, last.y1 - last.y0, end.width / 2, end.v1);
		}
		// 上: 端を丸めない小区間を、始まりの濃さから終わりの濃さへのグラデーションで。
		// 別のキャンバスに(重なりは濃い方を残して)描いてから、丸の上に重ねる(小区間のある所は小区間の濃さにする)
		const pctx = pressureScratch.getContext('2d')!;
		pctx.save();
		pctx.globalAlpha = 1;
		pctx.globalCompositeOperation = 'source-over';
		pctx.clearRect(0, 0, w, h);
		pctx.translate(-x0, -y0);
		pctx.globalCompositeOperation = 'lighten';
		pctx.lineCap = 'butt';
		for (const piece of pieces) {
			if (piece.x0 === piece.x1 && piece.y0 === piece.y1) continue;
			const gradient = pctx.createLinearGradient(piece.x0, piece.y0, piece.x1, piece.y1);
			gradient.addColorStop(0, gray(piece.v0));
			gradient.addColorStop(1, gray(piece.v1));
			pctx.strokeStyle = gradient;
			pctx.lineWidth = piece.width;
			// 縁のなめらか処理で小区間の境目に細いすき間ができて筋に見えないよう、前後に1pxずつ伸ばして重ねる
			// (伸ばした所はグラデーションの端の色のままなので、となりの濃さは持ち込まない)
			const len = Math.hypot(piece.x1 - piece.x0, piece.y1 - piece.y0);
			const ux = (piece.x1 - piece.x0) / len;
			const uy = (piece.y1 - piece.y0) / len;
			pctx.beginPath();
			pctx.moveTo(piece.x0 - ux, piece.y0 - uy);
			pctx.lineTo(piece.x1 + ux, piece.y1 + uy);
			pctx.stroke();
		}
		pctx.restore();
		fctx.setTransform(1, 0, 0, 1, 0, 0);
		fctx.globalCompositeOperation = 'source-over';
		fctx.drawImage(pressureScratch, 0, 0, w, h, 0, 0, w, h);
	}
	fctx.restore();
	// 明るさ×描いてある割合(縁のなめらかさ)を不透明度にする
	const image = fctx.getImageData(0, 0, w, h);
	const data = image.data;
	for (let k = 0; k < data.length; k += 4) data[k + 3] = Math.round(data[k] * data[k + 3] / 255);
	fctx.putImageData(image, 0, 0);

	// 線の色を、その不透明度で切り抜く
	const sctx = pressureScratch.getContext('2d')!;
	sctx.save();
	sctx.globalAlpha = 1;
	sctx.globalCompositeOperation = 'copy';
	sctx.fillStyle = stroke.color;
	sctx.fillRect(0, 0, w, h);
	sctx.globalCompositeOperation = 'destination-in';
	sctx.drawImage(pressureField, 0, 0, w, h, 0, 0, w, h);
	sctx.restore();

	ctx.save();
	ctx.globalAlpha = stroke.opacity ?? 1;
	ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
	ctx.drawImage(pressureScratch, 0, 0, w, h, x0, y0, w, h);
	ctx.restore();
	// 大きな線に使った後は小さくしておく
	if (w * h > 1024 * 1024) {
		for (const c of [pressureScratch, pressureField]) {
			c.width = 1;
			c.height = 1;
		}
	}
}

// JUICE: 透明度ロックの線を、作業用キャンバスに普通に描いてから、レイヤーの描いてある所にだけ重ねる
let lockScratch: HTMLCanvasElement | null = null;

function drawLockedStroke(ctx: CanvasRenderingContext2D, stroke: StrokeShape): void {
	const rect = pointsRect(stroke.points, stroke.size + 2);
	if (rect == null) return;
	const x0 = Math.floor(Math.max(0, rect.x0));
	const y0 = Math.floor(Math.max(0, rect.y0));
	const x1 = Math.ceil(Math.min(ctx.canvas.width, rect.x1));
	const y1 = Math.ceil(Math.min(ctx.canvas.height, rect.y1));
	if (x1 <= x0 || y1 <= y0) return;
	const w = x1 - x0;
	const h = y1 - y0;
	lockScratch ??= createScratch();
	if (lockScratch.width < w) lockScratch.width = w;
	if (lockScratch.height < h) lockScratch.height = h;
	const lctx = lockScratch.getContext('2d')!;
	lctx.save();
	lctx.globalCompositeOperation = 'source-over';
	lctx.globalAlpha = 1;
	lctx.clearRect(0, 0, w, h);
	lctx.translate(-x0, -y0);
	drawStroke(lctx, { ...stroke, lock: undefined });
	lctx.restore();
	ctx.save();
	ctx.globalAlpha = 1;
	ctx.globalCompositeOperation = 'source-atop';
	ctx.drawImage(lockScratch, 0, 0, w, h, x0, y0, w, h);
	ctx.restore();
	// 大きな線に使った後は小さくしておく(大きいキャンバスで、作業用のキャンバスがメモリを持ち続けないように)
	if (w * h > 1024 * 1024) {
		lockScratch.width = 1;
		lockScratch.height = 1;
	}
}

function drawStrokeUnclipped(ctx: CanvasRenderingContext2D, stroke: StrokeShape): void {
	// JUICE: 囲って塗る(ペン)・囲った範囲を消す(消しゴム)は、多角形を塗りつぶす
	if (stroke.tool === 'fill' || (stroke.tool === 'eraser' && stroke.brush === 'area')) {
		drawFill(ctx, stroke);
		return;
	}
	// JUICE: 筆圧で濃さを変える普通の筆の線
	if (stroke.brush !== 'soft' && pressureAffectsOpacity(stroke)) {
		drawPressureOpacityStroke(ctx, stroke);
		return;
	}
	const opacity = stroke.opacity ?? 1;
	if (opacity >= 1) {
		drawStrokePath(ctx, stroke, stroke.tool === 'eraser');
		return;
	}
	const p = stroke.points;
	if (p.length < 3) return;
	// 線がかかる範囲だけを作業用キャンバスで扱う
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (let i = 0; i < p.length; i += 3) {
		minX = Math.min(minX, p[i]);
		maxX = Math.max(maxX, p[i]);
		minY = Math.min(minY, p[i + 1]);
		maxY = Math.max(maxY, p[i + 1]);
	}
	const pad = stroke.size + 2;
	const x0 = Math.floor(Math.max(0, minX - pad));
	const y0 = Math.floor(Math.max(0, minY - pad));
	const x1 = Math.ceil(Math.min(ctx.canvas.width, maxX + pad));
	const y1 = Math.ceil(Math.min(ctx.canvas.height, maxY + pad));
	if (x1 <= x0 || y1 <= y0) return;
	const w = x1 - x0;
	const h = y1 - y0;
	scratch ??= createScratch();
	if (scratch.width < w) scratch.width = w;
	if (scratch.height < h) scratch.height = h;
	const sctx = scratch.getContext('2d')!;
	sctx.clearRect(0, 0, w, h);
	sctx.save();
	sctx.translate(-x0, -y0);
	// 作業用キャンバスには消しゴムも普通の線として描き、重ねるときに消す
	drawStrokePath(sctx, stroke, false);
	sctx.restore();
	ctx.save();
	ctx.globalAlpha = opacity;
	ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
	ctx.drawImage(scratch, 0, 0, w, h, x0, y0, w, h);
	ctx.restore();
}

/**
 * JUICE: 塗りつぶしの線(囲って塗る・バケツ)を描く。点の列は多角形の頂点で、印(筆圧の値)が0の点から次の輪郭が
 * 始まる。穴のある形も塗れるよう、偶奇規則で塗る
 */
function drawFill(ctx: CanvasRenderingContext2D, stroke: StrokeShape): void {
	const p = stroke.points;
	if (p.length < 9) return;
	ctx.save();
	ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
	ctx.globalAlpha = stroke.opacity ?? 1;
	ctx.fillStyle = stroke.color;
	tracePolygon(ctx, p);
	ctx.fill('evenodd');
	ctx.restore();
}

// 多角形(印が0の点から次の輪郭が始まる点の列)の道筋を作る
function tracePolygon(ctx: CanvasRenderingContext2D, p: number[]): void {
	ctx.beginPath();
	for (let i = 0; i < p.length; i += 3) {
		if (i === 0 || p[i + 2] === 0) {
			if (i !== 0) ctx.closePath();
			ctx.moveTo(p[i], p[i + 1]);
		} else {
			ctx.lineTo(p[i], p[i + 1]);
		}
	}
	ctx.closePath();
}

//#region 筆の種類(JUICE)
function hexToRgb(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// にじみ筆の1回分の筆跡(ふちに向かって薄くなる丸)の濃さ。何回も重ねて描くので薄めにする
const SOFT_STAMP_ALPHA = 0.22;

/**
 * 点iの位置に、筆の種類に合わせた筆跡を1つ置く
 */
function stampAt(ctx: CanvasRenderingContext2D, stroke: StrokeShape, x: number, y: number, width: number, pressure = 1): void {
	if (stroke.brush === 'dot') {
		// ドットは筆圧に関係なく、太さぶんの正方形の画素をくっきり塗る
		const w = Math.max(1, Math.round(stroke.size));
		const o = Math.floor(w / 2);
		ctx.fillRect(Math.floor(x) - o, Math.floor(y) - o, w, w);
		return;
	}
	const r = Math.max(0.5, width / 2);
	// JUICE: 筆跡ごとにグラデーションを作ると重い(線が多い絵の描き直しで数秒かかる)ので、色ごとに作っておいた筆跡の絵を
	// 大きさに合わせて置く。筆圧で濃さを変える線は、筆跡ごとの濃さを筆圧に合わせる
	if (pressureAffectsOpacity(stroke)) {
		const alpha = ctx.globalAlpha;
		ctx.globalAlpha = alpha * Math.min(1, Math.max(0, pressure));
		ctx.drawImage(softStampOf(stroke.color), x - r, y - r, r * 2, r * 2);
		ctx.globalAlpha = alpha;
		return;
	}
	ctx.drawImage(softStampOf(stroke.color), x - r, y - r, r * 2, r * 2);
}

// JUICE: にじみ筆の筆跡の絵(色ごと)。使う色が多すぎたら作り直す
const SOFT_STAMP_SIZE = 128;
const softStampCache = new Map<string, HTMLCanvasElement>();

function softStampOf(color: string): HTMLCanvasElement {
	let stamp = softStampCache.get(color);
	if (stamp != null) return stamp;
	if (softStampCache.size >= 32) softStampCache.clear();
	stamp = createScratch();
	stamp.width = SOFT_STAMP_SIZE;
	stamp.height = SOFT_STAMP_SIZE;
	const sctx = stamp.getContext('2d')!;
	const c = SOFT_STAMP_SIZE / 2;
	const [cr, cg, cb] = hexToRgb(color);
	const gradient = sctx.createRadialGradient(c, c, 0, c, c, c);
	gradient.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${SOFT_STAMP_ALPHA})`);
	gradient.addColorStop(0.6, `rgba(${cr}, ${cg}, ${cb}, ${SOFT_STAMP_ALPHA * 0.5})`);
	gradient.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
	sctx.fillStyle = gradient;
	sctx.beginPath();
	sctx.arc(c, c, c, 0, Math.PI * 2);
	sctx.fill();
	softStampCache.set(color, stamp);
	return stamp;
}

/**
 * ドット・にじみ筆で、区間from〜to(区間iは点i-1から点iへの直線)を描く
 */
function drawBrushLines(ctx: CanvasRenderingContext2D, stroke: StrokeShape, from: number, to: number): void {
	const p = stroke.points;
	for (let i = from; i <= to; i++) {
		const x0 = p[(i - 1) * 3];
		const y0 = p[(i - 1) * 3 + 1];
		const x1 = p[i * 3];
		const y1 = p[i * 3 + 1];
		if (stroke.brush === 'dot') {
			// 画素を1つずつたどる(Bresenham)
			let x = Math.floor(x0);
			let y = Math.floor(y0);
			const ex = Math.floor(x1);
			const ey = Math.floor(y1);
			const sx = x < ex ? 1 : -1;
			const sy = y < ey ? 1 : -1;
			const dx = Math.abs(ex - x);
			const dy = -Math.abs(ey - y);
			let err = dx + dy;
			for (;;) {
				stampAt(ctx, stroke, x, y, 0);
				if (x === ex && y === ey) break;
				const e2 = 2 * err;
				if (e2 >= dy) {
					err += dy;
					x += sx;
				}
				if (e2 <= dx) {
					err += dx;
					y += sy;
				}
			}
			continue;
		}
		// にじみ筆: 太さの12%ごとに筆跡を置く(太さは筆圧に合わせて区間の中でなめらかに変える)
		const w0 = strokeWidthAt(stroke, i - 1);
		const w1 = strokeWidthAt(stroke, i);
		const distance = Math.hypot(x1 - x0, y1 - y0);
		const steps = Math.max(1, Math.ceil(distance / Math.max(0.5, ((w0 + w1) / 2) * 0.12)));
		const p0 = p[(i - 1) * 3 + 2];
		const p1 = p[i * 3 + 2];
		for (let k = 1; k <= steps; k++) {
			const t = k / steps;
			stampAt(ctx, stroke, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w0 + (w1 - w0) * t, p0 + (p1 - p0) * t);
		}
	}
}
//#endregion

// JUICE: 点の列を(px, py)を中心にangleだけ回転する(筆圧・輪郭の印はそのまま)
export function rotatePoints(points: number[], angle: number, px: number, py: number): number[] {
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	return points.map((v, i) => {
		if (i % 3 === 2) return v;
		const x = points[i - (i % 3)] - px;
		const y = points[i - (i % 3) + 1] - py;
		return i % 3 === 0 ? px + x * cos - y * sin : py + x * sin + y * cos;
	});
}

function strokeWidthAt(stroke: StrokeShape, i: number): number {
	// JUICE: 筆圧で太さを変えない線(pressureが'none'・'opacity')は、いつも同じ太さ
	if (stroke.pressure === 'none' || stroke.pressure === 'opacity') return Math.max(0.5, stroke.size);
	return Math.max(0.5, stroke.size * Math.max(0.1, stroke.points[i * 3 + 2]));
}

function applyStrokeStyle(ctx: CanvasRenderingContext2D, stroke: StrokeShape, erase: boolean): void {
	ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
	ctx.strokeStyle = stroke.color;
	ctx.fillStyle = stroke.color;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
}

/**
 * 線の区間 from〜to(1始まり、区間iは点i-1から点iへ)を描く。
 * 次の点との中点を終点、点iを制御点にした2次曲線で、最後の区間(isLastTail)だけは点そのものへ引く
 */
function drawSegments(ctx: CanvasRenderingContext2D, stroke: StrokeShape, from: number, to: number, isLastTail: boolean): void {
	const p = stroke.points;
	// JUICE: 太さが同じ区間が続く間は1本の道筋にまとめて描く(区間ごとに描くと、線が多い部屋の読み込みが遅いため)
	let width = -1;
	for (let i = from; i <= to; i++) {
		const x = p[i * 3];
		const y = p[i * 3 + 1];
		const tail = isLastTail && i === to;
		const endX = tail ? x : (x + p[(i + 1) * 3]) / 2;
		const endY = tail ? y : (y + p[(i + 1) * 3 + 1]) / 2;
		const w = quantizeWidth((strokeWidthAt(stroke, i - 1) + strokeWidthAt(stroke, i)) / 2);
		if (w !== width) {
			if (width !== -1) ctx.stroke();
			width = w;
			ctx.beginPath();
			ctx.lineWidth = w;
			ctx.moveTo(i === 1 ? p[0] : (p[(i - 1) * 3] + x) / 2, i === 1 ? p[1] : (p[(i - 1) * 3 + 1] + y) / 2);
		}
		ctx.quadraticCurveTo(x, y, endX, endY);
	}
	if (width !== -1) ctx.stroke();
}

// 線の太さを、見た目で区別できない細かさ(2%刻み、細い線は0.25px刻み)にそろえる。
// そろえた太さが続く区間をまとめて描けるようにするため
function quantizeWidth(width: number): number {
	if (width < 12) return Math.max(0.25, Math.round(width * 4) / 4);
	const step = Math.log(1.02);
	return Math.exp(Math.round(Math.log(width) / step) * step);
}

function drawDot(ctx: CanvasRenderingContext2D, stroke: StrokeShape): void {
	ctx.beginPath();
	ctx.arc(stroke.points[0], stroke.points[1], strokeWidthAt(stroke, 0) / 2, 0, Math.PI * 2);
	ctx.fill();
}

function drawStrokePath(ctx: CanvasRenderingContext2D, stroke: StrokeShape, erase: boolean): void {
	const count = Math.floor(stroke.points.length / 3);
	if (count === 0) return;
	ctx.save();
	applyStrokeStyle(ctx, stroke, erase);
	if (stroke.brush === 'dot' || stroke.brush === 'soft') {
		stampAt(ctx, stroke, stroke.points[0], stroke.points[1], strokeWidthAt(stroke, 0), stroke.points[2]);
		drawBrushLines(ctx, stroke, 1, count - 1);
	} else if (count === 1) {
		drawDot(ctx, stroke);
	} else {
		drawSegments(ctx, stroke, 1, count - 1, true);
	}
	ctx.restore();
}

/**
 * JUICE: 描いている途中の線を、前回から増えた分だけ描き足す(不透明な線として)。
 * 最後の区間は次の点が来るまで形が決まらないので、形が決まった区間まで描く。描いた区間の数を返す
 */
function drawStrokeIncrement(ctx: CanvasRenderingContext2D, stroke: StrokeShape, drawnSegments: number): number {
	const count = Math.floor(stroke.points.length / 3);
	if (count === 0) return drawnSegments;
	ctx.save();
	if (stroke.clip != null && stroke.clip.length >= 9) {
		tracePolygon(ctx, stroke.clip);
		ctx.clip('evenodd');
	}
	applyStrokeStyle(ctx, stroke, false);
	// ドット・にじみ筆は点と点を直線でつなぐので、届いた点までの区間は全て形が決まっている
	if (stroke.brush === 'dot' || stroke.brush === 'soft') {
		if (drawnSegments === 0) stampAt(ctx, stroke, stroke.points[0], stroke.points[1], strokeWidthAt(stroke, 0), stroke.points[2]);
		if (count - 1 > drawnSegments) {
			drawBrushLines(ctx, stroke, drawnSegments + 1, count - 1);
			drawnSegments = count - 1;
		}
		ctx.restore();
		return Math.max(drawnSegments, 0);
	}
	// 描き始めは点を置いておく(1点だけの線も見えるように)
	if (drawnSegments === 0 && count >= 1) drawDot(ctx, stroke);
	// 区間iの終点は点i+1との中点なので、点がcount個なら区間count-2までは形が決まっている
	const settled = count - 2;
	if (settled > drawnSegments) {
		drawSegments(ctx, stroke, drawnSegments + 1, settled, false);
		drawnSegments = settled;
	}
	ctx.restore();
	return Math.max(drawnSegments, 0);
}

// JUICE: 全体マップの長い辺の大きさ
export const THUMBNAIL_MAX_SIZE = 160;

export class DrawCanvasEngine {
	public readonly width: number;
	public readonly height: number;
	// 全体マップの大きさと縮小率
	public readonly thumbWidth: number;
	public readonly thumbHeight: number;
	private readonly thumbScale: number;
	private layers = new Map<string, Layer>();
	// 下から順に重ねるレイヤーの並び
	private order: string[] = [];
	private display: HTMLCanvasElement | null = null;
	private renderRequested = false;
	// 描いている途中のペンの線を描く、表示用のキャンバスの上に重ねるキャンバス(不透明な線と、半透明な線)
	private overlay: HTMLCanvasElement | null = null;
	private overlayAlpha: HTMLCanvasElement | null = null;
	private overlayRequested = false;
	// 途中の線が取り除かれたなど、重ね描き用のキャンバスを最初から描き直す必要がある
	private overlayNeedsFullRedraw = false;
	// 途中の線が取り除かれて、重ね描き用のキャンバスのその範囲だけを描き直せばよいところ
	private overlayRegion: Rect | null = null;
	// 表示用のキャンバスのうち、次に描き直す範囲('full'は全体)。大きいキャンバス全体を毎回重ね直すとGPUが追いつかないため
	private displayRegion: Rect | 'full' | null = 'full';
	// 半透明の途中の線ごとのキャンバスを使い回すための置き場(作っては捨てるのを避ける)
	private strokeCanvasPool: HTMLCanvasElement[] = [];
	private probe: HTMLCanvasElement | null = null;
	private strokeCanvasInUse = new Set<HTMLCanvasElement>();
	private overlayAlphaDirty = false;
	// 自分のレイヤーを常に一番上に表示するか
	public myLayerOnTop = true;
	public myUserId: string | null = null;
	// JUICE: 自分が今描いているレイヤーのキー。表示用にまとめるとき、このレイヤーだけを分けて重ねる
	public activeKey: string | null = null;
	// JUICE: 見ている人が自分の画面だけで隠している人(その人の全てのレイヤー)
	private hiddenOwners = new Set<string>();

	// JUICE: 描いている途中の線を、重ね描き用のキャンバスに描くか。合成モードのレイヤーの線は、下の絵と正しく合成して見せるため、
	// 消しゴム・透明度ロックの線と同じくレイヤーに重ねて描く
	private isOverlay(layer: Layer, stroke: { tool: DrawTool; lock?: boolean; pressure?: StrokeShape['pressure']; brush?: StrokeShape['brush'] }): boolean {
		return isOverlayStroke(stroke) && layer.blend === 'source-over';
	}

	// 表示するか(レイヤーの表示の設定と、見ている人が隠しているか)
	private isShown(layer: Layer): boolean {
		return layer.visible && !this.hiddenOwners.has(layer.ownerId);
	}
	// JUICE: 全体マップの内容(描き終わった線・表示するレイヤー・重ね順)が変わったときに呼ぶ。
	// 全体マップは線のデータから小さいキャンバスに描き、表示用の大きいキャンバスからは読み出さない
	// (大きいキャンバスを読み出すと、ブラウザがGPUでの描画をやめてしまい、描くのが遅くなるため)
	public onThumbnailChange: (() => void) | null = null;
	// JUICE: 描き終わった線(と表示するレイヤー)が変わるたびに増やす。参照用の画像の作り直しの判断に使う
	private committedVersion = 0;
	private referenceCache: { version: number; image: ImageData } | null = null;
	// JUICE: 表示用に、自分のレイヤーより下・上のレイヤーをまとめて重ねておいたキャンバス。
	// 人数が多いと、毎回全員のレイヤー(1枚ずつがキャンバスの大きさ)を重ね直すのが重いので、
	// 変わったときだけ作り直し、ほかの人が描き終えた線はまとめたキャンバスに直接描き足す
	private groupCanvas: Record<'below' | 'above', HTMLCanvasElement | null> = { below: null, above: null };
	private groupDirty: Record<'below' | 'above', boolean> = { below: true, above: true };
	// まとめたキャンバスのうち、その範囲だけ重ね直せばよいところ(全体を作り直すときはgroupDirty)
	private groupRegion: Record<'below' | 'above', Rect | null> = { below: null, above: null };

	// レイヤーが、表示用にまとめるどの組(自分より下・自分・自分より上)にあるか
	private splitGroups(): { below: Layer[]; mine: Layer | null; above: Layer[] } {
		const ordered = this.orderedLayers();
		const i = this.activeKey == null ? -1 : ordered.findIndex(layer => layer.key === this.activeKey);
		if (i === -1) return { below: ordered, mine: null, above: [] };
		return { below: ordered.slice(0, i), mine: ordered[i], above: ordered.slice(i + 1) };
	}

	private groupOf(layer: Layer): 'below' | 'mine' | 'above' {
		const { below, mine } = this.splitGroups();
		if (mine === layer) return 'mine';
		return below.includes(layer) ? 'below' : 'above';
	}

	// そのレイヤーを含む組を、次に表示するときに作り直す
	private markLayerDirty(layer: Layer): void {
		this.displayRegion = 'full';
		const group = this.groupOf(layer);
		if (group !== 'mine') this.groupDirty[group] = true;
	}

	// そのレイヤーを含む組の、その範囲だけを次に表示するときに重ね直す(全員のレイヤーを全体で重ね直すと重いため)
	private markLayerRegion(layer: Layer, rect: Rect | null): void {
		if (rect == null) return;
		this.addDisplayRegion(rect);
		const group = this.groupOf(layer);
		if (group === 'mine' || this.groupDirty[group]) return;
		this.groupRegion[group] = unionRect(this.groupRegion[group], rect);
	}

	// 消しゴムの途中の線を反映したキャンバスの、その範囲(省略すると全体)を次に使うときに描き直す
	private invalidateLive(layer: Layer, rect?: Rect | null): void {
		if (layer.live == null) return;
		layer.liveDirty = rect == null || layer.liveDirty === 'full' ? 'full' : unionRect(layer.liveDirty, rect);
	}

	private markAllGroupsDirty(): void {
		this.displayRegion = 'full';
		this.groupDirty.below = true;
		this.groupDirty.above = true;
	}

	/**
	 * 描き終わった線を、まとめたキャンバスに反映する。組の一番上の不透明なレイヤーなら直接描き足し、
	 * そうでなければ(消しゴム・薄いレイヤー・上に別のレイヤーがある等)線の範囲だけを重ね直す
	 */
	private appendToGroup(layer: Layer, stroke: CanvasStroke): void {
		const group = this.groupOf(layer);
		if (group === 'mine' || this.groupDirty[group] || !this.isShown(layer)) return;
		const canvas = this.groupCanvas[group];
		if (canvas == null) return;
		const layers = group === 'below' ? this.splitGroups().below : this.splitGroups().above;
		// JUICE: 描いている途中からレイヤーに重ねて描いていた線(消しゴム・透明度ロック・筆圧で濃さを変える線など)は、
		// まとめたキャンバスに途中の分が既に入っているので、直接描き足すと二重になる。範囲だけ重ね直す
		if (!this.isOverlay(layer, stroke) || layer.opacity < 1 || layer.blend !== 'source-over' || layers.at(-1) !== layer || [...layer.pending.values()].some(entry => !this.isOverlay(layer, entry))) {
			this.markLayerRegion(layer, strokeRect(stroke));
			return;
		}
		drawStroke(canvas.getContext('2d')!, stroke);
	}

	// まとめたキャンバスを返す(変わっていれば作り直す)。自分より下の組は白い紙の上に重ねる
	private groupImage(group: 'below' | 'above', layers: Layer[]): HTMLCanvasElement {
		const canvas = this.groupCanvas[group] ??= createCanvas(this.width, this.height);
		if (this.groupDirty[group]) {
			const ctx = canvas.getContext('2d')!;
			ctx.globalCompositeOperation = 'source-over';
			if (group === 'below') {
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(0, 0, this.width, this.height);
			} else {
				ctx.clearRect(0, 0, this.width, this.height);
			}
			for (const layer of layers) {
				if (!this.isShown(layer)) continue;
				setLayerComposite(ctx, layer);
				ctx.drawImage(this.layerImage(layer), 0, 0);
			}
			ctx.globalAlpha = 1;
			ctx.globalCompositeOperation = 'source-over';
			this.groupDirty[group] = false;
			this.groupRegion[group] = null;
		} else if (this.groupRegion[group] != null) {
			const r = this.groupRegion[group];
			this.groupRegion[group] = null;
			const x = Math.max(0, r.x0);
			const y = Math.max(0, r.y0);
			const w = Math.min(this.width, r.x1) - x;
			const h = Math.min(this.height, r.y1) - y;
			if (w > 0 && h > 0) {
				const ctx = canvas.getContext('2d')!;
				ctx.globalCompositeOperation = 'source-over';
				if (group === 'below') {
					ctx.fillStyle = '#ffffff';
					ctx.fillRect(x, y, w, h);
				} else {
					ctx.clearRect(x, y, w, h);
				}
				for (const layer of layers) {
					if (!this.isShown(layer)) continue;
					setLayerComposite(ctx, layer);
					ctx.drawImage(this.layerImage(layer), x, y, w, h, x, y, w, h);
				}
				ctx.globalAlpha = 1;
				ctx.globalCompositeOperation = 'source-over';
			}
		}
		return canvas;
	}

	private committedChanged(): void {
		this.committedVersion++;
		this.referenceCache = null;
		this.onThumbnailChange?.();
	}

	constructor(width: number, height: number) {
		this.width = width;
		this.height = height;
		this.thumbScale = THUMBNAIL_MAX_SIZE / Math.max(width, height);
		this.thumbWidth = Math.max(1, Math.round(width * this.thumbScale));
		this.thumbHeight = Math.max(1, Math.round(height * this.thumbScale));
	}

	public attach(display: HTMLCanvasElement, overlay: HTMLCanvasElement, overlayAlpha: HTMLCanvasElement): void {
		this.display = display;
		display.width = this.width;
		display.height = this.height;
		this.overlay = overlay;
		overlay.width = this.width;
		overlay.height = this.height;
		// 半透明の線を初めて描くまでは大きさを持たせない(一度大きくしたらそのまま使い回す)
		this.overlayAlpha = overlayAlpha;
		overlayAlpha.width = 1;
		overlayAlpha.height = 1;
		this.overlayNeedsFullRedraw = true;
		this.requestRender();
		this.requestOverlay();
	}

	/**
	 * 途中の線が取り除かれた・表示が変わったときに、表示用と重ね描き用の両方を描き直す。
	 * rectを渡すと、その範囲だけを描き直す(取り除いた線の範囲)
	 */
	private pendingChanged(rect?: Rect | null): void {
		if (rect === undefined) this.overlayNeedsFullRedraw = true;
		else this.overlayRegion = unionRect(this.overlayRegion, rect);
		this.requestOverlay();
		this.requestRender(rect);
	}

	private ensureLayer(userId: string): Layer {
		let layer = this.layers.get(userId);
		if (layer == null) {
			layer = {
				key: userId,
				ownerId: ownerOfLayerKey(userId),
				opacity: 1,
				committed: createCanvas(this.width, this.height),
				live: null,
				liveDirty: null,
				strokes: [],
				thumb: createCanvas(this.thumbWidth, this.thumbHeight),
				pending: new Map(),
				visible: true,
				private: false,
				blend: 'source-over',
			};
			this.layers.set(userId, layer);
			this.order.push(userId);
			this.markAllGroupsDirty();
		}
		return layer;
	}

	/**
	 * JUICE: 自分が描くレイヤーを変える(表示用にまとめる組が変わるので作り直す)
	 */
	public setActiveKey(key: string): void {
		if (this.activeKey === key) return;
		this.activeKey = key;
		this.markAllGroupsDirty();
		this.requestRender();
	}

	// 全てのレイヤーのキー(重なり順、下から)
	public get layerKeys(): string[] {
		return [...this.order];
	}

	// レイヤーを持っている人(重なり順に初めて出てくる順)
	public get ownerIds(): string[] {
		return [...new Set(this.order.map(ownerOfLayerKey))];
	}

	// その人のレイヤーのキー(重なり順、下から)
	public keysOf(userId: string): string[] {
		return this.order.filter(key => ownerOfLayerKey(key) === userId);
	}

	// その人のどのレイヤーにその線があるか
	public findStrokeKey(userId: string, strokeId: string): string | null {
		return this.keysOf(userId).find(key => this.layers.get(key)?.strokes.some(stroke => stroke.id === strokeId)) ?? null;
	}

	public hasStrokesOf(userId: string): boolean {
		return this.keysOf(userId).some(key => (this.layers.get(key)?.strokes.length ?? 0) > 0);
	}

	public isOwnerHidden(userId: string): boolean {
		return this.hiddenOwners.has(userId);
	}

	/**
	 * JUICE: 見ている人が、自分の画面だけでその人(の全てのレイヤー)を隠す・出す
	 */
	public setOwnerHidden(userId: string, hidden: boolean): void {
		if (hidden) this.hiddenOwners.add(userId);
		else this.hiddenOwners.delete(userId);
		this.markAllGroupsDirty();
		this.pendingChanged();
		this.committedChanged();
	}

	/**
	 * JUICE: その人のレイヤーの一覧(重なり順は下から)に合わせて、レイヤーを作る・消す・並べ替える・表示と濃さを変える。
	 * その人のレイヤーは、今の重なり順の中の同じ位置にまとめて置く
	 */
	public setUserLayers(userId: string, metas: { id: string; visible: boolean; opacity: number; private?: boolean; blend?: DrawLayerBlend }[]): void {
		const keys = metas.map(meta => drawLayerKey(userId, meta.id));
		const old = [...this.order];
		for (const key of old) {
			if (ownerOfLayerKey(key) !== userId || keys.includes(key)) continue;
			// 消すレイヤーが消しゴム・移動の途中のキャンバスを持っていたら、予備に戻して使い回す
			const live = this.layers.get(key)?.live;
			if (live != null && this.liveSpare == null) this.liveSpare = live;
			this.layers.delete(key);
		}
		for (const [i, meta] of metas.entries()) {
			const layer = this.ensureLayer(keys[i]);
			layer.visible = meta.visible;
			layer.opacity = Math.min(1, Math.max(0, meta.opacity));
			layer.private = meta.private === true;
			const blend = meta.blend != null && (DRAW_LAYER_BLENDS as readonly string[]).includes(meta.blend) ? meta.blend : 'source-over';
			// 合成モードが変わると、描いている途中の線の描き方(重ね描き用か、レイヤーか)も変わるので描き直す
			if (layer.blend !== blend) this.invalidateLive(layer);
			layer.blend = blend;
		}
		const others = old.filter(key => ownerOfLayerKey(key) !== userId);
		const first = old.findIndex(key => ownerOfLayerKey(key) === userId);
		const insertAt = first === -1 ? others.length : old.slice(0, first).filter(key => ownerOfLayerKey(key) !== userId).length;
		this.order = [...others.slice(0, insertAt), ...keys, ...others.slice(insertAt)];
		this.markAllGroupsDirty();
		this.pendingChanged();
		this.committedChanged();
	}

	public setLayerVisible(userId: string, visible: boolean): void {
		this.ensureLayer(userId).visible = visible;
		this.markAllGroupsDirty();
		this.pendingChanged();
		this.committedChanged();
	}

	/**
	 * 自分のレイヤーを一番上に表示するかを切り替える
	 */
	public setMyLayerOnTop(value: boolean): void {
		this.myLayerOnTop = value;
		this.markAllGroupsDirty();
		this.pendingChanged();
		this.committedChanged();
	}

	public hasStrokes(userId: string): boolean {
		return (this.layers.get(userId)?.strokes.length ?? 0) > 0;
	}

	/**
	 * サーバーから取得した全員のレイヤーで置き換える(途中参加・再接続時)
	 */
	public load(layers: { userId: string; strokes: CanvasStroke[] }[]): void {
		for (const { userId, strokes } of layers) {
			this.beginLoadLayer(userId);
			this.loadStrokes(userId, strokes, 0, Infinity);
		}
		this.finishLoad(layers.map(layer => layer.userId));
	}

	/**
	 * JUICE: 読み込み(少しずつ描いて画面を固めないための3つ組)。まずレイヤーを空にする
	 */
	public beginLoadLayer(key: string): void {
		const layer = this.ensureLayer(key);
		layer.strokes = [];
		layer.pending.clear();
		layer.committed.getContext('2d')!.clearRect(0, 0, this.width, this.height);
		this.invalidateLive(layer);
	}

	/**
	 * 線をfrom番目から、deadline(performance.now()の時刻)になるまで描き足す。描いた本数を返す
	 */
	public loadStrokes(key: string, strokes: readonly CanvasStroke[], from: number, deadline: number): number {
		const layer = this.layers.get(key);
		if (layer == null) return strokes.length - from;
		const ctx = layer.committed.getContext('2d')!;
		let i = from;
		while (i < strokes.length) {
			layer.strokes.push(strokes[i]);
			drawStroke(ctx, strokes[i]);
			i++;
			if (performance.now() >= deadline) break;
		}
		return i - from;
	}

	/**
	 * 線を、別に描いておいた画像(Workerで描いたもの)ごと入れる。画像は使い終わったら閉じる
	 */
	public loadLayerImage(key: string, strokes: CanvasStroke[], image: ImageBitmap): void {
		const layer = this.layers.get(key);
		if (layer == null) {
			image.close();
			return;
		}
		layer.strokes = strokes;
		const ctx = layer.committed.getContext('2d')!;
		ctx.globalCompositeOperation = 'copy';
		ctx.drawImage(image, 0, 0);
		ctx.globalCompositeOperation = 'source-over';
		image.close();
		this.invalidateLive(layer);
	}

	/**
	 * 読み込んだレイヤーの全体マップ用の縮小を作り、表示を作り直す
	 */
	public finishLoad(keys: string[]): void {
		for (const key of keys) {
			const layer = this.layers.get(key);
			if (layer != null) this.redrawThumb(layer);
		}
		this.markAllGroupsDirty();
		this.pendingChanged();
		this.committedChanged();
	}

	/**
	 * 描き終わった線を描き直す。rectを渡すと、その範囲にかかる線だけをその範囲で描き直す(1本の線を取り消したときなど)
	 */
	private redrawCommitted(layer: Layer, rect?: Rect | null): void {
		const startedAt = performance.now();
		if (rect != null) {
			this.redrawCommittedRegion(layer, rect);
		} else {
			this.markLayerDirty(layer);
			this.invalidateLive(layer);
			const ctx = layer.committed.getContext('2d')!;
			ctx.clearRect(0, 0, this.width, this.height);
			for (const stroke of layer.strokes) drawStroke(ctx, stroke);
			this.redrawThumb(layer);
			this.committedChanged();
		}
		this.stats.lastRedrawMs = performance.now() - startedAt;
		this.stats.lastRedrawFull = rect == null;
	}

	// JUICE: デバッグ情報の表示用(描き直しにかかった時間など)
	public stats = { lastRedrawMs: 0, lastRedrawFull: false, lastRenderMs: 0 };

	/**
	 * JUICE: デバッグ情報の表示用。レイヤーの数・全員の線の本数・描いている途中の線の数
	 */
	public debugSummary(): { layers: number; strokes: number; pending: number } {
		let strokes = 0;
		let pending = 0;
		for (const layer of this.layers.values()) {
			strokes += layer.strokes.length;
			pending += layer.pending.size;
		}
		return { layers: this.layers.size, strokes, pending };
	}

	/**
	 * 全体マップ用の縮小したレイヤーを、描き終わった線のキャンバスを縮小して作り直す。
	 * rectを渡すと、その範囲だけ(線を1本ずつ縮小して描き直すより、ずっと速い)
	 */
	private redrawThumb(layer: Layer, rect?: Rect | null): void {
		const ctx = layer.thumb.getContext('2d')!;
		const s = this.thumbScale;
		const tx0 = rect == null ? 0 : Math.max(0, Math.floor(rect.x0 * s));
		const ty0 = rect == null ? 0 : Math.max(0, Math.floor(rect.y0 * s));
		const tx1 = rect == null ? this.thumbWidth : Math.min(this.thumbWidth, Math.ceil(rect.x1 * s));
		const ty1 = rect == null ? this.thumbHeight : Math.min(this.thumbHeight, Math.ceil(rect.y1 * s));
		if (tx1 <= tx0 || ty1 <= ty0) return;
		ctx.clearRect(tx0, ty0, tx1 - tx0, ty1 - ty0);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(layer.committed, tx0 / s, ty0 / s, (tx1 - tx0) / s, (ty1 - ty0) / s, tx0, ty0, tx1 - tx0, ty1 - ty0);
	}

	private redrawCommittedRegion(layer: Layer, rect: Rect): void {
		this.markLayerRegion(layer, rect);
		this.invalidateLive(layer, rect);
		const strokes = layer.strokes.filter(stroke => {
			const r = strokeRect(stroke);
			return r != null && rectsIntersect(r, rect);
		});
		const redraw = (ctx: CanvasRenderingContext2D, r: Rect) => {
			ctx.save();
			ctx.beginPath();
			ctx.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
			ctx.clip();
			ctx.clearRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
			for (const stroke of strokes) drawStroke(ctx, stroke);
			ctx.restore();
		};
		redraw(layer.committed.getContext('2d')!, rect);
		this.redrawThumb(layer, rect);
		this.committedChanged();
	}

	/**
	 * 描き終わった線を追加する。途中の線として表示していたものは取り除く
	 */
	public addStroke(userId: string, stroke: CanvasStroke): void {
		const layer = this.ensureLayer(userId);
		// 自分の線は送信前にローカルで確定させているので、サーバーから戻ってきた同じ線は重複させない
		if (layer.strokes.some(s => s.id === stroke.id)) return;
		const pendingEntry = layer.pending.get(stroke.id);
		const wasPending = layer.pending.delete(stroke.id);
		layer.strokes.push(stroke);
		drawStroke(layer.committed.getContext('2d')!, stroke);
		this.redrawThumb(layer, strokeRect(stroke));
		this.invalidateLive(layer, strokeRect(stroke));
		this.appendToGroup(layer, stroke);
		const rect = strokeRect(stroke);
		if (wasPending) this.pendingChanged(unionRect(rect, pendingRect(pendingEntry!)));
		else this.requestRender(rect);
		this.committedChanged();
	}

	/**
	 * 描いている途中の線の続きを追加する(同じidの点をつなげていく)
	 */
	public addStrokePart(userId: string, part: PendingStroke): void {
		const layer = this.ensureLayer(userId);
		if (layer.strokes.some(s => s.id === part.id)) return;
		const pending = layer.pending.get(part.id);
		// 増えた点と、形が変わる直前の2点(点の間は曲線でつなぐため)の範囲
		const changed = pointsRect([...(pending?.points.slice(-6) ?? []), ...part.points], part.size + 2);
		if (pending == null) {
			layer.pending.set(part.id, { ...part, points: [...part.points], updatedAt: Date.now(), drawnSegments: 0, canvas: null });
		} else {
			pending.points.push(...part.points);
			pending.updatedAt = Date.now();
		}
		if (this.isOverlay(layer, part)) {
			this.requestOverlay();
		} else {
			// 消しゴムの途中の線は、変わった範囲だけ描き直して見せる
			this.invalidateLive(layer, changed);
			this.markLayerRegion(layer, changed);
			this.requestRender(changed);
		}
	}

	/**
	 * 描いている途中の線を取りやめる(途中まで表示していた分を消す)
	 */
	public removePending(userId: string, strokeId: string): void {
		const layer = this.layers.get(userId);
		const entry = layer?.pending.get(strokeId);
		if (layer == null || entry == null) return;
		layer.pending.delete(strokeId);
		if (!this.isOverlay(layer, entry)) this.erasingRemoved(layer, entry);
		this.pendingChanged(pendingRect(entry));
	}

	// 消しゴムの途中の線を取り除いたので、その線の範囲を描き直す
	private erasingRemoved(layer: Layer, entry: PendingEntry): void {
		const rect = pendingRect(entry);
		this.invalidateLive(layer, rect);
		this.markLayerRegion(layer, rect);
	}

	/**
	 * そのユーザーの描いている途中の線を全て消す(退出・キックされたときなど)
	 */
	public clearPending(userId: string): void {
		const layer = this.layers.get(userId);
		if (layer == null || layer.pending.size === 0) return;
		const entries = [...layer.pending.values()];
		layer.pending.clear();
		for (const entry of entries) if (!this.isOverlay(layer, entry)) this.erasingRemoved(layer, entry);
		this.pendingChanged(entries.reduce<Rect | null>((r, entry) => unionRect(r, pendingRect(entry)), null));
	}

	/**
	 * 長い間更新の無い途中の線を消す。定期的に呼ぶ
	 */
	public pruneStalePending(): void {
		const now = Date.now();
		let changed = false;
		let rect: Rect | null = null;
		for (const layer of this.layers.values()) {
			// 自分の描きかけの線は、自分で確定・取りやめを管理しているので対象外
			if (layer.ownerId === this.myUserId) continue;
			for (const [id, pending] of layer.pending) {
				if (now - pending.updatedAt > PENDING_STROKE_TIMEOUT_MS) {
					layer.pending.delete(id);
					if (!this.isOverlay(layer, pending)) this.erasingRemoved(layer, pending);
					rect = unionRect(rect, pendingRect(pending));
					changed = true;
				}
			}
		}
		if (changed) this.pendingChanged(rect);
	}

	public removeStroke(userId: string, strokeId: string): void {
		const layer = this.layers.get(userId);
		if (layer == null) return;
		const old = layer.strokes;
		const before = old.length;
		layer.strokes = old.filter(s => s.id !== strokeId);
		const removed = layer.strokes.length !== before ? strokeRect(old.find(s => s.id === strokeId)!) : null;
		const pendingEntry = layer.pending.get(strokeId);
		const wasPending = layer.pending.delete(strokeId);
		if (pendingEntry != null && !this.isOverlay(layer, pendingEntry)) this.erasingRemoved(layer, pendingEntry);
		// 取り消した線の範囲だけを描き直す
		if (removed != null) this.redrawCommitted(layer, removed);
		if (wasPending) this.pendingChanged(unionRect(removed, pendingRect(pendingEntry!)));
		else this.requestRender(removed);
	}

	//#region 選択・移動(JUICE)
	/**
	 * 範囲(矩形、または投げ縄の多角形)に点が1つでも入っている線のid
	 */
	public strokesInArea(userId: string, area: { rect: [number, number, number, number] } | { polygon: number[] }): string[] {
		const layer = this.layers.get(userId);
		if (layer == null) return [];
		const inside = 'rect' in area
			? (x: number, y: number) => x >= area.rect[0] && x <= area.rect[2] && y >= area.rect[1] && y <= area.rect[3]
			: (x: number, y: number) => pointInPolygon(x, y, area.polygon);
		return layer.strokes.filter(stroke => {
			for (let i = 0; i < stroke.points.length; i += 3) {
				if (inside(stroke.points[i], stroke.points[i + 1])) return true;
			}
			return false;
		}).map(stroke => stroke.id);
	}

	/**
	 * JUICE: 選んだ形(多角形の並び)の境目で線を切る。形の中に全部入っている線はそのまま選び、
	 * 境目をまたぐ線は内側と外側の部分に切り分けて、内側の部分を選ぶ。切れ目は境目をまたぐ2点の中点で、
	 * 両側の線がその点を共有する(切れ目に隙間ができないように)。線そのものは変えず、切り方だけを返す
	 */
	public splitByShapes(userId: string, shapes: number[][], genId: () => string): { selected: Set<string>; splits: { id: string; pieces: CanvasStroke[] }[] } {
		const selected = new Set<string>();
		const splits: { id: string; pieces: CanvasStroke[] }[] = [];
		const layer = this.layers.get(userId);
		if (layer == null || shapes.length === 0) return { selected, splits };
		// JUICE: 選んだ形を囲む範囲の外の点・線は、多角形の内外を調べない(線や頂点が多いと重いため)
		let bounds: Rect | null = null;
		for (const shape of shapes) {
			for (let i = 0; i < shape.length; i += 2) bounds = unionRect(bounds, { x0: shape[i], y0: shape[i + 1], x1: shape[i], y1: shape[i + 1] });
		}
		if (bounds == null) return { selected, splits };
		const b = bounds;
		const inside = (x: number, y: number) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && shapes.some(shape => pointInPolygon(x, y, shape));
		// 送る形式と同じ細かさにそろえる(自分の画面とほかの人の画面で切れ目の位置がずれないように)
		const q = (v: number) => Math.round(v * POINT_SCALE) / POINT_SCALE;
		for (const stroke of layer.strokes) {
			const r = strokeRect(stroke);
			if (r == null || !rectsIntersect(r, { x0: b.x0 - 1, y0: b.y0 - 1, x1: b.x1 + 1, y1: b.y1 + 1 })) continue;
			const p = stroke.points;
			const count = Math.floor(p.length / 3);
			if (count === 0) continue;
			const flags: boolean[] = [];
			for (let i = 0; i < count; i++) flags.push(inside(p[i * 3], p[i * 3 + 1]));
			// 塗りつぶしは切ると形が崩れるので、頂点が1つでも入っていれば丸ごと選ぶ
			if (stroke.tool === 'fill' && flags.some(f => f)) {
				selected.add(stroke.id);
				continue;
			}
			if (flags.every(f => f)) {
				selected.add(stroke.id);
				continue;
			}
			if (!flags.some(f => f)) continue;
			const runs: { inside: boolean; points: number[] }[] = [];
			let current = { inside: flags[0], points: [p[0], p[1], p[2]] };
			for (let i = 1; i < count; i++) {
				const point = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]];
				if (flags[i] === current.inside) {
					current.points.push(...point);
					continue;
				}
				const mid = [q((p[(i - 1) * 3] + point[0]) / 2), q((p[(i - 1) * 3 + 1] + point[1]) / 2), Math.round(((p[(i - 1) * 3 + 2] + point[2]) / 2) * 255) / 255];
				current.points.push(...mid);
				runs.push(current);
				current = { inside: flags[i], points: [...mid, ...point] };
			}
			runs.push(current);
			const pieces = runs.map(run => ({ ...stroke, id: genId(), points: run.points }));
			runs.forEach((run, i) => {
				if (run.inside) selected.add(pieces[i].id);
			});
			splits.push({ id: stroke.id, pieces });
		}
		return { selected, splits };
	}

	/**
	 * JUICE: 線を、切った後の線の並びに置き換える(元の線と同じ位置に入れて、重なり順を保つ)
	 */
	public replaceStrokes(userId: string, splits: { id: string; pieces: CanvasStroke[] }[]): void {
		const layer = this.layers.get(userId);
		if (layer == null || splits.length === 0) return;
		const map = new Map(splits.map(split => [split.id, split.pieces]));
		// このレイヤーに無い線なら何もしない(その人の全てのレイヤーに同じ操作をすることがあるため)
		if (!layer.strokes.some(stroke => map.has(stroke.id))) return;
		// JUICE: 置き換える前と後の線の範囲だけを描き直す(レイヤー全体を描き直すと、線が多いときに重いため)
		let rect: Rect | null = null;
		for (const stroke of layer.strokes) {
			const pieces = map.get(stroke.id);
			if (pieces == null) continue;
			rect = unionRect(rect, strokeRect(stroke));
			for (const piece of pieces) rect = unionRect(rect, strokeRect(piece));
		}
		layer.strokes = layer.strokes.flatMap(stroke => map.get(stroke.id) ?? [stroke]);
		this.redrawStrokesRegion(layer, rect);
	}

	// JUICE: 線が変わった範囲だけを描き直して表示する(範囲が無ければ何もしない)
	private redrawStrokesRegion(layer: Layer, rect: Rect | null): void {
		if (rect == null) return;
		this.redrawCommitted(layer, rect);
		this.requestRender(rect);
	}

	/**
	 * JUICE: 取り消し・やり直しで線を戻す。それぞれbeforeの線の前(無い・nullなら最後)に入れる。もうある線は入れない
	 */
	public insertStrokes(userId: string, items: { before: string | null; stroke: CanvasStroke }[]): void {
		const layer = this.ensureLayer(userId);
		const present = new Set(layer.strokes.map(stroke => stroke.id));
		const inserting = items.filter(({ stroke }) => {
			if (present.has(stroke.id)) return false;
			present.add(stroke.id);
			return true;
		});
		if (inserting.length === 0) return;
		const beforeAnchor = new Map<string, CanvasStroke[]>();
		for (const { before, stroke } of inserting) {
			if (before == null) continue;
			const waiting = beforeAnchor.get(before) ?? [];
			waiting.push(stroke);
			beforeAnchor.set(before, waiting);
		}
		const result: CanvasStroke[] = [];
		const placed = new Set<string>();
		for (const stroke of layer.strokes) {
			const waiting = beforeAnchor.get(stroke.id);
			if (waiting != null) {
				result.push(...waiting);
				placed.add(stroke.id);
			}
			result.push(stroke);
		}
		// 目印の無い線と、目印の線が無くなっていた線は、手順の順に最後に入れる(サーバーと同じ並びにする)
		for (const { before, stroke } of inserting) {
			if (before == null || !placed.has(before)) result.push(stroke);
		}
		layer.strokes = result;
		// 戻した線の範囲だけを描き直す(線の多いレイヤーで、取り消すたびに全部を描き直さないように)
		let rect: Rect | null = null;
		for (const { stroke } of inserting) rect = unionRect(rect, strokeRect(stroke));
		if (rect == null) return;
		this.redrawCommitted(layer, rect);
		this.requestRender(rect);
	}

	public strokesOf(userId: string): readonly CanvasStroke[] {
		return this.layers.get(userId)?.strokes ?? [];
	}

	public strokeIdsOf(userId: string): Set<string> {
		return new Set(this.layers.get(userId)?.strokes.map(stroke => stroke.id) ?? []);
	}

	/**
	 * 線をずらす(移動ツール)。idsがnullならレイヤー全体
	 */
	public moveStrokes(userId: string, ids: Set<string> | null, dx: number, dy: number): void {
		const layer = this.layers.get(userId);
		if (layer == null || (dx === 0 && dy === 0)) return;
		if (ids != null && !layer.strokes.some(stroke => ids.has(stroke.id))) return;
		// JUICE: 選んだ線を動かしたときは、動かす前と後の範囲だけを描き直す(レイヤー全体を動かしたときは全体)
		let rect: Rect | null = null;
		layer.strokes = layer.strokes.map(stroke => {
			if (ids != null && !ids.has(stroke.id)) return stroke;
			const moved = {
				...stroke,
				points: shiftPoints(stroke.points, dx, dy),
				...(stroke.clip != null ? { clip: shiftPoints(stroke.clip, dx, dy) } : {}),
			};
			if (ids != null) rect = unionRect(unionRect(rect, strokeRect(stroke)), strokeRect(moved));
			return moved;
		});
		if (ids == null) {
			this.redrawCommitted(layer);
			this.requestRender();
			return;
		}
		this.redrawStrokesRegion(layer, rect);
	}

	public deleteStrokes(userId: string, ids: Set<string>): void {
		const layer = this.layers.get(userId);
		if (layer == null) return;
		let rect: Rect | null = null;
		for (const stroke of layer.strokes) {
			if (ids.has(stroke.id)) rect = unionRect(rect, strokeRect(stroke));
		}
		if (rect == null) return;
		layer.strokes = layer.strokes.filter(stroke => !ids.has(stroke.id));
		this.redrawStrokesRegion(layer, rect);
	}

	// 移動ツールでドラッグしている間の表示。動かす線と動かさない線を別々のキャンバスに描いておき、
	// 表示するときに動かす線だけをずらして重ねる(ドラッグのたびに全部の線を描き直さないように)
	// JUICE: 動かす線は、その線を囲む範囲だけの小さいキャンバス(origin=その左上のキャンバス座標)に描く。動かさない線は、
	// 描き終わった絵を写してから、動かす線の範囲だけを描き直して作る(線が多いときに、全部の線を描き直さないように)。
	// 表示するときは、前に描いた範囲と今の範囲だけを重ね直す
	private moving: {
		userId: string;
		still: HTMLCanvasElement | null;
		moving: HTMLCanvasElement;
		originX: number;
		originY: number;
		dx: number;
		dy: number;
		angle: number;
		pivotX: number;
		pivotY: number;
		// 前に表示した、動かす線の範囲(nullなら全体を描き直す)
		lastRect: Rect | null;
	} | null = null;

	public beginMove(userId: string, ids: Set<string> | null): void {
		const layer = this.layers.get(userId);
		if (layer == null) return;
		if (ids == null) {
			// レイヤー全体: 描き終わった絵をそのまま動かす
			const moving = createCanvas(this.width, this.height);
			moving.getContext('2d')!.drawImage(layer.committed, 0, 0);
			this.moving = { userId, still: null, moving, originX: 0, originY: 0, dx: 0, dy: 0, angle: 0, pivotX: 0, pivotY: 0, lastRect: null };
			this.requestRender();
			return;
		}
		let rect: Rect | null = null;
		for (const stroke of layer.strokes) {
			if (ids.has(stroke.id)) rect = unionRect(rect, strokeRect(stroke));
		}
		const r = rect ?? { x0: 0, y0: 0, x1: 1, y1: 1 };
		const x0 = Math.floor(r.x0);
		const y0 = Math.floor(r.y0);
		const moving = createCanvas(Math.max(1, Math.ceil(r.x1) - x0), Math.max(1, Math.ceil(r.y1) - y0));
		const movingCtx = moving.getContext('2d')!;
		// 動かさない線の絵は、全体の大きさのキャンバスを使い回す(ドラッグのたびに作って捨てると重いため)
		const still = this.moveStillSpare != null && this.moveStillSpare.width === this.width && this.moveStillSpare.height === this.height
			? this.moveStillSpare
			: createCanvas(this.width, this.height);
		this.moveStillSpare = null;
		const stillCtx = still.getContext('2d')!;
		stillCtx.globalCompositeOperation = 'copy';
		stillCtx.drawImage(layer.committed, 0, 0);
		stillCtx.globalCompositeOperation = 'source-over';
		// 動かす線の範囲だけ、動かさない線で描き直す
		stillCtx.save();
		stillCtx.beginPath();
		stillCtx.rect(x0, y0, moving.width, moving.height);
		stillCtx.clip();
		stillCtx.clearRect(x0, y0, moving.width, moving.height);
		for (const stroke of layer.strokes) {
			if (ids.has(stroke.id)) {
				// 小さいキャンバスの左上に合わせて、線の点をずらして描く(キャンバスを移動して描くと、半透明・透明度ロックの線の
				// 描く範囲の計算がキャンバスの大きさに合わず、消えたり切れたりするため)。ずらす量は整数なので、ドットもずれない
				drawStroke(movingCtx, {
					...stroke,
					points: shiftPoints(stroke.points, -x0, -y0),
					...(stroke.clip != null ? { clip: shiftPoints(stroke.clip, -x0, -y0) } : {}),
				});
			} else {
				const sr = strokeRect(stroke);
				if (sr != null && rectsIntersect(sr, r)) drawStroke(stillCtx, stroke);
			}
		}
		stillCtx.restore();
		this.moving = { userId, still, moving, originX: x0, originY: y0, dx: 0, dy: 0, angle: 0, pivotX: 0, pivotY: 0, lastRect: null };
		this.requestRender();
	}

	// 動かしている線の、今表示する範囲(回転も含めて囲む範囲)
	private movingRect(): Rect | null {
		const m = this.moving;
		if (m == null) return null;
		const cos = Math.cos(m.angle);
		const sin = Math.sin(m.angle);
		let rect: Rect | null = null;
		for (const [cx, cy] of [[m.originX, m.originY], [m.originX + m.moving.width, m.originY], [m.originX, m.originY + m.moving.height], [m.originX + m.moving.width, m.originY + m.moving.height]]) {
			const x = m.pivotX + (cx - m.pivotX) * cos - (cy - m.pivotY) * sin + m.dx;
			const y = m.pivotY + (cx - m.pivotX) * sin + (cy - m.pivotY) * cos + m.dy;
			rect = unionRect(rect, { x0: Math.floor(x) - 2, y0: Math.floor(y) - 2, x1: Math.ceil(x) + 2, y1: Math.ceil(y) + 2 });
		}
		return rect;
	}

	// 動かしている線の表示を変えた(前の範囲と今の範囲だけを表示し直す。レイヤー全体を動かしているときは全体)
	private movingChanged(): void {
		const m = this.moving;
		if (m == null) return;
		if (m.still == null) {
			this.requestRender();
			return;
		}
		this.requestRender(unionRect(m.lastRect, this.movingRect()));
	}

	public updateMove(dx: number, dy: number): void {
		if (this.moving == null) return;
		this.moving.dx = dx;
		this.moving.dy = dy;
		this.movingChanged();
	}

	/**
	 * 選んだ線を(pivotX, pivotY)を中心に回転して見せる(ドラッグしている間)
	 */
	public updateRotate(angle: number, pivotX: number, pivotY: number): void {
		if (this.moving == null) return;
		this.moving.angle = angle;
		this.moving.pivotX = pivotX;
		this.moving.pivotY = pivotY;
		this.movingChanged();
	}

	public endMove(): void {
		const m = this.moving;
		this.moving = null;
		if (m?.still != null) this.moveStillSpare = m.still;
		// 全体を表示し直す(動かしている間にそのレイヤーの線がほかから変わっていても、古いまま残らないように。
		// 3枚を重ねるだけなので軽い。描き終わった絵の描き直しは、この後の線の移動・置き換えで行う)
		this.requestRender();
	}

	// 動かさない線の絵に使うキャンバスの予備(次のドラッグで使い回す)
	private moveStillSpare: HTMLCanvasElement | null = null;
	//#endregion

	/**
	 * 自分の最後の線(undoで消える線)のid
	 */
	public lastStrokeId(userId: string): string | null {
		return this.layers.get(userId)?.strokes.at(-1)?.id ?? null;
	}

	public clearLayer(userId: string): void {
		const layer = this.layers.get(userId);
		if (layer == null) return;
		layer.strokes = [];
		layer.pending.clear();
		this.redrawCommitted(layer);
		this.pendingChanged();
	}

	// 消しゴム・移動の途中に使うキャンバスの予備(1枚だけ持っておく)
	private liveSpare: HTMLCanvasElement | null = null;

	private takeLiveCanvas(): HTMLCanvasElement {
		const canvas = this.liveSpare ?? createCanvas(this.width, this.height);
		this.liveSpare = null;
		return canvas;
	}

	private layerImage(layer: Layer): HTMLCanvasElement {
		// 移動ツールでドラッグしている間は、動かさない線の上に動かす線をずらして重ねる
		if (this.moving != null && this.moving.userId === layer.key) {
			const m = this.moving;
			const first = layer.live == null || m.lastRect == null || m.still == null;
			layer.live ??= this.takeLiveCanvas();
			const ctx = layer.live.getContext('2d')!;
			const now = this.movingRect();
			ctx.save();
			if (first) {
				ctx.globalCompositeOperation = 'copy';
				if (m.still != null) ctx.drawImage(m.still, 0, 0);
				else ctx.clearRect(0, 0, this.width, this.height);
			} else {
				// 前に描いた範囲と今の範囲だけを、動かさない線の絵に戻してから描く
				const dirty = unionRect(m.lastRect, now)!;
				const x = Math.max(0, dirty.x0);
				const y = Math.max(0, dirty.y0);
				const w = Math.min(this.width, dirty.x1) - x;
				const h = Math.min(this.height, dirty.y1) - y;
				ctx.beginPath();
				ctx.rect(x, y, Math.max(0, w), Math.max(0, h));
				ctx.clip();
				ctx.globalCompositeOperation = 'copy';
				if (w > 0 && h > 0) ctx.drawImage(m.still!, x, y, w, h, x, y, w, h);
			}
			ctx.globalCompositeOperation = 'source-over';
			ctx.translate(m.pivotX + m.dx, m.pivotY + m.dy);
			ctx.rotate(m.angle);
			ctx.translate(-m.pivotX, -m.pivotY);
			ctx.drawImage(m.moving, m.originX, m.originY);
			ctx.restore();
			m.lastRect = now;
			layer.liveDirty = 'full';
			return layer.live;
		}
		// ペンの途中の線は重ね描き用のキャンバスに描くので、ここでは消しゴムの途中の線だけを扱う
		const erasing = [...layer.pending.values()].filter(stroke => !this.isOverlay(layer, stroke));
		if (erasing.length === 0) {
			// 消しゴム・移動の途中に使ったキャンバスは、使い終わったら予備に戻す(スマホ等でメモリを使いすぎないように)
			if (layer.live != null && this.liveSpare == null) this.liveSpare = layer.live;
			layer.live = null;
			layer.liveDirty = null;
			return layer.committed;
		}
		if (layer.live == null) {
			layer.live = this.takeLiveCanvas();
			layer.liveDirty = 'full';
		}
		const dirty = layer.liveDirty;
		if (dirty == null) return layer.live;
		layer.liveDirty = null;
		const ctx = layer.live.getContext('2d')!;
		if (dirty === 'full') {
			ctx.globalCompositeOperation = 'copy';
			ctx.drawImage(layer.committed, 0, 0);
			ctx.globalCompositeOperation = 'source-over';
			for (const stroke of erasing) drawStroke(ctx, stroke);
			return layer.live;
		}
		// 変わった範囲だけ、描き終わった絵に戻してから消しゴムの途中の線を描き直す
		const x = Math.max(0, dirty.x0);
		const y = Math.max(0, dirty.y0);
		const w = Math.min(this.width, dirty.x1) - x;
		const h = Math.min(this.height, dirty.y1) - y;
		if (w <= 0 || h <= 0) return layer.live;
		ctx.save();
		ctx.beginPath();
		ctx.rect(x, y, w, h);
		ctx.clip();
		ctx.globalCompositeOperation = 'source-over';
		ctx.clearRect(x, y, w, h);
		ctx.drawImage(layer.committed, x, y, w, h, x, y, w, h);
		for (const stroke of erasing) drawStroke(ctx, stroke);
		ctx.restore();
		return layer.live;
	}

	private requestOverlay(): void {
		if (this.overlayRequested || this.overlay == null) return;
		this.overlayRequested = true;
		window.requestAnimationFrame(() => {
			this.overlayRequested = false;
			this.renderOverlay();
		});
	}

	/**
	 * 描いている途中のペンの線を、重ね描き用のキャンバスに描き足す。
	 * 不透明な線は増えた区間だけを描き足し、半透明な線は線ごとのキャンバスに描き足してから薄く重ねる
	 */
	private renderOverlay(): void {
		const overlay = this.overlay;
		const overlayAlpha = this.overlayAlpha;
		if (overlay == null || overlayAlpha == null) return;
		const ctx = overlay.getContext('2d')!;
		const full = this.overlayNeedsFullRedraw;
		this.overlayNeedsFullRedraw = false;
		if (full) {
			ctx.clearRect(0, 0, this.width, this.height);
			this.overlayRegion = null;
		}

		// 取り除かれた途中の線のキャンバスは、置き場に戻して次の線で使い回す
		const inUse = new Set<HTMLCanvasElement>();
		for (const layer of this.layers.values()) {
			for (const entry of layer.pending.values()) if (entry.canvas != null) inUse.add(entry.canvas);
		}
		for (const canvas of this.strokeCanvasInUse) {
			if (!inUse.has(canvas) && this.strokeCanvasPool.length < 2) this.strokeCanvasPool.push(canvas);
		}
		this.strokeCanvasInUse = inUse;

		const translucent: PendingEntry[] = [];
		for (const layer of this.orderedLayers()) {
			if (!this.isShown(layer)) continue;
			for (const entry of layer.pending.values()) {
				if (!this.isOverlay(layer, entry)) continue;
				if ((entry.opacity ?? 1) < 1) {
					if (entry.canvas == null) {
						entry.canvas = this.strokeCanvasPool.pop() ?? createCanvas(this.width, this.height);
						entry.canvas.getContext('2d')!.clearRect(0, 0, this.width, this.height);
						entry.drawnSegments = 0;
						this.strokeCanvasInUse.add(entry.canvas);
					} else if (full) {
						entry.canvas.getContext('2d')!.clearRect(0, 0, this.width, this.height);
						entry.drawnSegments = 0;
					}
					entry.drawnSegments = drawStrokeIncrement(entry.canvas.getContext('2d')!, entry, entry.drawnSegments);
					translucent.push(entry);
				} else {
					if (full) entry.drawnSegments = 0;
					entry.drawnSegments = drawStrokeIncrement(ctx, entry, entry.drawnSegments);
				}
			}
		}

		// 取り除かれた線の範囲だけ消して、そこにかかる残りの線を描き直す
		const region = full ? null : this.overlayRegion;
		this.overlayRegion = null;
		if (region != null) {
			const x = Math.max(0, region.x0);
			const y = Math.max(0, region.y0);
			const w = Math.min(this.width, region.x1) - x;
			const h = Math.min(this.height, region.y1) - y;
			if (w > 0 && h > 0) {
				ctx.save();
				ctx.beginPath();
				ctx.rect(x, y, w, h);
				ctx.clip();
				ctx.clearRect(x, y, w, h);
				for (const layer of this.orderedLayers()) {
					if (!this.isShown(layer)) continue;
					for (const entry of layer.pending.values()) {
						if (!this.isOverlay(layer, entry) || (entry.opacity ?? 1) < 1) continue;
						const r = pendingRect(entry);
						if (r != null && rectsIntersect(r, region)) drawStrokeIncrement(ctx, entry, 0);
					}
				}
				ctx.restore();
			}
		}

		if (translucent.length === 0) {
			// 大きさはそのままにして、中身だけ消す
			if (this.overlayAlphaDirty) {
				overlayAlpha.getContext('2d')!.clearRect(0, 0, overlayAlpha.width, overlayAlpha.height);
				this.overlayAlphaDirty = false;
			}
			return;
		}
		if (overlayAlpha.width !== this.width || overlayAlpha.height !== this.height) {
			overlayAlpha.width = this.width;
			overlayAlpha.height = this.height;
		}
		this.overlayAlphaDirty = true;
		const actx = overlayAlpha.getContext('2d')!;
		actx.clearRect(0, 0, this.width, this.height);
		for (const entry of translucent) {
			actx.globalAlpha = entry.opacity ?? 1;
			actx.drawImage(entry.canvas!, 0, 0);
		}
		actx.globalAlpha = 1;
	}

	private orderedLayers(): Layer[] {
		const ids = [...this.order];
		// 自分のレイヤーを一番上に表示するときは、自分のレイヤーをまとめて(順は保ったまま)一番上に置く
		if (this.myLayerOnTop && this.myUserId != null) {
			const mine = ids.filter(key => ownerOfLayerKey(key) === this.myUserId);
			const others = ids.filter(key => ownerOfLayerKey(key) !== this.myUserId);
			return [...others, ...mine].map(id => this.layers.get(id)!);
		}
		return ids.map(id => this.layers.get(id)!);
	}

	/**
	 * 白い背景の上に、表示するレイヤーを下から順に重ねる
	 */
	private composite(ctx: CanvasRenderingContext2D, onlyVisible: boolean): void {
		ctx.globalCompositeOperation = 'source-over';
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, this.width, this.height);
		for (const layer of this.orderedLayers()) {
			if (onlyVisible && !this.isShown(layer)) continue;
			setLayerComposite(ctx, layer);
			ctx.drawImage(this.layerImage(layer), 0, 0);
		}
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
	}

	// 表示用のキャンバスを次に描き直す。rectを渡すとその範囲だけ(nullなら範囲は増やさない)、省略すると全体
	public requestRender(rect?: Rect | null): void {
		if (rect === undefined) this.displayRegion = 'full';
		else if (rect != null) this.addDisplayRegion(rect);
		if (this.renderRequested || this.display == null) return;
		this.renderRequested = true;
		window.requestAnimationFrame(() => {
			this.renderRequested = false;
			if (this.display == null) return;
			const startedAt = performance.now();
			this.renderDisplay(this.display.getContext('2d')!);
			this.stats.lastRenderMs = performance.now() - startedAt;
		});
	}

	// JUICE: 表示用のキャンバスに、自分より下の組・自分のレイヤー・自分より上の組を重ねる(人数によらず3枚まで)
	private addDisplayRegion(rect: Rect): void {
		if (this.displayRegion !== 'full') this.displayRegion = unionRect(this.displayRegion, rect);
	}

	private renderDisplay(ctx: CanvasRenderingContext2D): void {
		const { below, mine, above } = this.splitGroups();
		const region = this.groupDirty.below || this.groupDirty.above ? 'full' : this.displayRegion;
		this.displayRegion = null;
		if (region == null) return;
		if (region !== 'full') {
			// 変わった範囲だけを重ね直す(下の組は白い紙の上に重ねてあるので、そのまま上書きできる)
			const x = Math.max(0, region.x0);
			const y = Math.max(0, region.y0);
			const w = Math.min(this.width, region.x1) - x;
			const h = Math.min(this.height, region.y1) - y;
			if (w <= 0 || h <= 0) return;
			ctx.globalCompositeOperation = 'source-over';
			ctx.drawImage(this.groupImage('below', below), x, y, w, h, x, y, w, h);
			this.drawMineAndAbove(ctx, mine, above, { x, y, w, h });
			return;
		}
		ctx.globalCompositeOperation = 'copy';
		ctx.drawImage(this.groupImage('below', below), 0, 0);
		ctx.globalCompositeOperation = 'source-over';
		this.drawMineAndAbove(ctx, mine, above, null);
	}

	// 自分のレイヤーと、その上の組を重ねる。JUICE: 上の組に合成モードのあるレイヤーがあるときは、まとめたキャンバス
	// (透明な上に重ねたもの)では下の絵と正しく合成できないので、1枚ずつ重ねる
	private drawMineAndAbove(ctx: CanvasRenderingContext2D, mine: Layer | null, above: Layer[], area: { x: number; y: number; w: number; h: number } | null): void {
		const draw = (image: CanvasImageSource) => {
			if (area == null) ctx.drawImage(image, 0, 0);
			else ctx.drawImage(image, area.x, area.y, area.w, area.h, area.x, area.y, area.w, area.h);
		};
		if (mine != null && this.isShown(mine)) {
			setLayerComposite(ctx, mine);
			draw(this.layerImage(mine));
		}
		const shown = above.filter(layer => this.isShown(layer));
		if (shown.some(layer => layer.blend !== 'source-over')) {
			for (const layer of shown) {
				setLayerComposite(ctx, layer);
				draw(this.layerImage(layer));
			}
		} else if (shown.length > 0) {
			ctx.globalAlpha = 1;
			ctx.globalCompositeOperation = 'source-over';
			draw(this.groupImage('above', above));
		}
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
	}

	/**
	 * 画面に表示している絵(表示中のレイヤーを重ねたもの)の、その位置の色を #rrggbb で返す(スポイト)
	 */
	public pickColor(x: number, y: number): string | null {
		const px = Math.floor(x);
		const py = Math.floor(y);
		if (px < 0 || py < 0 || px >= this.width || py >= this.height) return null;
		// 表示用のキャンバスからは読み出さず(GPUでの描画が止まらないように)、その1点だけを小さいキャンバスに重ねて読む
		this.probe ??= createCanvas(1, 1);
		const ctx = this.probe.getContext('2d', { willReadFrequently: true })!;
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, 1, 1);
		for (const layer of this.orderedLayers()) {
			if (!this.isShown(layer)) continue;
			setLayerComposite(ctx, layer);
			ctx.drawImage(this.layerImage(layer), px, py, 1, 1, 0, 0, 1, 1);
		}
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
		const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
		return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
	}

	/**
	 * JUICE: バケツツールが色を調べるための、表示している絵(表示中のレイヤーを白い背景に重ねたもの)の画素
	 */
	public referenceImage(): ImageData {
		// JUICE: 大きなキャンバスでは合成・読み出しが重い(3840×3840で約59MB)ので、線が変わるまで使い回す
		// (「線の中だけ塗る」では描き始めるたびに使うため)。使う側は画素を書き換えないこと
		if (this.referenceCache != null && this.referenceCache.version === this.committedVersion) return this.referenceCache.image;
		const canvas = createCanvas(this.width, this.height);
		const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
		this.composite(ctx, true);
		const image = ctx.getImageData(0, 0, this.width, this.height);
		this.referenceCache = { version: this.committedVersion, image };
		return image;
	}

	/**
	 * 全体マップを描く(表示中のレイヤーの、描き終わった線だけ)
	 */
	public renderThumbnail(target: HTMLCanvasElement): void {
		const ctx = target.getContext('2d')!;
		ctx.globalCompositeOperation = 'source-over';
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, target.width, target.height);
		for (const layer of this.orderedLayers()) {
			if (!this.isShown(layer)) continue;
			setLayerComposite(ctx, layer);
			ctx.drawImage(layer.thumb, 0, 0, target.width, target.height);
		}
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
	}

	/**
	 * 全員のレイヤーを重ねた画像のキャンバスを作る(保存用)。見ている人が自分の画面だけで隠している人も含め、
	 * レイヤーの表示・濃さの設定(描いた人が決めたもの)に従う。
	 * 描き終わった線だけを使う(描いている途中の線は含めず、ほかの人の画面にも影響しない)。
	 * areaを指定すると、その範囲だけを切り出す
	 */
	public renderImage(area?: { x: number; y: number; width: number; height: number }): HTMLCanvasElement {
		const x = Math.max(0, Math.floor(area?.x ?? 0));
		const y = Math.max(0, Math.floor(area?.y ?? 0));
		const width = Math.max(1, Math.min(this.width - x, Math.round(area?.width ?? this.width)));
		const height = Math.max(1, Math.min(this.height - y, Math.round(area?.height ?? this.height)));
		const canvas = createCanvas(width, height);
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, width, height);
		for (const layer of this.orderedLayers()) {
			// JUICE: 下描きは保存する画像に入れない
			if (!layer.visible || layer.private) continue;
			setLayerComposite(ctx, layer);
			ctx.drawImage(layer.committed, x, y, width, height, 0, 0, width, height);
		}
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
		return canvas;
	}

	public dispose(): void {
		this.moving = null;
		this.moveStillSpare = null;
		this.referenceCache = null;
		this.groupCanvas = { below: null, above: null };
		this.display = null;
		this.overlay = null;
		this.overlayAlpha = null;
		this.strokeCanvasPool = [];
		this.liveSpare = null;
		this.strokeCanvasInUse.clear();
		this.layers.clear();
		this.order = [];
	}
}
