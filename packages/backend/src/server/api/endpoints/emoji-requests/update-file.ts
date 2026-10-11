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
import { resolveEmojiRequestSettings } from '@/models/JuiceSettings.js';
import { FILE_TYPE_IMAGE } from '@/const.js';
import { ApiError } from '@/server/api/error.js';

// JUICE: 審査待ちの自分の絵文字申請の画像を差し替える(申請し直さずに、画像だけを入れ替える)。
// 承認・却下・取り下げの後は差し替えられない
export const meta = {
	tags: ['emoji-requests'],

	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:emoji-requests',

	limit: {
		duration: ms('1hour'),
		max: 60,
	},

	errors: {
		functionDisabled: {
			message: 'The emoji request feature is currently disabled.',
			code: 'FUNCTION_DISABLED',
			id: '44214383-98c3-4237-87c1-d70ba728f0e3',
		},
		noSuchRequest: {
			message: 'No such emoji request.',
			code: 'NO_SUCH_REQUEST',
			id: 'e42ad0c2-fe24-47ce-b7dd-a86201a8112b',
		},
		alreadyReviewed: {
			message: 'This emoji request has already been reviewed.',
			code: 'ALREADY_REVIEWED',
			id: 'b6d8fa3f-c33d-4954-a794-7fc246890a6d',
		},
		// JUICE: 申請者が画像を差し替えたため、見ていた申請と中身が変わった(もう一度確かめてもらう)
		requestModified: {
			message: 'The image of this emoji request has been replaced. Please check it again.',
			code: 'REQUEST_MODIFIED',
			id: 'af8e5fff-3df4-4eaa-89c0-e73ee0a40c08',
		},
		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: '5ea98307-9a2f-460f-bacd-d18e75030489',
		},
		accessDenied: {
			message: 'You do not have permission to use this file.',
			code: 'ACCESS_DENIED',
			id: '52de2ac4-c505-4537-a769-a91c32f3f8fd',
		},
		unsupportedFileType: {
			message: 'Unsupported file type.',
			code: 'UNSUPPORTED_FILE_TYPE',
			id: '63a1db85-25ff-4a21-818a-cb9a9cded762',
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
		@Inject(DI.emojiRequestsRepository)
		private emojiRequestsRepository: EmojiRequestsRepository,

		@Inject(DI.avatarDecorationRequestsRepository)
		private avatarDecorationRequestsRepository: AvatarDecorationRequestsRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private driveService: DriveService,
		private juiceSettingsService: JuiceSettingsService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const { emojiRequestEnabled } = resolveEmojiRequestSettings(await this.juiceSettingsService.fetch());
			if (!emojiRequestEnabled) throw new ApiError(meta.errors.functionDisabled);

			// 他人の申請の存在有無が判別できてしまわないよう、userId不一致もnoSuchRequestと同じ扱いにする
			const request = await this.emojiRequestsRepository.findOneBy({ id: ps.requestId, userId: me.id });
			if (request == null) throw new ApiError(meta.errors.noSuchRequest);
			if (request.status !== 'pending') throw new ApiError(meta.errors.alreadyReviewed);

			const driveFile = await this.driveFilesRepository.findOneBy({ id: ps.fileId });
			if (driveFile == null) throw new ApiError(meta.errors.noSuchFile);
			if (driveFile.userId !== me.id) throw new ApiError(meta.errors.accessDenied);
			if (!FILE_TYPE_IMAGE.includes(driveFile.type)) throw new ApiError(meta.errors.unsupportedFileType);

			// 冒頭のstatusチェックと更新の間に、モデレーターの審査(承認/却下)や取り下げが割り込むのを防ぐため、
			// WHERE句にstatus='pending'と読んだときの画像(fileId)を含めた条件付きUPDATEで原子的に排他する
			const updateResult = await this.emojiRequestsRepository.update({ id: request.id, userId: me.id, status: 'pending', fileId: request.fileId ?? IsNull() }, {
				fileId: driveFile.id,
			});
			if (updateResult.affected === 0) {
				// 同時にもう一度差し替えた・取り下げたなどで、読んだときの画像から変わっていたら断る(古い画像を二重に消さないため)
				const current = await this.emojiRequestsRepository.findOneBy({ id: request.id });
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
