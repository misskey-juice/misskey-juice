/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DrawRoomService } from '@/core/DrawRoomService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { drawRoomErrors, rethrowDrawRoomError } from '@/server/api/draw-room-errors.js';

// JUICE: 絵チャの部屋のチャット(直近100件、古い順)
export const meta = {
	tags: ['draw-rooms'],

	// JUICE: ログインしていない人も、公開の部屋(ローカル全体・NSFWでない)なら見られる(見るだけ)
	requireCredential: false,

	kind: 'read:draw-rooms',

	// JUICE: 回数を制限する
	limit: {
		duration: ms('1minute'),
		max: 60,
	},

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			properties: {
				message: {
					type: 'object',
					optional: false, nullable: false,
					ref: 'DrawRoomChatMessage',
				},
				user: {
					type: 'object',
					optional: false, nullable: false,
					ref: 'UserLite',
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
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const room = await this.drawRoomService.getRoom(ps.roomId, me);
				const messages = await this.drawRoomService.getChat(room);
				const users = await this.userEntityService.packMany([...new Set(messages.map(m => m.userId))], me);
				const userMap = new Map(users.map(u => [u.id, u]));
				return messages.flatMap(message => {
					const user = userMap.get(message.userId);
					return user ? [{ message, user }] : [];
				});
			} catch (err) {
				rethrowDrawRoomError(err);
			}
		});
	}
}
