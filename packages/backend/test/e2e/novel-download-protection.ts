/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 小説のtxtを、ほかの人にダウンロードさせない(添付としては出すがURLは小説ビューワーのページにし、本文は notes/novel-text で読む。
// 連合では添付として送らず、小説ビューワーへのリンクにする)
import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { SignupSuccessResponse } from 'misskey-js/entities.js';
import { api, initTestDb, post, signup, simpleGet, uploadFile } from '../utils.js';

describe('小説のtxtのダウンロード禁止', () => {
	let alice: SignupSuccessResponse;
	let bob: SignupSuccessResponse;
	let carol: SignupSuccessResponse;
	const content = '第一章\n本文の一行目です。\n';
	let fileId: string;
	let noteId: string;

	type Note = { files: { id: string; url: string; thumbnailUrl: string | null; name: string; novelDownloadDisabled: boolean }[]; fileIds: string[]; novelTextProtected?: boolean };

	beforeAll(async () => {
		await initTestDb(true);
		const root = await signup({ username: 'root' });
		// 連合の形を確かめるため(ActivityPubの取得を許す)
		await api('admin/update-meta', { federation: 'all' }, root);
		alice = await signup();
		bob = await signup();
		carol = await signup();
		await api('following/create', { userId: alice.id }, bob);
		const uploaded = await uploadFile(alice, { blob: new Blob([new TextEncoder().encode(content)], { type: 'text/plain' }), name: 'story.txt' });
		assert.strictEqual(uploaded.status, 200);
		fileId = uploaded.body!.id;
		const updated = await api('drive/files/update', { fileId, isNovel: true, novelDownloadDisabled: true }, alice);
		assert.strictEqual(updated.status, 200);
		assert.strictEqual(updated.body.novelDownloadDisabled, true);
		noteId = (await post(alice, { text: 'あらすじ', fileIds: [fileId], isNovel: true })).id;
	}, 1000 * 60 * 2);

	test('投稿者以外には、添付としては出すが、ファイルのURLを小説ビューワーのページにする。投稿者には今まで通り', async () => {
		for (const user of [bob, undefined]) {
			const note = (await api('notes/show', { noteId }, user)).body as unknown as Note;
			assert.deepStrictEqual(note.fileIds, [fileId]);
			assert.strictEqual(note.files[0].name, 'story.txt');
			assert.strictEqual(note.files[0].novelDownloadDisabled, true);
			assert.ok(note.files[0].url.endsWith(`/notes/${noteId}/novel-viewer`), note.files[0].url);
			assert.strictEqual(note.files[0].thumbnailUrl, null);
			assert.strictEqual(note.novelTextProtected, true);
		}
		const forAlice = (await api('notes/show', { noteId }, alice)).body as unknown as Note;
		assert.ok(!forAlice.files[0].url.includes('novel-viewer'));
		assert.strictEqual(forAlice.novelTextProtected, undefined);
	});

	test('本文は notes/novel-text で読める(ログインしていない人も)', async () => {
		for (const user of [bob, undefined]) {
			const res = await api('notes/novel-text', { noteId }, user);
			assert.strictEqual(res.status, 200, JSON.stringify(res.body));
			assert.strictEqual(res.body.name, 'story.txt');
			assert.strictEqual(Buffer.from(res.body.data, 'base64').toString('utf8'), content);
		}
	});

	test('見られないノート・小説でないノートの本文は読めない', async () => {
		const followersNote = (await post(alice, { text: 'フォロワーだけ', fileIds: [fileId], isNovel: true, visibility: 'followers' })).id;
		assert.strictEqual((await api('notes/novel-text', { noteId: followersNote }, bob)).status, 200);
		const denied = await api('notes/novel-text', { noteId: followersNote }, carol);
		assert.strictEqual(denied.status, 400);
		assert.strictEqual((denied.body as unknown as { error: { code: string } }).error.code, 'NO_SUCH_NOTE');

		const plain = (await post(alice, { text: '小説ではない' })).id;
		const none = await api('notes/novel-text', { noteId: plain }, bob);
		assert.strictEqual((none.body as unknown as { error: { code: string } }).error.code, 'NO_NOVEL_TEXT');
	});

	test('連合では添付として送らず、小説ビューワーへのリンクを付ける', async () => {
		const ap = await simpleGet(`notes/${noteId}`, 'application/activity+json');
		assert.strictEqual(ap.status, 200);
		assert.deepStrictEqual(ap.body.attachment, []);
		assert.ok((ap.body.content as string).includes(`/notes/${noteId}/novel-viewer`));
		assert.ok((ap.body._misskey_content as string).startsWith('あらすじ\n\n📖 '));
	});

	test('ダウンロードさせるに戻すと、ほかの人にも添付として出る', async () => {
		await api('drive/files/update', { fileId, novelDownloadDisabled: false }, alice);
		const forBob = (await api('notes/show', { noteId }, bob)).body as unknown as Note;
		assert.ok(!forBob.files[0].url.includes('novel-viewer'));
		assert.strictEqual(forBob.novelTextProtected, undefined);
		const ap = await simpleGet(`notes/${noteId}`, 'application/activity+json');
		assert.strictEqual(ap.body.attachment.length, 1);
	});
});
