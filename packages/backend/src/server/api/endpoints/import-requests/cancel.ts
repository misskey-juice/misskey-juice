/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ImportRequestsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';

// JUICE: 自分の、承認式にしたインポートの申請を取り下げる(審査待ちのものだけ)
export const meta = {
	tags: ['account'],

	requireCredential: true,
	kind: 'write:account',

	errors: {
		noSuchRequest: {
			message: 'No such import request.',
			code: 'NO_SUCH_REQUEST',
			id: 'b13d5f7a-9cae-46b1-8c8d-5e7a9b1c3d09',
		},
		alreadyReviewed: {
			message: 'This import request has already been reviewed.',
			code: 'ALREADY_REVIEWED',
			id: 'c24e6a8b-adbf-47c2-9d9e-6f8b0c2d4e1a',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		requestId: { type: 'string', format: 'misskey:id' },
	},
	required: ['requestId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.importRequestsRepository)
		private importRequestsRepository: ImportRequestsRepository,
	) {
		super(meta, paramDef, async (ps, me) => {
			const request = await this.importRequestsRepository.findOneBy({ id: ps.requestId, userId: me.id });
			if (request == null) throw new ApiError(meta.errors.noSuchRequest);
			if (request.status !== 'pending') throw new ApiError(meta.errors.alreadyReviewed);

			// 同時に審査されたときに、審査の結果を上書きしないよう、status='pending'を条件にして更新する
			const updateResult = await this.importRequestsRepository.update({ id: request.id, userId: me.id, status: 'pending' }, {
				status: 'cancelled',
			});
			if (updateResult.affected === 0) throw new ApiError(meta.errors.alreadyReviewed);
		});
	}
}
