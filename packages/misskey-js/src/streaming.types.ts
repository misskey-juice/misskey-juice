import {
	Antenna,
	ChatMessage,
	ChatMessageLite,
	DriveFile,
	DriveFolder,
	Note,
	Notification,
	Signin,
	User,
	UserDetailed,
	UserDetailedNotMe,
	UserLite,
	DrawRoom,
	DrawStroke,
	DrawLayer,
	DrawRoomChatMessage,
} from './autogen/models.js';
import {
	AnnouncementCreated,
	AnnouncementPollVoted,
	AnnouncementReacted,
	AnnouncementUnreacted,
	EmojiAdded, EmojiDeleted,
	EmojiUpdated,
	PageEvent,
	QueueStats,
	QueueStatsLog,
	ServerStats,
	ServerStatsLog,
	ReversiGameDetailed,
} from './entities.js';
import {
	ReversiUpdateKey,
} from './consts.js';

type ReversiUpdateSettings<K extends ReversiUpdateKey> = {
	key: K;
	value: ReversiGameDetailed[K];
};

// JUICE: 絵チャの取り消し・やり直しで行う手順
export type DrawStrokesPatchStep =
	| { t: 'del'; ids: string[]; }
	| { t: 'mv'; ids: string[] | null; dx: number; dy: number; }
	| { t: 'ins'; items: { before: string | null; stroke: DrawStroke; }[]; };

export type Channels = {
	main: {
		params: null;
		events: {
			notification: (payload: Notification) => void;
			mention: (payload: Note) => void;
			reply: (payload: Note) => void;
			renote: (payload: Note) => void;
			follow: (payload: UserDetailedNotMe) => void; // 自分が他人をフォローしたとき
			followed: (payload: UserDetailed | UserLite) => void; // 他人が自分をフォローしたとき
			unfollow: (payload: UserDetailed) => void; // 自分が他人をフォロー解除したとき
			meUpdated: (payload: UserDetailed) => void;
			pageEvent: (payload: PageEvent) => void;
			urlUploadFinished: (payload: { marker: string; file: DriveFile; }) => void;
			readAllNotifications: () => void;
			unreadNotification: (payload: Notification) => void;
			notificationFlushed: () => void;
			unreadAntenna: (payload: Antenna) => void;
			newChatMessage: (payload: ChatMessage) => void;
			readAllAnnouncements: () => void;
			myTokenRegenerated: () => void;
			signin: (payload: Signin) => void;
			registryUpdated: (payload: {
				scope?: string[];
				key: string;
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				value: any | null;
			}) => void;
			driveFileCreated: (payload: DriveFile) => void;
			readAntenna: (payload: Antenna) => void;
			receiveFollowRequest: (payload: User) => void;
			announcementCreated: (payload: AnnouncementCreated) => void;
		};
		receives: null;
	};
	homeTimeline: {
		params: {
			withRenotes?: boolean;
			withFiles?: boolean;
			localOnly?: boolean;
			onlyNovel?: boolean;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	localTimeline: {
		params: {
			withRenotes?: boolean;
			withReplies?: boolean;
			withFiles?: boolean;
			onlyNovel?: boolean;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	hybridTimeline: {
		params: {
			withRenotes?: boolean;
			withReplies?: boolean;
			withFiles?: boolean;
			onlyNovel?: boolean;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	globalTimeline: {
		params: {
			withRenotes?: boolean;
			withFiles?: boolean;
			onlyNovel?: boolean;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	/** JUICE */
	relayTimeline: {
		params: {
			withRenotes?: boolean;
			withFiles?: boolean;
			relayIds?: string[];
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	userList: {
		params: {
			listId: string;
			withFiles?: boolean;
			withRenotes?: boolean;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	hashtag: {
		params: {
			q: string[][];
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	roleTimeline: {
		params: {
			roleId: string;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	antenna: {
		params: {
			antennaId: string;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	channel: {
		params: {
			channelId: string;
		};
		events: {
			note: (payload: Note) => void;
		};
		receives: null;
	};
	drive: {
		params: null;
		events: {
			fileCreated: (payload: DriveFile) => void;
			fileDeleted: (payload: DriveFile['id']) => void;
			fileUpdated: (payload: DriveFile) => void;
			folderCreated: (payload: DriveFolder) => void;
			folderDeleted: (payload: DriveFolder['id']) => void;
			folderUpdated: (payload: DriveFolder) => void;
		};
		receives: null;
	};
	serverStats: {
		params: null;
		events: {
			stats: (payload: ServerStats) => void;
			statsLog: (payload: ServerStatsLog) => void;
		};
		receives: {
			requestLog: {
				id: string | number;
				length: number;
			};
		};
	};
	queueStats: {
		params: null;
		events: {
			stats: (payload: QueueStats) => void;
			statsLog: (payload: QueueStatsLog) => void;
		};
		receives: {
			requestLog: {
				id: string | number;
				length: number;
			};
		};
	};
	admin: {
		params: null;
		events: {
			newAbuseUserReport: {
				id: string;
				targetUserId: string;
				reporterId: string;
				comment: string;
			};
			// JUICE: 絵文字申請が作成されたとき
			newEmojiRequest: {
				id: string;
				name: string;
				category: string | null;
				requester: UserLite;
				// JUICE: 1回の送信でまとめて作られた申請の件数と一覧(id・name・categoryは1件目)
				count: number;
				requests: { id: string; name: string; category: string | null }[];
			};
			// JUICE: 承認式登録の申請が作成されたとき
			newSignupApplication: {
				applicant: UserLite;
				reason: string | null;
			};
			// JUICE: アバターデコレーション申請が作成されたとき
			newAvatarDecorationRequest: {
				id: string;
				name: string;
				category: string | null;
				requester: UserLite;
				// JUICE: 1回の送信でまとめて作られた申請の件数と一覧(id・name・categoryは1件目)
				count: number;
				requests: { id: string; name: string; category: string | null }[];
			};
			// JUICE: お問い合わせが送信されたとき(PIIを含まない要約のみ)
			newContactForm: {
				id: string;
				subject: string;
				category: string;
			};
		};
		receives: null;
	};
	reversi: {
		params: null;
		events: {
			matched: (payload: { game: ReversiGameDetailed }) => void;
			invited: (payload: { user: User }) => void;
		};
		receives: null;
	};
	reversiGame: {
		params: {
			gameId: string;
		};
		events: {
			started: (payload: { game: ReversiGameDetailed; }) => void;
			ended: (payload: { winnerId: User['id'] | null; game: ReversiGameDetailed; }) => void;
			canceled: (payload: { userId: User['id']; }) => void;
			changeReadyStates: (payload: { user1: boolean; user2: boolean; }) => void;
			updateSettings: <K extends ReversiUpdateKey>(payload: { userId: User['id']; key: K; value: ReversiGameDetailed[K]; }) => void;
			log: (payload: {
				time: number;
				player: boolean;
				operation: 'put';
				pos: number;
			} & { id: string | null }) => void;
		};
		receives: {
			putStone: {
				pos: number;
				id: string;
			};
			ready: boolean;
			cancel: null | Record<string, never>;
			updateSettings: ReversiUpdateSettings<ReversiUpdateKey>;
			claimTimeIsUp: null | Record<string, never>;
		}
	};
	// JUICE: 絵チャ
	drawRoom: {
		params: {
			roomId: string;
		};
		events: {
			strokePart: (payload: { userId: User['id']; strokeId: string; tool: DrawStroke['tool']; color: string; size: number; opacity?: number; brush?: DrawStroke['brush']; clip?: string; layer?: string; lock?: boolean; pressure?: DrawStroke['pressure']; points: string; private?: boolean; }) => void;
			cursors: (payload: { cursors: { userId: User['id']; x: number | null; y: number | null; pet?: boolean; }[]; }) => void;
			strokeCancel: (payload: { userId: User['id']; strokeId: string; }) => void;
			stroke: (payload: { userId: User['id']; stroke: DrawStroke; private?: boolean; }) => void;
			// JUICE: 取り消し・やり直しで、その人の線を変えた(手順を順に行う。insは同じレイヤーのbeforeの線の前、nullなら最後に入れる)
			strokesPatched: (payload: { userId: User['id']; steps: DrawStrokesPatchStep[]; privateLayers?: string[]; }) => void;
			clearLayer: (payload: { userId: User['id']; layer?: string; private?: boolean; }) => void;
			// JUICE: その人のレイヤーの一覧が変わった(一覧から消えたレイヤーの線も消えている)
			layersUpdated: (payload: { userId: User['id']; layers: DrawLayer[]; }) => void;
			strokesMoved: (payload: { userId: User['id']; strokeIds: string[] | null; dx: number; dy: number; }) => void;
			strokesDeleted: (payload: { userId: User['id']; strokeIds: string[]; }) => void;
			strokesSplit: (payload: { userId: User['id']; splits: { id: string; pieces: DrawStroke[]; }[]; privateLayers?: string[]; }) => void;
			// JUICE: 下描きのレイヤーを皆に見せるようにした(そのレイヤーの今の線)
			layerPublished: (payload: { userId: User['id']; layer: string; strokes: DrawStroke[]; }) => void;
			// JUICE: レイヤーを結合した(結合先のレイヤーの今の線。結合元のレイヤーは直前のlayersUpdatedで消えている)
			layerMerged: (payload: { userId: User['id']; layer: string; strokes: DrawStroke[]; private?: boolean; }) => void;
			// JUICE: 自分が送った線の移動・削除・置き換えが断られた(本人にだけ届く。線を取り直してサーバーの状態に合わせる)
			operationRejected: (payload: Record<string, never>) => void;
			// JUICE: 線の本数・データ量の上限に達して、送った線を受け付けなかった(本人にだけ届く)
			strokeLimitReached: (payload: { kind: 'strokes' | 'bytes' | 'room'; limit: number; }) => void;
			chat: (payload: { message: DrawRoomChatMessage; user: UserLite; }) => void;
			memberJoined: (payload: { user: UserLite; }) => void;
			memberLeft: (payload: { userId: User['id']; kicked: boolean; }) => void;
			presence: (payload: { userIds: User['id'][]; }) => void;
			deleted: (payload: { byModerator: boolean; }) => void;
			updated: (payload: { room: DrawRoom; }) => void;
			ended: (payload: { room: DrawRoom; }) => void;
		};
		receives: {
			strokePart: { strokeId: string; tool: DrawStroke['tool']; color: string; size: number; opacity?: number; brush?: DrawStroke['brush']; clip?: string; layer?: string; lock?: boolean; pressure?: DrawStroke['pressure']; points: string; };
			cursor: { x: number | null; y: number | null; pet?: boolean; };
			visibility: { visible: boolean; };
			strokeCancel: { strokeId: string; };
			stroke: DrawStroke;
			undo: null | Record<string, never>;
			redo: null | Record<string, never>;
			clearLayer: null | Record<string, never> | { layer: string; };
			// JUICE: 自分のレイヤーの一覧を置き換える
			setLayers: { layers: DrawLayer[]; };
			// JUICE: 自分のレイヤー(from)を、となりのレイヤー(into)に結合する
			mergeLayer: { from: string; into: string; };
			moveStrokes: { strokeIds: string[] | null; dx: number; dy: number; splits?: { id: string; pieces: DrawStroke[]; }[]; };
			deleteStrokes: { strokeIds: string[]; splits?: { id: string; pieces: DrawStroke[]; }[]; };
			replaceStrokes: { replacements: { id: string; pieces: DrawStroke[]; }[]; };
			clearLayerOf: { userId: User['id']; };
			chat: { text: string; };
		};
	};
	chatUser: {
		params: {
			otherId: string;
		};
		events: {
			message: (payload: ChatMessageLite) => void;
			deleted: (payload: ChatMessageLite['id']) => void;
			react: (payload: {
				reaction: string;
				user?: UserLite;
				messageId: ChatMessageLite['id'];
			}) => void;
			unreact: (payload: {
				reaction: string;
				user?: UserLite;
				messageId: ChatMessageLite['id'];
			}) => void;
		};
		receives: {
			read: {
				id: ChatMessageLite['id'];
			};
		};
	};
	chatRoom: {
		params: {
			roomId: string;
		};
		events: {
			message: (payload: ChatMessageLite) => void;
			deleted: (payload: ChatMessageLite['id']) => void;
			react: (payload: {
				reaction: string;
				user?: UserLite;
				messageId: ChatMessageLite['id'];
			}) => void;
			unreact: (payload: {
				reaction: string;
				user?: UserLite;
				messageId: ChatMessageLite['id'];
			}) => void;
		};
		receives: {
			read: {
				id: ChatMessageLite['id'];
			};
		};
	};
};

export type NoteUpdatedEvent = { id: Note['id'] } & ({
	type: 'reacted';
	body: {
		reaction: string;
		emoji?: {
			name: string;
			url: string;
		} | null;
		userId: User['id'];
	};
} | {
	type: 'unreacted';
	body: {
		reaction: string;
		userId: User['id'];
	};
} | {
	type: 'deleted';
	body: {
		deletedAt: string;
	};
} | {
	type: 'pollVoted';
	body: {
		choice: number;
		userId: User['id'];
	};
} | {
	// JUICE
	type: 'aiGeneratedChanged';
	body: {
		isAIGenerated: boolean;
	};
} | {
	// JUICE
	type: 'novelChanged';
	body: {
		isNovel: boolean;
	};
} | {
	// JUICE: リモートで編集された投稿を反映した。内容はnotes/showで取り直す
	type: 'edited';
	body: {
		updatedAt: string;
	};
});

export type BroadcastEvents = {
	noteUpdated: (payload: NoteUpdatedEvent) => void;
	emojiAdded: (payload: EmojiAdded) => void;
	emojiUpdated: (payload: EmojiUpdated) => void;
	emojiDeleted: (payload: EmojiDeleted) => void;
	announcementCreated: (payload: AnnouncementCreated) => void;
	// JUICE
	announcementReacted: (payload: AnnouncementReacted) => void;
	announcementUnreacted: (payload: AnnouncementUnreacted) => void;
	announcementPollVoted: (payload: AnnouncementPollVoted) => void;
};
