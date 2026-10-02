/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: アバターデコレーションの大きさ(scale)。0.1〜1で、1(今までと同じ大きさ)は保存せず、ユーザーの情報にも出さない
import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { SignupSuccessResponse } from 'misskey-js/entities.js';
import { api, signup, initTestDb } from '../utils.js';

describe('アバターデコレーションの大きさ', () => {
	let root: SignupSuccessResponse;
	let alice: SignupSuccessResponse;
	let decorationId: string;

	beforeAll(async () => {
		await initTestDb(true);
		root = await signup({ username: 'root' });
		alice = await signup();
		const created = await api('admin/avatar-decorations/create', { name: 'deco', description: '', url: 'https://example.com/deco.png' }, root);
		assert.strictEqual(created.status, 200, JSON.stringify(created.body));
		decorationId = created.body.id;
	}, 1000 * 60 * 2);

	const decorationsOf = async () => (await api('i', {}, alice)).body.avatarDecorations as { id: string; scale?: number }[];

	test('0.1〜1の大きさを保存し、ユーザーの情報に出す', async () => {
		const res = await api('i/update', { avatarDecorations: [{ id: decorationId, scale: 0.5 }] }, alice);
		assert.strictEqual(res.status, 200, JSON.stringify(res.body));
		assert.deepStrictEqual((await decorationsOf()).map(d => d.scale), [0.5]);
		const shown = (await api('users/show', { userId: alice.id }, root)).body.avatarDecorations as { scale?: number }[];
		assert.deepStrictEqual(shown.map(d => d.scale), [0.5]);
	});

	test('1と省略・nullは保存せず、ユーザーの情報にも出さない', async () => {
		for (const scale of [1, null, undefined]) {
			const res = await api('i/update', { avatarDecorations: [{ id: decorationId, ...(scale !== undefined ? { scale } : {}) }] }, alice);
			assert.strictEqual(res.status, 200, JSON.stringify(res.body));
			const decorations = await decorationsOf();
			assert.strictEqual(decorations.length, 1);
			assert.strictEqual('scale' in decorations[0], false, `scale: ${scale}`);
		}
	});

	test('範囲の外の大きさは断る', async () => {
		for (const scale of [0.05, 1.5, 0, -1]) {
			const res = await api('i/update', { avatarDecorations: [{ id: decorationId, scale }] }, alice);
			assert.strictEqual(res.status, 400, `scale: ${scale}`);
			assert.strictEqual((res.body as unknown as { error: { code: string } }).error.code, 'INVALID_PARAM');
		}
	});
});
