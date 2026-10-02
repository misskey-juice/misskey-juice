/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { defineAsyncComponent } from 'vue';
import { selectDriveFolder } from './drive.js';
import type { MenuItem } from '@/types/menu.js';
import { i18n } from '@/i18n.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { prefer } from '@/preferences.js';
import { globalEvents } from '@/events.js';

function rename(file: Misskey.entities.DriveFile) {
	os.inputText({
		title: i18n.ts.renameFile,
		placeholder: i18n.ts.inputNewFileName,
		default: file.name,
	}).then(({ canceled, result: name }) => {
		if (canceled) return;
		misskeyApi('drive/files/update', {
			fileId: file.id,
			name: name,
		}).then(updated => {
			globalEvents.emit('driveFilesUpdated', [updated]);
		});
	});
}

async function describe(file: Misskey.entities.DriveFile) {
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkFileCaptionEditWindow.vue').then(x => x.default), {
		default: file.comment ?? '',
		file: file,
	}, {
		done: caption => {
			misskeyApi('drive/files/update', {
				fileId: file.id,
				comment: caption.length === 0 ? null : caption,
			}).then(updated => {
				globalEvents.emit('driveFilesUpdated', [updated]);
			});
		},
		closed: () => dispose(),
	});
}

function move(file: Misskey.entities.DriveFile) {
	selectDriveFolder(null).then(({ canceled, folders }) => {
		if (canceled) return;
		misskeyApi('drive/files/update', {
			fileId: file.id,
			folderId: folders[0] ? folders[0].id : null,
		}).then(updated => {
			globalEvents.emit('driveFilesUpdated', [updated]);
		});
	});
}

function toggleSensitive(file: Misskey.entities.DriveFile) {
	misskeyApi('drive/files/update', {
		fileId: file.id,
		isSensitive: !file.isSensitive,
	}).then(updated => {
		globalEvents.emit('driveFilesUpdated', [updated]);
	}).catch(err => {
		os.alert({
			type: 'error',
			title: i18n.ts.error,
			text: err.message,
		});
	});
}

function toggleAIGenerated(file: Misskey.entities.DriveFile) {
	misskeyApi('drive/files/update', {
		fileId: file.id,
		isAIGenerated: !file.isAIGenerated,
	}).then(updated => {
		globalEvents.emit('driveFilesUpdated', [updated]);
	}).catch(err => {
		os.alert({
			type: 'error',
			title: i18n.ts.error,
			text: err.message,
		});
	});
}

// JUICE: .txtファイルに「小説」フラグを付け外しする。フラグ付きのファイルを投稿フォームで
// 添付すると、投稿自体にも自動で「小説」フラグが立つ
function toggleNovel(file: Misskey.entities.DriveFile) {
	misskeyApi('drive/files/update', {
		fileId: file.id,
		isNovel: !file.isNovel,
	}).then(updated => {
		globalEvents.emit('driveFilesUpdated', [updated]);
	}).catch(err => {
		os.alert({
			type: 'error',
			title: i18n.ts.error,
			text: err.message,
		});
	});
}

// JUICE: 小説のtxtを、ほかの人にダウンロードさせない(小説ビューワーで本文だけを読ませる)
function toggleNovelDownloadDisabled(file: Misskey.entities.DriveFile) {
	misskeyApi('drive/files/update', {
		fileId: file.id,
		novelDownloadDisabled: !file.novelDownloadDisabled,
	}).then(updated => {
		globalEvents.emit('driveFilesUpdated', [updated]);
	}).catch(err => {
		os.alert({
			type: 'error',
			title: i18n.ts.error,
			text: err.message,
		});
	});
}

function copyUrl(file: Misskey.entities.DriveFile) {
	copyToClipboard(file.url);
}

/*
function addApp() {
	alert('not implemented yet');
}
*/
async function deleteFile(file: Misskey.entities.DriveFile) {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx.driveFileDeleteConfirm({ name: file.name }),
	});
	if (canceled) return;

	await os.apiWithDialog('drive/files/delete', {
		fileId: file.id,
	});

	globalEvents.emit('driveFilesDeleted', [file]);
}

// JUICE: 小説ビューワーが本文として読み込める.txtファイルかどうか(novel-viewer.vueと同じ判定)
function isTextFile(file: Misskey.entities.DriveFile): boolean {
	return file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt');
}

/** 自分のドライブファイルを操作する際のメニュー */
export function getDriveFileMenu(file: Misskey.entities.DriveFile, folder?: Misskey.entities.DriveFolder | null): MenuItem[] {
	const _isImage = file.type.startsWith('image/');

	const menuItems: MenuItem[] = [];

	menuItems.push({
		type: 'link',
		to: `/my/drive/file/${file.id}`,
		text: i18n.ts._fileViewer.title,
		icon: 'ti ti-info-circle',
	}, { type: 'divider' }, {
		text: i18n.ts.rename,
		icon: 'ti ti-forms',
		action: () => rename(file),
	}, {
		text: i18n.ts.move,
		icon: 'ti ti-folder-symlink',
		action: () => move(file),
	}, {
		text: file.isSensitive ? i18n.ts.unmarkAsSensitive : i18n.ts.markAsSensitive,
		icon: file.isSensitive ? 'ti ti-eye' : 'ti ti-eye-exclamation',
		action: () => toggleSensitive(file),
	}, {
		text: file.isAIGenerated ? i18n.ts.unmarkAsAIGenerated : i18n.ts.markAsAIGenerated,
		icon: 'ti ti-ai _juiceAiIcon',
		badge: true,
		action: () => toggleAIGenerated(file),
	}, ...(isTextFile(file) ? [{
		text: file.isNovel ? i18n.ts._juice.unmarkAsNovel : i18n.ts._juice.markAsNovel,
		icon: 'ti ti-book',
		badge: true,
		action: () => toggleNovel(file),
	}, {
		text: file.novelDownloadDisabled ? i18n.ts._juice.allowNovelDownload : i18n.ts._juice.disallowNovelDownload,
		icon: file.novelDownloadDisabled ? 'ti ti-download' : 'ti ti-download-off',
		badge: true,
		action: () => toggleNovelDownloadDisabled(file),
	}] : []), {
		text: i18n.ts.describeFile,
		icon: 'ti ti-text-caption',
		action: () => describe(file),
	});

	menuItems.push({ type: 'divider' }, {
		text: i18n.ts.createNoteFromTheFile,
		icon: 'ti ti-pencil',
		action: () => os.post({
			initialFiles: [file],
			instant: true,
		}),
	}, {
		text: i18n.ts.copyUrl,
		icon: 'ti ti-link',
		action: () => copyUrl(file),
	}, {
		type: 'a',
		href: file.url,
		target: '_blank',
		text: i18n.ts.download,
		icon: 'ti ti-download',
		download: file.name,
	}, { type: 'divider' }, {
		text: i18n.ts.delete,
		icon: 'ti ti-trash',
		danger: true,
		action: () => deleteFile(file),
	});

	if (prefer.s.devMode) {
		menuItems.push({ type: 'divider' }, {
			icon: 'ti ti-hash',
			text: i18n.ts.copyFileId,
			action: () => {
				copyToClipboard(file.id);
			},
		});
	}

	return menuItems;
}
