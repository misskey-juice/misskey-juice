/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: お気に入りかどうかが分かっているノート(ノートの画面のお気に入りボタン用)。
// ノートごとにnotes/stateを問い合わせないので、お気に入りの一覧(ページ・デッキのカラム・ウィジェット)で出したノートや、
// お気に入りに登録・解除したノートだけを覚えておく。分からないノートはnull
import { reactive } from 'vue';
import { globalEvents } from '@/events.js';

const known = reactive(new Map<string, boolean>());

export function favoriteStateOf(noteId: string): boolean | null {
	return known.get(noteId) ?? null;
}

export function setFavoriteState(noteId: string, favorited: boolean): void {
	known.set(noteId, favorited);
}

// お気に入りの一覧に出したノートは、お気に入り済み
export function markFavorited(items: { noteId: string; note: { id: string } }[]): void {
	for (const item of items) {
		known.set(item.noteId, true);
		known.set(item.note.id, true);
	}
}

globalEvents.on('noteFavorited', noteId => known.set(noteId, true));
globalEvents.on('noteUnfavorited', noteId => known.set(noteId, false));
