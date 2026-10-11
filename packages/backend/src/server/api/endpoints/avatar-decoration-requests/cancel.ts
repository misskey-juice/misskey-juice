/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IsNull } from 'typeorm';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AvatarDecorationRequestsRepository, DriveFilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { DriveService } from '@/core/DriveService.js';

// JUICE: 審査待ちの自分のアバターデコレーション申請を、申請者自身の意思で取り下げる(モデレーターによる却下とは別)。
export const meta = {
	tags: ['avatar-decoration-requests'],

	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:avatar-decoration-requests',

	errors: {
		noSuchRequest: {
			message: 'No such avatar decoration request.',
			code: 'NO_SUCH_REQUEST',
			id: '2a23b8eb-1456-45a6-b99a-eefc30563190',
		},
		alreadyReviewed: {
			message: 'This avatar decoration request has already been reviewed.',
			code: 'ALREADY_REVIEWED',
			id: '9bbe4269-34c7-4cd5-8878-be00790ec54c',
		},
		// JUICE: 申請者が画像を差し替えたため、見ていた申請と中身が変わった(もう一度確かめてもらう)
		requestModified: {
			message: 'The image of this avatar decoration request has been replaced. Please check it again.',
			code: 'REQUEST_MODIFIED',
			id: 'ddde13c4-36f0-4f35-af46-2fbf8d468950',
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
		@Inject(DI.avatarDecorationRequestsRepository)
		private avatarDecorationRequestsRepository: AvatarDecorationRequestsRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private driveService: DriveService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// JUICE: 他人の申請の存在有無が判別できてしまわないよう、userId不一致もnoSuchRequestと同じ扱いにする
			const request = await this.avatarDecorationRequestsRepository.findOneBy({ id: ps.requestId, userId: me.id });
			if (request == null) throw new ApiError(meta.errors.noSuchRequest);
			if (request.status !== 'pending') throw new ApiError(meta.errors.alreadyReviewed);

			// JUICE: 冒頭のstatusチェックと本更新の間に、モデレーターによる審査(承認/却下)が
			// 割り込むTOCTOUを防ぐため、WHERE句にstatus='pending'を含めた条件付きUPDATEで原子的に排他する
			const updateResult = await this.avatarDecorationRequestsRepository.update({ id: request.id, status: 'pending', fileId: request.fileId ?? IsNull() }, {
				status: 'cancelled',
				reviewedAt: new Date(),
			});
			if (updateResult.affected === 0) {
				// JUICE: 同時に画像を差し替えていたら(まだ審査待ちのまま)、消すファイルを取り違えないよう断る
				const current = await this.avatarDecorationRequestsRepository.findOneBy({ id: request.id });
				throw new ApiError(current?.status === 'pending' ? meta.errors.requestModified : meta.errors.alreadyReviewed);
			}

			if (request.deleteFileAfterReview && request.fileId != null) {
				const driveFile = await this.driveFilesRepository.findOneBy({ id: request.fileId });
				if (driveFile != null) {
					this.driveService.deleteFile(driveFile, false, me);
				}
			}
		});
	}
}
