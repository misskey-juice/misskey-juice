/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * JUICE: 絵文字のタグ(aliases)を、空白ごとに分けて揃える。
 * 1つのタグの中に全角スペース(U+3000)などの空白が入っていたら、そこで別のタグに分ける。空のタグと重複は除く
 */
export function normalizeEmojiAliases(aliases: string[]): string[] {
	return [...new Set(aliases.flatMap(alias => alias.split(/\s+/)).filter(alias => alias !== ''))];
}
