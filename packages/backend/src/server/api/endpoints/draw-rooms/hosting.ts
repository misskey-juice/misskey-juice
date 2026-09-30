/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DrawRoomService } from '@/core/DrawRoomService.js';
import { drawRoomErrors, rethrowDrawRoomError } from '@/server/api/draw-room-errors.js';

// JUICE: 自分が開催中の絵チャの部屋の数と、同時に開催できる部屋の数の上限(ロールで決まる)
export const meta = {
	tags: ['draw-rooms'],

	requireCredential: true,

	kind: 'read:draw-rooms',

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			count: {
				type: 'integer',
				optional: false, nullable: false,
			},
			max: {
				type: 'integer',
				optional: false, nullable: false,
			},
		},
	},

	errors: {
		disabled: drawRoomErrors.disabled,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private drawRoomService: DrawRoomService,
	) {
		super(meta, paramDef, async (ps, me) => {
			try {
				return await this.drawRoomService.hostingStatus(me);
			} catch (err) {
				rethrowDrawRoomError(err);
			}
		});
	}
}
