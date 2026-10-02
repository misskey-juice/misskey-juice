/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 小説ビューワーの、行に挟むしおり。本文の章(data-novel-chapter="章の番号"の要素)の中の
// 何行目(改行で区切った行。折り返しは数えない)かで覚え、その行の書き出しも一緒に覚えておく
// (表示の設定で章や行の数え方が変わっても、書き出しで同じ行を探し直せるように)

export type NovelBookmark = {
	chapter: number;
	line: number;
	// 行の書き出し(行頭の空白・字下げを除いた最初の40文字)
	excerpt: string;
	createdAt: number;
};

const EXCERPT_LENGTH = 40;

export function lineExcerpt(line: string): string {
	return line.replace(/^[\s\u3000]+/, '').slice(0, EXCERPT_LENGTH);
}

/**
 * しおりの行を、今の本文(章ごとの行の並び)の中で探す。覚えた位置の行の書き出しが同じならそこ、
 * 違えば同じ書き出しの行のうち一番近いもの、それも無ければ覚えた位置(本文の範囲に収めたもの)
 */
export function resolveBookmark(chapterLines: readonly string[][], bookmark: Pick<NovelBookmark, 'chapter' | 'line' | 'excerpt'>): { chapter: number; line: number } | null {
	if (chapterLines.length === 0) return null;
	const exact = chapterLines[bookmark.chapter]?.[bookmark.line];
	if (exact != null && lineExcerpt(exact) === bookmark.excerpt) return { chapter: bookmark.chapter, line: bookmark.line };

	// 本文全体で何行目かで、近さを比べる
	let target = bookmark.line;
	for (let c = 0; c < Math.min(bookmark.chapter, chapterLines.length); c++) target += chapterLines[c].length;
	let best: { chapter: number; line: number } | null = null;
	let bestDistance = Infinity;
	if (bookmark.excerpt !== '') {
		let index = 0;
		for (const [c, lines] of chapterLines.entries()) {
			for (const [l, line] of lines.entries()) {
				if (lineExcerpt(line) === bookmark.excerpt && Math.abs(index - target) < bestDistance) {
					best = { chapter: c, line: l };
					bestDistance = Math.abs(index - target);
				}
				index++;
			}
		}
	}
	if (best != null) return best;
	const chapter = Math.min(Math.max(bookmark.chapter, 0), chapterLines.length - 1);
	return { chapter, line: Math.min(Math.max(bookmark.line, 0), Math.max(0, chapterLines[chapter].length - 1)) };
}

/**
 * 章の要素の中の位置(node, offset)が、その章の何行目か
 */
export function lineAtPosition(chapterEl: HTMLElement, node: Node, offset: number): number {
	const range = window.document.createRange();
	range.setStart(chapterEl, 0);
	range.setEnd(node, offset);
	// ルビのよみ(rt)には改行が無いので、そのまま数えてよい
	return (range.toString().match(/\n/g) ?? []).length;
}

/**
 * 章の要素の中の、line行目(改行の後から次の改行の前まで)の範囲
 */
export function lineRange(chapterEl: HTMLElement, line: number): Range | null {
	const walker = window.document.createTreeWalker(chapterEl, NodeFilter.SHOW_TEXT);
	let newlines = 0;
	let start: { node: Text; offset: number } | null = null;
	let end: { node: Text; offset: number } | null = null;
	let lastNode: Text | null = null;
	while (end == null && walker.nextNode()) {
		const node = walker.currentNode as Text;
		lastNode = node;
		if (start == null && line === 0) start = { node, offset: 0 };
		let from = 0;
		for (;;) {
			const i = node.data.indexOf('\n', from);
			if (i < 0) break;
			if (start != null) {
				end = { node, offset: i };
				break;
			}
			newlines++;
			if (newlines === line) start = { node, offset: i + 1 };
			from = i + 1;
		}
	}
	if (start == null || lastNode == null) return null;
	end ??= { node: lastNode, offset: lastNode.data.length };
	const range = window.document.createRange();
	range.setStart(start.node, start.offset);
	range.setEnd(end.node, end.offset);
	return range;
}

/**
 * 範囲の最初の部分の位置(行の書き出しのある所)。空の行など、位置が取れなければnull
 */
export function rangeStartRect(range: Range): DOMRect | null {
	const rects = range.getClientRects();
	for (const rect of rects) {
		if (rect.width > 0 || rect.height > 0) return rect;
	}
	const rect = range.getBoundingClientRect();
	return rect.width > 0 || rect.height > 0 ? rect : null;
}

type CaretDocument = Document & {
	caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
	caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

/**
 * 画面上の点にある文字の位置
 */
export function caretAtPoint(x: number, y: number): { node: Node; offset: number } | null {
	const doc = window.document as CaretDocument;
	if (typeof doc.caretPositionFromPoint === 'function') {
		const pos = doc.caretPositionFromPoint(x, y);
		if (pos != null) return { node: pos.offsetNode, offset: pos.offset };
	}
	if (typeof doc.caretRangeFromPoint === 'function') {
		const range = doc.caretRangeFromPoint(x, y);
		if (range != null) return { node: range.startContainer, offset: range.startOffset };
	}
	return null;
}

/**
 * 位置(node)を含む章の要素(rootの中にあるもの)
 */
export function chapterElementOf(root: HTMLElement, node: Node): HTMLElement | null {
	const el = node instanceof HTMLElement ? node : node.parentElement;
	const chapterEl = el?.closest<HTMLElement>('[data-novel-chapter]') ?? null;
	return chapterEl != null && root.contains(chapterEl) ? chapterEl : null;
}
