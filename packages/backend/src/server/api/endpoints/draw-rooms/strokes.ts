/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DrawRoomService } from '@/core/DrawRoomService.js';
import { drawRoomErrors, rethrowDrawRoomError } from '@/server/api/draw-room-errors.js';

// JUICE: 絵チャの部屋の、全員のレイヤーの線(途中参加・再接続・保存された部屋の閲覧用)
export const meta = {
	tags: ['draw-rooms'],

	// JUICE: ログインしていない人も、公開の部屋(ローカル全体・NSFWでない)なら見られる(見るだけ)
	requireCredential: false,

	kind: 'read:draw-rooms',

	// JUICE: 線を全部返す重い処理なので、回数を制限する
	limit: {
		duration: ms('1minute'),
		max: 30,
	},

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				userId: {
					type: 'string',
					optional: false, nullable: false,
				},
				strokes: {
					type: 'array',
					optional: false, nullable: false,
					items: {
						type: 'object',
						optional: false, nullable: false,
						ref: 'DrawStroke',
					},
				},
				// JUICE: その人のレイヤーの一覧(重なり順は下から)。無ければ最初のレイヤー1枚だけ
				layers: {
					type: 'array',
					optional: false, nullable: false,
					items: {
						type: 'object',
						optional: false, nullable: false,
						ref: 'DrawLayer',
					},
				},
			},
		},
	},

	errors: {
		disabled: drawRoomErrors.disabled,
		noSuchRoom: drawRoomErrors.noSuchRoom,
		forbidden: drawRoomErrors.forbidden,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		roomId: { type: 'string', format: 'misskey:id' },
	},
	required: ['roomId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private drawRoomService: DrawRoomService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const room = await this.drawRoomService.getRoom(ps.roomId, me);
				// JUICE: ほかの人の下描きのレイヤーは返さない
				return await this.drawRoomService.getLayers(room, me?.id ?? null);
			} catch (err) {
				rethrowDrawRoomError(err);
			}
		});
	}
}
