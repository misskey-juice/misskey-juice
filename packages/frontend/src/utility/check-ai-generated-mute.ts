/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import * as Misskey from 'misskey-js';
import type { $i } from '@/i.js';

// AI生成物としてマークされたノートの扱い(JUICE)。
// checkWordMute (utility/check-word-mute.ts) の自己除外パターンを踏襲する。
// none: 通常表示、mute: 折りたたみ表示、hardMute: 完全に非表示
// ノートそのものにフラグが無くても、添付ファイルのどれかにAI生成物のフラグが付いていれば対象にする
// (画像だけにフラグを付けた投稿も、AI生成物を含む投稿として扱う)
export function checkAIGeneratedMute(note: Pick<Misskey.entities.Note, 'userId' | 'isAIGenerated'> & { files?: Pick<Misskey.entities.DriveFile, 'isAIGenerated'>[] }, me: typeof $i): 'none' | 'mute' | 'hardMute' {
	if (!me || !me.muteAIGeneratedNotes || me.muteAIGeneratedNotes === 'none') return 'none';

	// 自分自身
	if (note.userId === me.id) return 'none';

	if (!note.isAIGenerated && !(note.files ?? []).some(file => file.isAIGenerated)) return 'none';

	return me.muteAIGeneratedNotes;
}
