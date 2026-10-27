/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import * as Misskey from 'misskey-js';
import { DI } from '@/di-symbols.js';
import type {
	SigninsRepository,
	UserProfilesRepository,
	UsersRepository,
} from '@/models/_.js';
import type { Config } from '@/config.js';
import { getIpHash } from '@/misc/get-ip-hash.js';
import type { MiLocalUser } from '@/models/User.js';
import { IdService } from '@/core/IdService.js';
import { bindThis } from '@/decorators.js';
import { UserAuthService } from '@/core/UserAuthService.js';
import { OAuthLoginService } from '@/core/OAuthLoginService.js';
import Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { RateLimiterService } from './RateLimiterService.js';
import { SigninService } from './SigninService.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

// JUICE: 連携ログイン。OAuthSigninCallbackApiServiceが発行したcontextを消費してサインインを
// 確定させる。SigninWithPasskeyApiServiceと同様に2回のリクエスト(1回目: 2FA要否の確認、
// 2回目: TOTP検証)で完結する構造
@Injectable()
export class SigninWithOAuthApiService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		private idService: IdService,
		private rateLimiterService: RateLimiterService,
		private signinService: SigninService,
		private userAuthService: UserAuthService,
		private oAuthLoginService: OAuthLoginService,
		loggerService: LoggerService,
	) {
		this.logger = loggerService.getLogger('SigninWithOAuth');
	}

	@bindThis
	public async signin(
		request: FastifyRequest<{
			Body: {
				context?: string;
				token?: string;
			};
		}>,
		reply: FastifyReply,
	) {
		function error(status: number, err: { id: string }) {
			reply.code(status);
			return { error: err };
		}

		const context = request.body['context'];
		const token = request.body['token'];

		if (typeof context !== 'string') {
			reply.code(400);
			return;
		}

		if (this.config.enableIpRateLimit) {
			try {
				// NOTE: 1 Sign-in require up to 2 API calls
				await this.rateLimiterService.limit({ key: 'signin-with-oauth', duration: 60 * 30 * 1000, max: 200, minInterval: 250 }, getIpHash(request.ip));
			} catch (_) {
				reply.code(429);
				return {
					error: {
						message: 'Too many failed attempts to sign in. Try again later.',
						code: 'TOO_MANY_AUTHENTICATION_FAILURES',
						id: '22d05606-fbcf-421a-a2db-b32610dcfd1b',
					},
				};
			}
		}

		const ctx = await this.oAuthLoginService.getSigninContext(context);
		if (ctx == null) {
			return error(403, { id: '2d16e51c-007b-4edd-afd2-f7dd02c947f6' });
		}

		const user = await this.usersRepository.findOneBy({ id: ctx.userId, host: IsNull() }) as MiLocalUser | null;
		if (user == null || user.isSuspended || !user.approved) {
			await this.oAuthLoginService.consumeSigninContext(context);
			return error(403, { id: '9f2f084b-af33-4f06-93cf-8a7fe04c6786' });
		}

		const profile = await this.userProfilesRepository.findOneByOrFail({ userId: user.id });

		const fail = async (status: number, failure: { id: string }) => {
			await this.signinsRepository.insert({
				id: this.idService.gen(),
				userId: user.id,
				ip: request.ip,
				headers: request.headers as any,
				success: false,
			});
			return error(status, failure);
		};

		if (!profile.twoFactorEnabled) {
			// useOauthLogin=trueにできるのは2FA有効なアカウントのみ。
			// 2FA無効なのにコンテキストが発行されているのは不整合な状態（2FA解除時に
			// useOauthLogin が残存していた等）なので、サインインさせず fail-closed に倒す。
			await this.oAuthLoginService.consumeSigninContext(context);
			return await fail(403, { id: '1a05cc1b-65e8-42c2-966a-dfa66f692999' });
		}

		if (!token) {
			reply.code(200);
			return {
				finished: false,
				next: 'totp',
			} satisfies Misskey.entities.SigninFlowResponse;
		}

		try {
			await this.userAuthService.twoFactorAuthenticate(profile, token);
		} catch (_) {
			return await fail(403, { id: 'cdf1235b-ac71-46d4-a3a6-84ccce48df6f' });
		}

		await this.oAuthLoginService.consumeSigninContext(context);
		const res = this.signinService.signin(request, reply, user);
		// JUICE: 遷移先はURLクエリではなく、開始時にサーバー側で検証して
		// コンテキストに保存した returnTo を返す(オープンリダイレクト対策)
		return { ...res, returnTo: ctx.returnTo } satisfies Misskey.entities.SigninWithOAuthResponse;
	}
}
