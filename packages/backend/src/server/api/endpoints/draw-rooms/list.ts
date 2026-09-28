/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DrawRoomService } from '@/core/DrawRoomService.js';
import { drawRoomErrors, rethrowDrawRoomError } from '@/server/api/draw-room-errors.js';

// JUICE: 絵チャの部屋一覧。userIdを指定しなければ自分が見られる開催中の部屋、
// 指定すればそのユーザーが部屋主の部屋(開催中+保存された終了済み)。
// savedを指定すると、保存された終了済みの部屋だけ(userIdが無ければ、自分が見られる全員分)
export const meta = {
	tags: ['draw-rooms'],

	requireCredential: true,

	kind: 'read:draw-rooms',

	// JUICE: 公開範囲の確認とメンバー全員の情報を部屋ごとに作る重い処理なので、回数を制限する
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
			ref: 'DrawRoom',
		},
	},

	errors: {
		disabled: drawRoomErrors.disabled,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		userId: { type: 'string', format: 'misskey:id' },
		saved: { type: 'boolean', default: false },
		limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private drawRoomService: DrawRoomService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				const rooms = await this.drawRoomService.list(me, { userId: ps.userId, saved: ps.saved, limit: ps.limit, untilId: ps.untilId });
				return await Promise.all(rooms.map(room => this.drawRoomService.pack(room, me)));
			} catch (err) {
				rethrowDrawRoomError(err);
			}
		});
	}
}
