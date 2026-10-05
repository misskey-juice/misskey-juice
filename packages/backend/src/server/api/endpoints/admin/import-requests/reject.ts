/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { ImportRequestsRepository, UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { NotificationService } from '@/core/NotificationService.js';

// JUICE: 承認式にしたインポートの申請を却下する(インポートは行わない)
export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requiredRolePolicyOrModerator: 'canApproveImportRequests',
	kind: 'write:admin:import-requests',

	errors: {
		noSuchRequest: {
			message: 'No such import request.',
			code: 'NO_SUCH_REQUEST',
			id: '9f1b3d5e-7a8c-449f-8a6b-3c5e7f9a1be7',
		},
		alreadyReviewed: {
			message: 'This import request has already been reviewed.',
			code: 'ALREADY_REVIEWED',
			id: 'a02c4e6f-8b9d-45a0-9b7c-4d6f8a0b2cf8',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		requestId: { type: 'string', format: 'misskey:id' },
		reason: { type: 'string', maxLength: 1024 },
	},
	required: ['requestId', 'reason'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.importRequestsRepository)
		private importRequestsRepository: ImportRequestsRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private moderationLogService: ModerationLogService,
		private notificationService: NotificationService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const request = await this.importRequestsRepository.findOneBy({ id: ps.requestId });
			if (request == null) throw new ApiError(meta.errors.noSuchRequest);
			if (request.status !== 'pending') throw new ApiError(meta.errors.alreadyReviewed);

			const requester = await this.usersRepository.findOneByOrFail({ id: request.userId });

			// 同時に別の審査が割り込まないよう、status='pending'を条件にして更新する
			const updateResult = await this.importRequestsRepository.update({ id: request.id, status: 'pending' }, {
				status: 'rejected',
				reviewerId: me.id,
				reviewedAt: new Date(),
				rejectReason: ps.reason,
			});
			if (updateResult.affected === 0) throw new ApiError(meta.errors.alreadyReviewed);

			this.moderationLogService.log(me, 'rejectImportRequest', {
				requestId: request.id,
				requesterId: requester.id,
				requesterUsername: requester.username,
				requesterHost: requester.host,
				importType: request.type,
				fileName: request.fileName,
				reason: ps.reason,
			});

			this.notificationService.createNotification(request.userId, 'importRequestRejected', {
				requestId: request.id,
				importType: request.type,
				reason: ps.reason === '' ? null : ps.reason,
			});
		});
	}
}
