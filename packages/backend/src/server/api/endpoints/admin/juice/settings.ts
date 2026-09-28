/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { resolveSignupApprovalSettings, resolveExploreOtherServersSettings, resolveEmailSettings, resolveEmojiRequestSettings, resolveAvatarDecorationRequestSettings, resolveRankingSettings, resolveRelayTimelineSettings, resolveMediaTimelineSettings, resolveLatexSettings, resolveReactionPiggybackSettings, resolveContactFormSettings, resolveCustomSplashTextSettings, resolveNewAccountFollowRequestSettings, resolveReportCategorySettings, resolveEmailAliasSettings, resolveAiGeneratedFallbackCwSettings, resolveNovelFallbackCwSettings, resolveOauthLoginSettings, resolveMidiPlayerSettings, resolveDrawRoomSettings, resolveRemoteAvatarDecorationSettings, resolveDrawRoomLimitSettings } from '@/models/JuiceSettings.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireAdmin: true,
	kind: 'read:admin:juice-settings',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			approvalRequiredForSignup: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			signupReasonRequired: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			signupReasonMaxLength: {
				type: 'number',
				optional: false, nullable: false,
			},
			invitationRegistrationEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			exploreOtherServersEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			defaultEmailLang: {
				type: 'string',
				optional: false, nullable: false,
			},
			emojiRequestEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			// JUICE: 絵文字申請フォームでカテゴリ・タグ・ライセンスの入力を必須にするか
			emojiRequestRequireCategory: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			emojiRequestRequireTags: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			emojiRequestRequireLicense: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			avatarDecorationRequestEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			// JUICE: アバターデコレーション申請フォームでカテゴリ・説明の入力を必須にするか
			avatarDecorationRequestRequireCategory: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			avatarDecorationRequestRequireDescription: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			// JUICE: リモートのユーザーのアイコンのデコレーションを表示するか
			remoteAvatarDecorationsEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			rankingAggregationPeriodHours: {
				type: 'number',
				optional: false, nullable: false,
			},
			rankingDisplayCount: {
				type: 'number',
				optional: false, nullable: false,
			},
			relayTimelineEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			mediaTimelineEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			latexEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			reactionPiggybackOnRemoteEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			contactFormEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			contactFormLimit: {
				type: 'number',
				optional: false, nullable: false,
			},
			contactFormRequireAuth: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			contactFormContentMaxLength: {
				type: 'number',
				optional: false, nullable: false,
			},
			contactFormCategories: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						key: { type: 'string', optional: false, nullable: false },
						text: { type: 'string', optional: false, nullable: false },
						enabled: { type: 'boolean', optional: false, nullable: false },
						order: { type: 'number', optional: false, nullable: false },
						isDefault: { type: 'boolean', optional: false, nullable: false },
					},
				},
			},
			customSplashText: {
				type: 'array',
				optional: false, nullable: false,
				items: { type: 'string', optional: false, nullable: false },
			},
			newAccountFollowRequestEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			newAccountFollowRequestThresholdMs: {
				type: 'number',
				optional: false, nullable: false,
			},
			reportCategories: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						key: { type: 'string', optional: false, nullable: false },
						text: { type: 'string', optional: false, nullable: false },
						enabled: { type: 'boolean', optional: false, nullable: false },
						order: { type: 'number', optional: false, nullable: false },
						isDefault: { type: 'boolean', optional: false, nullable: false },
					},
				},
			},
			blockEmailDotAliasRegistration: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			blockEmailPlusAliasRegistration: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			aiGeneratedFallbackCwEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			novelFallbackCwEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			discordOauthEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			discordOauthClientId: {
				type: 'string',
				optional: false, nullable: true,
			},
			discordOauthClientSecret: {
				type: 'string',
				optional: false, nullable: true,
			},
			googleOauthEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			googleOauthClientId: {
				type: 'string',
				optional: false, nullable: true,
			},
			googleOauthClientSecret: {
				type: 'string',
				optional: false, nullable: true,
			},
			githubOauthEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			githubOauthClientId: {
				type: 'string',
				optional: false, nullable: true,
			},
			githubOauthClientSecret: {
				type: 'string',
				optional: false, nullable: true,
			},
			gitlabOauthEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			gitlabOauthClientId: {
				type: 'string',
				optional: false, nullable: true,
			},
			gitlabOauthClientSecret: {
				type: 'string',
				optional: false, nullable: true,
			},
			microsoftOauthEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			microsoftOauthClientId: {
				type: 'string',
				optional: false, nullable: true,
			},
			microsoftOauthClientSecret: {
				type: 'string',
				optional: false, nullable: true,
			},
			midiPlayerMaxSize: {
				type: 'number',
				optional: false, nullable: false,
			},
			// JUICE: 絵チャの1つの部屋の全員の線のデータ量の合計の上限(MB)
			drawRoomMaxRoomMegabytes: {
				type: 'integer',
				optional: false, nullable: false,
			},
			drawRoomEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private juiceSettingsService: JuiceSettingsService,
	) {
		super(meta, paramDef, async () => {
			const settings = await this.juiceSettingsService.fetch();
			return {
				...resolveSignupApprovalSettings(settings),
				...resolveExploreOtherServersSettings(settings),
				...resolveEmailSettings(settings),
				...resolveEmojiRequestSettings(settings),
				...resolveAvatarDecorationRequestSettings(settings),
				...resolveRankingSettings(settings),
				...resolveRelayTimelineSettings(settings),
				...resolveMediaTimelineSettings(settings),
				...resolveLatexSettings(settings),
				...resolveReactionPiggybackSettings(settings),
				...resolveContactFormSettings(settings),
				...resolveCustomSplashTextSettings(settings),
				...resolveNewAccountFollowRequestSettings(settings),
				...resolveReportCategorySettings(settings),
				...resolveEmailAliasSettings(settings),
				...resolveAiGeneratedFallbackCwSettings(settings),
				...resolveNovelFallbackCwSettings(settings),
				...resolveOauthLoginSettings(settings),
				...resolveMidiPlayerSettings(settings),
				...resolveDrawRoomSettings(settings),
				...resolveRemoteAvatarDecorationSettings(settings),
				...resolveDrawRoomLimitSettings(settings),
			};
		});
	}
}
