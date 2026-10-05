/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ImportRequestsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { ImportRequestService } from '@/core/ImportRequestService.js';

// JUICE: 承認式にしたインポートの申請と、ファイルの中身の一部(審査する人向け)
export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requiredRolePolicyOrModerator: 'canApproveImportRequests',
	kind: 'read:admin:import-requests',

	errors: {
		noSuchRequest: {
			message: 'No such import request.',
			code: 'NO_SUCH_REQUEST',
			id: '3f5b7d9e-1a2c-4e6f-8a0b-7c9e1f3a5b81',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			request: {
				type: 'object',
				optional: false, nullable: false,
				ref: 'ImportRequestDetailedAdmin',
			},
			// ファイルの中身の一部。ファイルが消えている・読めないときはnull
			preview: {
				type: 'object',
				optional: false, nullable: true,
				properties: {
					// 先頭の行(アンテナは名前)。最大100件
					lines: {
						type: 'array',
						optional: false, nullable: false,
						items: { type: 'string', optional: false, nullable: false },
					},
					totalLines: {
						type: 'integer',
						optional: false, nullable: false,
					},
					// アカウントのホストごとの件数(多い順に最大10件。ホストの無い行は空文字)
					hosts: {
						type: 'array',
						optional: false, nullable: false,
						items: {
							type: 'object',
							optional: false, nullable: false,
							properties: {
								host: { type: 'string', optional: false, nullable: false },
								count: { type: 'integer', optional: false, nullable: false },
							},
						},
					},
				},
			},
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

		private importRequestService: ImportRequestService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const request = await this.importRequestsRepository.findOne({ where: { id: ps.requestId }, relations: { user: true, reviewer: true } });
			if (request == null) throw new ApiError(meta.errors.noSuchRequest);
			return {
				request: await this.importRequestService.packDetailed(request, me),
				preview: await this.importRequestService.preview(request),
			};
		});
	}
}
