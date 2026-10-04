/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as nodemailer from 'nodemailer';
import juice from 'juice';
import sanitizeHtml from 'sanitize-html';
import { Inject, Injectable } from '@nestjs/common';
import { UtilityService } from '@/core/UtilityService.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type Logger from '@/logger.js';
import type { MiMeta, UserProfilesRepository } from '@/models/_.js';
import { LoggerService } from '@/core/LoggerService.js';
import { bindThis } from '@/decorators.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { escapeHtml } from '@/misc/escape-html.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { DisposableEmailDomainService } from '@/core/DisposableEmailDomainService.js';
import { resolveEmailAliasSettings } from '@/models/JuiceSettings.js';

@Injectable()
export class EmailService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private loggerService: LoggerService,
		private utilityService: UtilityService,
		private httpRequestService: HttpRequestService,
		private juiceSettingsService: JuiceSettingsService,
		private disposableEmailDomainService: DisposableEmailDomainService,
	) {
		this.logger = this.loggerService.getLogger('email');
	}

	@bindThis
	public async sendEmail(to: string, subject: string, html: string, text: string) {
		if (!this.meta.enableEmail) return;

		const iconUrl = `${this.config.url}/static-assets/mi-white.png`;
		const emailSettingUrl = `${this.config.url}/settings/email`;

		const enableAuth = this.meta.smtpUser != null && this.meta.smtpUser !== '';

		const sanitizedHtml = sanitizeHtml(html);

		const transporter = nodemailer.createTransport({
			host: this.meta.smtpHost,
			port: this.meta.smtpPort,
			secure: this.meta.smtpSecure,
			ignoreTLS: !enableAuth,
			proxy: this.config.proxySmtp,
			auth: enableAuth ? {
				user: this.meta.smtpUser,
				pass: this.meta.smtpPass,
			} : undefined,
		} as any);

		const htmlContent = `<!doctype html>
<html>
	<head>
		<meta charset="utf-8">
		<title>${ escapeHtml(subject) }</title>
		<style>
			html {
				background: #eee;
			}

			body {
				padding: 16px;
				margin: 0;
				font-family: sans-serif;
				font-size: 14px;
			}

			a {
				text-decoration: none;
				color: #86b300;
			}
			a:hover {
				text-decoration: underline;
			}

			main {
				max-width: 500px;
				margin: 0 auto;
				background: #fff;
				color: #555;
			}
				main > header {
					padding: 32px;
					background: #86b300;
				}
					main > header > img {
						max-width: 128px;
						max-height: 28px;
						vertical-align: bottom;
					}
				main > article {
					padding: 32px;
				}
					main > article > h1 {
						margin: 0 0 1em 0;
					}
				main > footer {
					padding: 32px;
					border-top: solid 1px #eee;
				}

			nav {
				box-sizing: border-box;
				max-width: 500px;
				margin: 16px auto 0 auto;
				padding: 0 32px;
			}
				nav > a {
					color: #888;
				}
		</style>
	</head>
	<body>
		<main>
			<header>
				<img src="${ escapeHtml(this.meta.logoImageUrl ?? this.meta.iconUrl ?? iconUrl) }"/>
			</header>
			<article>
				<h1>${ escapeHtml(subject) }</h1>
				<div>${ sanitizedHtml }</div>
			</article>
			<footer>
				<a href="${ escapeHtml(emailSettingUrl) }">${ 'Email setting' }</a>
			</footer>
		</main>
		<nav>
			<a href="${ escapeHtml(this.config.url) }">${ escapeHtml(this.config.host) }</a>
		</nav>
	</body>
</html>`;

		const inlinedHtml = juice(htmlContent);

		try {
			const info = await transporter.sendMail({
				from: this.meta.name ? {
					name: this.meta.name,
					address: this.meta.email!,
				} : this.meta.email!,
				to: to,
				subject: subject,
				text: text,
				html: inlinedHtml,
			});

			this.logger.info(`Message sent: ${info.messageId}`);
		} catch (err) {
			this.logger.error(err as Error);
			throw err;
		}
	}

	@bindThis
	public async validateEmailForAccount(emailAddress: string): Promise<{
		available: boolean;
		reason: null | 'used' | 'format' | 'disposable' | 'mx' | 'smtp' | 'banned' | 'network' | 'blacklist' | 'plusTag' | 'gmailDot';
	}> {
		if (!this.utilityService.validateEmailFormat(emailAddress)) {
			return {
				available: false,
				reason: 'format',
			};
		}

		if (await this.isEmailUsedByOtherAccount(emailAddress)) {
			return {
				available: false,
				reason: 'used',
			};
		}

		// JUICE: 使い捨てメールアドレスのドメインの一覧(disposable-email-domains)に載っていれば断る。
		// 下の検証方式(verifymail.io・Truemail・deep-email-validator)のどれを使っていても、検証を使っていなくても動く。
		// 一覧を読めないときは判定せずに先へ進む(登録を止めない)
		if (await this.disposableEmailDomainService.isDisposable(emailAddress).catch((err) => {
			this.logger.warn(`Failed to check the disposable email domain list: ${err}`);
			return false;
		})) {
			return {
				available: false,
				reason: 'disposable',
			};
		}

		let validated: {
			valid: boolean,
			reason?: string | null,
		} = { valid: true, reason: null };

		if (this.meta.enableActiveEmailValidation) {
			// 使い捨てメールアドレスの一覧で判定できているか(設定がオンでも、一覧をまだ取れていなければfalse)
			const blocklistReady = await this.disposableEmailDomainService.isReady().catch(() => false);
			const validateByDeepEmailValidator = async () => {
				const { validate: validateEmail } = await import('deep-email-validator');
				return await validateEmail({
					email: emailAddress,
					validateRegex: true,
					validateMx: true,
					validateTypo: false, // TLDを見ているみたいだけどclubとか弾かれるので
					// 捨てアドかどうかチェック。JUICE: 使い捨てメールアドレスの一覧(上で判定済み)を使っているときは、
					// 同梱の古い一覧では判定しない(管理画面の「使い捨てと判定しないドメイン」が効くように)
					validateDisposable: !blocklistReady,
					validateSMTP: false, // 日本だと25ポートが殆どのプロバイダーで塞がれていてタイムアウトになるので
				});
			};
			if (this.meta.enableVerifymailApi && this.meta.verifymailAuthKey != null) {
				// JUICE: verifymail.ioに問い合わせられなかったとき(利用回数の上限で429が返る・落ちている等)は、
				// 全ての登録・メールアドレス変更をエラーで止めずに、サーバー自身での検証(deep-email-validator)に切り替える
				validated = await this.verifyMail(emailAddress, this.meta.verifymailAuthKey).catch(async (err) => {
					// エラーの文には、問い合わせ先のURL(APIキーとメールアドレスを含む)が入ることがあるので、種類だけを記録する
					const detail = (err as { statusCode?: number; code?: string; name?: string } | null)?.statusCode ?? (err as { code?: string } | null)?.code ?? (err as { name?: string } | null)?.name ?? 'unknown';
					this.logger.warn(`verifymail.io request failed (${detail}), falling back to deep-email-validator`);
					return await validateByDeepEmailValidator();
				});
			} else if (this.meta.enableTruemailApi && this.meta.truemailInstance && this.meta.truemailAuthKey != null) {
				validated = await this.trueMail(this.meta.truemailInstance, emailAddress, this.meta.truemailAuthKey);
				// JUICE: Truemailに問い合わせられなかったとき(reasonが'network')も、同じくサーバー自身での検証に切り替える
				if (!validated.valid && validated.reason === 'network') {
					this.logger.warn('Truemail request failed, falling back to deep-email-validator');
					validated = await validateByDeepEmailValidator();
				}
			} else {
				validated = await validateByDeepEmailValidator();
			}
		}

		// JUICE: 管理画面の「使い捨てと判定しないドメイン」は、検証方式(verifymail.io等)が使い捨てと判定したときにも効かせる
		if (!validated.valid && validated.reason === 'disposable' && await this.disposableEmailDomainService.isAllowed(emailAddress).catch(() => false)) {
			validated = { valid: true, reason: null };
		}

		if (!validated.valid) {
			const formatReason: Record<string, 'format' | 'disposable' | 'mx' | 'smtp' | 'network' | 'blacklist' | undefined> = {
				regex: 'format',
				disposable: 'disposable',
				mx: 'mx',
				smtp: 'smtp',
				network: 'network',
				blacklist: 'blacklist',
			};

			return {
				available: false,
				reason: validated.reason ? formatReason[validated.reason] ?? null : null,
			};
		}

		const emailDomain: string = emailAddress.split('@')[1];
		const isBanned = this.utilityService.isBlockedHost(this.meta.bannedEmailDomains, emailDomain);

		if (isBanned) {
			return {
				available: false,
				reason: 'banned',
			};
		}

		// JUICE: 管理画面で+タグを禁止しているときは、+を含むアドレスを既存のアカウントの有無に関係なく受け付けない。
		// お問い合わせフォームではこの理由を許すので、ほかの検証(使い捨てアドレス等)の後に判定する
		if (await this.isPlusTagBlocked(emailAddress)) {
			return {
				available: false,
				reason: 'plusTag',
			};
		}

		// JUICE: 同じく、Gmailのドット無視を禁止しているときは、@より前に.を含むGmailのアドレスを受け付けない
		if (await this.isGmailDotBlocked(emailAddress)) {
			return {
				available: false,
				reason: 'gmailDot',
			};
		}

		return {
			available: true,
			reason: null,
		};
	}

	// JUICE: メールアドレスの別名(Gmail等のドット無視・+タグ)を使った多重アカウント登録対策。
	// email-address/available は未認証・レート制限無しで叩けるエンドポイントのため、検証済み
	// メールアドレスを全件アプリ側へ転送して比較するとコストが大きい。正規化(ドット除去・+タグ除去)を
	// SQL側で再現し、DBだけで重複判定を完結させる(normalizeEmailForDedupとロジックを二重管理する
	// トレードオフはあるが、UtilityService.dotFoldingEmailDomainsは共有しているため対象ドメインの
	// 一覧だけは分岐しない)
	/**
	 * JUICE: そのメールアドレスが、確認済みのほかのアカウントで使われているか。管理画面の設定に応じて、
	 * +タグ・Gmailのドット無視による別名も同じアドレスとみなす。
	 * 登録・メールアドレス変更の受付時だけでなく、確認のリンクを開いたとき(アカウントを作る・確認済みにする直前)にも呼ぶ。
	 * 受付時は、まだ確認していない登録・変更を数えないため、確認前の別名を複数並べると素通りしてしまうので
	 */
	@bindThis
	public async isEmailUsedByOtherAccount(emailAddress: string, exceptUserId?: string): Promise<boolean> {
		const juiceSettings = await this.juiceSettingsService.fetch();
		const { blockEmailDotAliasRegistration, blockEmailPlusAliasRegistration } = resolveEmailAliasSettings(juiceSettings);
		if (!blockEmailDotAliasRegistration && !blockEmailPlusAliasRegistration) {
			const query = this.userProfilesRepository.createQueryBuilder('profile')
				.where('profile.emailVerified = true')
				.andWhere('profile.email = :emailAddress', { emailAddress });
			if (exceptUserId != null) query.andWhere('profile.userId != :exceptUserId', { exceptUserId });
			return (await query.getCount()) !== 0;
		}

		const used = await this.existsAsEmailAlias(emailAddress, {
			foldDots: blockEmailDotAliasRegistration,
			stripPlusTag: blockEmailPlusAliasRegistration,
		}, exceptUserId);
		// 別名として判定した場合は、問い合わせ対応時に経緯を追えるようログにだけ残す(APIレスポンス上は通常の'used'と区別しない)
		if (used) this.logger.debug(`email blocked as alias duplicate: ${emailAddress}`);
		return used;
	}

	/**
	 * JUICE: 管理画面の設定で、+タグを含むメールアドレスを禁止していて、このアドレスのローカルパートに+があるか
	 */
	@bindThis
	public async isPlusTagBlocked(emailAddress: string): Promise<boolean> {
		const { blockEmailPlusAliasRegistration } = resolveEmailAliasSettings(await this.juiceSettingsService.fetch());
		const atIndex = emailAddress.lastIndexOf('@');
		return blockEmailPlusAliasRegistration && atIndex !== -1 && emailAddress.slice(0, atIndex).includes('+');
	}

	/**
	 * JUICE: 管理画面の設定で、Gmailのドット無視による別名を禁止していて、このアドレスが@より前に.を含むGmail(Googlemail)のアドレスか
	 */
	@bindThis
	public async isGmailDotBlocked(emailAddress: string): Promise<boolean> {
		const { blockEmailDotAliasRegistration } = resolveEmailAliasSettings(await this.juiceSettingsService.fetch());
		const atIndex = emailAddress.lastIndexOf('@');
		if (!blockEmailDotAliasRegistration || atIndex === -1) return false;
		const domain = emailAddress.slice(atIndex + 1).toLowerCase();
		return this.utilityService.dotFoldingEmailDomains.includes(domain) && emailAddress.slice(0, atIndex).includes('.');
	}

	private async existsAsEmailAlias(emailAddress: string, options: { foldDots: boolean; stripPlusTag: boolean }, exceptUserId?: string): Promise<boolean> {
		const normalizedCandidate = this.utilityService.normalizeEmailForDedup(emailAddress, options);

		const localPart = options.stripPlusTag
			? `regexp_replace(split_part(profile.email, '@', 1), '\\+.*$', '')`
			: `split_part(profile.email, '@', 1)`;
		const domainPart = `lower(split_part(profile.email, '@', 2))`;
		const normalizedLocalPart = options.foldDots
			? `(CASE WHEN ${domainPart} = ANY(:dotFoldingDomains) THEN replace(${localPart}, '.', '') ELSE ${localPart} END)`
			: localPart;

		const query = this.userProfilesRepository.createQueryBuilder('profile')
			.where('profile.emailVerified = true')
			.andWhere('profile.email IS NOT NULL')
			.andWhere(`lower(${normalizedLocalPart} || '@' || ${domainPart}) = :normalizedCandidate`, {
				...(options.foldDots ? { dotFoldingDomains: this.utilityService.dotFoldingEmailDomains } : {}),
				normalizedCandidate,
			});
		if (exceptUserId != null) query.andWhere('profile.userId != :exceptUserId', { exceptUserId });

		return (await query.getCount()) !== 0;
	}

	private async verifyMail(emailAddress: string, verifymailAuthKey: string): Promise<{
		valid: boolean;
		reason: 'used' | 'format' | 'disposable' | 'mx' | 'smtp' | null;
	}> {
		const endpoint = 'https://verifymail.io/api/' + emailAddress + '?key=' + verifymailAuthKey;
		const res = await this.httpRequestService.send(endpoint, {
			method: 'GET',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Accept: 'application/json, */*',
			},
		});

		const json = (await res.json()) as Partial<{
			message: string;
			block: boolean;
			catch_all: boolean;
			deliverable_email: boolean;
			disposable: boolean;
			domain: string;
			email_address: string;
			email_provider: string;
			mx: boolean;
			mx_fallback: boolean;
			mx_host: string[];
			mx_ip: string[];
			mx_priority: { [key: string]: number };
			privacy: boolean;
			related_domains: string[];
		}>;

		/* api error: when there is only one `message` attribute in the returned result */
		// JUICE: APIのエラー(キーが無効・利用回数の上限など)は、全てのアドレスを無効にせず、例外にして呼び出し側で
		// サーバー自身での検証に切り替える(エラーの文は、キーなどを含まないよう記録しない)
		if (Object.keys(json).length === 1 && Reflect.has(json, 'message')) {
			throw Object.assign(new Error('verifymail.io returned an API error'), { code: 'VERIFYMAIL_API_ERROR' });
		}
		if (json.email_address === undefined) {
			return {
				valid: false,
				reason: 'format',
			};
		}
		if (json.deliverable_email !== undefined && !json.deliverable_email) {
			return {
				valid: false,
				reason: 'smtp',
			};
		}
		if (json.disposable) {
			return {
				valid: false,
				reason: 'disposable',
			};
		}
		if (json.mx !== undefined && !json.mx) {
			return {
				valid: false,
				reason: 'mx',
			};
		}

		return {
			valid: true,
			reason: null,
		};
	}

	private async trueMail<T>(truemailInstance: string, emailAddress: string, truemailAuthKey: string): Promise<{
		valid: boolean;
		reason: 'used' | 'format' | 'blacklist' | 'mx' | 'smtp' | 'network' | T | null;
	}> {
		const endpoint = truemailInstance + '?email=' + emailAddress;
		try {
			const res = await this.httpRequestService.send(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
					Authorization: truemailAuthKey,
				},
				isLocalAddressAllowed: true,
			});

			const json = (await res.json()) as {
				email: string;
				success: boolean;
				error?: string;
				errors?: {
					list_match?: string;
					regex?: string;
					mx?: string;
					smtp?: string;
				} | null;
			};

			if (json.email === undefined || json.errors?.regex) {
				return {
					valid: false,
					reason: 'format',
				};
			}
			if (json.errors?.smtp) {
				return {
					valid: false,
					reason: 'smtp',
				};
			}
			if (json.errors?.mx) {
				return {
					valid: false,
					reason: 'mx',
				};
			}
			if (!json.success) {
				return {
					valid: false,
					reason: json.errors?.list_match as T || 'blacklist',
				};
			}

			return {
				valid: true,
				reason: null,
			};
		} catch (_) {
			return {
				valid: false,
				reason: 'network',
			};
		}
	}
}
