/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// How to run:
// pnpm jest -- e2e/juice-admin-notification-targeting.ts

// JUICE: 絵文字申請・アバターデコレーション申請・承認式登録申請・お問い合わせが新しく来たことを、
// モデレーターだけでなくcanApproveXxxロールポリシー保持者にも通常の通知(🔔の通知一覧、
// notificationService.createNotification()経由)として届ける機能(JuiceAdminNotificationService)をe2eで検証する。
// admin stream(リアルタイムトースト・バナー)側の到達性は既にjuice-review-race-condition.ts等で
// 間接的にカバーされているため、ここでは通常の通知として実際にDBならぬRedisの通知タイムラインに
// 記録され、i/notificationsから取得できることに絞って検証する。
import * as assert from 'assert';
import { setTimeout } from 'node:timers/promises';
import { describe, beforeAll, test } from 'vitest';
import { SignupSuccessResponse } from 'misskey-js/entities.js';
import { allSettled } from '@/misc/promise-tracker.js';
import { api, successfulApiCall, uploadFile, signup, randomString, role } from '../utils.js';

describe('新着申請の通知(admin向け)', () => {
	let root: SignupSuccessResponse;
	let alice: SignupSuccessResponse;

	beforeAll(async () => {
		root = await signup({ username: 'root' });
		alice = await signup();

		await successfulApiCall({
			endpoint: 'admin/juice/update-settings',
			parameters: { emojiRequestEnabled: true, avatarDecorationRequestEnabled: true, contactFormEnabled: true },
			user: root,
		}, { status: 204 });
	}, 1000 * 60 * 2);

	test('絵文字申請を作成すると、モデレーターに新着通知が届く', async () => {
		const file = await uploadFile(alice);
		const request = await successfulApiCall({
			endpoint: 'emoji-requests/create',
			parameters: { fileId: file.body!.id, name: `dummy_${Date.now()}`, category: 'テストカテゴリ' },
			user: alice,
		});

		await allSettled();
		await setTimeout(500);

		const res = await api('i/notifications', {}, root);
		assert.strictEqual(res.status, 200);
		const notification = res.body.find((n: { type: string }) => n.type === 'newEmojiRequest') as { requestId: string; name: string; category: string | null; requester: { id: string } } | undefined;
		assert.notStrictEqual(notification, undefined);
		assert.strictEqual(notification!.requestId, request.id);
		assert.strictEqual(notification!.name, request.name);
		assert.strictEqual(notification!.category, 'テストカテゴリ');
		assert.strictEqual(notification!.requester.id, alice.id);
	});

	test('まとめて申請(create-many)すると、モデレーターへの新着通知は1件にまとまり、件数が入る', async () => {
		const bob = await signup();
		const files = await Promise.all([0, 1, 2].map(() => uploadFile(bob)));
		const stamp = Date.now();
		const requests = await successfulApiCall({
			endpoint: 'emoji-requests/create-many',
			parameters: { requests: files.map((file, i) => ({ fileId: file.body!.id, name: `bulk_${stamp}_${i}` })) },
			user: bob,
		});
		assert.strictEqual(requests.length, 3);

		await allSettled();
		await setTimeout(500);

		const res = await api('i/notifications', {}, root);
		assert.strictEqual(res.status, 200);
		const notifications = res.body.filter((n: { type: string; requester?: { id: string } }) => n.type === 'newEmojiRequest' && n.requester?.id === bob.id) as { requestId: string; name: string; count: number }[];
		assert.strictEqual(notifications.length, 1);
		assert.strictEqual(notifications[0].count, 3);
		assert.strictEqual(notifications[0].requestId, requests[0].id);
		assert.strictEqual(notifications[0].name, requests[0].name);
	});

	test('申請者をミュートしていても、モデレーターに新着通知が届く(管理用通知はミュートの影響を受けない)', async () => {
		const mutedRequester = await signup();
		await successfulApiCall({
			endpoint: 'mute/create',
			parameters: { userId: mutedRequester.id },
			user: root,
		}, { status: 204 });

		const file = await uploadFile(mutedRequester);
		const request = await successfulApiCall({
			endpoint: 'emoji-requests/create',
			parameters: { fileId: file.body!.id, name: `muted_requester_${Date.now()}` },
			user: mutedRequester,
		});

		await allSettled();
		await setTimeout(500);

		const res = await api('i/notifications', {}, root);
		assert.strictEqual(res.status, 200);
		const notification = res.body.find((n: { type: string, requestId?: string }) => n.type === 'newEmojiRequest' && n.requestId === request.id);
		assert.notStrictEqual(notification, undefined);

		await successfulApiCall({
			endpoint: 'mute/delete',
			parameters: { userId: mutedRequester.id },
			user: root,
		}, { status: 204 });
	});

	test('アバターデコレーション申請を作成すると、モデレーターに新着通知が届く', async () => {
		const file = await uploadFile(alice);
		const request = await successfulApiCall({
			endpoint: 'avatar-decoration-requests/create',
			parameters: { fileId: file.body!.id, name: `dummy_${Date.now()}` },
			user: alice,
		});

		await allSettled();
		await setTimeout(500);

		const res = await api('i/notifications', {}, root);
		assert.strictEqual(res.status, 200);
		const notification = res.body.find((n: { type: string }) => n.type === 'newAvatarDecorationRequest') as { requestId: string; name: string; requester: { id: string } } | undefined;
		assert.notStrictEqual(notification, undefined);
		assert.strictEqual(notification!.requestId, request.id);
		assert.strictEqual(notification!.name, request.name);
		assert.strictEqual(notification!.requester.id, alice.id);
	});

	test('承認式登録の申請があると、モデレーターに新着通知が届く', async () => {
		await successfulApiCall({
			endpoint: 'admin/juice/update-settings',
			parameters: { approvalRequiredForSignup: true, signupReasonRequired: true, signupReasonMaxLength: 4096 },
			user: root,
		}, { status: 204 });

		const username = randomString();
		const signupRes = await api('signup', { username, password: 'test', reason: 'よろしくお願いします' });
		assert.strictEqual(signupRes.status, 200);

		await allSettled();
		await setTimeout(500);

		const res = await api('i/notifications', {}, root);
		assert.strictEqual(res.status, 200);
		const notification = res.body.find((n: { type: string, requester?: { username: string } }) => n.type === 'newSignupApplication' && n.requester?.username === username) as { reason: string | null } | undefined;
		assert.notStrictEqual(notification, undefined);
		assert.strictEqual(notification!.reason, 'よろしくお願いします');

		await successfulApiCall({
			endpoint: 'admin/juice/update-settings',
			parameters: { approvalRequiredForSignup: false, signupReasonRequired: true, signupReasonMaxLength: 4096 },
			user: root,
		}, { status: 204 });
	});

	test('お問い合わせを送信すると、モデレーターに新着通知が届く(送信者を特定できる情報は含まれない)', async () => {
		const subject = `テスト件名_${Date.now()}`;
		const submitted = await successfulApiCall({
			endpoint: 'contact-form/submit',
			parameters: {
				subject,
				content: 'これはe2eテストから送信したお問い合わせ本文です。20文字以上必要です。',
				replyMethod: 'misskey',
				misskeyUsername: alice.username,
			},
			user: undefined,
		});

		await allSettled();
		await setTimeout(500);

		const res = await api('i/notifications', {}, root);
		assert.strictEqual(res.status, 200);
		const notification = res.body.find((n: { type: string }) => n.type === 'newContactForm') as { contactFormId: string; subject: string } | undefined;
		assert.notStrictEqual(notification, undefined);
		assert.strictEqual(notification!.contactFormId, submitted.id);
		assert.strictEqual(notification!.subject, subject);
		// JUICE: PII保護のため、送信者を特定できるフィールド(email/misskeyUsername/name等)を一切含まない
		assert.strictEqual('user' in notification!, false);
		assert.strictEqual('email' in notification!, false);
	});

	test('通報を送信すると、モデレーターに新着通知が届く(通報コメント・通報者は含まれない)', async () => {
		const target = await signup();
		await successfulApiCall({
			endpoint: 'users/report-abuse',
			parameters: { userId: target.id, comment: 'テスト通報コメント', category: 'spam' },
			user: alice,
		}, { status: 204 });

		await allSettled();
		await setTimeout(500);

		const res = await api('i/notifications', {}, root);
		assert.strictEqual(res.status, 200);
		const notification = res.body.find((n: { type: string, targetUser?: { id: string } }) => n.type === 'newAbuseUserReport' && n.targetUser?.id === target.id) as { category: string | null } | undefined;
		assert.notStrictEqual(notification, undefined);
		assert.strictEqual(notification!.category, 'spam');
		// JUICE: PII保護のため、通報コメント・通報者を特定できるフィールドは含まない
		assert.strictEqual('comment' in notification!, false);
		assert.strictEqual('reporter' in notification!, false);
	});

	test('モデレーターでなくても、canApproveEmojiRequestsロールポリシーを持つユーザーに新着通知が届く', async () => {
		const approver = await signup({ username: 'notificationApprover' });
		const approverRole = await role(root, { isModerator: false, name: 'Notification Approver Role' }, {
			canApproveEmojiRequests: { priority: 0, useDefault: false, value: true },
		});
		await api('admin/roles/assign', { userId: approver.id, roleId: approverRole.id }, root);

		const file = await uploadFile(alice);
		const request = await successfulApiCall({
			endpoint: 'emoji-requests/create',
			parameters: { fileId: file.body!.id, name: `role_approver_${Date.now()}` },
			user: alice,
		});

		await allSettled();
		await setTimeout(500);

		const res = await api('i/notifications', {}, approver);
		assert.strictEqual(res.status, 200);
		const notification = res.body.find((n: { type: string }) => n.type === 'newEmojiRequest') as { requestId: string } | undefined;
		assert.notStrictEqual(notification, undefined);
		assert.strictEqual(notification!.requestId, request.id);
	});
});
