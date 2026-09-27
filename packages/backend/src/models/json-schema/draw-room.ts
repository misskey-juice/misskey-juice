/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 絵チャの部屋
export const packedDrawRoomSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
		},
		createdAt: {
			type: 'string',
			format: 'date-time',
			optional: false, nullable: false,
		},
		ownerId: {
			type: 'string',
			optional: false, nullable: false,
		},
		owner: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'UserLite',
		},
		title: {
			type: 'string',
			optional: false, nullable: false,
		},
		visibility: {
			type: 'string',
			optional: false, nullable: false,
			enum: ['followers', 'local'],
		},
		maxMembers: {
			type: 'number',
			optional: false, nullable: false,
		},
		canvasWidth: {
			type: 'number',
			optional: false, nullable: false,
		},
		canvasHeight: {
			type: 'number',
			optional: false, nullable: false,
		},
		keepAfterEnd: {
			type: 'boolean',
			optional: false, nullable: false,
		},
		isEnded: {
			type: 'boolean',
			optional: false, nullable: false,
		},
		endedAt: {
			type: 'string',
			format: 'date-time',
			optional: false, nullable: true,
		},
		// JUICE: 保存しないで終了した部屋が自動で削除される日時(それ以外はnull)。部屋主はそれより前にも削除できる
		deletesAt: {
			type: 'string',
			format: 'date-time',
			optional: false, nullable: true,
		},
		members: {
			type: 'array',
			optional: false, nullable: false,
			items: {
				type: 'object',
				optional: false, nullable: false,
				ref: 'UserLite',
			},
		},
		isMember: {
			type: 'boolean',
			optional: false, nullable: false,
		},
		// JUICE: モデレーターが公開範囲の外から確認のために開いている(見るだけで、チャット等はできない)
		viewOnly: {
			type: 'boolean',
			optional: false, nullable: false,
		},
	},
} as const;

// JUICE: 絵チャの線(pointsは [x, y, 筆圧, …] の平らな配列)
export const packedDrawStrokeSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
		},
		tool: {
			type: 'string',
			optional: false, nullable: false,
			enum: ['pen', 'eraser', 'fill'],
		},
		color: {
			type: 'string',
			optional: false, nullable: false,
		},
		size: {
			type: 'number',
			optional: false, nullable: false,
		},
		opacity: {
			type: 'number',
			optional: true, nullable: false,
		},
		// JUICE: 筆の種類(soft: にじみ筆、dot: ドット)。無ければ普通の筆
		brush: {
			type: 'string',
			optional: true, nullable: false,
			enum: ['soft', 'dot', 'area'],
		},
		// JUICE: 線の中だけ塗る(はみ出し防止)で塗れる範囲の多角形(pointsと同じ形式)
		clip: {
			type: 'string',
			optional: true, nullable: false,
		},
		// JUICE: 移動ツールでずらした量(キャンバス座標)。描くときに点の列をこの分ずらす
		dx: {
			type: 'number',
			optional: true, nullable: false,
		},
		dy: {
			type: 'number',
			optional: true, nullable: false,
		},
		// JUICE: 描いた人のどのレイヤーの線か。無ければ最初のレイヤー('0')
		layer: {
			type: 'string',
			optional: true, nullable: false,
		},
		// JUICE: 透明度ロック(その時点でレイヤーに描いてある所にだけ描く)
		lock: {
			type: 'boolean',
			optional: true, nullable: false,
		},
		// 1点5バイト(x・yは1/8px単位のint16、筆圧は0〜255のuint8、リトルエンディアン)を並べてbase64にしたもの
		points: {
			type: 'string',
			optional: false, nullable: false,
		},
	},
} as const;

// JUICE: 絵チャのチャット1件
export const packedDrawRoomChatMessageSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
		},
		userId: {
			type: 'string',
			optional: false, nullable: false,
		},
		text: {
			type: 'string',
			optional: false, nullable: false,
		},
		createdAt: {
			type: 'number',
			optional: false, nullable: false,
		},
	},
} as const;

// JUICE: 1人が持つレイヤー(重なり順・表示・濃さはほかの人の画面にも反映される)
export const packedDrawLayerSchema = {
	type: 'object',
	properties: {
		id: {
			type: 'string',
			optional: false, nullable: false,
		},
		name: {
			type: 'string',
			optional: false, nullable: false,
		},
		visible: {
			type: 'boolean',
			optional: false, nullable: false,
		},
		opacity: {
			type: 'number',
			optional: false, nullable: false,
		},
		// JUICE: 下描き(描いた本人にだけ見える)。ほかの人には、下描きのレイヤーは返らない
		private: {
			type: 'boolean',
			optional: true, nullable: false,
		},
		// JUICE: 合成モード(乗算・焼き込みカラーなど)。無ければ通常
		blend: {
			type: 'string',
			optional: true, nullable: false,
			enum: ['multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'lighter'],
		},
	},
} as const;
