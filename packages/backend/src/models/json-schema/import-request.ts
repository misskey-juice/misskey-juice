/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 承認式にしたインポートの申請
export const packedImportRequestSchema = {
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
			enum: ['following', 'muting', 'blocking', 'userLists', 'antennas'],
		},
		// 申請した本人がファイルを消していればnull(そのときは承認できない)
		fileId: {
			type: 'string',
			optional: false, nullable: true,
			format: 'id',
		},
		fileName: {
			type: 'string',
			optional: false, nullable: false,
		},
		fileSize: {
			type: 'integer',
			optional: false, nullable: false,
		},
		withReplies: {
			type: 'boolean',
			optional: false, nullable: true,
		},
		status: {
			type: 'string',
			optional: false, nullable: false,
			enum: ['pending', 'approved', 'rejected', 'cancelled'],
		},
		rejectReason: {
			type: 'string',
			optional: false, nullable: true,
		},
		reviewedAt: {
			type: 'string',
			optional: false, nullable: true,
			format: 'date-time',
		},
	},
} as const;

// 審査する人向け(申請した人・審査した人を付ける)
export const packedImportRequestDetailedAdminSchema = {
	type: 'object',
	allOf: [{
		type: 'object',
		ref: 'ImportRequest',
	}, {
		type: 'object',
		properties: {
			user: {
				type: 'object',
				optional: false, nullable: false,
				ref: 'UserLite',
			},
			reviewer: {
				type: 'object',
				optional: false, nullable: true,
				ref: 'UserLite',
			},
		},
	}],
} as const;
