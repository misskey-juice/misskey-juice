/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// How to run:
// pnpm jest -- e2e/emoji-avatar-decoration-request-update-file.ts

// JUICE: 審査待ちの自分の絵文字申請・アバターデコレーション申請の画像を差し替える
// emoji-requests/update-file・avatar-decoration-requests/update-fileと、
// 絵文字のタグを全角スペースなどの空白でも分けること(normalizeEmojiAliases)をe2eで検証する。
// (承認のときの分け方は、承認がローカルのe2eでは画像のコピー(自分のURLへの取得)で失敗するため、ここでは確かめない。
// 分け方そのものはtest/unit/misc/emoji-aliases.tsで確かめる)
// 審査待ちの件数の上限(既定3件)に当たらないよう、テストごとに新しいユーザーで申請する
import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { SignupSuccessResponse } from 'misskey-js/entities.js';
import { api, successfulApiCall, failedApiCall, uploadFile, signup } from '../utils.js';

const KINDS = [{
	label: '絵文字申請',
	endpoint: 'emoji-requests',
	errors: {
		noSuchRequest: 'e42ad0c2-fe24-47ce-b7dd-a86201a8112b',
		alreadyReviewed: 'b6d8fa3f-c33d-4954-a794-7fc246890a6d',
		accessDenied: '52de2ac4-c505-4537-a769-a91c32f3f8fd',
		unsupportedFileType: '63a1db85-25ff-4a21-818a-cb9a9cded762',
		approveModified: '732b34eb-fd78-452a-9d4f-d98918f98e7d',
		rejectModified: '7d64005c-adc6-47ff-a0c8-4e09f064e3ec',
	},
}, {
	label: 'アバターデコレーション申請',
	endpoint: 'avatar-decoration-requests',
	errors: {
		noSuchRequest: '16966edd-99dd-4e39-8524-6c15d508d23c',
		alreadyReviewed: '83c68d40-fed0-49a8-9d4d-be3da59e6c42',
		accessDenied: '9d1f0b8e-3c2a-4e57-8b6d-1a4f7c9e2d30',
		unsupportedFileType: 'c4e8a2f6-7b1d-4c39-9e5a-2f8b6d0a4c71',
		approveModified: '1409ef48-ae42-4606-b866-dd552d7d7bbd',
		rejectModified: '5498b455-fe41-4b3d-8eac-3142ee627133',
	},
}] as const;

describe('申請の画像の差し替え', () => {
	let root: SignupSuccessResponse;

	beforeAll(async () => {
		root = await signup({ username: 'root' });

		// 絵文字申請・アバターデコレーション申請は既定で無効なので、テストのために有効化する
		await successfulApiCall({
			endpoint: 'admin/juice/update-settings',
			parameters: { emojiRequestEnabled: true, avatarDecorationRequestEnabled: true },
			user: root,
		}, { status: 204 });
	}, 1000 * 60 * 2);

	for (const kind of KINDS) {
		describe(kind.label, () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const create = async (user: SignupSuccessResponse, extra: Record<string, unknown> = {}): Promise<any> => {
				const file = await uploadFile(user);
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const res = await api(`${kind.endpoint}/create` as any, { fileId: file.body!.id, name: `dummy_${Date.now()}`, ...extra } as any, user);
				assert.strictEqual(res.status, 200);
				return res.body;
			};
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const updateFile = (user: SignupSuccessResponse, requestId: string, fileId: string) => api(`${kind.endpoint}/update-file` as any, { requestId, fileId } as any, user);

			test('審査待ちの間、申請者自身で画像を差し替えられる', async () => {
				const alice = await signup();
				const request = await create(alice);
				const newFile = await uploadFile(alice, { path: '192.png' });

				const res = await updateFile(alice, request.id, newFile.body!.id);
				assert.strictEqual(res.status, 200);
				assert.strictEqual(res.body.fileId, newFile.body!.id);
				assert.strictEqual(res.body.fileUrl, newFile.body!.url);

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const list = await api(`${kind.endpoint}/list` as any, { status: 'pending' } as any, alice);
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const listed = (list.body as any[]).find(r => r.id === request.id);
				assert.strictEqual(listed.fileId, newFile.body!.id);
			});

			test('他人の申請の画像は差し替えられない', async () => {
				const alice = await signup();
				const bob = await signup();
				const request = await create(alice);
				const bobFile = await uploadFile(bob);

				const res = await updateFile(bob, request.id, bobFile.body!.id);
				assert.strictEqual(res.status, 400);
				assert.strictEqual(res.body.error.id, kind.errors.noSuchRequest);
			});

			test('取り下げた申請の画像は差し替えられない', async () => {
				const alice = await signup();
				const request = await create(alice);
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const cancel = await api(`${kind.endpoint}/cancel` as any, { requestId: request.id } as any, alice);
				assert.strictEqual(cancel.status, 204);
				const newFile = await uploadFile(alice);

				const res = await updateFile(alice, request.id, newFile.body!.id);
				assert.strictEqual(res.status, 400);
				assert.strictEqual(res.body.error.id, kind.errors.alreadyReviewed);
			});

			test('他人のファイルには差し替えられない', async () => {
				const alice = await signup();
				const bob = await signup();
				const request = await create(alice);
				const bobFile = await uploadFile(bob);

				const res = await updateFile(alice, request.id, bobFile.body!.id);
				assert.strictEqual(res.status, 400);
				assert.strictEqual(res.body.error.id, kind.errors.accessDenied);
			});

			test('画像ではないファイルには差し替えられない', async () => {
				const alice = await signup();
				const request = await create(alice);
				const audio = await uploadFile(alice, { path: 'kick_gaba7.mp3' });

				const res = await updateFile(alice, request.id, audio.body!.id);
				assert.strictEqual(res.status, 400);
				assert.strictEqual(res.body.error.id, kind.errors.unsupportedFileType);
			});

			test('「審査後にファイルを消す」にしていた申請なら、前の画像を消す', async () => {
				const alice = await signup();
				const request = await create(alice, { deleteFileAfterReview: true });
				const oldFileId = request.fileId as string;
				const newFile = await uploadFile(alice, { path: '192.png' });

				const res = await updateFile(alice, request.id, newFile.body!.id);
				assert.strictEqual(res.status, 200);

				// ファイルの削除は非同期なので、消えるまで少し待つ
				let deleted = false;
				for (let i = 0; i < 50 && !deleted; i++) {
					const show = await api('drive/files/show', { fileId: oldFileId }, alice);
					deleted = show.status === 400;
					if (!deleted) await new Promise(resolve => setTimeout(resolve, 100));
				}
				assert.ok(deleted, '前の画像が消えていない');

				// 差し替えた画像は残る
				const kept = await api('drive/files/show', { fileId: newFile.body!.id }, alice);
				assert.strictEqual(kept.status, 200);
			});

			test('モデレーターが見ていた後に差し替えられたら、承認も却下も断る(見ていない画像を公開・却下しない)', async () => {
				const alice = await signup();
				const request = await create(alice);
				const seenFileId = request.fileId as string;
				const newFile = await uploadFile(alice, { path: '192.png' });
				const res = await updateFile(alice, request.id, newFile.body!.id);
				assert.strictEqual(res.status, 200);

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const approve = await api(`admin/${kind.endpoint}/approve` as any, { requestId: request.id, expectedFileId: seenFileId } as any, root);
				assert.strictEqual(approve.status, 400);
				assert.strictEqual(approve.body.error.id, kind.errors.approveModified);

				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const reject = await api(`admin/${kind.endpoint}/reject` as any, { requestId: request.id, expectedFileId: seenFileId, reason: 'テスト' } as any, root);
				assert.strictEqual(reject.status, 400);
				assert.strictEqual(reject.body.error.id, kind.errors.rejectModified);

				// 今の画像を見ていれば却下できる(審査待ちのまま残っている)
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const reject2 = await api(`admin/${kind.endpoint}/reject` as any, { requestId: request.id, expectedFileId: newFile.body!.id, reason: 'テスト' } as any, root);
				assert.strictEqual(reject2.status, 204);
			});

			test('「審査後にファイルを消す」にしていなければ、前の画像は消さない', async () => {
				const alice = await signup();
				const request = await create(alice);
				const oldFileId = request.fileId as string;
				const newFile = await uploadFile(alice, { path: '192.png' });

				const res = await updateFile(alice, request.id, newFile.body!.id);
				assert.strictEqual(res.status, 200);

				const show = await api('drive/files/show', { fileId: oldFileId }, alice);
				assert.strictEqual(show.status, 200);
			});
		});
	}

	test('同じ画像を絵文字申請とアバターデコレーション申請の両方で使っていたら、片方を差し替えても前の画像を消さない', async () => {
		const alice = await signup();
		const shared = await uploadFile(alice);
		const emojiRequest = await successfulApiCall({
			endpoint: 'emoji-requests/create',
			parameters: { fileId: shared.body!.id, name: `dummy_${Date.now()}`, deleteFileAfterReview: true },
			user: alice,
		});
		await successfulApiCall({
			endpoint: 'avatar-decoration-requests/create',
			parameters: { fileId: shared.body!.id, name: `dummy_${Date.now()}` },
			user: alice,
		});
		const newFile = await uploadFile(alice, { path: '192.png' });

		await successfulApiCall({
			endpoint: 'emoji-requests/update-file',
			parameters: { requestId: emojiRequest.id, fileId: newFile.body!.id },
			user: alice,
		});

		await new Promise(resolve => setTimeout(resolve, 1000));
		const show = await api('drive/files/show', { fileId: shared.body!.id }, alice);
		assert.strictEqual(show.status, 200);
	});

	describe('絵文字のタグの区切り', () => {
		test('1つのタグの中の全角スペース・半角スペースでも、タグを分ける(空のタグと重複は除く)', async () => {
			const alice = await signup();
			const file = await uploadFile(alice);
			const request = await successfulApiCall({
				endpoint: 'emoji-requests/create',
				parameters: { fileId: file.body!.id, name: `dummy_${Date.now()}`, aliases: ['ねこ　かわいい', 'いぬ  とり', 'ねこ', '　'] },
				user: alice,
			});
			assert.deepStrictEqual(request.aliases, ['ねこ', 'かわいい', 'いぬ', 'とり']);
		});

		test('タグ必須の設定で、空白だけのタグしか無ければ断る', async () => {
			await successfulApiCall({
				endpoint: 'admin/juice/update-settings',
				parameters: { emojiRequestRequireTags: true },
				user: root,
			}, { status: 204 });
			try {
				const alice = await signup();
				const file = await uploadFile(alice);
				await failedApiCall({
					endpoint: 'emoji-requests/create',
					parameters: { fileId: file.body!.id, name: `dummy_${Date.now()}`, aliases: ['　', ' '] },
					user: alice,
				}, { status: 400, code: 'TAGS_REQUIRED', id: '7c9b6d9f-4b9a-4a27-9c2b-2f6a7d9e4b3c' });
			} finally {
				await successfulApiCall({
					endpoint: 'admin/juice/update-settings',
					parameters: { emojiRequestRequireTags: false },
					user: root,
				}, { status: 204 });
			}
		});
	});
});

