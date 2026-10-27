/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import * as Redis from 'ioredis';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { MiMeta, SignupApprovalChecksRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { CaptchaService } from '@/core/CaptchaService.js';
import { ApiError } from '@/server/api/error.js';
import { markSignupCheckCodeSeen, touchSignupCheckCodeSeen } from '@/misc/signup-check-seen.js';

export const meta = {
	tags: ['meta'],

	requireCredential: false,

	description: 'Check the approval status of a pending signup application using its check code (JUICE).',

	limit: {
		duration: ms('1hour'),
		max: 30,
	},

	errors: {
		// JUICE
		captchaFailed: {
			message: 'Captcha verification failed.',
			code: 'CAPTCHA_FAILED',
			id: 'fbea36d0-8e72-4b5e-b752-a49e16abd09d',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			status: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['pending', 'approved', 'declined', 'notFound'],
			},
			// JUICE: 却下時の理由。却下されていない場合や、まだ理由が記録されていない古いレコードではnull
			reason: {
				type: 'string',
				optional: false, nullable: true,
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		code: { type: 'string', minLength: 1 },
		// JUICE: 端末に保存済みのコードを画面表示のたびに黙って再確認する経路ではcaptchaを要求しない。
		// 「新規かどうか」はこの申告だけでは判定できないため、サーバー側でコードの初出を記録し、
		// 初出のコードについては申告の有無によらずcaptchaを必須にする(下記ハンドラ参照)。
		isNewSubmission: { type: 'boolean', default: false },
		'hcaptcha-response': { type: 'string', nullable: true },
		'g-recaptcha-response': { type: 'string', nullable: true },
		'm-captcha-response': { type: 'string', nullable: true },
		'turnstile-response': { type: 'string', nullable: true },
		'testcaptcha-response': { type: 'string', nullable: true },
	},
	required: ['code'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		@Inject(DI.signupApprovalChecksRepository)
		private signupApprovalChecksRepository: SignupApprovalChecksRepository,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		private captchaService: CaptchaService,
	) {
		super(meta, paramDef, async (ps) => {
			// JUICE: isNewSubmission は呼び出し側の自己申告であり、攻撃者は常に false を送れる。
			// そのため「一度見たコード」をサーバー側(Redis)で記録し、記録の無いコードでは申告によらず
			// captcha を必須にする。登録のときに発行したコードも記録するので、端末に保存したコードの
			// 再確認は captcha なしで通り、未知のコードの総当たりには毎回 captcha が要る
			const seen = !ps.isNewSubmission && await touchSignupCheckCodeSeen(this.redisClient, ps.code);

			if (!seen) {
				await this.captchaService.verifyRequestCaptcha(this.serverSettings, {
					hcaptcha: ps['hcaptcha-response'],
					mcaptcha: ps['m-captcha-response'],
					recaptcha: ps['g-recaptcha-response'],
					turnstile: ps['turnstile-response'],
					testcaptcha: ps['testcaptcha-response'],
				}).catch(err => {
					throw new ApiError(meta.errors.captchaFailed, { message: err.message });
				});

				await markSignupCheckCodeSeen(this.redisClient, ps.code);
			}

			const check = await this.signupApprovalChecksRepository.findOneBy({ code: ps.code });

			return {
				status: check?.status ?? 'notFound',
				reason: check?.reason ?? null,
			};
		});
	}
}
