/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { notificationTypes, userExportableEntities } from '@/types.js';

const baseSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
			format: 'id',
		},
		createdAt: {
			type: 'string',
			optional: false, nullable: false,
			format: 'date-time',
		},
		type: {
			type: 'string',
			optional: false, nullable: false,
			enum: [...notificationTypes, 'reaction:grouped', 'renote:grouped'],
		},
	},
} as const;

export const packedNotificationSchema = {
	type: 'object',
	oneOf: [{
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['note'],
			},
			user: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			userId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			note: {
				type: 'object',
				ref: 'Note',
				optional: false, nullable: false,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['mention'],
			},
			user: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			userId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			note: {
				type: 'object',
				ref: 'Note',
				optional: false, nullable: false,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['reply'],
			},
			user: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			userId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			note: {
				type: 'object',
				ref: 'Note',
				optional: false, nullable: false,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['renote'],
			},
			user: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			userId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			note: {
				type: 'object',
				ref: 'Note',
				optional: false, nullable: false,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['quote'],
			},
			user: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			userId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			note: {
				type: 'object',
				ref: 'Note',
				optional: false, nullable: false,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['reaction'],
			},
			user: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			userId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			note: {
				type: 'object',
				ref: 'Note',
				optional: false, nullable: false,
			},
			reaction: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['pollEnded'],
			},
			user: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			userId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			note: {
				type: 'object',
				ref: 'Note',
				optional: false, nullable: false,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['scheduledNotePosted'],
			},
			note: {
				type: 'object',
				ref: 'Note',
				optional: false, nullable: false,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['scheduledNotePostFailed'],
			},
			noteDraft: {
				type: 'object',
				ref: 'NoteDraft',
				optional: false, nullable: false,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['follow'],
			},
			user: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			userId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['receiveFollowRequest'],
			},
			user: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			userId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['followRequestAccepted'],
			},
			user: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			userId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			message: {
				type: 'string',
				optional: false, nullable: true,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['roleAssigned'],
			},
			role: {
				type: 'object',
				ref: 'Role',
				optional: false, nullable: false,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['chatRoomInvitationReceived'],
			},
			invitation: {
				type: 'object',
				ref: 'ChatRoomInvitation',
				optional: false, nullable: false,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['achievementEarned'],
			},
			achievement: {
				ref: 'AchievementName',
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['exportCompleted'],
			},
			exportedEntity: {
				type: 'string',
				optional: false, nullable: false,
				enum: userExportableEntities,
			},
			fileId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['login'],
			},
		},
	}, {
		// JUICE: misskey-tempuraを参考に追加
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['loginFailed'],
			},
		},
	}, {
		// JUICE: 絵文字申請が承認されたとき
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['emojiRequestApproved'],
			},
			requestId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			name: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
	}, {
		// JUICE: 絵文字申請が却下されたとき
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['emojiRequestRejected'],
			},
			requestId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			name: {
				type: 'string',
				optional: false, nullable: false,
			},
			reason: {
				type: 'string',
				optional: false, nullable: true,
			},
		},
	}, {
		// JUICE: アバターデコレーション申請が承認されたとき
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['avatarDecorationRequestApproved'],
			},
			requestId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			name: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
	}, {
		// JUICE: アバターデコレーション申請が却下されたとき
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['avatarDecorationRequestRejected'],
			},
			requestId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			name: {
				type: 'string',
				optional: false, nullable: false,
			},
			reason: {
				type: 'string',
				optional: false, nullable: true,
			},
		},
	}, {
		// JUICE: 絵文字申請が新しく来たとき
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['newEmojiRequest'],
			},
			// JUICE: 申請者。notifierIdではなくrequesterIdからパックしているため、ミュートフィルタの
			// 影響を受けない(モデレーターがこの申請者を別件でミュートしていても通知は届く)
			requester: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			requestId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			name: {
				type: 'string',
				optional: false, nullable: false,
			},
			category: {
				type: 'string',
				optional: false, nullable: true,
			},
			// JUICE: 1回の送信でまとめて作られた申請の件数(requestId・nameは1件目)
			count: {
				type: 'integer',
				optional: false, nullable: false,
			},
		},
	}, {
		// JUICE: アバターデコレーション申請が新しく来たとき
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['newAvatarDecorationRequest'],
			},
			requester: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			requestId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			name: {
				type: 'string',
				optional: false, nullable: false,
			},
			category: {
				type: 'string',
				optional: false, nullable: true,
			},
			// JUICE: 1回の送信でまとめて作られた申請の件数(requestId・nameは1件目)
			count: {
				type: 'integer',
				optional: false, nullable: false,
			},
		},
	}, {
		// JUICE: 承認式新規登録の申請が新しく来たとき
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['newSignupApplication'],
			},
			requester: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			reason: {
				type: 'string',
				optional: false, nullable: true,
			},
		},
	}, {
		// JUICE: お問い合わせが新しく来たとき。PII保護のため送信者を特定できる情報は含めない
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['newContactForm'],
			},
			contactFormId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			subject: {
				type: 'string',
				optional: false, nullable: false,
			},
			category: {
				type: 'string',
				optional: false, nullable: true,
			},
		},
	}, {
		// JUICE: 通報が新しく来たとき。通報コメント・通報者はPII保護のため含めない
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['newAbuseUserReport'],
			},
			targetUser: {
				type: 'object',
				ref: 'UserLite',
				optional: false, nullable: false,
			},
			reportId: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
			},
			category: {
				type: 'string',
				optional: false, nullable: true,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['createToken'],
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['app'],
			},
			body: {
				type: 'string',
				optional: false, nullable: false,
			},
			header: {
				type: 'string',
				optional: false, nullable: true,
			},
			icon: {
				type: 'string',
				optional: false, nullable: true,
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['reaction:grouped'],
			},
			note: {
				type: 'object',
				ref: 'Note',
				optional: false, nullable: false,
			},
			reactions: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					properties: {
						user: {
							type: 'object',
							ref: 'UserLite',
							optional: false, nullable: false,
						},
						reaction: {
							type: 'string',
							optional: false, nullable: false,
						},
					},
					required: ['user', 'reaction'],
				},
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['renote:grouped'],
			},
			note: {
				type: 'object',
				ref: 'Note',
				optional: false, nullable: false,
			},
			users: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					ref: 'UserLite',
					optional: false, nullable: false,
				},
			},
		},
	}, {
		type: 'object',
		properties: {
			...baseSchema.properties,
			type: {
				type: 'string',
				optional: false, nullable: false,
				enum: ['test'],
			},
		},
	}],
} as const;
