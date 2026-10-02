/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 小説ビューワーで読むテキストファイル(.txt)か。MIMEタイプが付いていないことがあるので、拡張子が.txtのものも含める
// (サーバーの misc/novel-text-file.ts と同じ判定)
export function isNovelTextFile(file: { type: string; name: string }): boolean {
	return file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
}
