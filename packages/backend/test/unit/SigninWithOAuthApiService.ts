/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IncomingHttpHeaders } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyReply, FastifyRequest } from 'fastify';
import { HttpHeader } from 'fastify/types/utils.js';
import { MiUser } from '@/models/User.js';
import { MiUserProfile, UserProfilesRepository, UsersRepository } from '@/models/_.js';
import { IdService } from '@/core/IdService.js';
import { GlobalModule } from '@/GlobalModule.js';
import { DI } from '@/di-symbols.js';
import { CoreModule } from '@/core/CoreModule.js';
import { SigninWithOAuthApiService } from '@/server/api/SigninWithOAuthApiService.js';
import { RateLimiterService } from '@/server/api/RateLimiterService.js';
import { UserAuthService } from '@/core/UserAuthService.js';
import { OAuthLoginService } from '@/core/OAuthLoginService.js';
import { SigninService } from '@/server/api/SigninService.js';

class FakeLimiter {
	public async limit() {
		return;
	}
}

class FakeSigninService {
	public signin(..._args: any): any {
		return { finished: true, id: 'dummy', i: 'dummy-token' };
	}
}

class DummyFastifyReply {
	public statusCode: number;
	code(num: number): void {
		this.statusCode = num;
	}
	header(_key: HttpHeader, _value: any): void {
	}
}
class DummyFastifyRequest {
	public ip: string;
	public body: { context?: string; token?: string };
	public headers: IncomingHttpHeaders = { 'accept': 'application/json' };
	constructor(body?: any) {
		this.ip = '0.0.0.0';
		this.body = body ?? {};
	}
}

type ApiFastifyRequestType = FastifyRequest<{
	Body: {
		context?: string;
		token?: string;
	};
}>;

describe('SigninWithOAuthApiService', () => {
	let app: TestingModule;
	let service: SigninWithOAuthApiService;
	let usersRepository: UsersRepository;
	let userProfilesRepository: UserProfilesRepository;
	let oAuthLoginService: OAuthLoginService;
	let userAuthService: UserAuthService;
	let idService: IdService;

	async function createUser(data: Partial<MiUser> = {}) {
		return await usersRepository.save({ ...data });
	}

	async function createUserProfile(data: Partial<MiUserProfile> = {}) {
		return await userProfilesRepository.save({ ...data });
	}

	beforeAll(async () => {
		app = await Test.createTestingModule({
			imports: [GlobalModule, CoreModule],
			providers: [
				SigninWithOAuthApiService,
				{ provide: RateLimiterService, useClass: FakeLimiter },
				{ provide: SigninService, useClass: FakeSigninService },
			],
		}).useMocker((token) => {
			if (typeof token === 'function') {
				return mockDeep<typeof token>();
			}
		}).compile();

		service = app.get<SigninWithOAuthApiService>(SigninWithOAuthApiService);
		usersRepository = app.get<UsersRepository>(DI.usersRepository);
		userProfilesRepository = app.get<UserProfilesRepository>(DI.userProfilesRepository);
		oAuthLoginService = app.get<OAuthLoginService>(OAuthLoginService);
		userAuthService = app.get<UserAuthService>(UserAuthService);
		idService = app.get<IdService>(IdService);
	});

	afterAll(async () => {
		await app.close();
	});

	async function setupUser(twoFactorEnabled: boolean) {
		const uid = idService.gen();
		await createUser({ id: uid, username: uid, usernameLower: uid.toLowerCase(), uri: null, host: null, isSuspended: false, approved: true });
		await createUserProfile({ userId: uid, twoFactorEnabled, useOauthLogin: twoFactorEnabled });
		return uid;
	}

	it('存在しない・期限切れのcontextは403になる', async () => {
		const req = new DummyFastifyRequest({ context: '00000000-0000-4000-8000-000000000000' }) as ApiFastifyRequestType;
		const res = new DummyFastifyReply() as unknown as FastifyReply;
		const body = await service.signin(req, res);
		expect(res.statusCode).toBe(403);
		expect((body as any).error?.id).toStrictEqual('2d16e51c-007b-4edd-afd2-f7dd02c947f6');
	});

	it('2段階認証が無効なアカウントは不整合な状態としてサインインを拒否する', async () => {
		const uid = await setupUser(false);
		const context = await oAuthLoginService.issueSigninContext({ userId: uid, returnTo: null });

		const req = new DummyFastifyRequest({ context }) as ApiFastifyRequestType;
		const res = new DummyFastifyReply() as unknown as FastifyReply;
		const body = await service.signin(req, res);
		expect(res.statusCode).toBe(403);
		expect((body as any).error?.id).toStrictEqual('1a05cc1b-65e8-42c2-966a-dfa66f692999');

		// 不整合な状態で発行されたcontextは消費され、再利用できない
		const consumed = await oAuthLoginService.getSigninContext(context);
		expect(consumed).toBeNull();
	});

	it('2段階認証が有効なアカウントは、tokenが無ければ next: totp を返す(サインインは確定しない)', async () => {
		const uid = await setupUser(true);
		const context = await oAuthLoginService.issueSigninContext({ userId: uid, returnTo: null });

		const req = new DummyFastifyRequest({ context }) as ApiFastifyRequestType;
		const res = new DummyFastifyReply() as unknown as FastifyReply;
		const body = await service.signin(req, res);
		expect(res.statusCode).toBe(200);
		expect((body as any).finished).toBe(false);
		expect((body as any).next).toBe('totp');

		// JUICE: next:'totp'の時点ではcontextはまだ消費されていない(2回目のリクエストで再度参照できる)
		const stillValid = await oAuthLoginService.getSigninContext(context);
		expect(stillValid).not.toBeNull();
	});

	it('正しいTOTPトークンが提出されるとサインインが確定し、contextは使い捨てになる', async () => {
		const uid = await setupUser(true);
		const context = await oAuthLoginService.issueSigninContext({ userId: uid, returnTo: null });
		vi.spyOn(userAuthService, 'twoFactorAuthenticate').mockResolvedValue(undefined);

		const req = new DummyFastifyRequest({ context, token: '123456' }) as ApiFastifyRequestType;
		const res = new DummyFastifyReply() as unknown as FastifyReply;
		const body = await service.signin(req, res);
		expect((body as any).finished).toBe(true);

		// JUICE: contextは1回きりで消費済みになっているため、同じcontextを再送しても無効になる
		const consumed = await oAuthLoginService.getSigninContext(context);
		expect(consumed).toBeNull();
	});

	it('誤ったTOTPトークンはサインインを確定させない(2FAバイパス防止)', async () => {
		const uid = await setupUser(true);
		const context = await oAuthLoginService.issueSigninContext({ userId: uid, returnTo: null });
		vi.spyOn(userAuthService, 'twoFactorAuthenticate').mockRejectedValue(new Error('invalid token'));

		const req = new DummyFastifyRequest({ context, token: 'wrong' }) as ApiFastifyRequestType;
		const res = new DummyFastifyReply() as unknown as FastifyReply;
		const body = await service.signin(req, res);
		expect(res.statusCode).toBe(403);
		expect((body as any).error?.id).toStrictEqual('cdf1235b-ac71-46d4-a3a6-84ccce48df6f');

		// JUICE: 失敗してもcontext自体は生き続ける(再挑戦できる)
		const stillValid = await oAuthLoginService.getSigninContext(context);
		expect(stillValid).not.toBeNull();
	});

	it('凍結・未承認アカウントは403になり、contextは消費される', async () => {
		const uid = idService.gen();
		await createUser({ id: uid, username: uid, usernameLower: uid.toLowerCase(), uri: null, host: null, isSuspended: true, approved: true });
		await createUserProfile({ userId: uid, twoFactorEnabled: true, useOauthLogin: true });
		const context = await oAuthLoginService.issueSigninContext({ userId: uid, returnTo: null });

		const req = new DummyFastifyRequest({ context }) as ApiFastifyRequestType;
		const res = new DummyFastifyReply() as unknown as FastifyReply;
		const body = await service.signin(req, res);
		expect(res.statusCode).toBe(403);
		expect((body as any).error?.id).toStrictEqual('9f2f084b-af33-4f06-93cf-8a7fe04c6786');

		const consumed = await oAuthLoginService.getSigninContext(context);
		expect(consumed).toBeNull();
	});
});
