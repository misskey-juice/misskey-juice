/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: ウォーターマークだけを、透明な絵として作る(動画のコマに毎回重ねるため。落書きのタイムラプスで使う)。
// ウォーターマークの描画は、下の絵に混ぜる(下の絵×(1-濃さ) + 色)形なので、黒い絵と白い絵の上に1回ずつ描いて、
// その差から濃さと色を取り出す(模様のレイヤーは下の絵の透明度をそのまま返すので、透明な絵の上には描けない)

import type { WatermarkLayers } from '@/utility/watermark/WatermarkRenderer.js';

async function renderOn(color: string, layers: WatermarkLayers, width: number, height: number): Promise<Uint8ClampedArray> {
	const base = window.document.createElement('canvas');
	base.width = width;
	base.height = height;
	const baseCtx = base.getContext('2d')!;
	baseCtx.fillStyle = color;
	baseCtx.fillRect(0, 0, width, height);

	const { WatermarkRenderer } = await import('@/utility/watermark/WatermarkRenderer.js');
	const glCanvas = window.document.createElement('canvas');
	const image = await window.createImageBitmap(base);
	const renderer = new WatermarkRenderer({ canvas: glCanvas, renderWidth: width, renderHeight: height, image });
	try {
		await renderer.render(layers);
		// 描いた直後に写す(WebGLの絵は、次の描画までしか残らない)
		baseCtx.drawImage(glCanvas, 0, 0);
		return baseCtx.getImageData(0, 0, width, height).data;
	} finally {
		renderer.destroy();
		image.close();
		base.width = 1;
		base.height = 1;
	}
}

/** ウォーターマークだけの絵(透明な下地)を作る。レイヤーが無ければnull */
export async function renderWatermarkOverlay(layers: WatermarkLayers, width: number, height: number): Promise<HTMLCanvasElement | null> {
	if (layers.length === 0 || width < 1 || height < 1) return null;
	const onBlack = await renderOn('#000000', layers, width, height);
	const onWhite = await renderOn('#ffffff', layers, width, height);
	const out = new ImageData(width, height);
	const data = out.data;
	for (let i = 0; i < data.length; i += 4) {
		// 白の上と黒の上の差が、下の絵が透けている分(1 - 濃さ)
		const through = ((onWhite[i] - onBlack[i]) + (onWhite[i + 1] - onBlack[i + 1]) + (onWhite[i + 2] - onBlack[i + 2])) / (3 * 255);
		const alpha = Math.min(1, Math.max(0, 1 - through));
		if (alpha <= 0.002) continue;
		// 黒の上の色は、色×濃さ
		data[i] = onBlack[i] / alpha;
		data[i + 1] = onBlack[i + 1] / alpha;
		data[i + 2] = onBlack[i + 2] / alpha;
		data[i + 3] = Math.round(alpha * 255);
	}
	const canvas = window.document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	canvas.getContext('2d')!.putImageData(out, 0, 0);
	return canvas;
}
