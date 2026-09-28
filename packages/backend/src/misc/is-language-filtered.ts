/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { MiNote } from '@/models/Note.js';
import type { Packed } from './json-schema.js';

// JUICE: 主言語サブタグが一致していても、リージョン/スクリプトの違いが別言語同然の意味を持つため
// 完全一致(大小無視)でしか突き合わせてはいけないもの。Mastodon本体のLanguagesHelper
// (ISO_639_1_REGIONAL、"Chinese, which is not a language but a language family in spite of
// sharing the main locale code"というコメント付き)に倣い、中国語(zh-CN/zh-HK/zh-TW/zh-YUE等)を
// 対象とする。ポルトガル語(pt-BR/pt-PT)はMastodon側でも表示名の出し分けのみで、言語フィルタ
// 対象のSUPPORTED_LOCALESには"pt"単独でしか登録されていないため、ここでは特別扱いしない
const REGION_SENSITIVE_BASE_LANGUAGE_TAGS = new Set(['zh']);

// JUICE: BCP 47言語タグの主言語サブタグ(先頭の"-"より前、小文字化)を取り出す。
// Mastodon/Pleroma/Akkomaはリージョンを含まない主言語サブタグのみ(例: "en"、"ja"。
// AkkomaのAP拡張ドキュメントにも"a sub key named after the language's ISO 639-1 code"と明記)を
// 送ってくることが多く、一方でMisskeyのアカウント言語設定・フィルター候補はリージョン付き
// (例: "en-US"、"ja-JP")を含むため、両者を完全一致だけで突き合わせるとほぼ一致しない。
// QueryService.generateLanguageFilterQuery(SQL/TypeORMパス)にも同じ正規化を実装している。
// この関数を変更した場合、そちらも変更する必要がある
function baseLanguageTag(lang: string): string {
	const i = lang.indexOf('-');
	return (i === -1 ? lang : lang.slice(0, i)).toLowerCase();
}

// JUICE: 2つの言語タグ(大小無視)が、表示言語フィルタの観点で同一言語とみなせるか。
// 主言語サブタグが一致していれば、REGION_SENSITIVE_BASE_LANGUAGE_TAGSに含まれる言語族
// (中国語)以外は同一言語とみなす。中国語はリージョン/スクリプトが完全一致する場合のみ一致とする
function languageTagsMatch(a: string, b: string): boolean {
	const baseA = baseLanguageTag(a);
	const baseB = baseLanguageTag(b);
	if (baseA !== baseB) return false;
	if (REGION_SENSITIVE_BASE_LANGUAGE_TAGS.has(baseA)) return a.toLowerCase() === b.toLowerCase();
	return true;
}

// JUICE: 連合(ActivityPubのcontentMap)へ言語タグを送出する際に、他実装(Mastodon/Akkoma等)が
// 正しく認識できる形へ正規化する。Mastodon本体は受信したcontentMapのキーを、リージョン付きの
// バリアントをほぼ持たないSUPPORTED_LOCALES(主言語サブタグのみ、中国語(zh-CN/zh-HK/zh-TW/
// zh-YUE)のみ例外)へ大小無視で正規化しようとするが、一致しなければ受け取った文字列をそのまま
// (正規化せず)status.languageへ保存する。さらに閲覧者側の言語フィルタ(chosen_languages、
// これもSUPPORTED_LOCALESの選択肢から選ぶため主言語サブタグのみが基本)はDB上で完全一致
// (Status.where(language: chosen_languages))でしか照合しないため、Misskeyのアカウント言語設定
// 由来のリージョン付きタグ(例: "en-US")をそのまま送るとMastodon側の言語フィルタで一切
// 認識されない。そのため主言語サブタグへ切り詰めて送る(中国語はリージョン/スクリプトを保持)。
// JUICE間の連合では、この関数を通さない生のnote.langを_juice_langとして別途送出し、
// 受信側(ApNoteService)はそちらを優先することでリージョン情報を失わない
export function canonicalizeLanguageTagForFederation(lang: string): string {
	const base = baseLanguageTag(lang);
	return REGION_SENSITIVE_BASE_LANGUAGE_TAGS.has(base) ? lang : base;
}

// JUICE: ユーザーが設定した表示言語の絞り込み(filteredLanguages)。空なら絞り込み無し。
// ノートに言語が指定されていない場合は、言語が分からないので絞り込まずに表示する(Mastodonと同じ。
// 以前は非表示にしていたが、言語を指定せずに書いたローカルの投稿がまとめて消えてしまっていた)。
// 突き合わせは完全一致ではなく主言語サブタグ単位(languageTagsMatch参照)で行う
// (Mastodon/Pleroma/Akkoma等、リージョン無しの言語タグとの互換のため)。
// 純粋なリノート(自身のテキストを持たない)は、リノート元ノートの言語で判定する。
export function isLanguageFiltered(note: Packed<'Note'> | MiNote, filteredLanguages: Set<string>): boolean {
	if (filteredLanguages.size === 0) return false;

	const lang = note.lang ?? note.renote?.lang ?? null;
	if (lang == null) return false;

	for (const filtered of filteredLanguages) {
		if (languageTagsMatch(lang, filtered)) return false;
	}
	return true;
}
