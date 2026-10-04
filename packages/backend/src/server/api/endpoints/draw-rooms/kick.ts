/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DrawRoomService } from '@/core/DrawRoomService.js';
import { drawRoomErrors, rethrowDrawRoomError } from '@/server/api/draw-room-errors.js';

// JUICE: 部屋主が、絵チャの部屋のメンバーを外す(外された人は見学者になる)
export const meta = {
	tags: ['draw-rooms'],

	requireCredential: true,

	kind: 'write:draw-rooms',

	limit: {
		duration: ms('1minute'),
		max: 60,
	},

	errors: {
		disabled: drawRoomErrors.disabled,
		noSuchRoom: drawRoomErrors.noSuchRoom,
		forbidden: drawRoomErrors.forbidden,
		notOwner: drawRoomErrors.notOwner,
		cannotKickOwner: drawRoomErrors.cannotKickOwner,
		ended: drawRoomErrors.ended,
		notMember: drawRoomErrors.notMember,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		roomId: { type: 'string', format: 'misskey:id' },
		userId: { type: 'string', format: 'misskey:id' },
		// 外す理由(任意)。外された本人にだけ伝える
		reason: { type: 'string', nullable: true, maxLength: 200 },
	},
	required: ['roomId', 'userId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private drawRoomService: DrawRoomService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const room = await this.drawRoomService.getRoom(ps.roomId, me);
				await this.drawRoomService.kick(room, me, ps.userId, ps.reason?.trim() || null);
			} catch (err) {
				rethrowDrawRoomError(err);
			}
		});
	}
}
