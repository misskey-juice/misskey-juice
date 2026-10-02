/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 小説ビューワーで読むテキストファイル(.txt)か。フロントエンドの小説ビューワーと同じ判定
export function isNovelTextFile(file: { type: string; name: string }): boolean {
	return file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
}

// JUICE: ノートの添付のうち、小説ビューワーで読むファイル(「小説」フラグの付いたものを優先)
export function pickNovelTextFile<T extends { type: string; name: string; isNovel: boolean }>(files: T[]): T | null {
	const textFiles = files.filter(isNovelTextFile);
	return textFiles.find(file => file.isNovel) ?? textFiles[0] ?? null;
}
