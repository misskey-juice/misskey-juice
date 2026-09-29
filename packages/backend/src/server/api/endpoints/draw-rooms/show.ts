/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DrawRoomService } from '@/core/DrawRoomService.js';
import { drawRoomErrors, rethrowDrawRoomError } from '@/server/api/draw-room-errors.js';

// JUICE: 絵チャの部屋の情報
export const meta = {
	tags: ['draw-rooms'],

	// JUICE: ログインしていない人も、公開の部屋(ローカル全体・NSFWでない)なら見られる(見るだけ)
	requireCredential: false,

	kind: 'read:draw-rooms',

	// JUICE: メンバー全員の情報を返すので、回数を制限する
	limit: {
		duration: ms('1minute'),
		max: 120,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'DrawRoom',
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
				return await this.drawRoomService.pack(room, me);
			} catch (err) {
				rethrowDrawRoomError(err);
			}
		});
	}
}
