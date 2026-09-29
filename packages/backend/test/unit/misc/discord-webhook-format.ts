/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import {
	isDiscordWebhookUrl,
	formatSystemWebhookForDiscord,
	formatUserWebhookForDiscord,
} from '@/misc/discord-webhook-format.js';

const server = 'https://misskey.example.com';

const user = {
	id: 'user1',
	name: 'Alice',
	username: 'alice',
	host: null,
	avatarUrl: 'https://misskey.example.com/avatar.png',
};

describe('misc:discord-webhook-format', () => {
	describe('isDiscordWebhookUrl', () => {
		test('matches discord.com webhook URLs', () => {
			expect(isDiscordWebhookUrl('https://discord.com/api/webhooks/123/abc')).toBe(true);
		});

		test('matches legacy discordapp.com webhook URLs', () => {
			expect(isDiscordWebhookUrl('https://discordapp.com/api/webhooks/123/abc')).toBe(true);
		});

		test('does not match non-Discord URLs', () => {
			expect(isDiscordWebhookUrl('https://example.com/api/webhooks/123/abc')).toBe(false);
		});

		test('does not match Discord URLs outside the webhooks path', () => {
			expect(isDiscordWebhookUrl('https://discord.com/channels/123')).toBe(false);
		});

		test('does not throw on an invalid URL string', () => {
			expect(isDiscordWebhookUrl('not-a-url')).toBe(false);
		});
	});

	describe('formatSystemWebhookForDiscord', () => {
		test('formats abuseReport with reporter/target/id fields', () => {
			const result = formatSystemWebhookForDiscord('abuseReport', {
				id: 'report1',
				comment: 'spam',
				reporter: user,
				targetUser: { ...user, id: 'user2', username: 'bob' },
				assignee: null,
			}, server);

			expect(result.embeds[0].title).toBe('🚨 新しい通報');
			expect(result.embeds[0].fields?.map(f => f.name)).toEqual(['通報者', '対象ユーザー', '通報ID']);
		});

		test('formats emojiRequestCreated (JUICE) with the emoji name and requester', () => {
			const result = formatSystemWebhookForDiscord('emojiRequestCreated', {
				id: 'req1',
				name: 'party_parrot',
				category: 'fun',
				requester: user,
				count: 1,
				requests: [{ id: 'req1', name: 'party_parrot', category: 'fun' }],
			}, server);

			expect(result.embeds[0].title).toBe('🙂 絵文字申請が届きました');
			expect(result.embeds[0].description).toBe('`:party_parrot:`');
		});

		test('formats signupApplicationCreated (JUICE) without leaking checkCode', () => {
			const result = formatSystemWebhookForDiscord('signupApplicationCreated', {
				applicant: user,
				reason: 'I want to join',
			}, server);

			expect(JSON.stringify(result)).not.toContain('checkCode');
			expect(result.embeds[0].description).toBe('I want to join');
		});

		test('falls back to a generic embed for an unrecognized event type', () => {
			// @ts-expect-error unknown event type on purpose
			const result = formatSystemWebhookForDiscord('somethingUnknown', {}, server);
			expect(result.embeds[0].description).toContain('somethingUnknown');
		});

		test('formats avatarDecorationRequestCreated (JUICE) with the decoration name and requester', () => {
			const result = formatSystemWebhookForDiscord('avatarDecorationRequestCreated', {
				id: 'req1',
				name: 'sparkle_crown',
				category: 'fun',
				requester: user,
				count: 1,
				requests: [{ id: 'req1', name: 'sparkle_crown', category: 'fun' }],
			}, server);

			expect(result.embeds[0].title).toBe('✨ アバターデコレーション申請が届きました');
			expect(result.embeds[0].description).toBe('sparkle_crown');
		});

		test('formats emojiRequestCreated (JUICE) that bundles several requests into one embed', () => {
			const requests = Array.from({ length: 22 }, (_, i) => ({ id: `req${i}`, name: `emoji_${i}`, category: null }));
			const result = formatSystemWebhookForDiscord('emojiRequestCreated', {
				...requests[0],
				requester: user,
				count: requests.length,
				requests,
			}, server);

			const lines = result.embeds[0].description!.split('\n');
			// 並べるのは20件まで、残りは件数で
			expect(lines.slice(0, 2)).toEqual(['`:emoji_0:`', '`:emoji_1:`']);
			expect(lines).toHaveLength(21);
			expect(lines[20]).toBe('ほか2件');
			expect(result.embeds[0].fields?.map(f => [f.name, f.value])).toContainEqual(['件数', '22']);
		});
	});

	describe('formatUserWebhookForDiscord', () => {
		test('formats note with a title linking to the note URL', () => {
			const result = formatUserWebhookForDiscord('note', {
				note: { id: 'note1', text: 'hello', cw: null, uri: null, url: null, createdAt: '2026-01-01T00:00:00.000Z', user },
			}, server);

			expect(result.embeds[0].title).toBe(`[📝 新しいノート](${server}/notes/note1)`);
			expect(result.embeds[0].description).toBe('hello');
		});

		test('hides the note text behind a spoiler when cw is set', () => {
			const result = formatUserWebhookForDiscord('note', {
				note: { id: 'note1', text: 'spoiler text', cw: 'spoiler warning', uri: null, url: null, createdAt: '2026-01-01T00:00:00.000Z', user },
			}, server);

			expect(result.embeds[0].description).toContain('**CW:** spoiler warning');
			expect(result.embeds[0].description).toContain('||spoiler text||');
		});

		test('formats followed with the follower as description', () => {
			const result = formatUserWebhookForDiscord('followed', { user }, server);
			expect(result.embeds[0].title).toBe('👋 フォローされました');
			expect(result.embeds[0].description).toContain('@alice');
		});

		test('falls back to a generic embed for reaction (no dedicated payload yet)', () => {
			const result = formatUserWebhookForDiscord('reaction', {}, server);
			expect(result.embeds[0].description).toContain('reaction');
		});
	});

	// JuiceSettings.defaultEmailLang(EmailI18nServiceと同じ設定)をそのまま流用しているため、
	// ja-JP以外はすべて英語にフォールバックする(EmailI18nService.getI18n()と同じ方式)
	describe('lang', () => {
		test('defaults to Japanese when lang is omitted', () => {
			const result = formatSystemWebhookForDiscord('userCreated', user, server);
			expect(result.embeds[0].title).toBe('👤 新規ユーザー登録');
		});

		test('uses Japanese strings explicitly for ja-JP', () => {
			const result = formatSystemWebhookForDiscord('userCreated', user, server, 'ja-JP');
			expect(result.embeds[0].title).toBe('👤 新規ユーザー登録');
		});

		test('falls back to English for any non-ja-JP lang (system webhook)', () => {
			const result = formatSystemWebhookForDiscord('userCreated', user, server, 'en-US');
			expect(result.embeds[0].title).toBe('👤 New user registered');
			expect(result.embeds[0].fields?.[0].name).toBe('User ID');
		});

		test('falls back to English for any non-ja-JP lang (user webhook)', () => {
			const result = formatUserWebhookForDiscord('followed', { user }, server, 'en-US');
			expect(result.embeds[0].title).toBe('👋 New follower');
		});
	});
});
