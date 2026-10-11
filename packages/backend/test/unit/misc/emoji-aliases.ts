/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { normalizeEmojiAliases } from '@/misc/emoji-aliases.js';

// JUICE: 絵文字のタグは、全角スペースなどの空白でも分ける
describe('normalizeEmojiAliases', () => {
	test('1つのタグの中の全角スペース・半角スペース・タブ・改行で分ける', () => {
		expect(normalizeEmojiAliases(['ねこ　かわいい', 'いぬ  とり', 'a\tb', 'c\nd'])).toEqual(['ねこ', 'かわいい', 'いぬ', 'とり', 'a', 'b', 'c', 'd']);
	});

	test('空のタグ・空白だけのタグと重複を除く(最初に出てきた順は保つ)', () => {
		expect(normalizeEmojiAliases(['', '　', ' ', 'ねこ', 'いぬ　ねこ'])).toEqual(['ねこ', 'いぬ']);
	});

	test('空白の無いタグはそのまま', () => {
		expect(normalizeEmojiAliases(['ねこ', 'cat_face'])).toEqual(['ねこ', 'cat_face']);
	});
});
