/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, test, expect } from 'vitest';
import { CHAPTER_TITLE_PATTERN, splitByChapterTitles } from '@/utility/novel-chapters.js';

describe('splitByChapterTitles', () => {
	test('章タイトルの行から新しい章にし、その前の改行の数(空行を含む)を持つ', () => {
		const pieces = splitByChapterTitles('[chapter:彼はどこか]\n私は彼を探している。\n\n——\n\n[chapter:何だっけ]\nこの物語は唐突に終わってしまった。');
		expect(pieces).toEqual([
			{ text: '[chapter:彼はどこか]\n私は彼を探している。\n\n——', breaksBefore: 0 },
			{ text: '[chapter:何だっけ]\nこの物語は唐突に終わってしまった。', breaksBefore: 2 },
		]);
	});

	test('空行が無ければ改行は1つ', () => {
		expect(splitByChapterTitles('a\n[chapter:x]\nb').map(p => p.breaksBefore)).toEqual([0, 1]);
	});

	test('空白だけの行も空行として数える', () => {
		const pieces = splitByChapterTitles('a\n[chapter:x]\nb\n　\n\n\n[chapter:y]\nc\n');
		expect(pieces.map(p => p.breaksBefore)).toEqual([0, 1, 4]);
		expect(pieces.map(p => p.text)).toEqual(['a', '[chapter:x]\nb', '[chapter:y]\nc']);
	});

	test('前に本文が無い章タイトルでは分けない', () => {
		expect(splitByChapterTitles('[chapter:x]\nbody')).toEqual([{ text: '[chapter:x]\nbody', breaksBefore: 0 }]);
		expect(splitByChapterTitles('\n\n[chapter:x]\nbody')).toEqual([{ text: '[chapter:x]\nbody', breaksBefore: 0 }]);
	});

	test('行の途中の章タイトルは、その行の頭で分ける', () => {
		expect(splitByChapterTitles('a\nfoo [chapter:x] bar')).toEqual([
			{ text: 'a', breaksBefore: 0 },
			{ text: 'foo [chapter:x] bar', breaksBefore: 1 },
		]);
	});

	test('同じ行に章タイトルが2つあっても、章は増えない', () => {
		expect(splitByChapterTitles('a\n[chapter:x][chapter:y]\nb').length).toBe(2);
	});

	test('空・空白だけなら章は無い', () => {
		expect(splitByChapterTitles('')).toEqual([]);
		expect(splitByChapterTitles(' \n　\n')).toEqual([]);
	});

	test('題名の中のルビ記法の ] で題名を打ち切らない', () => {
		const m = [...'[chapter:[[rb:彼 > かれ]]の話]'.matchAll(CHAPTER_TITLE_PATTERN)];
		expect(m.length).toBe(1);
		expect(m[0][1]).toBe('[[rb:彼 > かれ]]の話');
	});
});
