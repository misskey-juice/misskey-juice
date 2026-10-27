/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as assert from 'node:assert';
import { describe, beforeAll, afterEach, test } from 'vitest';
import { DataSource } from 'typeorm';
import * as OTPAuth from 'otpauth';
import { SignupSuccessResponse } from 'misskey-js/entities.js';
import { MiUserOauthConnection } from '@/models/UserOauthConnection.js';
import { MiUserProfile } from '@/models/UserProfile.js';
import { IdService } from '@/core/IdService.js';
import { loadConfig } from '@/config.js';
import { successfulApiCall, failedApiCall, signup, initTestDb, api, relativeFetch, origin } from '../utils.js';

const idService = new IdService(loadConfig());

// JUICE: 連携ログイン(Discord/Google/GitHub/GitLab/Microsoft)。実プロバイダへの通信が必要な「認可コード交換〜
// プロフィール取得」部分は本テストでは検証できない(外部ネットワークに依存するため)。ここでは
// state/context検証・admin設定によるプロバイダ有効化・DB直シードでの接続一覧/解除・
// 2段階認証を前提条件とするuseOauthLoginのゲートといった、このインスタンス内で完結する部分を
// e2eで検証する。トークン交換〜プロフィール抽出のロジック自体はtest/unit/OAuthLoginService.tsで、
// signin-with-oauthの2FA分岐・contextの使い捨てはtest/unit/SigninWithOAuthApiService.tsで検証済み
describe('連携ログイン(OAuth) (JUICE)', () => {
	let db: DataSource;
	let root: SignupSuccessResponse;

	beforeAll(async () => {
		db = await initTestDb(true);
		root = await signup({ username: 'root' });
	}, 1000 * 60 * 2);

	afterEach(async () => {
		// 他のテストに影響しないよう、admin設定を既定(無効)へ戻す
		await successfulApiCall({
			endpoint: 'admin/juice/update-settings',
			parameters: {
				discordOauthEnabled: false,
				discordOauthClientId: null,
				discordOauthClientSecret: null,
				gitlabOauthEnabled: false,
				gitlabOauthClientId: null,
				gitlabOauthClientSecret: null,
				microsoftOauthEnabled: false,
				microsoftOauthClientId: null,
				microsoftOauthClientSecret: null,
			},
			user: root,
		}, { status: 204 });
	});

	describe('oauth-login/link-start', () => {
		test('プロバイダが無効な間はPROVIDER_DISABLEDで弾かれる', async () => {
			const alice = await signup();
			await failedApiCall({
				endpoint: 'oauth-login/link-start',
				parameters: { provider: 'discord' },
				user: alice,
			}, {
				status: 400,
				code: 'PROVIDER_DISABLED',
				id: '2eefaa74-3e99-4f2d-be25-bdc9d92b479e',
			});
		});

		test('有効化されていれば正しい認可URLを発行する', async () => {
			const alice = await signup();
			await successfulApiCall({
				endpoint: 'admin/juice/update-settings',
				parameters: {
					discordOauthEnabled: true,
					discordOauthClientId: 'dummy-client-id',
					discordOauthClientSecret: 'dummy-client-secret',
				},
				user: root,
			}, { status: 204 });

			const res = await successfulApiCall({
				endpoint: 'oauth-login/link-start',
				parameters: { provider: 'discord' },
				user: alice,
			});
			const url = new URL(res.url);
			assert.strictEqual(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
			assert.strictEqual(url.searchParams.get('client_id'), 'dummy-client-id');
			assert.strictEqual(url.searchParams.get('response_type'), 'code');
			assert.ok(url.searchParams.get('state'));
			assert.strictEqual(url.searchParams.get('redirect_uri'), `${new URL('api/oauth-login/link-callback', origin)}`);
		});

		test('gitlab: 有効化されていれば正しい認可URLを発行する', async () => {
			const alice = await signup();
			await successfulApiCall({
				endpoint: 'admin/juice/update-settings',
				parameters: {
					gitlabOauthEnabled: true,
					gitlabOauthClientId: 'dummy-client-id',
					gitlabOauthClientSecret: 'dummy-client-secret',
				},
				user: root,
			}, { status: 204 });

			const res = await successfulApiCall({
				endpoint: 'oauth-login/link-start',
				parameters: { provider: 'gitlab' },
				user: alice,
			});
			const url = new URL(res.url);
			assert.strictEqual(url.origin + url.pathname, 'https://gitlab.com/oauth/authorize');
			assert.strictEqual(url.searchParams.get('client_id'), 'dummy-client-id');
		});

		test('microsoft: 有効化されていれば正しい認可URLを発行する', async () => {
			const alice = await signup();
			await successfulApiCall({
				endpoint: 'admin/juice/update-settings',
				parameters: {
					microsoftOauthEnabled: true,
					microsoftOauthClientId: 'dummy-client-id',
					microsoftOauthClientSecret: 'dummy-client-secret',
				},
				user: root,
			}, { status: 204 });

			const res = await successfulApiCall({
				endpoint: 'oauth-login/link-start',
				parameters: { provider: 'microsoft' },
				user: alice,
			});
			const url = new URL(res.url);
			assert.strictEqual(url.origin + url.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
			assert.strictEqual(url.searchParams.get('client_id'), 'dummy-client-id');
		});
	});

	describe('oauth-login/signin-start', () => {
		test('プロバイダが無効な間はPROVIDER_DISABLEDで弾かれる(未ログインでも呼べる)', async () => {
			await failedApiCall({
				endpoint: 'oauth-login/signin-start',
				parameters: { provider: 'discord' },
				user: undefined,
			}, {
				status: 400,
				code: 'PROVIDER_DISABLED',
				id: '3e916c17-8fca-4eb2-a0d6-459f19e10d64',
			});
		});

		test('有効化されていれば未ログインでも認可URLを発行する', async () => {
			await successfulApiCall({
				endpoint: 'admin/juice/update-settings',
				parameters: {
					discordOauthEnabled: true,
					discordOauthClientId: 'dummy-client-id',
					discordOauthClientSecret: 'dummy-client-secret',
				},
				user: root,
			}, { status: 204 });

			const res = await successfulApiCall({
				endpoint: 'oauth-login/signin-start',
				parameters: { provider: 'discord' },
				user: undefined,
			});
			const url = new URL(res.url);
			assert.strictEqual(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
			assert.ok(url.searchParams.get('state'));
		});
	});

	describe('oauth-login/link-callback', () => {
		test('stateが無い場合は400', async () => {
			const res = await relativeFetch('api/oauth-login/link-callback', { redirect: 'manual' });
			assert.strictEqual(res.status, 400);
		});

		test('stateが無効・期限切れの場合、設定画面へエラー付きでリダイレクトする', async () => {
			const res = await relativeFetch('api/oauth-login/link-callback?state=00000000-0000-4000-8000-000000000000&code=dummy', { redirect: 'manual' });
			assert.strictEqual(res.status, 302);
			const location = new URL(res.headers.get('location')!);
			assert.strictEqual(location.pathname, '/settings/security');
			assert.strictEqual(location.searchParams.get('oauthLinkError'), 'stateExpired');
		});
	});

	describe('oauth-login/signin-callback', () => {
		test('stateが無い場合は400', async () => {
			const res = await relativeFetch('api/oauth-login/signin-callback', { redirect: 'manual' });
			assert.strictEqual(res.status, 400);
		});

		test('stateが無効・期限切れの場合、/oauth-completeへエラー付きでリダイレクトする', async () => {
			const res = await relativeFetch('api/oauth-login/signin-callback?state=00000000-0000-4000-8000-000000000000&code=dummy', { redirect: 'manual' });
			assert.strictEqual(res.status, 302);
			const location = new URL(res.headers.get('location')!);
			assert.strictEqual(location.pathname, '/oauth-complete');
			assert.strictEqual(location.searchParams.get('error'), 'stateExpired');
		});
	});

	describe('oauth-login/list-connections, oauth-login/unlink', () => {
		test('接続一覧を取得・解除できる。最後の1件を解除するとuseOauthLoginも自動でfalseに戻る', async () => {
			const alice = await signup();
			await db.getRepository(MiUserOauthConnection).insert({
				id: idService.gen(),
				userId: alice.id,
				provider: 'discord',
				providerUserId: 'discord-uid-1',
				providerUsername: 'alice#discord',
				linkedAt: new Date(),
			});
			await db.getRepository(MiUserProfile).update({ userId: alice.id }, { twoFactorEnabled: true });

			const list1 = await successfulApiCall({ endpoint: 'oauth-login/list-connections', parameters: {}, user: alice });
			assert.strictEqual(list1.length, 1);
			assert.strictEqual(list1[0].provider, 'discord');
			assert.strictEqual(list1[0].providerUsername, 'alice#discord');

			await successfulApiCall({ endpoint: 'i/oauth/set-login-enabled', parameters: { value: true }, user: alice }, { status: 204 });

			await successfulApiCall({ endpoint: 'oauth-login/unlink', parameters: { provider: 'discord' }, user: alice }, { status: 204 });

			const list2 = await successfulApiCall({ endpoint: 'oauth-login/list-connections', parameters: {}, user: alice });
			assert.strictEqual(list2.length, 0);

			const me = await successfulApiCall({ endpoint: 'i', parameters: {}, user: alice });
			assert.strictEqual((me as any).useOauthLogin, false);
		});

		test('存在しない接続を解除しようとするとNO_SUCH_CONNECTION', async () => {
			const alice = await signup();
			await failedApiCall({
				endpoint: 'oauth-login/unlink',
				parameters: { provider: 'google' },
				user: alice,
			}, {
				status: 400,
				code: 'NO_SUCH_CONNECTION',
				id: '8b7a1deb-ecf8-494a-be6b-32de1ff96c84',
			});
		});
	});

	describe('i/oauth/set-login-enabled', () => {
		test('2段階認証が無効なアカウントは有効化できない', async () => {
			const alice = await signup();
			await failedApiCall({
				endpoint: 'i/oauth/set-login-enabled',
				parameters: { value: true },
				user: alice,
			}, {
				status: 400,
				code: 'TWO_FACTOR_REQUIRED',
				id: 'b7775934-2877-4f4f-ac2b-35d04dce25bd',
			});
		});

		test('2段階認証が有効でも連携が無ければ有効化できない', async () => {
			const alice = await signup();
			await db.getRepository(MiUserProfile).update({ userId: alice.id }, { twoFactorEnabled: true });
			await failedApiCall({
				endpoint: 'i/oauth/set-login-enabled',
				parameters: { value: true },
				user: alice,
			}, {
				status: 400,
				code: 'NO_CONNECTION',
				id: '8b7d13a7-77c2-4c00-964e-c43898259995',
			});
		});

		test('2段階認証・連携どちらも揃っていれば有効化でき、無効化はいつでもできる', async () => {
			const alice = await signup();
			await db.getRepository(MiUserProfile).update({ userId: alice.id }, { twoFactorEnabled: true });
			await db.getRepository(MiUserOauthConnection).insert({
				id: idService.gen(),
				userId: alice.id,
				provider: 'github',
				providerUserId: 'gh-uid-1',
				providerUsername: 'alice-gh',
				linkedAt: new Date(),
			});

			await successfulApiCall({ endpoint: 'i/oauth/set-login-enabled', parameters: { value: true }, user: alice }, { status: 204 });
			const me = await successfulApiCall({ endpoint: 'i', parameters: {}, user: alice });
			assert.strictEqual((me as any).useOauthLogin, true);

			await successfulApiCall({ endpoint: 'i/oauth/set-login-enabled', parameters: { value: false }, user: alice }, { status: 204 });
			const me2 = await successfulApiCall({ endpoint: 'i', parameters: {}, user: alice });
			assert.strictEqual((me2 as any).useOauthLogin, false);
		});
	});

	describe('2段階認証を解除したとき', () => {
		// 2段階認証(TOTP)と連携ログインを両方有効にしたユーザーを作る
		async function signupWithOauthLogin(providerUserId: string) {
			const user = await signup();
			const secret = new OTPAuth.Secret();
			await db.getRepository(MiUserProfile).update({ userId: user.id }, { twoFactorEnabled: true, twoFactorSecret: secret.base32 });
			await db.getRepository(MiUserOauthConnection).insert({
				id: idService.gen(),
				userId: user.id,
				provider: 'github',
				providerUserId,
				providerUsername: `${user.username}-gh`,
				linkedAt: new Date(),
			});
			await successfulApiCall({ endpoint: 'i/oauth/set-login-enabled', parameters: { value: true }, user }, { status: 204 });
			return { user, secret };
		}

		test('本人が解除すると、連携ログインも無効になる', async () => {
			const { user: alice, secret } = await signupWithOauthLogin('gh-uid-unregister');
			const token = OTPAuth.TOTP.generate({ secret, digits: 6, period: 30, algorithm: 'SHA1' });

			await successfulApiCall({ endpoint: 'i/2fa/unregister', parameters: { password: 'test', token }, user: alice }, { status: 204 });

			const profile = await db.getRepository(MiUserProfile).findOneByOrFail({ userId: alice.id });
			assert.strictEqual(profile.twoFactorEnabled, false);
			assert.strictEqual(profile.useOauthLogin, false);
		});

		test('モデレーターがリセットすると、連携ログインも無効になる', async () => {
			const { user: alice } = await signupWithOauthLogin('gh-uid-unset-mfa');

			await successfulApiCall({ endpoint: 'admin/unset-mfa', parameters: { userId: alice.id }, user: root }, { status: 204 });

			const profile = await db.getRepository(MiUserProfile).findOneByOrFail({ userId: alice.id });
			assert.strictEqual(profile.twoFactorEnabled, false);
			assert.strictEqual(profile.useOauthLogin, false);
		});
	});

	describe('signin-with-oauth', () => {
		test('存在しないcontextは403', async () => {
			const res = await api('signin-with-oauth' as any, { context: '00000000-0000-4000-8000-000000000000' } as any);
			assert.strictEqual(res.status, 403);
		});
	});
});
