/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 落書き(1人で描く絵チャ)を新しく作る・投稿フォームから開く

import { defineAsyncComponent } from 'vue';
import type * as Misskey from 'misskey-js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { clampCanvasSize, DRAW_ROOM_CANVAS_MAX_SIZE, DRAW_ROOM_CANVAS_MIN_SIZE } from '@/utility/draw-canvas.js';
import { createDoodle, listDoodles } from '@/utility/doodle-storage.js';
import type { DoodleMeta } from '@/utility/doodle-storage.js';
import type { MenuItem } from '@/types/menu.js';

// 絵チャの部屋と同じ大きさから選ぶ(サーバーに保存しないので、ロールの上限は使わない)
const CANVAS_PRESETS = [
	{ value: 'landscape', width: 1600, height: 900, label: () => i18n.ts._drawRoom.canvasLandscape },
	{ value: 'portrait', width: 900, height: 1600, label: () => i18n.ts._drawRoom.canvasPortrait },
	{ value: 'square', width: 1200, height: 1200, label: () => i18n.ts._drawRoom.canvasSquare },
	{ value: 'square2048', width: 2048, height: 2048, label: () => i18n.ts._drawRoom.canvasSquare2048 },
] as const;

/** 名前とキャンバスの大きさを聞いて、新しい落書きを作る */
export async function createDoodleWithDialog(): Promise<DoodleMeta | null> {
	const { canceled, result } = await os.form(i18n.ts._juice.doodleNew, {
		title: {
			type: 'string',
			label: i18n.ts._juice.doodleTitle,
			required: false,
			default: '',
		},
		canvasPreset: {
			type: 'radio',
			label: i18n.ts._drawRoom.canvasSize,
			default: 'landscape',
			options: [
				...CANVAS_PRESETS.map(preset => ({ label: preset.label(), value: preset.value as string })),
				{ label: i18n.ts._drawRoom.canvasCustom, value: 'custom' },
			],
		},
	});
	if (canceled) return null;

	let size: { width: number; height: number };
	const preset = CANVAS_PRESETS.find(p => p.value === result.canvasPreset);
	if (preset != null) {
		size = { width: preset.width, height: preset.height };
	} else {
		// 「自由に指定」を選んだら、続けて幅と高さを聞く
		const custom = await os.form(i18n.ts._drawRoom.canvasCustom, {
			width: {
				type: 'number',
				label: i18n.ts._drawRoom.canvasWidth,
				description: i18n.tsx._drawRoom.canvasSizeRange({ min: DRAW_ROOM_CANVAS_MIN_SIZE, max: DRAW_ROOM_CANVAS_MAX_SIZE }),
				default: 1600,
				step: 1,
			},
			height: {
				type: 'number',
				label: i18n.ts._drawRoom.canvasHeight,
				description: i18n.tsx._drawRoom.canvasSizeRange({ min: DRAW_ROOM_CANVAS_MIN_SIZE, max: DRAW_ROOM_CANVAS_MAX_SIZE }),
				default: 900,
				step: 1,
			},
		});
		if (custom.canceled) return null;
		size = { width: clampCanvasSize(custom.result.width, 1600), height: clampCanvasSize(custom.result.height, 900) };
	}

	return await createDoodle((result.title ?? '').trim().slice(0, 64), size.width, size.height);
}

/** 落書きの名前(付けていなければ、作った日時) */
export function doodleTitle(meta: DoodleMeta): string {
	return meta.title !== '' ? meta.title : new Date(meta.createdAt).toLocaleString();
}

/**
 * 落書きをウインドウで開き、描いた絵を添付できるようにする(投稿フォームから使う)
 */
export function openDoodleWindow(doodleId: string, onAttach: (file: Misskey.entities.DriveFile) => void): void {
	const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkDoodleWindow.vue')), {
		doodleId,
	}, {
		attach: onAttach,
		closed: () => dispose(),
	});
}

/**
 * 投稿フォームの落書きボタン: 新しく描くか、前に描いた落書きの続きを描くかを選んでもらい、ウインドウで開く
 */
export async function pickDoodleToAttach(src: HTMLElement, onAttach: (file: Misskey.entities.DriveFile) => void): Promise<void> {
	// 前に描いた落書きを読めなくても(ブラウザの保存領域が使えないなど)、新しく描くことはできるようにする
	const recent = (await listDoodles().catch(() => [])).slice(0, 10);
	const items: MenuItem[] = [{
		text: i18n.ts._juice.doodleNew,
		icon: 'ti ti-plus',
		action: async () => {
			const meta = await createDoodleWithDialog();
			if (meta != null) openDoodleWindow(meta.id, onAttach);
		},
	}];
	if (recent.length > 0) {
		items.push({ type: 'label', text: i18n.ts._juice.doodleRecent });
		for (const meta of recent) {
			items.push({
				text: doodleTitle(meta),
				icon: 'ti ti-scribble',
				action: () => openDoodleWindow(meta.id, onAttach),
			});
		}
	}
	os.popupMenu(items, src);
}
