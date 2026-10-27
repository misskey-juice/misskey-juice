/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { UserOauthConnectionsRepository } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { getIpHash } from '@/misc/get-ip-hash.js';
import { IdService } from '@/core/IdService.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { resolveOauthLoginSettings } from '@/models/JuiceSettings.js';
import { OAuthLoginService } from '@/core/OAuthLoginService.js';
import Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { RateLimiterService } from './RateLimiterService.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

// JUICE: 連携ログイン。ログイン済みユーザーが自分のアカウントへプロバイダを紐付ける
// (oauth-login/link-startで開始した)フローの、プロバイダ側からのリダイレクト先
@Injectable()
export class OAuthLinkCallbackApiService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.userOauthConnectionsRepository)
		private userOauthConnectionsRepository: UserOauthConnectionsRepository,

		private idService: IdService,
		private rateLimiterService: RateLimiterService,
		private juiceSettingsService: JuiceSettingsService,
		private oAuthLoginService: OAuthLoginService,
		loggerService: LoggerService,
	) {
		this.logger = loggerService.getLogger('OAuthLinkCallback');
	}

	@bindThis
	private failRedirect(reply: FastifyReply, returnTo: string | null, reason: string) {
		const target = new URL(returnTo ?? '/settings/security', this.config.url);
		target.searchParams.set('oauthLinkError', reason);
		reply.redirect(target.toString());
	}

	@bindThis
	public async callback(request: FastifyRequest, reply: FastifyReply) {
		try {
			await this.rateLimiterService.limit({ key: 'oauth-link-callback', duration: 1000 * 60, max: 60, minInterval: 250 }, getIpHash(request.ip));
		} catch (_) {
			reply.code(429);
			return;
		}

		const query = request.query as { code?: string; state?: string; error?: string };

		if (query.state == null) {
			reply.code(400);
			return;
		}

		const state = await this.oAuthLoginService.consumeLinkState(query.state);
		if (state == null) {
			// stateを検証できない(期限切れ・二重使用)場合は、returnToも信用できないため既定の設定画面へ
			this.failRedirect(reply, null, 'stateExpired');
			return;
		}

		if (query.error != null || query.code == null) {
			this.failRedirect(reply, state.returnTo, 'providerDenied');
			return;
		}

		const settings = resolveOauthLoginSettings(await this.juiceSettingsService.fetch());
		const enabled = settings[`${state.provider}OauthEnabled`];
		const clientId = settings[`${state.provider}OauthClientId`];
		const clientSecret = settings[`${state.provider}OauthClientSecret`];
		if (!enabled || clientId == null || clientSecret == null) {
			this.failRedirect(reply, state.returnTo, 'providerDisabled');
			return;
		}

		let profile;
		try {
			profile = await this.oAuthLoginService.exchangeCodeAndFetchProfile(state.provider, query.code, clientId, clientSecret, 'link');
		} catch (err) {
			this.logger.warn(`oauth link exchange failed (${state.provider})`, { err });
			this.failRedirect(reply, state.returnTo, 'exchangeFailed');
			return;
		}

		// JUICE: 既に他ユーザーがこのプロバイダアカウントを連携済みなら奪えない
		const conflictOwner = await this.userOauthConnectionsRepository.findOneBy({ provider: state.provider, providerUserId: profile.providerUserId });
		if (conflictOwner != null && conflictOwner.userId !== state.userId) {
			this.failRedirect(reply, state.returnTo, 'alreadyLinkedToAnotherUser');
			return;
		}

		const own = await this.userOauthConnectionsRepository.findOneBy({ userId: state.userId, provider: state.provider });
		if (own != null) {
			await this.userOauthConnectionsRepository.update(own.id, {
				providerUserId: profile.providerUserId,
				providerUsername: profile.providerUsername,
				linkedAt: new Date(),
			});
		} else {
			await this.userOauthConnectionsRepository.insert({
				id: this.idService.gen(),
				userId: state.userId,
				provider: state.provider,
				providerUserId: profile.providerUserId,
				providerUsername: profile.providerUsername,
				linkedAt: new Date(),
			});
		}

		const target = new URL(state.returnTo ?? '/settings/security', this.config.url);
		target.searchParams.set('oauthLinked', state.provider);
		reply.redirect(target.toString());
	}
}
