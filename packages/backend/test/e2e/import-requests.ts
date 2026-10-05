/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 承認式にしたアカウントのデータのインポート(設定 → アカウントのデータ)
import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { SignupSuccessResponse } from 'misskey-js/entities.js';
import { api, failedApiCall, successfulApiCall, uploadFile, signup, role, initTestDb } from '../utils.js';

const policy = (value: boolean) => ({ priority: 0, useDefault: false, value });

describe('インポートの承認', () => {
	let root: SignupSuccessResponse;
	let moderator: SignupSuccessResponse;
	let approver: SignupSuccessResponse;
	let alice: SignupSuccessResponse;
	let bob: SignupSuccessResponse;

	const csv = () => new Blob(['@bob@example.com\n@carol@example.com\n@dave@other.example\n'], { type: 'text/csv' });
	const uploadCsv = async (user: SignupSuccessResponse) => (await uploadFile(user, { blob: csv(), name: 'following.csv' })).body!;

	beforeAll(async () => {
		await initTestDb(true);
		root = await signup({ username: 'root' });
		moderator = await signup({ username: 'importMod' });
		approver = await signup({ username: 'importApprover' });
		alice = await signup({ username: 'importAlice' });
		bob = await signup({ username: 'importBob' });

		// インポートできるロール(既定では誰もインポートできない)
		const importer = await role(root, { name: 'importer' }, {
			canImportFollowing: policy(true),
			canImportMuting: policy(true),
		});
		const moderatorRole = await role(root, { name: 'moderator', isModerator: true });
		// 審査だけできるロール
		const approverRole = await role(root, { name: 'approver' }, { canApproveImportRequests: policy(true) });
		for (const user of [moderator, approver, alice, bob]) {
			await api('admin/roles/assign', { userId: user.id, roleId: importer.id }, root);
		}
		await api('admin/roles/assign', { userId: moderator.id, roleId: moderatorRole.id }, root);
		await api('admin/roles/assign', { userId: approver.id, roleId: approverRole.id }, root);
	}, 1000 * 60 * 2);

	test('既定では、フォローのインポートは申請になり、ミュートのインポートはそのまま行う', async () => {
		const settings = await successfulApiCall({ endpoint: 'admin/juice/settings', parameters: {}, user: root });
		assert.deepStrictEqual(settings.importApprovalRequiredTypes, ['following']);

		const file = await uploadCsv(alice);
		const following = await successfulApiCall({ endpoint: 'i/import-following', parameters: { fileId: file.id, withReplies: true }, user: alice });
		assert.strictEqual(following.requiresApproval, true);
		const muting = await successfulApiCall({ endpoint: 'i/import-muting', parameters: { fileId: file.id }, user: alice });
		assert.strictEqual(muting.requiresApproval, false);

		const mine = await successfulApiCall({ endpoint: 'import-requests/list', parameters: {}, user: alice });
		assert.strictEqual(mine.length, 1);
		assert.strictEqual(mine[0].type, 'following');
		assert.strictEqual(mine[0].status, 'pending');
		assert.strictEqual(mine[0].withReplies, true);
		assert.strictEqual(mine[0].fileName, 'following.csv');
	});

	test('同じ種類の審査待ちの申請があれば、断る', async () => {
		const file = await uploadCsv(alice);
		await failedApiCall({ endpoint: 'i/import-following', parameters: { fileId: file.id }, user: alice }, {
			status: 400, code: 'ALREADY_REQUESTED', id: '5a8f2c1e-7b3d-4e9a-b6c4-1d2e3f4a5b60',
		});
	});

	test('審査できる人(モデレーター・ロールポリシーを持つ人)のインポートは、申請にならない', async () => {
		for (const user of [moderator, approver]) {
			const file = await uploadCsv(user);
			const res = await successfulApiCall({ endpoint: 'i/import-following', parameters: { fileId: file.id }, user });
			assert.strictEqual(res.requiresApproval, false);
		}
	});

	test('審査できない人は、一覧も見られず、承認もできない', async () => {
		await failedApiCall({ endpoint: 'admin/import-requests/list', parameters: {}, user: bob }, { status: 403, code: 'ROLE_PERMISSION_DENIED', id: '60ae1eea-4c46-4b88-9c4c-549867219a30' });
		const [request] = await successfulApiCall({ endpoint: 'import-requests/list', parameters: {}, user: alice });
		await failedApiCall({ endpoint: 'admin/import-requests/approve', parameters: { requestId: request.id }, user: bob }, { status: 403, code: 'ROLE_PERMISSION_DENIED', id: '60ae1eea-4c46-4b88-9c4c-549867219a30' });
	});

	test('ロールポリシーを持つ人は、一覧と中身を見て、承認できる。申請した本人に通知が届く', async () => {
		const list = await successfulApiCall({ endpoint: 'admin/import-requests/list', parameters: { state: 'pending' }, user: approver });
		const request = list.find(r => r.user.id === alice.id);
		assert.ok(request != null);
		assert.strictEqual(request.type, 'following');
		assert.strictEqual(request.reviewer, null);

		const shown = await successfulApiCall({ endpoint: 'admin/import-requests/show', parameters: { requestId: request.id }, user: approver });
		assert.strictEqual(shown.request.id, request.id);
		// テストの環境では、自分のサーバーのファイルを取りに行けないことがある(config.urlへのfetch)ので、中身は読めたときだけ確かめる
		if (shown.preview != null) {
			assert.strictEqual(shown.preview.totalLines, 3);
			assert.deepStrictEqual(shown.preview.hosts[0], { host: 'example.com', count: 2 });
		}

		await successfulApiCall({ endpoint: 'admin/import-requests/approve', parameters: { requestId: request.id }, user: approver }, { status: 204 });
		// 2回目は断る
		await failedApiCall({ endpoint: 'admin/import-requests/approve', parameters: { requestId: request.id }, user: approver }, {
			status: 400, code: 'ALREADY_REVIEWED', id: '5b7d9f1a-3c4e-405b-8c2d-9e1a3b5c7da3',
		});

		const [mine] = await successfulApiCall({ endpoint: 'import-requests/list', parameters: {}, user: alice });
		assert.strictEqual(mine.status, 'approved');
		assert.ok(mine.reviewedAt != null);

		const notifications = await successfulApiCall({ endpoint: 'i/notifications', parameters: { includeTypes: ['importRequestApproved'] }, user: alice });
		assert.strictEqual(notifications.length, 1);

		// 審査できる人には、新しい申請の通知が届いている
		const adminNotifications = await successfulApiCall({ endpoint: 'i/notifications', parameters: { includeTypes: ['newImportRequest'] }, user: approver });
		assert.ok(adminNotifications.length >= 1);
	});

	test('却下すると、理由つきで申請した本人に通知が届き、モデレーションログに残る', async () => {
		const file = await uploadCsv(bob);
		await successfulApiCall({ endpoint: 'i/import-following', parameters: { fileId: file.id }, user: bob });
		const [request] = await successfulApiCall({ endpoint: 'import-requests/list', parameters: { state: 'pending' }, user: bob });

		await successfulApiCall({ endpoint: 'admin/import-requests/reject', parameters: { requestId: request.id, reason: '知らない人ばかりなので' }, user: moderator }, { status: 204 });

		const [mine] = await successfulApiCall({ endpoint: 'import-requests/list', parameters: {}, user: bob });
		assert.strictEqual(mine.status, 'rejected');
		assert.strictEqual(mine.rejectReason, '知らない人ばかりなので');

		const notifications = await successfulApiCall({ endpoint: 'i/notifications', parameters: { includeTypes: ['importRequestRejected'] }, user: bob });
		assert.strictEqual(notifications.length, 1);

		const logs = await successfulApiCall({ endpoint: 'admin/show-moderation-logs', parameters: { type: 'rejectImportRequest' }, user: root });
		assert.strictEqual(logs[0].info.reason, '知らない人ばかりなので');
	});

	test('申請した本人は、審査待ちの申請を取り下げられる(審査した後は取り下げられない)。ほかの人の申請は取り下げられない', async () => {
		const file = await uploadCsv(bob);
		await successfulApiCall({ endpoint: 'i/import-following', parameters: { fileId: file.id }, user: bob });
		const [request] = await successfulApiCall({ endpoint: 'import-requests/list', parameters: { state: 'pending' }, user: bob });

		await failedApiCall({ endpoint: 'import-requests/cancel', parameters: { requestId: request.id }, user: alice }, {
			status: 400, code: 'NO_SUCH_REQUEST', id: 'b13d5f7a-9cae-46b1-8c8d-5e7a9b1c3d09',
		});
		await successfulApiCall({ endpoint: 'import-requests/cancel', parameters: { requestId: request.id }, user: bob }, { status: 204 });
		await failedApiCall({ endpoint: 'admin/import-requests/approve', parameters: { requestId: request.id }, user: moderator }, {
			status: 400, code: 'ALREADY_REVIEWED', id: '5b7d9f1a-3c4e-405b-8c2d-9e1a3b5c7da3',
		});
	});

	test('ファイルが消されていたら、承認できず、審査待ちのまま残る', async () => {
		const file = await uploadCsv(bob);
		await successfulApiCall({ endpoint: 'i/import-following', parameters: { fileId: file.id }, user: bob });
		const [request] = await successfulApiCall({ endpoint: 'import-requests/list', parameters: { state: 'pending' }, user: bob });
		await successfulApiCall({ endpoint: 'drive/files/delete', parameters: { fileId: file.id }, user: bob }, { status: 204 });

		await failedApiCall({ endpoint: 'admin/import-requests/approve', parameters: { requestId: request.id }, user: moderator }, {
			status: 400, code: 'NO_SUCH_FILE', id: '6c8e0a2b-4d5f-416c-9d3e-0f2b4c6d8eb4',
		});
		const [mine] = await successfulApiCall({ endpoint: 'import-requests/list', parameters: {}, user: bob });
		assert.strictEqual(mine.status, 'pending');
		assert.strictEqual(mine.fileId, null);
		// 却下はできる
		await successfulApiCall({ endpoint: 'admin/import-requests/reject', parameters: { requestId: request.id, reason: 'ファイルがありません' }, user: moderator }, { status: 204 });
	});

	test('申請した後に凍結された人のインポートは、承認できず、審査待ちのまま残る', async () => {
		const carol = await signup({ username: 'importCarol' });
		const roles = await successfulApiCall({ endpoint: 'admin/roles/list', parameters: {}, user: root });
		const importer = roles.find(r => r.name === 'importer')!;
		await api('admin/roles/assign', { userId: carol.id, roleId: importer.id }, root);
		const file = await uploadCsv(carol);
		await successfulApiCall({ endpoint: 'i/import-following', parameters: { fileId: file.id }, user: carol });
		const list = await successfulApiCall({ endpoint: 'admin/import-requests/list', parameters: { state: 'pending' }, user: root });
		const request = list.find(r => r.user.id === carol.id)!;

		await successfulApiCall({ endpoint: 'admin/suspend-user', parameters: { userId: carol.id }, user: root }, { status: 204 });
		await failedApiCall({ endpoint: 'admin/import-requests/approve', parameters: { requestId: request.id }, user: moderator }, {
			status: 400, code: 'REQUESTER_UNAVAILABLE', id: 'f3c5e7a9-8b0d-4c2e-af4a-9b1d3f5a7ce8',
		});
		const after = await successfulApiCall({ endpoint: 'admin/import-requests/list', parameters: { state: 'pending' }, user: root });
		assert.ok(after.some(r => r.id === request.id));
	});

	test('JUICE設定で、承認の要る種類を変えられる', async () => {
		await successfulApiCall({ endpoint: 'admin/juice/update-settings', parameters: { importApprovalRequiredTypes: ['muting'] }, user: root }, { status: 204 });
		const file = await uploadCsv(bob);
		const following = await successfulApiCall({ endpoint: 'i/import-following', parameters: { fileId: file.id }, user: bob });
		assert.strictEqual(following.requiresApproval, false);
		const muting = await successfulApiCall({ endpoint: 'i/import-muting', parameters: { fileId: file.id }, user: bob });
		assert.strictEqual(muting.requiresApproval, true);

		await successfulApiCall({ endpoint: 'admin/juice/update-settings', parameters: { importApprovalRequiredTypes: [] }, user: root }, { status: 204 });
		const settings = await successfulApiCall({ endpoint: 'admin/juice/settings', parameters: {}, user: root });
		assert.deepStrictEqual(settings.importApprovalRequiredTypes, []);
	});
});
