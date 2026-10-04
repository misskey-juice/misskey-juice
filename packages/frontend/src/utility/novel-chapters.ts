/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 小説ビューワーの、章タイトル([chapter:タイトル])での章分け

// タイトルの中にルビ記法 [[rb:…]] を含めてもよい(途中の ] で打ち切らない)。
// 改行はまたがない(閉じ忘れたときに、後ろの本文まで題名にしないように。エディターの目次と同じ)
export const CHAPTER_TITLE_PATTERN = /\[chapter:\s*((?:\[\[rb:[^\]\n]*\]\]|[^\]\n])*?)\s*\]/g;

export type NovelChapterPiece = {
	text: string;
	// この章の前(前の章の本文の終わりから、章タイトルの行の頭まで)に、原文にあった改行の数(行末の改行+空行)。
	// 章の本文は前後の空白を落とすので、縦書きで章タイトルを新しい行から始める・空行を再現するのに使う。最初の章は0
	breaksBefore: number;
};

// [chapter:タイトル] のある行から新しい章にする(その前に本文があるときだけ。区切り線・改ページのすぐ後の
// 章タイトルは、その章の題名にする)。区切り線を入れずに章タイトルだけを並べた作品でも、全ての章が目次に出るように
// (エディターの目次 buildNovelOutline と同じ数え方)
export function splitByChapterTitles(part: string): NovelChapterPiece[] {
	const starts: number[] = [];
	let last = 0;
	for (const m of part.matchAll(CHAPTER_TITLE_PATTERN)) {
		const lineStart = part.lastIndexOf('\n', m.index) + 1;
		if (lineStart <= last) continue;
		if (part.slice(last, lineStart).trim() === '') continue;
		starts.push(lineStart);
		last = lineStart;
	}
	const raws: string[] = [];
	let from = 0;
	for (const start of starts) {
		raws.push(part.slice(from, start));
		from = start;
	}
	raws.push(part.slice(from));
	const pieces: NovelChapterPiece[] = [];
	let breaks = 0;
	for (const raw of raws) {
		const text = raw.trim();
		if (text.length > 0) pieces.push({ text, breaksBefore: pieces.length === 0 ? 0 : breaks });
		// 次の章の前にあった改行の数(空白だけの行も空行として数える)
		breaks = (raw.slice(raw.trimEnd().length).match(/\n/g) ?? []).length;
	}
	return pieces;
}
