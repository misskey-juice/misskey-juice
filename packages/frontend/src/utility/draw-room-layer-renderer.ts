/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import DrawRoomLayerWorker from '@/workers/draw-room-layer?worker';
import type { DrawLayerGroup, DrawStroke } from '@/utility/draw-canvas.js';

// JUICE: 絵チャの部屋を開くときに、レイヤーの線を複数のWorkerで同時に描いて画像にする。
// 使い終わったらdispose()でWorkerを止める(Workerごとにキャンバス1枚ぶんのメモリを使うため)

type Job = {
	id: number;
	width: number;
	height: number;
	strokes: DrawStroke[];
	groups: DrawLayerGroup[] | undefined;
	resolve: (bitmap: ImageBitmap | null) => void;
};

export function canRenderLayersInWorker(): boolean {
	return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof OffscreenCanvas.prototype.transferToImageBitmap === 'function';
}

// 同時に使うWorkerの数。メモリの少ない端末では減らす
function workerCount(): number {
	const cores = navigator.hardwareConcurrency || 2;
	const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
	const max = memory != null && memory <= 4 ? 2 : 4;
	return Math.max(1, Math.min(max, cores - 1));
}

export class DrawRoomLayerRenderer {
	private workers: { worker: Worker; job: Job | null }[] = [];
	private queue: Job[] = [];
	private nextId = 0;

	constructor() {
		for (let i = 0; i < workerCount(); i++) {
			const worker = new DrawRoomLayerWorker();
			const slot = { worker, job: null as Job | null };
			worker.onmessage = (event: MessageEvent<{ id: number; bitmap: ImageBitmap | null }>) => {
				const job = slot.job;
				slot.job = null;
				if (job != null && job.id === event.data.id) {
					job.resolve(event.data.bitmap);
				} else {
					// 頼んだものと違う返事は使わない(待っている側が止まらないよう、描けなかったことにする)
					event.data.bitmap?.close();
					job?.resolve(null);
				}
				this.dispatch();
			};
			// 読み込みに失敗した等で止まったWorkerは使わない(残りのWorkerが無ければ、頼まれた分は呼んだ側で描く)
			worker.onerror = () => {
				const job = slot.job;
				slot.job = null;
				job?.resolve(null);
				worker.terminate();
				this.workers = this.workers.filter(x => x !== slot);
				if (this.workers.length === 0) this.rejectQueue();
				else this.dispatch();
			};
			this.workers.push(slot);
		}
	}

	/**
	 * 線を描いた画像を作る。Workerで描けなかったときはnull(呼んだ側で描く)
	 */
	public render(width: number, height: number, strokes: DrawStroke[], groups?: DrawLayerGroup[]): Promise<ImageBitmap | null> {
		if (this.workers.length === 0) return Promise.resolve(null);
		return new Promise(resolve => {
			this.queue.push({ id: this.nextId++, width, height, strokes, groups, resolve });
			this.dispatch();
		});
	}

	// 同時に描けるレイヤーの数
	public get concurrency(): number {
		return this.workers.length;
	}

	private rejectQueue(): void {
		for (const job of this.queue) job.resolve(null);
		this.queue = [];
	}

	private dispatch(): void {
		for (const slot of this.workers) {
			if (slot.job != null) continue;
			const job = this.queue.shift();
			if (job == null) return;
			slot.job = job;
			slot.worker.postMessage({ id: job.id, width: job.width, height: job.height, strokes: job.strokes, groups: job.groups });
		}
	}

	public dispose(): void {
		for (const slot of this.workers) {
			slot.worker.terminate();
			slot.job?.resolve(null);
		}
		this.workers = [];
		this.rejectQueue();
	}
}
