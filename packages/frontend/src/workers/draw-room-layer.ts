/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/// <reference lib="esnext" />
/// <reference lib="webworker" />

// JUICE: 絵チャの部屋を開くときに、1枚のレイヤーの線を描いて画像にして返す。
// 線が多い部屋でも画面を固めずに、複数のWorkerで同時に描けるようにする。
// GPUのキャンバスより、CPUで描く方がこの用途(細かい線をたくさん描く)では速いので、willReadFrequentlyでCPUに描かせる

import { decodeStroke, drawStrokesInGroups } from '@/utility/draw-canvas.js';
import type { CanvasStroke, DrawLayerGroup, DrawStroke } from '@/utility/draw-canvas.js';

let canvas: OffscreenCanvas | null = null;
// JUICE: 結合したレイヤーのまとまりを描く作業用の絵(使い回す)
const groupPool: HTMLCanvasElement[] = [];

// JUICE: decoded なら、線の点は読み込み済みの形(CanvasStroke)で届く(移動ツールで、キャンバスの一部だけを描き直すとき)
onmessage = (event: MessageEvent<{ id: number; width: number; height: number; strokes: DrawStroke[] | CanvasStroke[]; decoded?: boolean; groups?: DrawLayerGroup[] }>) => {
	const { id, width, height, strokes, decoded, groups } = event.data;
	try {
		if (canvas == null || canvas.width !== width || canvas.height !== height) canvas = new OffscreenCanvas(width, height);
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (ctx == null) throw new Error('no 2d context');
		ctx.clearRect(0, 0, width, height);
		// 描く関数はcanvas要素の2Dコンテキスト向けの型だが、ここで使う機能はOffscreenCanvasでも同じ
		// JUICE: 結合したレイヤーの線は、まとまりごとに重ねる
		const groupMap = groups != null && groups.length > 0 ? new Map(groups.map(group => [group.id, group])) : null;
		drawStrokesInGroups(ctx as unknown as CanvasRenderingContext2D, decoded ? strokes as CanvasStroke[] : (strokes as DrawStroke[]).map(decodeStroke), groupMap, groupPool);
		const bitmap = canvas.transferToImageBitmap();
		self.postMessage({ id, bitmap }, [bitmap]);
	} catch {
		self.postMessage({ id, bitmap: null });
	}
};
