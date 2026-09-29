/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 絵チャの部屋の絵を、サーバーで小さな画像(OGP用)にする。
// 画面の描き方(frontend/src/utility/draw-canvas.ts)を小さい画像向けに簡単にしたもの:
// - 普通の筆は、太さを筆圧に合わせた曲線(区間ごと)。筆圧で濃さを変える線は、区間ごとに濃さを変える
// - にじみ筆は、薄めの普通の線で代わりにする(小さい画像では違いがほとんど見えないため)
// - ドットは四角い線端の直線、塗りつぶし(囲って塗る・バケツ)は多角形、消しゴムは消す描き方
// - 半透明の線・透明度ロック・線の中だけ塗るの線は、線ごとに作業用のキャンバスに描いてから重ねる(不透明な線はそのまま描く)
// - レイヤーの表示・濃さ・合成モードを反映する(下描きのレイヤーは呼び出し側で除いておくこと)
import { createCanvas } from '@napi-rs/canvas';
import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';
import type { DrawLayerMeta, DrawStroke } from '@/models/DrawRoomLayer.js';

const POINT_BYTES = 5;
const POINT_SCALE = 8;

function decodePoints(encoded: string, dx = 0, dy = 0): number[] {
	const buf = Buffer.from(encoded, 'base64');
	const points: number[] = [];
	for (let i = 0; i + POINT_BYTES <= buf.length; i += POINT_BYTES) {
		points.push(buf.readInt16LE(i) / POINT_SCALE + dx, buf.readInt16LE(i + 2) / POINT_SCALE + dy, buf.readUInt8(i + 4) / 255);
	}
	return points;
}

function widthAt(stroke: DrawStroke, p: number[], i: number): number {
	if (stroke.pressure === 'none' || stroke.pressure === 'opacity') return Math.max(0.5, stroke.size);
	return Math.max(0.5, stroke.size * Math.max(0.1, p[i * 3 + 2]));
}

function tracePolygon(ctx: SKRSContext2D, p: number[]): void {
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

// 線の形を、不透明で描く(濃さ・消す描き方は重ねるときに決める)
function drawShape(ctx: SKRSContext2D, stroke: DrawStroke, p: number[]): void {
	const count = Math.floor(p.length / 3);
	if (count === 0) return;
	ctx.fillStyle = stroke.color;
	ctx.strokeStyle = stroke.color;
	if (stroke.tool === 'fill' || (stroke.tool === 'eraser' && stroke.brush === 'area')) {
		if (p.length < 9) return;
		tracePolygon(ctx, p);
		ctx.fill('evenodd');
		return;
	}
	if (stroke.brush === 'dot') {
		const w = Math.max(1, Math.round(stroke.size));
		ctx.lineWidth = w;
		ctx.lineCap = 'square';
		ctx.lineJoin = 'miter';
		ctx.beginPath();
		ctx.moveTo(p[0], p[1]);
		for (let i = 1; i < count; i++) ctx.lineTo(p[i * 3], p[i * 3 + 1]);
		if (count === 1) ctx.lineTo(p[0] + 0.01, p[1]);
		ctx.stroke();
		return;
	}
	const pressureOpacity = (stroke.pressure === 'opacity' || stroke.pressure === 'both') && stroke.brush !== 'soft';
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	if (count === 1) {
		ctx.globalAlpha = pressureOpacity ? Math.max(0.05, p[2]) : 1;
		ctx.beginPath();
		ctx.arc(p[0], p[1], widthAt(stroke, p, 0) / 2, 0, Math.PI * 2);
		ctx.fill();
		ctx.globalAlpha = 1;
		return;
	}
	for (let i = 1; i < count; i++) {
		const x = p[i * 3];
		const y = p[i * 3 + 1];
		const tail = i === count - 1;
		ctx.globalAlpha = pressureOpacity ? Math.max(0.05, (p[(i - 1) * 3 + 2] + p[i * 3 + 2]) / 2) : 1;
		ctx.lineWidth = (widthAt(stroke, p, i - 1) + widthAt(stroke, p, i)) / 2;
		ctx.beginPath();
		ctx.moveTo(i === 1 ? p[0] : (p[(i - 1) * 3] + x) / 2, i === 1 ? p[1] : (p[(i - 1) * 3 + 1] + y) / 2);
		ctx.quadraticCurveTo(x, y, tail ? x : (x + p[(i + 1) * 3]) / 2, tail ? y : (y + p[(i + 1) * 3 + 1]) / 2);
		ctx.stroke();
	}
	ctx.globalAlpha = 1;
}

export type DrawRoomThumbnailEntry = { strokes: DrawStroke[]; layers: DrawLayerMeta[] };

/**
 * 部屋の絵を、最大maxWidth×maxHeightに収めたPNGにする(背景は白)
 */
export async function renderDrawRoomThumbnail(canvasWidth: number, canvasHeight: number, entries: DrawRoomThumbnailEntry[], maxWidth = 1200, maxHeight = 630): Promise<Buffer> {
	const scale = Math.min(maxWidth / canvasWidth, maxHeight / canvasHeight, 1);
	const w = Math.max(1, Math.round(canvasWidth * scale));
	const h = Math.max(1, Math.round(canvasHeight * scale));
	const out = createCanvas(w, h);
	const octx = out.getContext('2d');
	octx.fillStyle = '#ffffff';
	octx.fillRect(0, 0, w, h);

	const layerCanvas: Canvas = createCanvas(w, h);
	const lctx = layerCanvas.getContext('2d');
	const scratch: Canvas = createCanvas(w, h);
	const sctx = scratch.getContext('2d');

	for (const entry of entries) {
		for (const meta of entry.layers) {
			if (!meta.visible || meta.opacity <= 0) continue;
			const strokes = entry.strokes.filter(stroke => (stroke.layer ?? '0') === meta.id);
			if (strokes.length === 0) continue;
			lctx.setTransform(1, 0, 0, 1, 0, 0);
			lctx.globalCompositeOperation = 'source-over';
			lctx.globalAlpha = 1;
			lctx.clearRect(0, 0, w, h);
			for (const stroke of strokes) {
				const p = decodePoints(stroke.points, stroke.dx, stroke.dy);
				if (p.length === 0) continue;
				const erase = stroke.tool === 'eraser';
				const opacity = Math.min(1, Math.max(0, stroke.opacity ?? 1)) * (stroke.brush === 'soft' ? 0.6 : 1);
				const clip = stroke.clip != null ? decodePoints(stroke.clip, stroke.dx, stroke.dy) : null;
				const lock = stroke.lock === true && !erase;
				const op = erase ? 'destination-out' : lock ? 'source-atop' : 'source-over';
				// 不透明な普通の線は、そのままレイヤーに描く(線が多い部屋でも重くならないように)
				if (opacity >= 1 && !lock && clip == null) {
					lctx.save();
					lctx.setTransform(scale, 0, 0, scale, 0, 0);
					lctx.globalCompositeOperation = op;
					drawShape(lctx, stroke, p);
					lctx.restore();
					continue;
				}
				// 半透明・透明度ロック・線の中だけ塗るの線は、線ごとに作業用のキャンバスへ描いてから重ねる
				// (線の中の重なりで濃くならないように)。線がかかる範囲だけを扱う
				let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
				for (let i = 0; i < p.length; i += 3) {
					if (p[i] < minX) minX = p[i];
					if (p[i] > maxX) maxX = p[i];
					if (p[i + 1] < minY) minY = p[i + 1];
					if (p[i + 1] > maxY) maxY = p[i + 1];
				}
				const pad = stroke.size + 2;
				const rx = Math.max(0, Math.floor((minX - pad) * scale));
				const ry = Math.max(0, Math.floor((minY - pad) * scale));
				const rw = Math.min(w, Math.ceil((maxX + pad) * scale)) - rx;
				const rh = Math.min(h, Math.ceil((maxY + pad) * scale)) - ry;
				if (rw <= 0 || rh <= 0) continue;
				sctx.setTransform(1, 0, 0, 1, 0, 0);
				sctx.globalCompositeOperation = 'source-over';
				sctx.globalAlpha = 1;
				sctx.clearRect(rx, ry, rw, rh);
				sctx.setTransform(scale, 0, 0, scale, 0, 0);
				sctx.save();
				if (clip != null && clip.length >= 9) {
					tracePolygon(sctx, clip);
					sctx.clip('evenodd');
				}
				drawShape(sctx, stroke, p);
				sctx.restore();
				lctx.setTransform(1, 0, 0, 1, 0, 0);
				lctx.globalAlpha = opacity;
				lctx.globalCompositeOperation = op;
				lctx.drawImage(scratch, rx, ry, rw, rh, rx, ry, rw, rh);
				lctx.globalAlpha = 1;
			}
			octx.globalAlpha = Math.min(1, meta.opacity);
			octx.globalCompositeOperation = meta.blend ?? 'source-over';
			octx.drawImage(layerCanvas, 0, 0);
		}
	}
	octx.globalAlpha = 1;
	octx.globalCompositeOperation = 'source-over';
	return await out.encode('png');
}
