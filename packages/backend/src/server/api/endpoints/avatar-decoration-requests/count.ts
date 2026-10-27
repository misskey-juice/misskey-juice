/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AvatarDecorationRequestsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { resolveAvatarDecorationRequestSettings } from '@/models/JuiceSettings.js';
import { RoleService } from '@/core/RoleService.js';
import { RateLimiterService } from '@/server/api/RateLimiterService.js';
import { ApiError } from '@/server/api/error.js';

// JUICE: 申請フォームで「あと何件申請できるか」を表示するための専用エンドポイント。
// 審査待ち件数の上限(i.policies.avatarDecorationRequestLimit)自体はi.policiesから取得できるため、
// ここでは現在の審査待ち件数と、avatar-decoration-requests/create-manyの1日あたりの送信回数上限
// (i.policies.avatarDecorationRequestDailyLimit、審査待ち件数の上限とは別物)の残り回数を返す
export const meta = {
	tags: ['avatar-decoration-requests'],

	requireCredential: true,
	kind: 'read:avatar-decoration-requests',

	errors: {
		functionDisabled: {
			message: 'The avatar decoration request feature is currently disabled.',
			code: 'FUNCTION_DISABLED',
			id: '8509c4c5-b03a-40d1-acc0-d49ebeec6d45',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			pending: {
				type: 'number',
				optional: false, nullable: false,
			},
			// JUICE: avatar-decoration-requests/create-manyの1日あたりの送信回数上限の残り回数
			// (nullはロールのrateLimitFactorが0以下に設定されている等、この制限自体が
			// 適用されない場合を表す)
			dailyRemaining: {
				type: 'number',
				optional: false, nullable: true,
			},
			// JUICE: 1日あたりの送信回数上限が次に回復する(枠が1つ空く)日時。今回の集計期間に
			// 送信実績が無い場合(dailyRemainingが上限のまま)はnull
			dailyResetAt: {
				type: 'string',
				format: 'date-time',
				optional: false, nullable: true,
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.avatarDecorationRequestsRepository)
		private avatarDecorationRequestsRepository: AvatarDecorationRequestsRepository,

		private juiceSettingsService: JuiceSettingsService,
		private roleService: RoleService,
		private rateLimiterService: RateLimiterService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const { avatarDecorationRequestEnabled } = resolveAvatarDecorationRequestSettings(await this.juiceSettingsService.fetch());
			if (!avatarDecorationRequestEnabled) throw new ApiError(meta.errors.functionDisabled);

			const pending = await this.avatarDecorationRequestsRepository.countBy({ userId: me.id, status: 'pending' });

			const policies = await this.roleService.getUserPolicies(me.id);
			const usage = await this.rateLimiterService.peekUsage({
				key: 'avatar-decoration-requests/create',
				duration: ms('1day'),
				max: policies.avatarDecorationRequestDailyLimit,
			}, me.id, policies.rateLimitFactor);
			const dailyRemaining = usage != null ? Math.max(0, Math.floor(usage.max - usage.used)) : null;
			const dailyResetAt = usage?.resetAt != null ? new Date(usage.resetAt).toISOString() : null;

			return { pending, dailyRemaining, dailyResetAt };
		});
	}
}
