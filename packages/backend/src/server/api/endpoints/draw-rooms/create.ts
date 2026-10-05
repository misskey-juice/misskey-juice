/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DrawRoomService, normalizeCw, normalizeDescription, DRAW_ROOM_DESCRIPTION_MAX_LENGTH, DRAW_ROOM_CANVAS_MAX_SIZE, DRAW_ROOM_CANVAS_MIN_SIZE, DRAW_ROOM_CANVAS_PRESETS, DRAW_ROOM_MAX_MEMBERS, DRAW_ROOM_MIN_MEMBERS } from '@/core/DrawRoomService.js';
import { drawRoomVisibilities } from '@/models/DrawRoom.js';
import { drawRoomErrors, rethrowDrawRoomError } from '@/server/api/draw-room-errors.js';
import { ApiError } from '@/server/api/error.js';

// JUICE: 絵チャの部屋を作る(作った人は部屋主としてメンバーにもなる)
export const meta = {
	tags: ['draw-rooms'],

	requireCredential: true,
	prohibitMoved: true,

	kind: 'write:draw-rooms',

	limit: {
		duration: ms('1hour'),
		max: 20,
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'DrawRoom',
	},

	errors: {
		disabled: drawRoomErrors.disabled,
		alreadyHosting: drawRoomErrors.alreadyHosting,
		canvasTooLarge: drawRoomErrors.canvasTooLarge,
		cannotCreate: drawRoomErrors.cannotCreate,
		invalidCanvasSize: drawRoomErrors.invalidCanvasSize,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		title: { type: 'string', minLength: 1, maxLength: 64 },
		visibility: { type: 'string', enum: drawRoomVisibilities },
		maxMembers: { type: 'integer', minimum: DRAW_ROOM_MIN_MEMBERS, maximum: DRAW_ROOM_MAX_MEMBERS },
		canvasPreset: { type: 'string', enum: Object.keys(DRAW_ROOM_CANVAS_PRESETS) as (keyof typeof DRAW_ROOM_CANVAS_PRESETS)[] },
		// JUICE: 大きさを直接指定する(両方指定したときはcanvasPresetより優先。どちらも無ければ横長)
		canvasWidth: { type: 'integer', minimum: DRAW_ROOM_CANVAS_MIN_SIZE, maximum: DRAW_ROOM_CANVAS_MAX_SIZE },
		canvasHeight: { type: 'integer', minimum: DRAW_ROOM_CANVAS_MIN_SIZE, maximum: DRAW_ROOM_CANVAS_MAX_SIZE },
		keepAfterEnd: { type: 'boolean', default: false },
		// JUICE: 部屋を開く前に出す注意書き(CW)と、センシティブ(NSFW)の印
		cw: { type: 'string', nullable: true, maxLength: 128 },
		// JUICE: 部屋の説明(どんな絵を描く部屋か。一覧にも出す。nullか空で外す)
		description: { type: 'string', nullable: true, maxLength: DRAW_ROOM_DESCRIPTION_MAX_LENGTH },
		isSensitive: { type: 'boolean', default: false },
	},
	required: ['title', 'visibility', 'maxMembers'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private drawRoomService: DrawRoomService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// 幅と高さは両方そろえて指定する(片方だけだと、黙ってプリセットの大きさになってしまうため)
			if ((ps.canvasWidth == null) !== (ps.canvasHeight == null)) throw new ApiError(meta.errors.invalidCanvasSize);
			try {
				const room = await this.drawRoomService.create(me, {
					title: ps.title,
					visibility: ps.visibility,
					maxMembers: ps.maxMembers,
					canvasPreset: ps.canvasPreset,
					canvasSize: ps.canvasWidth != null && ps.canvasHeight != null ? { width: ps.canvasWidth, height: ps.canvasHeight } : undefined,
					keepAfterEnd: ps.keepAfterEnd,
					cw: normalizeCw(ps.cw),
					description: normalizeDescription(ps.description),
					isSensitive: ps.isSensitive,
				});
				return await this.drawRoomService.pack(room, me);
			} catch (err) {
				rethrowDrawRoomError(err);
			}
		});
	}
}
