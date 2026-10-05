/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { userExportableEntities } from '@/types.js';
import { MiUser } from './User.js';
import { MiNote } from './Note.js';
import { MiAccessToken } from './AccessToken.js';
import { MiRole } from './Role.js';
import { MiDriveFile } from './DriveFile.js';
import { MiNoteDraft } from './NoteDraft.js';
import type { ImportRequestType } from './ImportRequest.js';

// misskey-js の notificationTypes と同期すべし
export type MiNotification = {
	type: 'note';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'follow';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
} | {
	type: 'mention';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'reply';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'renote';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
	targetNoteId: MiNote['id'];
} | {
	type: 'quote';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'reaction';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
	reaction: string;
} | {
	type: 'pollEnded';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	noteId: MiNote['id'];
} | {
	type: 'scheduledNotePosted';
	id: string;
	createdAt: string;
	noteId: MiNote['id'];
} | {
	type: 'scheduledNotePostFailed';
	id: string;
	createdAt: string;
	noteDraftId: MiNoteDraft['id'];
} | {
	type: 'receiveFollowRequest';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
} | {
	type: 'followRequestAccepted';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	message: string | null;
} | {
	type: 'roleAssigned';
	id: string;
	createdAt: string;
	roleId: MiRole['id'];
} | {
	type: 'chatRoomInvitationReceived';
	id: string;
	createdAt: string;
	notifierId: MiUser['id'];
	invitationId: string;
} | {
	type: 'achievementEarned';
	id: string;
	createdAt: string;
	achievement: string;
} | {
	type: 'exportCompleted';
	id: string;
	createdAt: string;
	exportedEntity: typeof userExportableEntities[number];
	fileId: MiDriveFile['id'];
} | {
	type: 'login';
	id: string;
	createdAt: string;
} | {
	// JUICE: misskey-tempuraを参考に追加
	type: 'loginFailed';
	id: string;
	createdAt: string;
} | {
	// JUICE: 絵文字申請が承認されたとき
	type: 'emojiRequestApproved';
	id: string;
	createdAt: string;
	requestId: string;
	name: string;
} | {
	// JUICE: 絵文字申請が却下されたとき
	type: 'emojiRequestRejected';
	id: string;
	createdAt: string;
	requestId: string;
	name: string;
	reason: string | null;
} | {
	// JUICE: アバターデコレーション申請が承認されたとき
	type: 'avatarDecorationRequestApproved';
	id: string;
	createdAt: string;
	requestId: string;
	name: string;
} | {
	// JUICE: アバターデコレーション申請が却下されたとき
	type: 'avatarDecorationRequestRejected';
	id: string;
	createdAt: string;
	requestId: string;
	name: string;
	reason: string | null;
} | {
	// JUICE: インポートの申請が承認されたとき(インポートを始めた)
	type: 'importRequestApproved';
	id: string;
	createdAt: string;
	requestId: string;
	importType: ImportRequestType;
} | {
	// JUICE: インポートの申請が却下されたとき
	type: 'importRequestRejected';
	id: string;
	createdAt: string;
	requestId: string;
	importType: ImportRequestType;
	reason: string | null;
} | {
	// JUICE: インポートの申請が新しく来たとき(モデレーター・canApproveImportRequestsロールポリシー保持者向け)。
	// requesterIdについてはnewEmojiRequestと同じ理由でnotifierIdを使わない
	type: 'newImportRequest';
	id: string;
	createdAt: string;
	requesterId: MiUser['id'];
	requestId: string;
	importType: ImportRequestType;
} | {
	// JUICE: 絵文字申請が新しく来たとき(モデレーター・canApproveEmojiRequestsロールポリシー保持者向け)。
	// 申請者はnotifierIdではなくrequesterIdで持つ(あえて別フィールドにしている。notifierIdにすると
	// createNotification/NotificationEntityServiceの既存のミュートフィルタに引っかかり、モデレーターが
	// 申請者を(この件と無関係な理由で)ミュートしているだけで管理用の通知が黙って作られなくなるため。
	// 管理用通知はミュートの影響を受けてはならない)
	type: 'newEmojiRequest';
	id: string;
	createdAt: string;
	requesterId: MiUser['id'];
	requestId: string;
	name: string;
	category: string | null;
	// JUICE: 1回の送信でまとめて作られた申請の件数(requestId・nameは1件目)。前からある通知には無い(1件)
	count?: number;
} | {
	// JUICE: アバターデコレーション申請が新しく来たとき(モデレーター・canApproveAvatarDecorationRequestsロールポリシー保持者向け)。
	// requesterIdについてはnewEmojiRequestと同じ理由でnotifierIdを使わない
	type: 'newAvatarDecorationRequest';
	id: string;
	createdAt: string;
	requesterId: MiUser['id'];
	requestId: string;
	name: string;
	category: string | null;
	// JUICE: 1回の送信でまとめて作られた申請の件数(requestId・nameは1件目)。前からある通知には無い(1件)
	count?: number;
} | {
	// JUICE: 承認式新規登録の申請が新しく来たとき(モデレーター・canApproveSignupsロールポリシー保持者向け)。
	// applicantIdについてはnewEmojiRequestと同じ理由でnotifierIdを使わない
	type: 'newSignupApplication';
	id: string;
	createdAt: string;
	applicantId: MiUser['id']; // 申請者(登録待ちのユーザー)
	reason: string | null;
} | {
	// JUICE: お問い合わせが新しく来たとき(モデレーター・canProcessContactFormsロールポリシー保持者向け)。
	// お問い合わせにはメールアドレス・IPアドレス等のPIIが含まれうるため、送信者を特定できる情報
	// (notifierId等)は一切含めない(通知一覧からPIIが漏れることを防ぐ)
	type: 'newContactForm';
	id: string;
	createdAt: string;
	contactFormId: string;
	subject: string;
	category: string | null;
} | {
	// JUICE: 通報が新しく来たとき(モデレーター向け)。通報コメント・通報者は含めない
	// (newContactFormと同様、通知一覧に残る情報は最小限にし、詳細は通報管理画面で確認させる)
	type: 'newAbuseUserReport';
	id: string;
	createdAt: string;
	reportId: string;
	targetUserId: MiUser['id'];
	category: string | null;
} | {
	type: 'createToken';
	id: string;
	createdAt: string;
} | {
	type: 'app';
	id: string;
	createdAt: string;

	/**
	 * アプリ通知のbody
	 */
	customBody: string;

	/**
	 * アプリ通知のheader
	 * (省略時はアプリ名で表示されることを期待)
	 */
	customHeader: string | null;

	/**
	 * アプリ通知のicon(URL)
	 * (省略時はアプリアイコンで表示されることを期待)
	 */
	customIcon: string | null;

	/**
	 * アプリ通知のアプリ(のトークン)
	 */
	appAccessTokenId: MiAccessToken['id'] | null;
} | {
	type: 'test';
	id: string;
	createdAt: string;
};

export type MiGroupedNotification = MiNotification | {
	type: 'reaction:grouped';
	id: string;
	createdAt: string;
	noteId: MiNote['id'];
	reactions: {
		userId: string;
		reaction: string;
	}[];
} | {
	type: 'renote:grouped';
	id: string;
	createdAt: string;
	noteId: MiNote['id'];
	userIds: string[];
};
