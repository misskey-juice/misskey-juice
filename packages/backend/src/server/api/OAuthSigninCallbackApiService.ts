/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { SigninsRepository, UserOauthConnectionsRepository, UserProfilesRepository, UsersRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import { bindThis } from '@/decorators.js';
import { getIpHash } from '@/misc/get-ip-hash.js';
import { IdService } from '@/core/IdService.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { resolveOauthLoginSettings } from '@/models/JuiceSettings.js';
import { OAuthLoginService } from '@/core/OAuthLoginService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { EmailService } from '@/core/EmailService.js';
import { EmailI18nService } from '@/core/EmailI18nService.js';
import Logger from '@/logger.js';
import { LoggerService } from '@/core/LoggerService.js';
import { RateLimiterService } from './RateLimiterService.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

// JUICE: 連携ログイン。未ログインのユーザーが連携済みプロバイダでサインインする
// (oauth-login/signin-startで開始した)フローの、プロバイダ側からのリダイレクト先。
// ここではサインインを完了させず、/oauth-complete へ一度きりのcontextを発行してリダイレクトする
// (2段階認証があるアカウントはTOTP入力を経由する必要があるため)
@Injectable()
export class OAuthSigninCallbackApiService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.userOauthConnectionsRepository)
		private userOauthConnectionsRepository: UserOauthConnectionsRepository,

		@Inject(DI.signinsRepository)
		private signinsRepository: SigninsRepository,

		private idService: IdService,
		private rateLimiterService: RateLimiterService,
		private juiceSettingsService: JuiceSettingsService,
		private oAuthLoginService: OAuthLoginService,
		private notificationService: NotificationService,
		private emailService: EmailService,
		private emailI18nService: EmailI18nService,
		loggerService: LoggerService,
	) {
		this.logger = loggerService.getLogger('OAuthSigninCallback');
	}

	@bindThis
	private failRedirect(reply: FastifyReply, returnTo: string | null, reason: string) {
		const target = new URL('/oauth-complete', this.config.url);
		target.searchParams.set('error', reason);
		if (returnTo != null) target.searchParams.set('returnTo', returnTo);
		reply.redirect(target.toString());
	}

	// JUICE: SigninApiServiceのfail()と同様、失敗時は本人へ通知する(未認証の第三者が何度でも
	// 発火できるため、userId単位で間引く)。ただしここでは「アカウントが存在するかどうか」自体を
	// 漏らさないため、userIdが特定できた場合のみ呼び出す
	@bindThis
	private async notifyFailure(userId: string) {
		try {
			const notifyRateLimit = await this.rateLimiterService.limit({ key: 'loginFailedNotify', duration: 1000 * 60 * 5, max: 1 }, userId);
			if (notifyRateLimit != null) return;

			this.notificationService.createNotification(userId, 'loginFailed', {});

			const profile = await this.userProfilesRepository.findOneBy({ userId });
			if (profile?.email && profile.emailVerified) {
				const lang = await this.emailI18nService.resolveLang(profile.emailLang);
				const i18n = this.emailI18nService.getI18n(lang);
				this.emailService.sendEmail(profile.email, i18n.t('_email.newLoginFailed.subject'),
					i18n.t('_email.newLoginFailed.html', { ip: '' }),
					i18n.t('_email.newLoginFailed.text', { ip: '' }));
			}
		} catch (err) {
			this.logger.error('failed to notify oauth signin failure', { stack: err });
		}
	}

	@bindThis
	public async callback(request: FastifyRequest, reply: FastifyReply) {
		try {
			await this.rateLimiterService.limit({ key: 'oauth-signin-callback', duration: 1000 * 60, max: 60, minInterval: 250 }, getIpHash(request.ip));
		} catch (_) {
			reply.code(429);
			return;
		}

		const query = request.query as { code?: string; state?: string; error?: string };

		if (query.state == null) {
			reply.code(400);
			return;
		}

		const state = await this.oAuthLoginService.consumeSigninState(query.state);
		if (state == null) {
			this.failRedirect(reply, null, 'stateExpired');
			return;
		}

		if (query.error != null || query.code == null) {
			this.failRedirect(reply, state.returnTo, 'providerDenied');
			return;
		}

		const settings = resolveOauthLoginSettings(await this.juiceSettingsService.fetch());
		const clientId = settings[`${state.provider}OauthClientId`];
		const clientSecret = settings[`${state.provider}OauthClientSecret`];
		if (clientId == null || clientSecret == null) {
			this.failRedirect(reply, state.returnTo, 'providerDisabled');
			return;
		}

		let profile;
		try {
			profile = await this.oAuthLoginService.exchangeCodeAndFetchProfile(state.provider, query.code, clientId, clientSecret, 'signin');
		} catch (err) {
			this.logger.warn(`oauth signin exchange failed (${state.provider})`, { err });
			this.failRedirect(reply, state.returnTo, 'exchangeFailed');
			return;
		}

		const connection = await this.userOauthConnectionsRepository.findOneBy({ provider: state.provider, providerUserId: profile.providerUserId });
		if (connection == null) {
			this.failRedirect(reply, state.returnTo, 'noConnection');
			return;
		}

		const user = await this.usersRepository.findOneBy({ id: connection.userId, host: IsNull() }) as MiLocalUser | null;
		if (user == null || user.isSuspended || !user.approved) {
			await this.notifyFailure(connection.userId);
			await this.signinsRepository.insert({
				id: this.idService.gen(),
				userId: connection.userId,
				ip: request.ip,
				headers: request.headers as any,
				success: false,
			});
			this.failRedirect(reply, state.returnTo, 'signinRejected');
			return;
		}

		const userProfile = await this.userProfilesRepository.findOneByOrFail({ userId: user.id });
		if (!userProfile.useOauthLogin || !userProfile.twoFactorEnabled) {
			await this.notifyFailure(user.id);
			await this.signinsRepository.insert({
				id: this.idService.gen(),
				userId: user.id,
				ip: request.ip,
				headers: request.headers as any,
				success: false,
			});
			this.failRedirect(reply, state.returnTo, 'signinRejected');
			return;
		}

		// JUICE: ここではサインインを確定させず、/signin-with-oauth で
		// (2FA有効なアカウントは必ず)TOTP検証を経てから確定させる
		const context = await this.oAuthLoginService.issueSigninContext({ userId: user.id, returnTo: state.returnTo });

		const target = new URL('/oauth-complete', this.config.url);
		target.searchParams.set('context', context);
		reply.redirect(target.toString());
	}
}
