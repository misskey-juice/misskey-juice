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
import { ImportRequestService } from '@/core/ImportRequestService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

// JUICE: 承認式にしたインポートの申請を承認し、元のインポートを行う
export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requiredRolePolicyOrModerator: 'canApproveImportRequests',
	kind: 'write:admin:import-requests',

	errors: {
		noSuchRequest: {
			message: 'No such import request.',
			code: 'NO_SUCH_REQUEST',
			id: '4a6c8e0f-2b3d-4f5a-9b1c-8d0f2a4b6c92',
		},
		alreadyReviewed: {
			message: 'This import request has already been reviewed.',
			code: 'ALREADY_REVIEWED',
			id: '5b7d9f1a-3c4e-405b-8c2d-9e1a3b5c7da3',
		},
		noSuchFile: {
			message: 'The file to import has been deleted by the requester.',
			code: 'NO_SUCH_FILE',
			id: '6c8e0a2b-4d5f-416c-9d3e-0f2b4c6d8eb4',
		},
		tooManyAntennas: {
			message: 'The requester cannot create antenna any more.',
			code: 'TOO_MANY_ANTENNAS',
			id: '7d9f1b3c-5e6a-427d-8e4f-1a3c5d7e9fc5',
		},
		invalidFile: {
			message: 'The file is not a valid antenna export.',
			code: 'INVALID_FILE',
			id: '8e0a2c4d-6f7b-438e-9f5a-2b4d6e8f0ad6',
		},
		// 申請した後に、凍結・削除された、アカウントを引っ越した、インポートできるロールではなくなった
		requesterUnavailable: {
			message: 'The requester cannot import now (suspended, deleted, moved, or no longer allowed to import).',
			code: 'REQUESTER_UNAVAILABLE',
			id: 'f3c5e7a9-8b0d-4c2e-af4a-9b1d3f5a7ce8',
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

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private moderationLogService: ModerationLogService,
		private notificationService: NotificationService,
		private importRequestService: ImportRequestService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const request = await this.importRequestsRepository.findOneBy({ id: ps.requestId });
			if (request == null) throw new ApiError(meta.errors.noSuchRequest);
			if (request.status !== 'pending') throw new ApiError(meta.errors.alreadyReviewed);

			const requester = await this.usersRepository.findOneByOrFail({ id: request.userId });

			// 同時に別の審査(承認・却下・取り下げ)が割り込まないよう、status='pending'を条件にして先に押さえてから、インポートを行う
			const reviewedAt = new Date();
			const updateResult = await this.importRequestsRepository.update({ id: request.id, status: 'pending' }, {
				status: 'approved',
				reviewerId: me.id,
				reviewedAt,
			});
			if (updateResult.affected === 0) throw new ApiError(meta.errors.alreadyReviewed);

			try {
				await this.importRequestService.startImport(request);
			} catch (err) {
				// インポートを始められなかったら、審査待ちに戻す(却下するか、ファイルを直してもらう)
				await this.importRequestsRepository.update({ id: request.id, status: 'approved', reviewerId: me.id, reviewedAt }, {
					status: 'pending',
					reviewerId: null,
					reviewedAt: null,
				});
				if (err instanceof IdentifiableError) {
					if (err.id === ImportRequestService.NO_SUCH_FILE) throw new ApiError(meta.errors.noSuchFile);
					if (err.id === ImportRequestService.TOO_MANY_ANTENNAS) throw new ApiError(meta.errors.tooManyAntennas);
					if (err.id === ImportRequestService.INVALID_FILE) throw new ApiError(meta.errors.invalidFile);
					if (err.id === ImportRequestService.REQUESTER_UNAVAILABLE) throw new ApiError(meta.errors.requesterUnavailable);
				}
				throw err;
			}

			this.moderationLogService.log(me, 'approveImportRequest', {
				requestId: request.id,
				requesterId: requester.id,
				requesterUsername: requester.username,
				requesterHost: requester.host,
				importType: request.type,
				fileName: request.fileName,
			});

			this.notificationService.createNotification(request.userId, 'importRequestApproved', {
				requestId: request.id,
				importType: request.type,
			});
		});
	}
}
