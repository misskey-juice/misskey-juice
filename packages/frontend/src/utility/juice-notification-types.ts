/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { notificationTypes } from 'misskey-js';

// JUICE: 本家に無いJUICE独自の通知種別であることを示すバッジ(_juiceクラス)を出す対象
export const juiceNotificationTypes: readonly (typeof notificationTypes[number])[] = [
	'loginFailed',
	'emojiRequestApproved',
	'emojiRequestRejected',
	'avatarDecorationRequestApproved',
	'avatarDecorationRequestRejected',
	'importRequestApproved',
	'importRequestRejected',
	'newEmojiRequest',
	'newAvatarDecorationRequest',
	'newImportRequest',
	'newSignupApplication',
	'newContactForm',
	'newAbuseUserReport',
];
