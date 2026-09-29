/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import * as Reversi from 'misskey-reversi';
import type { MiChannel } from '@/models/Channel.js';
import type { MiUser } from '@/models/User.js';
import type { MiAnnouncement } from '@/models/Announcement.js';
import type { MiUserProfile } from '@/models/UserProfile.js';
import type { MiNote } from '@/models/Note.js';
import type { MiAntenna } from '@/models/Antenna.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import type { MiDriveFolder } from '@/models/DriveFolder.js';
import type { MiUserList } from '@/models/UserList.js';
import type { MiAbuseUserReport } from '@/models/AbuseUserReport.js';
import type { MiSignin } from '@/models/Signin.js';
import type { MiPage } from '@/models/Page.js';
import type { MiWebhook } from '@/models/Webhook.js';
import type { MiSystemWebhook } from '@/models/SystemWebhook.js';
import type { MiMeta } from '@/models/Meta.js';
import type { MiJuiceSettings } from '@/models/JuiceSettings.js';
import { MiAvatarDecoration, MiChatMessage, MiChatRoom, MiReversiGame, MiRole, MiRoleAssignment } from '@/models/_.js';
import type { MiDrawRoom } from '@/models/DrawRoom.js';
import type { Packed } from '@/misc/json-schema.js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { DrawLayerMeta, DrawStroke } from '@/models/DrawRoomLayer.js';
import { bindThis } from '@/decorators.js';
import { Serialized } from '@/types.js';
import type Emitter from 'strict-event-emitter-types';
import type { EventEmitter } from 'events';

//#region Stream type-body definitions
export interface BroadcastTypes {
	emojiAdded: {
		emoji: Packed<'EmojiDetailed'>;
	};
	emojiUpdated: {
		emojis: Packed<'EmojiDetailed'>[];
	};
	emojiDeleted: {
		emojis: Packed<'EmojiDetailed'>[];
	};
	announcementCreated: {
		announcement: Packed<'Announcement'>;
	};
	announcementReacted: {
		announcementId: MiAnnouncement['id'];
		reaction: string;
		userId: MiUser['id'];
	};
	announcementUnreacted: {
		announcementId: MiAnnouncement['id'];
		reaction: string;
		userId: MiUser['id'];
	};
	announcementPollVoted: {
		announcementId: MiAnnouncement['id'];
		choice: number;
		userId: MiUser['id'];
	};
}

export interface MainEventTypes {
	notification: Packed<'Notification'>;
	mention: Packed<'Note'>;
	reply: Packed<'Note'>;
	renote: Packed<'Note'>;
	follow: Packed<'UserDetailedNotMe'>;
	followed: Packed<'UserLite'>;
	unfollow: Packed<'UserDetailedNotMe'>;
	meUpdated: Packed<'MeDetailed'>;
	pageEvent: {
		pageId: MiPage['id'];
		event: string;
		var: any;
		userId: MiUser['id'];
		user: Packed<'UserDetailed'>;
	};
	urlUploadFinished: {
		marker?: string | null;
		file: Packed<'DriveFile'>;
	};
	readAllNotifications: undefined;
	notificationFlushed: undefined;
	unreadNotification: Packed<'Notification'>;
	unreadAntenna: MiAntenna;
	newChatMessage: Packed<'ChatMessage'>;
	readAllAnnouncements: undefined;
	myTokenRegenerated: undefined;
	signin: {
		id: MiSignin['id'];
		createdAt: string;
		ip: string;
		headers: Record<string, any>;
		success: boolean;
	};
	registryUpdated: {
		scope?: string[];
		key: string;
		value: any | null;
	};
	driveFileCreated: Packed<'DriveFile'>;
	readAntenna: MiAntenna;
	receiveFollowRequest: Packed<'UserLite'>;
	announcementCreated: {
		announcement: Packed<'Announcement'>;
	};
}

export interface DriveEventTypes {
	fileCreated: Packed<'DriveFile'>;
	fileDeleted: MiDriveFile['id'];
	fileUpdated: Packed<'DriveFile'>;
	folderCreated: Packed<'DriveFolder'>;
	folderDeleted: MiDriveFolder['id'];
	folderUpdated: Packed<'DriveFolder'>;
}

export interface NoteEventTypes {
	pollVoted: {
		choice: number;
		userId: MiUser['id'];
	};
	deleted: {
		deletedAt: Date;
	};
	updated: {
		cw: string | null;
		text: string;
	};
	reacted: {
		reaction: string;
		emoji?: {
			name: string;
			url: string;
		} | null;
		userId: MiUser['id'];
	};
	unreacted: {
		reaction: string;
		userId: MiUser['id'];
	};
	aiGeneratedChanged: {
		isAIGenerated: boolean;
	};
	novelChanged: {
		isNovel: boolean;
	};
	// JUICE: 編集日時だけ配る(内容は見る人ごとに見られるかを確かめるため、受け取った側がnotes/showで取り直す)
	edited: { updatedAt: string };
}
type NoteStreamEventTypes = {
	[key in keyof NoteEventTypes]: {
		id: MiNote['id'];
		userId: MiNote['userId'];
		visibility: MiNote['visibility'];
		visibleUserIds: MiNote['visibleUserIds'];
		body: NoteEventTypes[key];
	};
};

export interface UserListEventTypes {
	userAdded: Packed<'UserLite'>;
	userRemoved: Packed<'UserLite'>;
}

export interface AntennaEventTypes {
	note: MiNote;
}

export interface RoleTimelineEventTypes {
	note: Packed<'Note'>;
}

export interface AdminEventTypes {
	newAbuseUserReport: {
		id: MiAbuseUserReport['id'];
		targetUserId: MiUser['id'],
		reporterId: MiUser['id'],
		comment: string;
	};
	// JUICE: 絵文字申請が作成された時のリアルタイム通知(1回の送信でまとめて作られた申請は1つにまとめる。
	// id・name・categoryは1件目、countは件数、requestsは一覧)
	newEmojiRequest: {
		id: string;
		name: string;
		category: string | null;
		requester: Packed<'UserLite'>;
		count: number;
		requests: { id: string; name: string; category: string | null }[];
	};
	// JUICE: 承認式登録の申請が作成された時のリアルタイム通知
	newSignupApplication: {
		applicant: Packed<'UserLite'>;
		reason: string | null;
	};
	// JUICE: アバターデコレーション申請が作成された時のリアルタイム通知(まとめ方は絵文字申請と同じ)
	newAvatarDecorationRequest: {
		id: string;
		name: string;
		category: string | null;
		requester: Packed<'UserLite'>;
		count: number;
		requests: { id: string; name: string; category: string | null }[];
	};
	// JUICE: お問い合わせが送信された時のリアルタイム通知。本文にメールアドレス・IPアドレス等の
	// PIIを含むため、こちらはWebhookペイロード(ContactFormPayload)と異なりPIIを含まない
	newContactForm: {
		id: string;
		subject: string;
		category: string;
	};
}

export interface ChatEventTypes {
	message: Packed<'ChatMessageLite'>;
	deleted: Packed<'ChatMessageLite'>['id'];
	react: {
		reaction: string;
		user?: Packed<'UserLite'>;
		messageId: MiChatMessage['id'];
	};
	unreact: {
		reaction: string;
		user?: Packed<'UserLite'>;
		messageId: MiChatMessage['id'];
	};
}

export interface ReversiEventTypes {
	matched: {
		game: Packed<'ReversiGameDetailed'>;
	};
	invited: {
		user: Packed<'User'>;
	};
}

export interface ReversiGameEventTypes {
	changeReadyStates: {
		user1: boolean;
		user2: boolean;
	};
	updateSettings: {
		userId: MiUser['id'];
		key: string;
		value: any;
	};
	log: Reversi.Serializer.Log & { id: string | null };
	started: {
		game: Packed<'ReversiGameDetailed'>;
	};
	ended: {
		winnerId: MiUser['id'] | null;
		game: Packed<'ReversiGameDetailed'>;
	};
	canceled: {
		userId: MiUser['id'];
	};
}

// JUICE: 絵チャの部屋ごとのストリーム
export interface DrawRoomEventTypes {
	// 描いている途中の線(保存しない。受信側は同じstrokeIdの点を順につなげて表示する)
	strokePart: {
		userId: MiUser['id'];
		strokeId: string;
		tool: 'pen' | 'eraser' | 'fill';
		color: string;
		size: number;
		opacity?: number;
		brush?: 'soft' | 'dot' | 'area';
		clip?: string;
		layer?: string;
		points: string;
		// JUICE: 下描き(本人だけに見える)のレイヤーの線。ほかの人のストリームには流さない
		private?: boolean;
	};
	// カーソルの位置(保存しない)。一定間隔でまとめて配る。x・yがnullならキャンバスの外に出た
	cursors: {
		cursors: {
			userId: MiUser['id'];
			x: number | null;
			y: number | null;
			// JUICE: なでるツールで絵をなでている
			pet?: boolean;
		}[];
	};
	// 描いている途中の線を取りやめた(途中まで表示していた分を消す)
	strokeCancel: {
		userId: MiUser['id'];
		strokeId: string;
	};
	// 描き終わった線(保存済み)
	stroke: {
		userId: MiUser['id'];
		stroke: Packed<'DrawStroke'>;
		private?: boolean;
	};
	// JUICE: 取り消し・やり直しで、その人の線を変えた(手順を順に行う。insは同じレイヤーのbeforeの線の前、nullなら最後に入れる)
	strokesPatched: {
		userId: MiUser['id'];
		steps: ({ t: 'del'; ids: string[] } | { t: 'mv'; ids: string[] | null; dx: number; dy: number } | { t: 'ins'; items: { before: string | null; stroke: DrawStroke }[] })[];
		// 下描きのレイヤーのid(ほかの人のストリームでは、これらのレイヤーの線を除いて流す)
		privateLayers?: string[];
	};
	// layerがあればその人のそのレイヤーだけ、無ければその人の全てのレイヤーを消去した
	clearLayer: {
		userId: MiUser['id'];
		layer?: string;
		private?: boolean;
	};
	// JUICE: その人のレイヤーの一覧(追加・削除・名前・並び・表示・濃さ)が変わった。
	// 一覧から消えたレイヤーの線は、そのレイヤーごと消えている
	layersUpdated: {
		userId: MiUser['id'];
		layers: DrawLayerMeta[];
	};
	// 移動ツールで線をずらした(strokeIdsがnullならレイヤー全体)
	strokesMoved: {
		userId: MiUser['id'];
		strokeIds: string[] | null;
		dx: number;
		dy: number;
	};
	// 選択範囲の境目で線を切った(元の線を、切った後の線の並びに置き換える)
	strokesSplit: {
		userId: MiUser['id'];
		splits: { id: string; pieces: DrawStroke[] }[];
		// JUICE: 下描きのレイヤーのid(ほかの人のストリームでは、これらのレイヤーの線を除いて流す)
		privateLayers?: string[];
	};
	// JUICE: 下描きのレイヤーを皆に見せるようにした(そのレイヤーの今の線)
	layerPublished: {
		userId: MiUser['id'];
		layer: string;
		strokes: DrawStroke[];
	};
	// 選んだ線を消した
	strokesDeleted: {
		userId: MiUser['id'];
		strokeIds: string[];
	};
	chat: {
		message: Packed<'DrawRoomChatMessage'>;
		user: Packed<'UserLite'>;
	};
	memberJoined: {
		user: Packed<'UserLite'>;
	};
	memberLeft: {
		userId: MiUser['id'];
		kicked: boolean;
	};
	// 部屋が削除された(モデレーターによる削除を含む)
	deleted: {
		byModerator: boolean;
	};
	// 今この部屋を開いている人(オンライン)の一覧
	presence: {
		userIds: MiUser['id'][];
	};
	updated: {
		room: Packed<'DrawRoom'>;
	};
	ended: {
		room: Packed<'DrawRoom'>;
	};
}
//#endregion

// 辞書(interface or type)から{ type, body }ユニオンを定義
// https://stackoverflow.com/questions/49311989/can-i-infer-the-type-of-a-value-using-extends-keyof-type
// VS Codeの展開を防止するためにEvents型を定義
type Events<T extends object> = { [K in keyof T]: { type: K; body: T[K]; } };
type EventUnionFromDictionary<
	T extends object,
	U = Events<T>,
> = U[keyof U];

type SerializedAll<T> = {
	[K in keyof T]: Serialized<T[K]>;
};

type UndefinedAsNullAll<T> = {
	[K in keyof T]: T[K] extends undefined ? null : T[K];
};

export interface InternalEventTypes {
	userChangeSuspendedState: { id: MiUser['id']; isSuspended: MiUser['isSuspended']; };
	userChangeDeletedState: { id: MiUser['id']; isDeleted: MiUser['isDeleted']; };
	userTokenRegenerated: { id: MiUser['id']; oldToken: string; newToken: string; };
	remoteUserUpdated: { id: MiUser['id']; };
	localUserUpdated: { id: MiUser['id']; };
	follow: { followerId: MiUser['id']; followeeId: MiUser['id']; };
	unfollow: { followerId: MiUser['id']; followeeId: MiUser['id']; };
	blockingCreated: { blockerId: MiUser['id']; blockeeId: MiUser['id']; };
	blockingDeleted: { blockerId: MiUser['id']; blockeeId: MiUser['id']; };
	policiesUpdated: MiRole['policies'];
	roleCreated: MiRole;
	roleDeleted: MiRole;
	roleUpdated: MiRole;
	userRoleAssigned: MiRoleAssignment;
	userRoleUnassigned: MiRoleAssignment;
	webhookCreated: MiWebhook;
	webhookDeleted: MiWebhook;
	webhookUpdated: MiWebhook;
	systemWebhookCreated: MiSystemWebhook;
	systemWebhookDeleted: MiSystemWebhook;
	systemWebhookUpdated: MiSystemWebhook;
	antennaCreated: MiAntenna;
	antennaDeleted: MiAntenna;
	antennaUpdated: MiAntenna;
	avatarDecorationCreated: MiAvatarDecoration;
	avatarDecorationDeleted: MiAvatarDecoration;
	avatarDecorationUpdated: MiAvatarDecoration;
	metaUpdated: { before?: MiMeta; after: MiMeta; };
	juiceSettingsUpdated: { before: MiJuiceSettings['settings']; after: MiJuiceSettings['settings']; };
	followChannel: { userId: MiUser['id']; channelId: MiChannel['id']; };
	unfollowChannel: { userId: MiUser['id']; channelId: MiChannel['id']; };
	muteChannel: { userId: MiUser['id']; channelId: MiChannel['id']; };
	unmuteChannel: { userId: MiUser['id']; channelId: MiChannel['id']; };
	updateUserProfile: MiUserProfile;
	mute: { muterId: MiUser['id']; muteeId: MiUser['id']; };
	unmute: { muterId: MiUser['id']; muteeId: MiUser['id']; };
	userListMemberAdded: { userListId: MiUserList['id']; memberId: MiUser['id']; };
	userListMemberRemoved: { userListId: MiUserList['id']; memberId: MiUser['id']; };
}

export type EventTypesToEventPayload<T> = EventUnionFromDictionary<UndefinedAsNullAll<SerializedAll<T>>>;

// name/messages(spec) pairs dictionary
export type GlobalEvents = {
	internal: {
		name: 'internal';
		payload: EventTypesToEventPayload<InternalEventTypes>;
	};
	broadcast: {
		name: 'broadcast';
		payload: EventTypesToEventPayload<BroadcastTypes>;
	};
	main: {
		name: `mainStream:${MiUser['id']}`;
		payload: EventTypesToEventPayload<MainEventTypes>;
	};
	drive: {
		name: `driveStream:${MiUser['id']}`;
		payload: EventTypesToEventPayload<DriveEventTypes>;
	};
	note: {
		name: `noteStream:${MiNote['id']}`;
		payload: EventTypesToEventPayload<NoteStreamEventTypes>;
	};
	userList: {
		name: `userListStream:${MiUserList['id']}`;
		payload: EventTypesToEventPayload<UserListEventTypes>;
	};
	roleTimeline: {
		name: `roleTimelineStream:${MiRole['id']}`;
		payload: EventTypesToEventPayload<RoleTimelineEventTypes>;
	};
	antenna: {
		name: `antennaStream:${MiAntenna['id']}`;
		payload: EventTypesToEventPayload<AntennaEventTypes>;
	};
	admin: {
		name: `adminStream:${MiUser['id']}`;
		payload: EventTypesToEventPayload<AdminEventTypes>;
	};
	notes: {
		name: 'notesStream';
		payload: Serialized<Packed<'Note'>>;
	};
	/** JUICE: リレーTL */
	relayTimeline: {
		name: 'relayTimelineStream';
		payload: Serialized<Packed<'Note'>>;
	};
	chatUser: {
		name: `chatUserStream:${MiUser['id']}-${MiUser['id']}`;
		payload: EventTypesToEventPayload<ChatEventTypes>;
	};
	chatRoom: {
		name: `chatRoomStream:${MiChatRoom['id']}`;
		payload: EventTypesToEventPayload<ChatEventTypes>;
	};
	reversi: {
		name: `reversiStream:${MiUser['id']}`;
		payload: EventTypesToEventPayload<ReversiEventTypes>;
	};
	reversiGame: {
		name: `reversiGameStream:${MiReversiGame['id']}`;
		payload: EventTypesToEventPayload<ReversiGameEventTypes>;
	};
	/** JUICE: 絵チャ */
	drawRoom: {
		name: `drawRoomStream:${MiDrawRoom['id']}`;
		payload: EventTypesToEventPayload<DrawRoomEventTypes>;
	};
};

// API event definitions
// ストリームごとのEmitterの辞書を用意
type EventEmitterDictionary = { [x in keyof GlobalEvents]: Emitter.default<EventEmitter, { [y in GlobalEvents[x]['name']]: (e: GlobalEvents[x]['payload']) => void }> };
// 共用体型を交差型にする型 https://stackoverflow.com/questions/54938141/typescript-convert-union-to-intersection
type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends ((k: infer I) => void) ? I : never;
// Emitter辞書から共用体型を作り、UnionToIntersectionで交差型にする
export type StreamEventEmitter = UnionToIntersection<EventEmitterDictionary[keyof GlobalEvents]>;
// { [y in name]: (e: spec) => void }をまとめてその交差型をEmitterにかけるとts(2590)にひっかかる

// provide stream channels union
export type StreamChannels = GlobalEvents[keyof GlobalEvents]['name'];

@Injectable()
export class GlobalEventService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redisForPub)
		private redisForPub: Redis.Redis,
	) {
	}

	@bindThis
	private publish(channel: StreamChannels, type: string | null, value?: any): void {
		const message = type == null ? value : value == null ?
			{ type: type, body: null } :
			{ type: type, body: value };

		this.redisForPub.publish(this.config.host, JSON.stringify({
			channel: channel,
			message: message,
		}));
	}

	@bindThis
	public publishInternalEvent<K extends keyof InternalEventTypes>(type: K, value?: InternalEventTypes[K]): void {
		this.publish('internal', type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishBroadcastStream<K extends keyof BroadcastTypes>(type: K, value?: BroadcastTypes[K]): void {
		this.publish('broadcast', type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishMainStream<K extends keyof MainEventTypes>(userId: MiUser['id'], type: K, value?: MainEventTypes[K]): void {
		this.publish(`mainStream:${userId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishDriveStream<K extends keyof DriveEventTypes>(userId: MiUser['id'], type: K, value?: DriveEventTypes[K]): void {
		this.publish(`driveStream:${userId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishNoteStream<K extends keyof NoteEventTypes>(note: MiNote, type: K, value?: NoteEventTypes[K]): void {
		this.publish(`noteStream:${note.id}`, type, {
			id: note.id,
			userId: note.userId,
			visibility: note.visibility,
			visibleUserIds: note.visibleUserIds,
			body: value,
		});
	}

	@bindThis
	public publishUserListStream<K extends keyof UserListEventTypes>(listId: MiUserList['id'], type: K, value?: UserListEventTypes[K]): void {
		this.publish(`userListStream:${listId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishAntennaStream<K extends keyof AntennaEventTypes>(antennaId: MiAntenna['id'], type: K, value?: AntennaEventTypes[K]): void {
		this.publish(`antennaStream:${antennaId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishRoleTimelineStream<K extends keyof RoleTimelineEventTypes>(roleId: MiRole['id'], type: K, value?: RoleTimelineEventTypes[K]): void {
		this.publish(`roleTimelineStream:${roleId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishNotesStream(note: Packed<'Note'>): void {
		this.publish('notesStream', null, note);
	}

	/** JUICE: リレー経由で届いた公開ノートをリレーTL購読者に配信する */
	@bindThis
	public publishRelayTimelineStream(note: Packed<'Note'>): void {
		this.publish('relayTimelineStream', null, note);
	}

	@bindThis
	public publishAdminStream<K extends keyof AdminEventTypes>(userId: MiUser['id'], type: K, value?: AdminEventTypes[K]): void {
		this.publish(`adminStream:${userId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishChatUserStream<K extends keyof ChatEventTypes>(fromUserId: MiUser['id'], toUserId: MiUser['id'], type: K, value?: ChatEventTypes[K]): void {
		this.publish(`chatUserStream:${fromUserId}-${toUserId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishChatRoomStream<K extends keyof ChatEventTypes>(toRoomId: MiChatRoom['id'], type: K, value?: ChatEventTypes[K]): void {
		this.publish(`chatRoomStream:${toRoomId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishReversiStream<K extends keyof ReversiEventTypes>(userId: MiUser['id'], type: K, value?: ReversiEventTypes[K]): void {
		this.publish(`reversiStream:${userId}`, type, typeof value === 'undefined' ? null : value);
	}

	@bindThis
	public publishReversiGameStream<K extends keyof ReversiGameEventTypes>(gameId: MiReversiGame['id'], type: K, value?: ReversiGameEventTypes[K]): void {
		this.publish(`reversiGameStream:${gameId}`, type, typeof value === 'undefined' ? null : value);
	}

	// JUICE: 絵チャ
	@bindThis
	public publishDrawRoomStream<K extends keyof DrawRoomEventTypes>(roomId: MiDrawRoom['id'], type: K, value: DrawRoomEventTypes[K]): void {
		this.publish(`drawRoomStream:${roomId}`, type, value);
	}
}
