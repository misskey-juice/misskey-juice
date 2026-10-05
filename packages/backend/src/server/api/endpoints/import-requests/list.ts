/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ImportRequestsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { QueryService } from '@/core/QueryService.js';
import { ImportRequestService } from '@/core/ImportRequestService.js';
import { importRequestStatuses } from '@/models/ImportRequest.js';

// JUICE: 自分の、承認式にしたインポートの申請の一覧
export const meta = {
	tags: ['account'],

	requireCredential: true,
	kind: 'read:account',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'ImportRequest',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		state: { type: 'string', enum: importRequestStatuses },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.importRequestsRepository)
		private importRequestsRepository: ImportRequestsRepository,

		private queryService: QueryService,
		private importRequestService: ImportRequestService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const query = this.queryService.makePaginationQuery(this.importRequestsRepository.createQueryBuilder('request'), ps.sinceId, ps.untilId)
				.andWhere('request.userId = :userId', { userId: me.id });
			if (ps.state != null) query.andWhere('request.status = :status', { status: ps.state });

			const requests = await query.limit(ps.limit).getMany();
			return requests.map(request => this.importRequestService.pack(request));
		});
	}
}
