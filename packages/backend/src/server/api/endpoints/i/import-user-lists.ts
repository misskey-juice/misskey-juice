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
	requiredRolePolicy: 'canImportUserLists',
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
			id: '8dbc5f41-ae60-41cd-a9f7-4a5b6c7d8e93',
		},

		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: 'ea9cc34f-c415-4bc6-a6fe-28ac40357049',
		},

		unexpectedFileType: {
			message: 'We need csv file.',
			code: 'UNEXPECTED_FILE_TYPE',
			id: 'a3c9edda-dd9b-4596-be6a-150ef813745c',
		},

		tooBigFile: {
			message: 'That file is too big.',
			code: 'TOO_BIG_FILE',
			id: 'ae6e7a22-971b-4b52-b2be-fc0b9b121fe9',
		},

		emptyFile: {
			message: 'That file is empty.',
			code: 'EMPTY_FILE',
			id: '99efe367-ce6e-4d44-93f8-5fae7b040356',
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
			if (await this.importRequestService.requiresApproval(me, 'userLists')) {
				try {
					await this.importRequestService.createRequest(me, 'userLists', file, {});
				} catch (err) {
					if (err instanceof IdentifiableError && err.id === ImportRequestService.ALREADY_REQUESTED) throw new ApiError(meta.errors.alreadyRequested);
					throw err;
				}
				return { requiresApproval: true };
			}

			await this.queueService.createImportUserListsJob(me, file.id);
			return { requiresApproval: false };
		});
	}
}
