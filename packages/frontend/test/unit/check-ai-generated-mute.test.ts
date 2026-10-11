/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { checkAIGeneratedMute } from '@/utility/check-ai-generated-mute.js';
import { splitEmojiTags } from '@/utility/emoji-tags.js';

// JUICE: AI生成物のミュートは、ノートのフラグだけでなく、添付ファイルのフラグも見る
describe('checkAIGeneratedMute', () => {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const me = (mode: 'none' | 'mute' | 'hardMute') => ({ id: 'me', muteAIGeneratedNotes: mode }) as any;

	test('ノートにフラグがあれば、設定どおりにミュートする', () => {
		expect(checkAIGeneratedMute({ userId: 'other', isAIGenerated: true }, me('mute'))).toBe('mute');
		expect(checkAIGeneratedMute({ userId: 'other', isAIGenerated: true }, me('hardMute'))).toBe('hardMute');
	});

	test('ノートにフラグが無くても、添付ファイルのどれかにフラグがあればミュートする', () => {
		const note = { userId: 'other', isAIGenerated: false, files: [{ isAIGenerated: false }, { isAIGenerated: true }] };
		expect(checkAIGeneratedMute(note, me('mute'))).toBe('mute');
		expect(checkAIGeneratedMute(note, me('hardMute'))).toBe('hardMute');
	});

	test('ノートにも添付ファイルにもフラグが無ければ、ミュートしない', () => {
		expect(checkAIGeneratedMute({ userId: 'other', isAIGenerated: false, files: [{ isAIGenerated: false }] }, me('hardMute'))).toBe('none');
		expect(checkAIGeneratedMute({ userId: 'other', isAIGenerated: false }, me('hardMute'))).toBe('none');
	});

	test('自分の投稿と、設定がオフのときはミュートしない', () => {
		const note = { userId: 'me', isAIGenerated: false, files: [{ isAIGenerated: true }] };
		expect(checkAIGeneratedMute(note, me('hardMute'))).toBe('none');
		expect(checkAIGeneratedMute({ ...note, userId: 'other' }, me('none'))).toBe('none');
		expect(checkAIGeneratedMute({ ...note, userId: 'other' }, null)).toBe('none');
	});
});

// JUICE: 絵文字のタグの入力欄は、全角スペースでも区切る
describe('splitEmojiTags', () => {
	test('半角スペース・全角スペース・続いた空白で分け、空のタグは作らない', () => {
		expect(splitEmojiTags('ねこ　かわいい  いぬ')).toEqual(['ねこ', 'かわいい', 'いぬ']);
		expect(splitEmojiTags('　ねこ ')).toEqual(['ねこ']);
		expect(splitEmojiTags('')).toEqual([]);
		expect(splitEmojiTags('　 ')).toEqual([]);
	});
});
