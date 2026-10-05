/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { DisposableEmailDomainService, normalizeDisposableEmailAllowDomains } from '@/core/DisposableEmailDomainService.js';
import type { JuiceSettingsValue } from '@/models/JuiceSettings.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireAdmin: true,
	kind: 'write:admin:juice-settings',
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		approvalRequiredForSignup: { type: 'boolean' },
		signupReasonRequired: { type: 'boolean' },
		signupReasonMaxLength: { type: 'integer', minimum: 1 },
		invitationRegistrationEnabled: { type: 'boolean' },
		exploreOtherServersEnabled: { type: 'boolean' },
		defaultEmailLang: { type: 'string' },
		emojiRequestEnabled: { type: 'boolean' },
		emojiRequestRequireCategory: { type: 'boolean' },
		emojiRequestRequireTags: { type: 'boolean' },
		emojiRequestRequireLicense: { type: 'boolean' },
		avatarDecorationRequestEnabled: { type: 'boolean' },
		avatarDecorationRequestRequireCategory: { type: 'boolean' },
		avatarDecorationRequestRequireDescription: { type: 'boolean' },
		remoteAvatarDecorationsEnabled: { type: 'boolean' },
		rankingAggregationPeriodHours: { type: 'integer', minimum: 1 },
		rankingDisplayCount: { type: 'integer', minimum: 1, maximum: 100 },
		relayTimelineEnabled: { type: 'boolean' },
		mediaTimelineEnabled: { type: 'boolean' },
		latexEnabled: { type: 'boolean' },
		reactionPiggybackOnRemoteEnabled: { type: 'boolean' },
		contactFormEnabled: { type: 'boolean' },
		contactFormLimit: { type: 'integer', minimum: 1, maximum: 100 },
		contactFormRequireAuth: { type: 'boolean' },
		contactFormContentMaxLength: { type: 'integer', minimum: 20, maximum: 10000 },
		contactFormCategories: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					key: { type: 'string', minLength: 1, maxLength: 64 },
					text: { type: 'string', minLength: 1, maxLength: 128 },
					enabled: { type: 'boolean' },
					order: { type: 'integer' },
					isDefault: { type: 'boolean' },
				},
				required: ['key', 'text', 'enabled', 'order', 'isDefault'],
			},
		},
		customSplashText: {
			type: 'array',
			maxItems: 20,
			items: { type: 'string', maxLength: 256 },
		},
		newAccountFollowRequestEnabled: { type: 'boolean' },
		newAccountFollowRequestThresholdMs: { type: 'integer', minimum: 1, maximum: 2592000000 }, // 30日
		// JUICE: 運営の承認が要るインポートの種類
		importApprovalRequiredTypes: {
			type: 'array',
			uniqueItems: true,
			items: { type: 'string', enum: ['following', 'muting', 'blocking', 'userLists', 'antennas'] },
		},
		reportCategories: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					key: { type: 'string', minLength: 1, maxLength: 64 },
					text: { type: 'string', minLength: 1, maxLength: 128 },
					enabled: { type: 'boolean' },
					order: { type: 'integer' },
					isDefault: { type: 'boolean' },
				},
				required: ['key', 'text', 'enabled', 'order', 'isDefault'],
			},
		},
		blockEmailDotAliasRegistration: { type: 'boolean' },
		blockEmailPlusAliasRegistration: { type: 'boolean' },
		disposableEmailBlocklistEnabled: { type: 'boolean' },
		disposableEmailAllowDomains: { type: 'array', maxItems: 1000, items: { type: 'string', maxLength: 253 } },
		aiGeneratedFallbackCwEnabled: { type: 'boolean' },
		novelFallbackCwEnabled: { type: 'boolean' },
		discordOauthEnabled: { type: 'boolean' },
		discordOauthClientId: { type: 'string', nullable: true },
		discordOauthClientSecret: { type: 'string', nullable: true },
		googleOauthEnabled: { type: 'boolean' },
		googleOauthClientId: { type: 'string', nullable: true },
		googleOauthClientSecret: { type: 'string', nullable: true },
		githubOauthEnabled: { type: 'boolean' },
		githubOauthClientId: { type: 'string', nullable: true },
		githubOauthClientSecret: { type: 'string', nullable: true },
		gitlabOauthEnabled: { type: 'boolean' },
		gitlabOauthClientId: { type: 'string', nullable: true },
		gitlabOauthClientSecret: { type: 'string', nullable: true },
		microsoftOauthEnabled: { type: 'boolean' },
		microsoftOauthClientId: { type: 'string', nullable: true },
		microsoftOauthClientSecret: { type: 'string', nullable: true },
		// JUICE: 黒MIDI等の再生によるブラウザのフリーズを防ぐ安全装置。最小値は極端に小さい値による
		// 事実上の機能無効化を避けるため1KB、最大値は暴走防止のため50MBに制限する
		midiPlayerMaxSize: { type: 'integer', minimum: 1024, maximum: 50 * 1024 * 1024 },
		drawRoomEnabled: { type: 'boolean' },
		drawRoomMaxRoomMegabytes: { type: 'integer', minimum: 16, maximum: 512 },
	},
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private juiceSettingsService: JuiceSettingsService,
		private moderationLogService: ModerationLogService,
		private disposableEmailDomainService: DisposableEmailDomainService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const before = await this.juiceSettingsService.fetch(true);

			// paramDef に additionalProperties: false を指定していないため、
			// ps には認証トークン(i)等の余分なフィールドが含まれうる。
			// jsonb にそのまま紛れ込ませないよう、既知のフィールドだけを明示的に拾う。
			const set: Partial<JuiceSettingsValue> = {};
			if (ps.approvalRequiredForSignup !== undefined) set.approvalRequiredForSignup = ps.approvalRequiredForSignup;
			if (ps.signupReasonRequired !== undefined) set.signupReasonRequired = ps.signupReasonRequired;
			if (ps.signupReasonMaxLength !== undefined) set.signupReasonMaxLength = ps.signupReasonMaxLength;
			if (ps.invitationRegistrationEnabled !== undefined) set.invitationRegistrationEnabled = ps.invitationRegistrationEnabled;
			if (ps.exploreOtherServersEnabled !== undefined) set.exploreOtherServersEnabled = ps.exploreOtherServersEnabled;
			if (ps.defaultEmailLang !== undefined) set.defaultEmailLang = ps.defaultEmailLang;
			if (ps.emojiRequestEnabled !== undefined) set.emojiRequestEnabled = ps.emojiRequestEnabled;
			if (ps.emojiRequestRequireCategory !== undefined) set.emojiRequestRequireCategory = ps.emojiRequestRequireCategory;
			if (ps.emojiRequestRequireTags !== undefined) set.emojiRequestRequireTags = ps.emojiRequestRequireTags;
			if (ps.emojiRequestRequireLicense !== undefined) set.emojiRequestRequireLicense = ps.emojiRequestRequireLicense;
			if (ps.avatarDecorationRequestEnabled !== undefined) set.avatarDecorationRequestEnabled = ps.avatarDecorationRequestEnabled;
			if (ps.avatarDecorationRequestRequireCategory !== undefined) set.avatarDecorationRequestRequireCategory = ps.avatarDecorationRequestRequireCategory;
			if (ps.avatarDecorationRequestRequireDescription !== undefined) set.avatarDecorationRequestRequireDescription = ps.avatarDecorationRequestRequireDescription;
			if (ps.remoteAvatarDecorationsEnabled !== undefined) set.remoteAvatarDecorationsEnabled = ps.remoteAvatarDecorationsEnabled;
			if (ps.rankingAggregationPeriodHours !== undefined) set.rankingAggregationPeriodHours = ps.rankingAggregationPeriodHours;
			if (ps.rankingDisplayCount !== undefined) set.rankingDisplayCount = ps.rankingDisplayCount;
			if (ps.relayTimelineEnabled !== undefined) set.relayTimelineEnabled = ps.relayTimelineEnabled;
			if (ps.mediaTimelineEnabled !== undefined) set.mediaTimelineEnabled = ps.mediaTimelineEnabled;
			if (ps.latexEnabled !== undefined) set.latexEnabled = ps.latexEnabled;
			if (ps.reactionPiggybackOnRemoteEnabled !== undefined) set.reactionPiggybackOnRemoteEnabled = ps.reactionPiggybackOnRemoteEnabled;
			if (ps.contactFormEnabled !== undefined) set.contactFormEnabled = ps.contactFormEnabled;
			if (ps.contactFormLimit !== undefined) set.contactFormLimit = ps.contactFormLimit;
			if (ps.contactFormRequireAuth !== undefined) set.contactFormRequireAuth = ps.contactFormRequireAuth;
			if (ps.contactFormContentMaxLength !== undefined) set.contactFormContentMaxLength = ps.contactFormContentMaxLength;
			if (ps.contactFormCategories !== undefined) set.contactFormCategories = ps.contactFormCategories;
			if (ps.customSplashText !== undefined) set.customSplashText = ps.customSplashText;
			if (ps.newAccountFollowRequestEnabled !== undefined) set.newAccountFollowRequestEnabled = ps.newAccountFollowRequestEnabled;
			if (ps.importApprovalRequiredTypes !== undefined) set.importApprovalRequiredTypes = ps.importApprovalRequiredTypes;
			if (ps.newAccountFollowRequestThresholdMs !== undefined) set.newAccountFollowRequestThresholdMs = ps.newAccountFollowRequestThresholdMs;
			if (ps.reportCategories !== undefined) set.reportCategories = ps.reportCategories;
			if (ps.blockEmailDotAliasRegistration !== undefined) set.blockEmailDotAliasRegistration = ps.blockEmailDotAliasRegistration;
			if (ps.blockEmailPlusAliasRegistration !== undefined) set.blockEmailPlusAliasRegistration = ps.blockEmailPlusAliasRegistration;
			if (ps.disposableEmailBlocklistEnabled !== undefined) set.disposableEmailBlocklistEnabled = ps.disposableEmailBlocklistEnabled;
			// 許可するドメインは、小文字・重複なし・形の正しいものだけにして保存する
			if (ps.disposableEmailAllowDomains !== undefined) set.disposableEmailAllowDomains = normalizeDisposableEmailAllowDomains(ps.disposableEmailAllowDomains);
			if (ps.aiGeneratedFallbackCwEnabled !== undefined) set.aiGeneratedFallbackCwEnabled = ps.aiGeneratedFallbackCwEnabled;
			if (ps.novelFallbackCwEnabled !== undefined) set.novelFallbackCwEnabled = ps.novelFallbackCwEnabled;
			if (ps.discordOauthEnabled !== undefined) set.discordOauthEnabled = ps.discordOauthEnabled;
			if (ps.discordOauthClientId !== undefined) set.discordOauthClientId = ps.discordOauthClientId;
			if (ps.discordOauthClientSecret !== undefined) set.discordOauthClientSecret = ps.discordOauthClientSecret;
			if (ps.googleOauthEnabled !== undefined) set.googleOauthEnabled = ps.googleOauthEnabled;
			if (ps.googleOauthClientId !== undefined) set.googleOauthClientId = ps.googleOauthClientId;
			if (ps.googleOauthClientSecret !== undefined) set.googleOauthClientSecret = ps.googleOauthClientSecret;
			if (ps.githubOauthEnabled !== undefined) set.githubOauthEnabled = ps.githubOauthEnabled;
			if (ps.githubOauthClientId !== undefined) set.githubOauthClientId = ps.githubOauthClientId;
			if (ps.githubOauthClientSecret !== undefined) set.githubOauthClientSecret = ps.githubOauthClientSecret;
			if (ps.gitlabOauthEnabled !== undefined) set.gitlabOauthEnabled = ps.gitlabOauthEnabled;
			if (ps.gitlabOauthClientId !== undefined) set.gitlabOauthClientId = ps.gitlabOauthClientId;
			if (ps.gitlabOauthClientSecret !== undefined) set.gitlabOauthClientSecret = ps.gitlabOauthClientSecret;
			if (ps.microsoftOauthEnabled !== undefined) set.microsoftOauthEnabled = ps.microsoftOauthEnabled;
			if (ps.microsoftOauthClientId !== undefined) set.microsoftOauthClientId = ps.microsoftOauthClientId;
			if (ps.microsoftOauthClientSecret !== undefined) set.microsoftOauthClientSecret = ps.microsoftOauthClientSecret;
			if (ps.midiPlayerMaxSize !== undefined) set.midiPlayerMaxSize = ps.midiPlayerMaxSize;
			if (ps.drawRoomEnabled !== undefined) set.drawRoomEnabled = ps.drawRoomEnabled;
			if (ps.drawRoomMaxRoomMegabytes !== undefined) set.drawRoomMaxRoomMegabytes = ps.drawRoomMaxRoomMegabytes;

			const after = await this.juiceSettingsService.update(set);

			// JUICE: 使い捨てメールアドレスの一覧をオンにしたら、すぐに一覧を取りに行く。管理画面に一覧の状態をすぐ出せるよう、
			// 少しだけ待つ(取れなくても・間に合わなくても、設定の保存は成功にする)
			if (ps.disposableEmailBlocklistEnabled === true && before.disposableEmailBlocklistEnabled !== true) {
				await Promise.race([
					this.disposableEmailDomainService.refresh().catch(() => {}),
					new Promise(resolve => setTimeout(resolve, 8000)),
				]);
			}

			this.moderationLogService.log(me, 'updateJuiceSettings', {
				before,
				after,
			});
		});
	}
}
