/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueueService } from '@/core/QueueService.js';
import { AccountMoveService } from '@/core/AccountMoveService.js';
import type { DriveFilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ImportRequestService } from '@/core/ImportRequestService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { ApiError } from '../../error.js';

export const meta = {
	secure: true,
	requireCredential: true,
	requiredRolePolicy: 'canImportFollowing',
	prohibitMoved: true,
	limit: {
		duration: ms('1hour'),
		max: 1,
	},

	errors: {
		// JUICE: 承認式にしたインポートで、同じ種類の審査待ちの申請がもうある
		alreadyRequested: {
			message: 'There is already a pending import request of this kind.',
			code: 'ALREADY_REQUESTED',
			id: '5a8f2c1e-7b3d-4e9a-b6c4-1d2e3f4a5b60',
		},

		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: 'b98644cf-a5ac-4277-a502-0b8054a709a3',
		},

		unexpectedFileType: {
			message: 'We need csv file.',
			code: 'UNEXPECTED_FILE_TYPE',
			id: '660f3599-bce0-4f95-9dde-311fd841c183',
		},

		tooBigFile: {
			message: 'That file is too big.',
			code: 'TOO_BIG_FILE',
			id: 'dee9d4ed-ad07-43ed-8b34-b2856398bc60',
		},

		emptyFile: {
			message: 'That file is empty.',
			code: 'EMPTY_FILE',
			id: '31a1b42c-06f7-42ae-8a38-a661c5c9f691',
		},
	},

	// JUICE: 運営の承認が要る(承認式にした)インポートなら、すぐには行わず申請にしたことを返す
	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			requiresApproval: {
				type: 'boolean',
				optional: false, nullable: false,
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		fileId: { type: 'string', format: 'misskey:id' },
		withReplies: { type: 'boolean' },
	},
	required: ['fileId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private queueService: QueueService,
		private importRequestService: ImportRequestService,
		private accountMoveService: AccountMoveService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const file = await this.driveFilesRepository.findOneBy({ id: ps.fileId, userId: me.id });

			if (file == null) throw new ApiError(meta.errors.noSuchFile);
			//if (!file.type.endsWith('/csv')) throw new ApiError(meta.errors.unexpectedFileType);
			if (file.size === 0) throw new ApiError(meta.errors.emptyFile);

			const checkMoving = await this.accountMoveService.validateAlsoKnownAs(
				me,
				(old, src) => !!src.movedAt && src.movedAt.getTime() + 1000 * 60 * 60 * 2 > Date.now(),
				true,
			);
			if (checkMoving ? file.size > 32 * 1024 * 1024 : file.size > 64 * 1024) throw new ApiError(meta.errors.tooBigFile);

			// JUICE: 運営の承認が要る種類なら、申請にする(承認されたら、同じインポートを行う)
			if (await this.importRequestService.requiresApproval(me, 'following')) {
				try {
					await this.importRequestService.createRequest(me, 'following', file, { withReplies: ps.withReplies });
				} catch (err) {
					if (err instanceof IdentifiableError && err.id === ImportRequestService.ALREADY_REQUESTED) throw new ApiError(meta.errors.alreadyRequested);
					throw err;
				}
				return { requiresApproval: true };
			}

			await this.queueService.createImportFollowingJob(me, file.id, ps.withReplies);
			return { requiresApproval: false };
		});
	}
}
