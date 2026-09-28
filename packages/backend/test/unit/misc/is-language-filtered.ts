/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { canonicalizeLanguageTagForFederation, isLanguageFiltered } from '@/misc/is-language-filtered.js';
import { MiNote } from '@/models/Note.js';

const base: MiNote = {
	id: 'some-note-id',
	replyId: null,
	reply: null,
	renoteId: null,
	renote: null,
	threadId: null,
	text: null,
	name: null,
	cw: null,
	lang: null,
	userId: 'some-user-id',
	user: null,
	localOnly: false,
	isAIGenerated: false,
	hideFromMediaTimeline: false,
	isNovel: false,
	relayId: null,
	relay: null,
	reactionAcceptance: null,
	renoteCount: 0,
	repliesCount: 0,
	clippedCount: 0,
	pageCount: 0,
	reactions: {},
	visibility: 'public',
	uri: null,
	url: null,
	fileIds: [],
	attachedFileTypes: [],
	visibleUserIds: [],
	mentions: [],
	mentionedRemoteUsers: '',
	reactionAndUserPairCache: [],
	emojis: [],
	tags: [],
	hasPoll: false,
	channelId: null,
	channel: null,
	userHost: null,
	replyUserId: null,
	replyUserHost: null,
	renoteUserId: null,
	renoteUserHost: null,
	renoteChannelId: null,
};

describe('misc:is-language-filtered', () => {
	test('empty filteredLanguages should never filter', () => {
		const note: MiNote = { ...base, lang: 'en-US' };
		expect(isLanguageFiltered(note, new Set())).toBe(false);
	});

	// JUICE: 言語が分からない投稿は、絞り込みが有効でも表示する(Mastodonと同じ)
	test('note with unspecified language should not be filtered even when a filter is active', () => {
		const note: MiNote = { ...base, lang: null };
		expect(isLanguageFiltered(note, new Set(['ja-JP']))).toBe(false);
	});

	test('note with unspecified language should not be filtered when no filter is active', () => {
		const note: MiNote = { ...base, lang: null };
		expect(isLanguageFiltered(note, new Set())).toBe(false);
	});

	test('note with a language not in filteredLanguages should be filtered', () => {
		const note: MiNote = { ...base, lang: 'en-US' };
		expect(isLanguageFiltered(note, new Set(['ja-JP']))).toBe(true);
	});

	test('note with a language in filteredLanguages should not be filtered', () => {
		const note: MiNote = { ...base, lang: 'ja-JP' };
		expect(isLanguageFiltered(note, new Set(['ja-JP']))).toBe(false);
	});

	test('pure renote (no own text) should be judged by the renoted note\'s language', () => {
		const note = {
			...base,
			renoteId: 'some-renote-id',
			lang: null,
			renote: { ...base, id: 'some-renote-id', lang: 'en-US' },
		} as unknown as MiNote;
		expect(isLanguageFiltered(note, new Set(['ja-JP']))).toBe(true);
	});

	test('renote\'s own lang takes precedence over the renoted note\'s language', () => {
		const note = {
			...base,
			renoteId: 'some-renote-id',
			lang: 'ja-JP',
			renote: { ...base, id: 'some-renote-id', lang: 'en-US' },
		} as unknown as MiNote;
		expect(isLanguageFiltered(note, new Set(['ja-JP']))).toBe(false);
	});

	// JUICE: Mastodon/Pleroma/Akkoma等、リージョン無しの言語タグ(例: "en")との互換のため、
	// 主言語サブタグ単位で突き合わせる
	test('a region-less note lang (e.g. Mastodon/Pleroma/Akkoma style) should match a region-qualified filter entry', () => {
		const note: MiNote = { ...base, lang: 'en' };
		expect(isLanguageFiltered(note, new Set(['en-US']))).toBe(false);
	});

	test('a region-qualified note lang should match a region-less filter entry', () => {
		const note: MiNote = { ...base, lang: 'en-US' };
		expect(isLanguageFiltered(note, new Set(['en']))).toBe(false);
	});

	test('different regions of the same base language should still match', () => {
		const note: MiNote = { ...base, lang: 'en-GB' };
		expect(isLanguageFiltered(note, new Set(['en-US']))).toBe(false);
	});

	test('base language matching is case-insensitive', () => {
		const note: MiNote = { ...base, lang: 'EN-us' };
		expect(isLanguageFiltered(note, new Set(['en-US']))).toBe(false);
	});

	test('different base languages should still be filtered even if unrelated', () => {
		const note: MiNote = { ...base, lang: 'fr' };
		expect(isLanguageFiltered(note, new Set(['en-US']))).toBe(true);
	});

	// JUICE: 中国語(zh-*)はMastodon本体のLanguagesHelper::ISO_639_1_REGIONALと同様、
	// 主言語サブタグが同じでもリージョン/スクリプトが異なれば別言語として扱う
	// (簡体字/繁体字は同じ"zh"サブタグを共有するが別スクリプトのため)
	test('zh-CN and zh-TW should NOT match each other despite sharing the "zh" base tag', () => {
		const note: MiNote = { ...base, lang: 'zh-CN' };
		expect(isLanguageFiltered(note, new Set(['zh-TW']))).toBe(true);
	});

	test('zh-CN should still match an exact zh-CN filter entry', () => {
		const note: MiNote = { ...base, lang: 'zh-CN' };
		expect(isLanguageFiltered(note, new Set(['zh-CN']))).toBe(false);
	});

	test('a region-less "zh" note lang should NOT match a specific zh-CN/zh-TW filter entry (ambiguous script)', () => {
		const note: MiNote = { ...base, lang: 'zh' };
		expect(isLanguageFiltered(note, new Set(['zh-CN']))).toBe(true);
		expect(isLanguageFiltered(note, new Set(['zh-TW']))).toBe(true);
	});

	test('Portuguese is not treated as region-sensitive (pt-BR should match pt-PT)', () => {
		const note: MiNote = { ...base, lang: 'pt-BR' };
		expect(isLanguageFiltered(note, new Set(['pt-PT']))).toBe(false);
	});
});

// JUICE: Mastodon本体は受信したcontentMapのキーをリージョン無しの主言語サブタグ(中国語除く)
// としてしか正規化・照合しないため、連合へ送出する際はこの形へ切り詰める必要がある
describe('misc:canonicalizeLanguageTagForFederation', () => {
	test('region-qualified non-Chinese tags are truncated to the base subtag', () => {
		expect(canonicalizeLanguageTagForFederation('en-US')).toBe('en');
		expect(canonicalizeLanguageTagForFederation('ja-JP')).toBe('ja');
		expect(canonicalizeLanguageTagForFederation('pt-BR')).toBe('pt');
	});

	test('bare (region-less) tags are left unchanged', () => {
		expect(canonicalizeLanguageTagForFederation('en')).toBe('en');
	});

	test('Chinese region/script variants are preserved as-is', () => {
		expect(canonicalizeLanguageTagForFederation('zh-CN')).toBe('zh-CN');
		expect(canonicalizeLanguageTagForFederation('zh-TW')).toBe('zh-TW');
	});
});
