/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { IsNull } from 'typeorm';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AvatarDecorationRequestsRepository, DriveFilesRepository, EmojiRequestsRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { DriveService } from '@/core/DriveService.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { resolveAvatarDecorationRequestSettings } from '@/models/JuiceSettings.js';
import { FILE_TYPE_IMAGE } from '@/const.js';
import { ApiError } from '@/server/api/error.js';

// JUICE: 審査待ちの自分のアバターデコレーション申請の画像を差し替える(申請し直さずに、画像だけを入れ替える)。
// 承認・却下・取り下げの後は差し替えられない
export const meta = {
	tags: ['avatar-decoration-requests'],

	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:avatar-decoration-requests',

	limit: {
		duration: ms('1hour'),
		max: 60,
	},

	errors: {
		functionDisabled: {
			message: 'The avatar decoration request feature is currently disabled.',
			code: 'FUNCTION_DISABLED',
			id: '18e3560c-637b-4cdc-b185-27a5b2665388',
		},
		noSuchRequest: {
			message: 'No such avatar decoration request.',
			code: 'NO_SUCH_REQUEST',
			id: '16966edd-99dd-4e39-8524-6c15d508d23c',
		},
		alreadyReviewed: {
			message: 'This avatar decoration request has already been reviewed.',
			code: 'ALREADY_REVIEWED',
			id: '83c68d40-fed0-49a8-9d4d-be3da59e6c42',
		},
		// JUICE: 申請者が画像を差し替えたため、見ていた申請と中身が変わった(もう一度確かめてもらう)
		requestModified: {
			message: 'The image of this avatar decoration request has been replaced. Please check it again.',
			code: 'REQUEST_MODIFIED',
			id: 'fe31bf16-022b-4178-86be-390894f2f8aa',
		},
		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: 'ffebc49b-fb84-4ef6-a8dd-46dd5d4dc1a6',
		},
		accessDenied: {
			message: 'You do not have permission to use this file.',
			code: 'ACCESS_DENIED',
			id: '9d1f0b8e-3c2a-4e57-8b6d-1a4f7c9e2d30',
		},
		unsupportedFileType: {
			message: 'Unsupported file type.',
			code: 'UNSUPPORTED_FILE_TYPE',
			id: 'c4e8a2f6-7b1d-4c39-9e5a-2f8b6d0a4c71',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			fileId: { type: 'string', optional: false, nullable: false, format: 'id' },
			fileUrl: { type: 'string', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		requestId: { type: 'string', format: 'misskey:id' },
		fileId: { type: 'string', format: 'misskey:id' },
	},
	required: ['requestId', 'fileId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.avatarDecorationRequestsRepository)
		private avatarDecorationRequestsRepository: AvatarDecorationRequestsRepository,

		@Inject(DI.emojiRequestsRepository)
		private emojiRequestsRepository: EmojiRequestsRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private driveService: DriveService,
		private juiceSettingsService: JuiceSettingsService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const { avatarDecorationRequestEnabled } = resolveAvatarDecorationRequestSettings(await this.juiceSettingsService.fetch());
			if (!avatarDecorationRequestEnabled) throw new ApiError(meta.errors.functionDisabled);

			// 他人の申請の存在有無が判別できてしまわないよう、userId不一致もnoSuchRequestと同じ扱いにする
			const request = await this.avatarDecorationRequestsRepository.findOneBy({ id: ps.requestId, userId: me.id });
			if (request == null) throw new ApiError(meta.errors.noSuchRequest);
			if (request.status !== 'pending') throw new ApiError(meta.errors.alreadyReviewed);

			const driveFile = await this.driveFilesRepository.findOneBy({ id: ps.fileId });
			if (driveFile == null) throw new ApiError(meta.errors.noSuchFile);
			if (driveFile.userId !== me.id) throw new ApiError(meta.errors.accessDenied);
			if (!FILE_TYPE_IMAGE.includes(driveFile.type)) throw new ApiError(meta.errors.unsupportedFileType);

			// 冒頭のstatusチェックと更新の間に、モデレーターの審査(承認/却下)や取り下げが割り込むのを防ぐため、
			// WHERE句にstatus='pending'と読んだときの画像(fileId)を含めた条件付きUPDATEで原子的に排他する
			const updateResult = await this.avatarDecorationRequestsRepository.update({ id: request.id, userId: me.id, status: 'pending', fileId: request.fileId ?? IsNull() }, {
				fileId: driveFile.id,
			});
			if (updateResult.affected === 0) {
				// 同時にもう一度差し替えた・取り下げたなどで、読んだときの画像から変わっていたら断る(古い画像を二重に消さないため)
				const current = await this.avatarDecorationRequestsRepository.findOneBy({ id: request.id });
				throw new ApiError(current?.status === 'pending' ? meta.errors.requestModified : meta.errors.alreadyReviewed);
			}

			// 「審査後にファイルを消す」にしていた申請なら、使わなくなった前の画像を消す(ほかの申請で使っていなければ)
			if (request.deleteFileAfterReview && request.fileId != null && request.fileId !== driveFile.id) {
				const oldFileId = request.fileId;
				// 絵文字申請・アバターデコレーション申請のどちらかで、まだその画像を使っていれば消さない
				const stillUsed = await this.emojiRequestsRepository.existsBy({ fileId: oldFileId }) || await this.avatarDecorationRequestsRepository.existsBy({ fileId: oldFileId });
				if (!stillUsed) {
					const oldFile = await this.driveFilesRepository.findOneBy({ id: oldFileId, userId: me.id });
					if (oldFile != null) this.driveService.deleteFile(oldFile, false, me);
				}
			}

			return {
				fileId: driveFile.id,
				fileUrl: driveFile.url,
			};
		});
	}
}
