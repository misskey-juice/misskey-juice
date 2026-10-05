/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * note - 通知オンにしているユーザーが投稿した
 * follow - フォローされた
 * mention - 投稿で自分が言及された
 * reply - 投稿に返信された
 * renote - 投稿がRenoteされた
 * quote - 投稿が引用Renoteされた
 * reaction - 投稿にリアクションされた
 * pollEnded - 自分のアンケートもしくは自分が投票したアンケートが終了した
 * scheduledNotePosted - 予約したノートが投稿された
 * scheduledNotePostFailed - 予約したノートの投稿に失敗した
 * receiveFollowRequest - フォローリクエストされた
 * followRequestAccepted - 自分の送ったフォローリクエストが承認された
 * roleAssigned - ロールが付与された
 * chatRoomInvitationReceived - チャットルームに招待された
 * achievementEarned - 実績を獲得
 * exportCompleted - エクスポートが完了
 * login - ログイン
 * loginFailed - ログイン試行に失敗した(JUICE)
 * emojiRequestApproved - 絵文字申請が承認された(JUICE)
 * emojiRequestRejected - 絵文字申請が却下された(JUICE)
 * avatarDecorationRequestApproved - アバターデコレーション申請が承認された(JUICE)
 * avatarDecorationRequestRejected - アバターデコレーション申請が却下された(JUICE)
 * importRequestApproved - インポートの申請が承認された(JUICE)
 * importRequestRejected - インポートの申請が却下された(JUICE)
 * createToken - トークン作成
 * app - アプリ通知
 * test - テスト通知（サーバー側）
 */
export const notificationTypes = [
	'note',
	'follow',
	'mention',
	'reply',
	'renote',
	'quote',
	'reaction',
	'pollEnded',
	'scheduledNotePosted',
	'scheduledNotePostFailed',
	'receiveFollowRequest',
	'followRequestAccepted',
	'roleAssigned',
	'chatRoomInvitationReceived',
	'achievementEarned',
	'exportCompleted',
	'login',
	// JUICE: misskey-tempuraを参考に追加
	'loginFailed',
	// JUICE
	'emojiRequestApproved',
	'emojiRequestRejected',
	'avatarDecorationRequestApproved',
	'avatarDecorationRequestRejected',
	'importRequestApproved',
	'importRequestRejected',
	// JUICE: モデレーター・canApproveXxxロールポリシー保持者向け、新着申請の通知
	'newEmojiRequest',
	'newAvatarDecorationRequest',
	'newImportRequest',
	'newSignupApplication',
	'newContactForm',
	// JUICE: モデレーター向け、新着通報の通知
	'newAbuseUserReport',
	'createToken',
	'app',
	'test',
] as const;

export const groupedNotificationTypes = [
	...notificationTypes,
	'reaction:grouped',
	'renote:grouped',
] as const;

export const obsoleteNotificationTypes = ['pollVote', 'groupInvited'] as const;

export const noteVisibilities = ['public', 'home', 'followers', 'specified'] as const;

export const noteReactionAcceptances = ['likeOnly', 'likeOnlyForRemote', 'nonSensitiveOnly', 'nonSensitiveOnlyForLocalLikeOnlyForRemote', null] as const;

export const mutedNoteReasons = ['word', 'manual', 'spam', 'other'] as const;

export const followingVisibilities = ['public', 'followers', 'private'] as const;
export const followersVisibilities = ['public', 'followers', 'private'] as const;

/**
 * ユーザーがエクスポートできるものの種類
 *
 * （主にエクスポート完了通知で使用するものであり、既存のDBの名称等と必ずしも一致しない）
 */
export const userExportableEntities = ['antenna', 'blocking', 'clip', 'customEmoji', 'favorite', 'following', 'muting', 'note', 'userList'] as const;

/**
 * ユーザーがインポートできるものの種類
 *
 * （主にインポート完了通知で使用するものであり、既存のDBの名称等と必ずしも一致しない）
 */
export const userImportableEntities = ['antenna', 'blocking', 'customEmoji', 'following', 'muting', 'userList'] as const;

export const moderationLogTypes = [
	'updateServerSettings',
	'suspend',
	'unsuspend',
	'updateUserNote',
	'addCustomEmoji',
	'updateCustomEmoji',
	'deleteCustomEmoji',
	'assignRole',
	'unassignRole',
	'createRole',
	'updateRole',
	'deleteRole',
	'clearQueue',
	'promoteQueue',
	'pauseQueue',
	'resumeQueue',
	'deleteDriveFile',
	'deleteNote',
	'createGlobalAnnouncement',
	'createUserAnnouncement',
	'updateGlobalAnnouncement',
	'updateUserAnnouncement',
	'deleteGlobalAnnouncement',
	'deleteUserAnnouncement',
	'resetPassword',
	'suspendRemoteInstance',
	'unsuspendRemoteInstance',
	'updateRemoteInstanceNote',
	'markSensitiveDriveFile',
	'unmarkSensitiveDriveFile',
	'resolveAbuseReport',
	'forwardAbuseReport',
	'updateAbuseReportNote',
	'createInvitation',
	'createAd',
	'updateAd',
	'deleteAd',
	'createAvatarDecoration',
	'updateAvatarDecoration',
	'deleteAvatarDecoration',
	'unsetMfa',
	'unsetUserAvatar',
	'unsetUserBanner',
	'createSystemWebhook',
	'updateSystemWebhook',
	'deleteSystemWebhook',
	'createAbuseReportNotificationRecipient',
	'updateAbuseReportNotificationRecipient',
	'deleteAbuseReportNotificationRecipient',
	'deleteAccount',
	'deletePage',
	'deleteFlash',
	'deleteGalleryPost',
	'deleteChatRoom',
	'updateProxyAccountDescription',
	'updateJuiceSettings',
	'approveSignup',
	'declineSignup',
	'approveEmojiRequest',
	'rejectEmojiRequest',
	'approveAvatarDecorationRequest',
	'rejectAvatarDecorationRequest',
	'approveImportRequest',
	'rejectImportRequest',
	// JUICE
	'cleanupOrphanedObjectStorageFiles',
	'deleteDrawRoom',
] as const;

export type ModerationLogPayloads = {
	updateServerSettings: {
		before: any | null;
		after: any | null;
	};
	suspend: {
		userId: string;
		userUsername: string;
		userHost: string | null;
	};
	unsuspend: {
		userId: string;
		userUsername: string;
		userHost: string | null;
	};
	updateUserNote: {
		userId: string;
		userUsername: string;
		userHost: string | null;
		before: string | null;
		after: string | null;
	};
	addCustomEmoji: {
		emojiId: string;
		emoji: any;
	};
	updateCustomEmoji: {
		emojiId: string;
		before: any;
		after: any;
	};
	deleteCustomEmoji: {
		emojiId: string;
		emoji: any;
	};
	assignRole: {
		userId: string;
		userUsername: string;
		userHost: string | null;
		roleId: string;
		roleName: string;
		expiresAt: string | null;
	};
	unassignRole: {
		userId: string;
		userUsername: string;
		userHost: string | null;
		roleId: string;
		roleName: string;
	};
	createRole: {
		roleId: string;
		role: any;
	};
	updateRole: {
		roleId: string;
		before: any;
		after: any;
	};
	deleteRole: {
		roleId: string;
		role: any;
	};
	clearQueue: Record<string, never>;
	promoteQueue: Record<string, never>;
	pauseQueue: Record<string, never>;
	resumeQueue: Record<string, never>;
	deleteDriveFile: {
		fileId: string;
		fileUserId: string | null;
		fileUserUsername: string | null;
		fileUserHost: string | null;
	};
	deleteNote: {
		noteId: string;
		noteUserId: string;
		noteUserUsername: string;
		noteUserHost: string | null;
		note: any;
	};
	createGlobalAnnouncement: {
		announcementId: string;
		announcement: any;
	};
	createUserAnnouncement: {
		announcementId: string;
		announcement: any;
		userId: string;
		userUsername: string;
		userHost: string | null;
	};
	updateGlobalAnnouncement: {
		announcementId: string;
		before: any;
		after: any;
	};
	updateUserAnnouncement: {
		announcementId: string;
		before: any;
		after: any;
		userId: string;
		userUsername: string;
		userHost: string | null;
	};
	deleteGlobalAnnouncement: {
		announcementId: string;
		announcement: any;
	};
	deleteUserAnnouncement: {
		announcementId: string;
		announcement: any;
		userId: string;
		userUsername: string;
		userHost: string | null;
	};
	resetPassword: {
		userId: string;
		userUsername: string;
		userHost: string | null;
	};
	suspendRemoteInstance: {
		id: string;
		host: string;
	};
	unsuspendRemoteInstance: {
		id: string;
		host: string;
	};
	updateRemoteInstanceNote: {
		id: string;
		host: string;
		before: string | null;
		after: string | null;
	};
	markSensitiveDriveFile: {
		fileId: string;
		fileUserId: string | null;
		fileUserUsername: string | null;
		fileUserHost: string | null;
	};
	unmarkSensitiveDriveFile: {
		fileId: string;
		fileUserId: string | null;
		fileUserUsername: string | null;
		fileUserHost: string | null;
	};
	resolveAbuseReport: {
		reportId: string;
		report: any;
		forwarded?: boolean;
		resolvedAs?: string | null;
	};
	forwardAbuseReport: {
		reportId: string;
		report: any;
	};
	updateAbuseReportNote: {
		reportId: string;
		report: any;
		before: string;
		after: string;
	};
	createInvitation: {
		invitations: any[];
	};
	createAd: {
		adId: string;
		ad: any;
	};
	updateAd: {
		adId: string;
		before: any;
		after: any;
	};
	deleteAd: {
		adId: string;
		ad: any;
	};
	createAvatarDecoration: {
		avatarDecorationId: string;
		avatarDecoration: any;
	};
	updateAvatarDecoration: {
		avatarDecorationId: string;
		before: any;
		after: any;
	};
	deleteAvatarDecoration: {
		avatarDecorationId: string;
		avatarDecoration: any;
	};
	unsetMfa: {
		userId: string;
		userUsername: string;
		userHost: string | null;
	};
	unsetUserAvatar: {
		userId: string;
		userUsername: string;
		userHost: string | null;
		fileId: string;
	};
	unsetUserBanner: {
		userId: string;
		userUsername: string;
		userHost: string | null;
		fileId: string;
	};
	createSystemWebhook: {
		systemWebhookId: string;
		webhook: any;
	};
	updateSystemWebhook: {
		systemWebhookId: string;
		before: any;
		after: any;
	};
	deleteSystemWebhook: {
		systemWebhookId: string;
		webhook: any;
	};
	createAbuseReportNotificationRecipient: {
		recipientId: string;
		recipient: any;
	};
	updateAbuseReportNotificationRecipient: {
		recipientId: string;
		before: any;
		after: any;
	};
	deleteAbuseReportNotificationRecipient: {
		recipientId: string;
		recipient: any;
	};
	deleteAccount: {
		userId: string;
		userUsername: string;
		userHost: string | null;
	};
	deletePage: {
		pageId: string;
		pageUserId: string;
		pageUserUsername: string;
		page: any;
	};
	deleteFlash: {
		flashId: string;
		flashUserId: string;
		flashUserUsername: string;
		flash: any;
	};
	deleteGalleryPost: {
		postId: string;
		postUserId: string;
		postUserUsername: string;
		post: any;
	};
	deleteChatRoom: {
		roomId: string;
		room: any;
	};
	updateProxyAccountDescription: {
		before: string | null;
		after: string | null;
	};
	updateJuiceSettings: {
		before: any | null;
		after: any | null;
	};
	approveSignup: {
		userId: string;
		userUsername: string;
		userHost: string | null;
	};
	declineSignup: {
		userId: string;
		userUsername: string;
		userHost: string | null;
		reason: string;
	};
	approveEmojiRequest: {
		requestId: string;
		requesterId: string;
		requesterUsername: string;
		requesterHost: string | null;
		emojiId: string;
		emojiName: string;
		// JUICE: 差し替え申請(既存の絵文字の画像だけを差し替える)の承認かどうか
		isReplacement: boolean;
	};
	rejectEmojiRequest: {
		requestId: string;
		requesterId: string;
		requesterUsername: string;
		requesterHost: string | null;
		requestedName: string;
		reason: string;
	};
	approveAvatarDecorationRequest: {
		requestId: string;
		requesterId: string;
		requesterUsername: string;
		requesterHost: string | null;
		avatarDecorationId: string;
		avatarDecorationName: string;
		// JUICE: 差し替え申請(既存のデコレーションの画像だけを差し替える)の承認かどうか
		isReplacement: boolean;
	};
	rejectAvatarDecorationRequest: {
		requestId: string;
		requesterId: string;
		requesterUsername: string;
		requesterHost: string | null;
		requestedName: string;
		reason: string;
	};
	// JUICE: 承認式にしたインポートの承認・却下
	approveImportRequest: {
		requestId: string;
		requesterId: string;
		requesterUsername: string;
		requesterHost: string | null;
		importType: string;
		fileName: string;
	};
	rejectImportRequest: {
		requestId: string;
		requesterId: string;
		requesterUsername: string;
		requesterHost: string | null;
		importType: string;
		fileName: string;
		reason: string;
	};
	// JUICE
	cleanupOrphanedObjectStorageFiles: {
		dryRun: boolean;
		scanned: number;
		deletedCount: number;
		deletedKeys: string[];
		failedKeys: string[];
	};
	// JUICE: モデレーターによる絵チャの部屋の削除
	deleteDrawRoom: {
		roomId: string;
		room: {
			id: string;
			title: string;
			ownerId: string;
			ownerUsername: string;
			ownerHost: string | null;
			visibility: string;
			isEnded: boolean;
		};
	};
};

export type Serialized<T> = {
	[K in keyof T]:
	T[K] extends Date
		? string
		: T[K] extends (Date | null)
			? (string | null)
			: T[K] extends Record<string, any>
				? Serialized<T[K]>
				: T[K] extends (Record<string, any> | null)
					? (Serialized<T[K]> | null)
					: T[K] extends (Record<string, any> | undefined)
						? (Serialized<T[K]> | undefined)
						: T[K];
};

export type FilterUnionByProperty<
	Union,
	Property extends string | number | symbol,
	Condition,
> = Union extends Record<Property, Condition> ? Union : never;

export type Awaitable<T> = T | Promise<T>;
