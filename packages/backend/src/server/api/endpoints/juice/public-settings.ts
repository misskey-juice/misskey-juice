/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { resolveSignupApprovalSettings, resolveExploreOtherServersSettings, resolveEmojiRequestSettings, resolveAvatarDecorationRequestSettings, resolveRelayTimelineSettings, resolveMediaTimelineSettings, resolveLatexSettings, resolveReactionPiggybackSettings, resolveContactFormSettings, resolveReportCategorySettings, resolveOauthLoginSettings, resolveMidiPlayerSettings, resolveDrawRoomSettings, resolveDrawRoomLimitSettings } from '@/models/JuiceSettings.js';

export const meta = {
	tags: ['meta'],

	requireCredential: false,

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
			// JUICE: 連携ログインの有効プロバイダ。client_id/secretは非公開(公開APIには出さない)
			discordOauthEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			googleOauthEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			githubOauthEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			gitlabOauthEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			microsoftOauthEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			midiPlayerMaxSize: {
				type: 'number',
				optional: false, nullable: false,
			},
			drawRoomEnabled: {
				type: 'boolean',
				optional: false, nullable: false,
			},
			// JUICE: 絵チャの部屋の全員の線のデータ量の合計の上限(MB。絵チャのデバッグ情報に出す)
			drawRoomMaxRoomMegabytes: {
				type: 'number',
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
			const { contactFormEnabled, contactFormRequireAuth, contactFormCategories, contactFormContentMaxLength } = resolveContactFormSettings(settings);
			const { reportCategories } = resolveReportCategorySettings(settings);
			const { discordOauthEnabled, googleOauthEnabled, githubOauthEnabled, gitlabOauthEnabled, microsoftOauthEnabled } = resolveOauthLoginSettings(settings);
			return {
				...resolveSignupApprovalSettings(settings),
				...resolveExploreOtherServersSettings(settings),
				...resolveEmojiRequestSettings(settings),
				...resolveAvatarDecorationRequestSettings(settings),
				...resolveRelayTimelineSettings(settings),
				...resolveMediaTimelineSettings(settings),
				...resolveLatexSettings(settings),
				...resolveReactionPiggybackSettings(settings),
				contactFormEnabled,
				contactFormRequireAuth,
				contactFormContentMaxLength,
				// JUICE: 公開設定なので無効化されたカテゴリは含めない
				contactFormCategories: contactFormCategories.filter(cat => cat.enabled).sort((a, b) => a.order - b.order),
				// JUICE: 公開設定なので無効化されたカテゴリは含めない
				reportCategories: reportCategories.filter(cat => cat.enabled).sort((a, b) => a.order - b.order),
				discordOauthEnabled,
				googleOauthEnabled,
				githubOauthEnabled,
				gitlabOauthEnabled,
				microsoftOauthEnabled,
				...resolveMidiPlayerSettings(settings),
				...resolveDrawRoomSettings(settings),
				...resolveDrawRoomLimitSettings(settings),
			};
		});
	}
}
