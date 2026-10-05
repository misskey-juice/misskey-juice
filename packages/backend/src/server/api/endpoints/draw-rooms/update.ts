/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DrawRoomService, normalizeCw, normalizeDescription, DRAW_ROOM_DESCRIPTION_MAX_LENGTH, DRAW_ROOM_CANVAS_MAX_SIZE, DRAW_ROOM_CANVAS_MIN_SIZE, DRAW_ROOM_MAX_MEMBERS, DRAW_ROOM_MIN_MEMBERS } from '@/core/DrawRoomService.js';
import { drawRoomErrors, rethrowDrawRoomError } from '@/server/api/draw-room-errors.js';

// JUICE: 部屋主が、絵チャの部屋のタイトル・人数上限・終了後に保存するかを変える
export const meta = {
	tags: ['draw-rooms'],

	requireCredential: true,

	kind: 'write:draw-rooms',

	limit: {
		duration: ms('1minute'),
		max: 60,
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
		notOwner: drawRoomErrors.notOwner,
		ended: drawRoomErrors.ended,
		canvasTooLarge: drawRoomErrors.canvasTooLarge,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		roomId: { type: 'string', format: 'misskey:id' },
		title: { type: 'string', minLength: 1, maxLength: 64 },
		maxMembers: { type: 'integer', minimum: DRAW_ROOM_MIN_MEMBERS, maximum: DRAW_ROOM_MAX_MEMBERS },
		keepAfterEnd: { type: 'boolean' },
		// JUICE: 注意書き(CW。nullか空で外す)と、センシティブ(NSFW)の印
		cw: { type: 'string', nullable: true, maxLength: 128 },
		// JUICE: 部屋の説明(どんな絵を描く部屋か。一覧にも出す。nullか空で外す)
		description: { type: 'string', nullable: true, maxLength: DRAW_ROOM_DESCRIPTION_MAX_LENGTH },
		isSensitive: { type: 'boolean' },
		// JUICE: キャンバスの大きさ(左上を基準に広げる・切り詰める。線は消えない)
		canvasWidth: { type: 'integer', minimum: DRAW_ROOM_CANVAS_MIN_SIZE, maximum: DRAW_ROOM_CANVAS_MAX_SIZE },
		canvasHeight: { type: 'integer', minimum: DRAW_ROOM_CANVAS_MIN_SIZE, maximum: DRAW_ROOM_CANVAS_MAX_SIZE },
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
				const updated = await this.drawRoomService.update(room, me, {
					title: ps.title,
					maxMembers: ps.maxMembers,
					keepAfterEnd: ps.keepAfterEnd,
					cw: ps.cw === undefined ? undefined : normalizeCw(ps.cw),
					description: ps.description === undefined ? undefined : normalizeDescription(ps.description),
					isSensitive: ps.isSensitive,
					canvasWidth: ps.canvasWidth,
					canvasHeight: ps.canvasHeight,
				});
				return await this.drawRoomService.pack(updated, me);
			} catch (err) {
				rethrowDrawRoomError(err);
			}
		});
	}
}
