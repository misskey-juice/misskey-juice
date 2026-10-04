/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MiMeta } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { ContactFormService } from '@/core/ContactFormService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { CaptchaService } from '@/core/CaptchaService.js';
import { EmailService } from '@/core/EmailService.js';
import { DisposableEmailDomainService } from '@/core/DisposableEmailDomainService.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { resolveContactFormSettings } from '@/models/JuiceSettings.js';

// JUICE: misskey-tempuraのコンタクトフォームを参考に追加
export const meta = {
	tags: ['contact'],
	requireCredential: false,

	limit: {
		duration: 60 * 60 * 1000,
		max: 3, // ApiCallServiceでcontactFormLimitにより動的に上書きされる
	},

	res: {
		type: 'object',
		properties: {
			id: { type: 'string', format: 'misskey:id' },
		},
	},

	errors: {
		contactFormDisabled: {
			message: 'Contact form is disabled.',
			code: 'CONTACT_FORM_DISABLED',
			id: '097fc507-fbc9-4f8c-b565-f7d89d928c1e',
		},
		invalidReplyMethod: {
			message: 'Invalid reply method or missing/invalid required field.',
			code: 'INVALID_REPLY_METHOD',
			id: '010e1246-cf6d-424a-ae39-e11fab022594',
		},
		invalidContent: {
			message: 'Subject or content is empty or too short after trimming whitespace.',
			code: 'INVALID_CONTENT',
			id: '88decb85-49b8-4813-b28c-b450ae87d8d5',
		},
		authRequired: {
			message: 'Authentication required.',
			code: 'AUTH_REQUIRED',
			id: '1d6f0539-b4a3-4f9a-b8a6-9d55c36b0c86',
		},
		captchaFailed: {
			message: 'CAPTCHA verification failed.',
			code: 'CAPTCHA_FAILED',
			id: '306ca25f-d454-40d1-8e59-eb5f0fabfaaf',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		subject: { type: 'string', minLength: 1, maxLength: 256 },
		content: { type: 'string', minLength: 20, maxLength: 10000 },
		replyMethod: { type: 'string', enum: ['email', 'misskey'] },
		email: { type: 'string', maxLength: 320, nullable: true },
		misskeyUsername: { type: 'string', maxLength: 128, nullable: true },
		name: { type: 'string', maxLength: 256, nullable: true },
		category: { type: 'string', maxLength: 64, nullable: true },

		'hcaptcha-response': { type: 'string', nullable: true },
		'g-recaptcha-response': { type: 'string', nullable: true },
		'm-captcha-response': { type: 'string', nullable: true },
		'turnstile-response': { type: 'string', nullable: true },
		'testcaptcha-response': { type: 'string', nullable: true },
	},
	required: ['subject', 'content', 'replyMethod'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		private juiceSettingsService: JuiceSettingsService,
		private contactFormService: ContactFormService,
		private utilityService: UtilityService,
		private captchaService: CaptchaService,
		private emailService: EmailService,
		private disposableEmailDomainService: DisposableEmailDomainService,
	) {
		super(meta, paramDef, async (ps, me, _accessToken, _file, _cleanup, ip, headers) => {
			const { contactFormEnabled, contactFormRequireAuth, contactFormContentMaxLength } = resolveContactFormSettings(await this.juiceSettingsService.fetch());

			if (!contactFormEnabled) throw new ApiError(meta.errors.contactFormDisabled);
			if (contactFormRequireAuth && !me) throw new ApiError(meta.errors.authRequired);

			// JUICE: paramDefのminLengthはtrim前の文字数で判定されるため、空白のみの入力を別途弾く。
			// maxLengthはparamDef側の10000が絶対上限で、これはJUICE設定でさらに引き下げられる下限20〜上限10000の範囲の値
			if (ps.subject.trim().length === 0 || ps.content.trim().length < 20 || ps.content.trim().length > contactFormContentMaxLength) {
				throw new ApiError(meta.errors.invalidContent);
			}

			await this.captchaService.verifyRequestCaptcha(this.serverSettings, {
				hcaptcha: ps['hcaptcha-response'],
				mcaptcha: ps['m-captcha-response'],
				recaptcha: ps['g-recaptcha-response'],
				turnstile: ps['turnstile-response'],
				testcaptcha: ps['testcaptcha-response'],
			}).catch(err => {
				throw new ApiError(meta.errors.captchaFailed, { message: err.message });
			});

			if (ps.replyMethod === 'email') {
				if (!ps.email || ps.email.trim() === '' || !this.utilityService.validateEmailFormat(ps.email.trim())) {
					throw new ApiError(meta.errors.invalidReplyMethod);
				}

				// JUICE: 詳細なメール検証(使い捨てメール判定等)が有効な場合、こちらでも検証する。
				// ただしコンタクトフォームでは既存メールアドレス(reason: 'used')も許可する
				if (this.serverSettings.enableActiveEmailValidation) {
					const validated = await this.emailService.validateEmailForAccount(ps.email.trim()).catch(() => null);
					// JUICE: +タグ・Gmailのドットの禁止はアカウント向けの設定なので、お問い合わせではそれらのアドレスも受け付ける
					if (validated != null && !validated.available && validated.reason !== 'used' && validated.reason !== 'plusTag' && validated.reason !== 'gmailDot') {
						throw new ApiError(meta.errors.invalidReplyMethod);
					}
				} else if (await this.disposableEmailDomainService.isDisposable(ps.email.trim()).catch(() => false)) {
					// JUICE: 詳細なメール検証を使っていなくても、使い捨てメールアドレスの一覧(JUICE設定)には従う
					// (入力画面は email-address/available で止めるので、ここでも同じにする)
					throw new ApiError(meta.errors.invalidReplyMethod);
				}
			} else {
				if (!ps.misskeyUsername || ps.misskeyUsername.trim() === '') {
					throw new ApiError(meta.errors.invalidReplyMethod);
				}

				// 先頭の@を取り除いた上で、username@domain形式かを検証する。
				// JUICE: ローカルユーザーはこのサーバーのドメインを付与しなくても
				// @usernameのみで通す(MFMの@メンション記法もホスト省略でローカル扱いになるため)
				const misskeyUsername = ps.misskeyUsername.trim().replace(/^@/, '');
				const parts = misskeyUsername.split('@');
				if (parts.length === 1) {
					if (parts[0] === '' || !/^[a-zA-Z0-9_-]+$/.test(parts[0])) {
						throw new ApiError(meta.errors.invalidReplyMethod);
					}
				} else if (
					parts.length !== 2 || parts[0] === '' || parts[1] === '' ||
					!/^[a-zA-Z0-9_-]+$/.test(parts[0]) ||
					!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(parts[1])
				) {
					throw new ApiError(meta.errors.invalidReplyMethod);
				}
			}

			const category = ps.category || await this.contactFormService.getDefaultCategory();
			if (!(await this.contactFormService.validateCategory(category))) {
				throw new ApiError(meta.errors.invalidReplyMethod);
			}

			const userAgent = (headers && typeof headers === 'object' && 'user-agent' in headers)
				? String(headers['user-agent'] ?? '')
				: null;

			const contactForm = await this.contactFormService.submit({
				subject: ps.subject,
				content: ps.content,
				replyMethod: ps.replyMethod,
				name: ps.name ?? null,
				email: ps.replyMethod === 'email' ? ps.email : null,
				misskeyUsername: ps.replyMethod === 'misskey' ? ps.misskeyUsername!.trim().replace(/^@/, '') : null,
				category,
				ipAddress: ip ?? null,
				userAgent,
				userId: me ? me.id : null,
			});

			return {
				id: contactForm.id,
			};
		});
	}
}
