/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * JUICE: 絵文字のタグ(aliases)の入力欄の文字列を、タグごとに分ける。
 * 半角スペースだけでなく、全角スペース(U+3000)・タブ・改行などの空白でも区切る(JavaScriptの\sは全角スペースにも当たる)
 */
export function splitEmojiTags(text: string): string[] {
	return text.split(/\s+/).filter(tag => tag !== '');
}
