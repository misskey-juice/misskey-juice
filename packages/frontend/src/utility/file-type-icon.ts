/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: ファイルの種類(MIMEタイプ)に合ったアイコン。ドライブのサムネイル(MkDriveFileThumbnail)と同じ分け方にする

const ARCHIVE_TYPES = [
	'application/zip',
	'application/x-cpio',
	'application/x-bzip',
	'application/x-bzip2',
	'application/java-archive',
	'application/x-rar-compressed',
	'application/x-tar',
	'application/gzip',
	'application/x-7z-compressed',
];

export function fileTypeIcon(type: string): string {
	if (type.startsWith('image/')) return 'ti ti-photo';
	if (type.startsWith('video/')) return 'ti ti-video';
	if (type.startsWith('audio/')) return 'ti ti-file-music';
	if (type.endsWith('/csv') || type.endsWith('/pdf') || type.startsWith('text/')) return 'ti ti-file-text';
	if (ARCHIVE_TYPES.includes(type)) return 'ti ti-file-zip';
	return 'ti ti-file';
}
