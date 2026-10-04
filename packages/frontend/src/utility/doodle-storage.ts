/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 落書き(1人で描く絵チャ)の作品を、このブラウザに保存する(IndexedDB。使えなければlocalStorage)。
// アカウントごとに分け、一覧(名前・大きさ・日時・小さな絵)と、線・レイヤーの中身を別々に持つ(一覧を出すときに中身まで読まないように)

import type * as Misskey from 'misskey-js';
import { get, set, del } from '@/utility/idb-proxy.js';
import { $i } from '@/i.js';

export type DoodleMeta = {
	id: string;
	title: string;
	width: number;
	height: number;
	createdAt: number;
	updatedAt: number;
	// 一覧に出す小さな絵(data URL)。まだ描いていなければnull
	thumbnail: string | null;
};

export type DoodleData = {
	strokes: Misskey.entities.DrawStroke[];
	layers: Misskey.entities.DrawLayer[];
};

const prefix = () => `juiceDoodle:${$i?.id ?? 'guest'}`;
const indexKey = () => `${prefix()}:index`;
const dataKey = (id: string) => `${prefix()}:data:${id}`;

// 一覧の読み書きが重なって片方の変更が消えたり、保存し終える前の古い中身を読んだりしないよう、順番に行う
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
	const result = queue.then(fn, fn);
	queue = result.catch(() => {});
	return result;
}

async function readIndex(): Promise<DoodleMeta[]> {
	const raw = await get(indexKey());
	return Array.isArray(raw) ? raw as DoodleMeta[] : [];
}

/** 作品の一覧(新しく描いたものから) */
export function listDoodles(): Promise<DoodleMeta[]> {
	return serialize(async () => (await readIndex()).sort((a, b) => b.updatedAt - a.updatedAt));
}

export function getDoodle(id: string): Promise<{ meta: DoodleMeta; data: DoodleData } | null> {
	return serialize(async () => {
		const meta = (await readIndex()).find(item => item.id === id);
		if (meta == null) return null;
		const data = await get(dataKey(id)) as DoodleData | undefined;
		return { meta, data: data ?? { strokes: [], layers: [] } };
	});
}

export function createDoodle(title: string, width: number, height: number): Promise<DoodleMeta> {
	return serialize(async () => {
		const now = Date.now();
		const meta: DoodleMeta = {
			id: now.toString(36) + Math.random().toString(36).slice(2, 8),
			title,
			width,
			height,
			createdAt: now,
			updatedAt: now,
			thumbnail: null,
		};
		await set(dataKey(meta.id), { strokes: [], layers: [] } satisfies DoodleData);
		await set(indexKey(), [...await readIndex(), meta]);
		return meta;
	});
}

/** 一覧の情報(名前・小さな絵など)を変える */
export function updateDoodleMeta(id: string, patch: Partial<Omit<DoodleMeta, 'id' | 'createdAt'>>): Promise<void> {
	return serialize(async () => {
		const index = await readIndex();
		const i = index.findIndex(item => item.id === id);
		if (i === -1) return;
		index[i] = { ...index[i], ...patch };
		await set(indexKey(), index);
	});
}

/** 線・レイヤーを保存する。metaを渡すと、一覧の情報(キャンバスの大きさなど)も続けて変える(ほかの読み書きは間に入らない) */
export function saveDoodleData(id: string, data: DoodleData, meta?: Partial<Pick<DoodleMeta, 'width' | 'height'>>): Promise<void> {
	return serialize(async () => {
		const index = await readIndex();
		const i = index.findIndex(item => item.id === id);
		// 消した作品には書かない(消した後に、描いた分の保存が遅れて届いたとき)
		if (i === -1) return;
		// 保存する形にそろえる(画面が持っているリアクティブな配列をそのまま入れないように)
		await set(dataKey(id), JSON.parse(JSON.stringify(data)));
		index[i] = { ...index[i], ...meta, updatedAt: Date.now() };
		await set(indexKey(), index);
	});
}

export function deleteDoodle(id: string): Promise<void> {
	return serialize(async () => {
		await set(indexKey(), (await readIndex()).filter(item => item.id !== id));
		await del(dataKey(id));
	});
}
