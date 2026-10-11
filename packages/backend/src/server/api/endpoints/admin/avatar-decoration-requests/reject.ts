/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { IsNull } from 'typeorm';
import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AvatarDecorationRequestsRepository, DriveFilesRepository, UserProfilesRepository, UsersRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { DriveService } from '@/core/DriveService.js';
import { EmailService } from '@/core/EmailService.js';
import { EmailI18nService } from '@/core/EmailI18nService.js';
import { NotificationService } from '@/core/NotificationService.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	// JUICE: モデレーター/管理者、またはcanApproveAvatarDecorationRequestsロールポリシーを持つユーザーのみ許可
	requiredRolePolicyOrModerator: 'canApproveAvatarDecorationRequests',
	kind: 'write:admin:avatar-decoration-requests-reject',

	errors: {
		noSuchRequest: {
			message: 'No such avatar decoration request.',
			code: 'NO_SUCH_REQUEST',
			id: '429f8943-4682-4d7c-ab0a-e2659a394cd7',
		},
		alreadyReviewed: {
			message: 'This avatar decoration request has already been reviewed.',
			code: 'ALREADY_REVIEWED',
			id: '36323604-7766-4741-a5f1-a7a9e6c904d9',
		},
		// JUICE: 申請者が画像を差し替えたため、見ていた申請と中身が変わった(もう一度確かめてもらう)
		requestModified: {
			message: 'The image of this avatar decoration request has been replaced. Please check it again.',
			code: 'REQUEST_MODIFIED',
			id: '5498b455-fe41-4b3d-8eac-3142ee627133',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		requestId: { type: 'string', format: 'misskey:id' },
		// JUICE: モデレーターが見ていた申請の画像。申請者がその後に差し替えていたら断る(見ていない画像を公開・却下しないため)
		expectedFileId: { type: 'string', format: 'misskey:id', nullable: true },
		reason: { type: 'string', maxLength: 1024 },
	},
	required: ['requestId', 'reason'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.avatarDecorationRequestsRepository)
		private avatarDecorationRequestsRepository: AvatarDecorationRequestsRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private moderationLogService: ModerationLogService,
		private driveService: DriveService,
		private emailService: EmailService,
		private emailI18nService: EmailI18nService,
		private notificationService: NotificationService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const request = await this.avatarDecorationRequestsRepository.findOneBy({ id: ps.requestId });
			if (request == null) throw new ApiError(meta.errors.noSuchRequest);
			if (request.status !== 'pending') throw new ApiError(meta.errors.alreadyReviewed);
			if (ps.expectedFileId !== undefined && ps.expectedFileId !== request.fileId) throw new ApiError(meta.errors.requestModified);

			const requester = await this.usersRepository.findOneByOrFail({ id: request.userId });

			// JUICE: 冒頭のstatusチェックと本更新の間に同時に別の審査(承認/却下)が割り込むTOCTOUを防ぐため、
			// WHERE句にstatus='pending'を含めた条件付きUPDATEで原子的に排他する
			const updateResult = await this.avatarDecorationRequestsRepository.update({ id: request.id, status: 'pending', fileId: request.fileId ?? IsNull() }, {
				status: 'rejected',
				reviewerId: me.id,
				reviewedAt: new Date(),
				rejectReason: ps.reason,
			});
			if (updateResult.affected === 0) {
				// JUICE: 間に申請者が画像を差し替えていたら(まだ審査待ちのまま)、見ていない画像の申請を却下しない
				const current = await this.avatarDecorationRequestsRepository.findOneBy({ id: request.id });
				throw new ApiError(current?.status === 'pending' ? meta.errors.requestModified : meta.errors.alreadyReviewed);
			}

			this.moderationLogService.log(me, 'rejectAvatarDecorationRequest', {
				requestId: request.id,
				requesterId: requester.id,
				requesterUsername: requester.username,
				requesterHost: requester.host,
				requestedName: request.name,
				reason: ps.reason,
			});

			if (request.deleteFileAfterReview && request.fileId != null) {
				const driveFile = await this.driveFilesRepository.findOneBy({ id: request.fileId });
				if (driveFile != null) {
					this.driveService.deleteFile(driveFile, false, me);
				}
			}

			// JUICE: 申請者本人へアプリ内通知(メールとは別チャンネル、メール設定に関わらず常に送る)
			this.notificationService.createNotification(request.userId, 'avatarDecorationRequestRejected', {
				requestId: request.id,
				name: request.name,
				reason: ps.reason,
			});

			const profile = await this.userProfilesRepository.findOneBy({ userId: request.userId });
			if (profile?.email != null && profile.emailVerified && profile.receiveAvatarDecorationRequestResultEmail) {
				const lang = await this.emailI18nService.resolveLang(profile.emailLang);
				const i18n = this.emailI18nService.getI18n(lang);
				this.emailService.sendEmail(profile.email, i18n.t('_email.avatarDecorationRequestRejected.subject', { name: request.name }),
					i18n.t('_email.avatarDecorationRequestRejected.html', { name: request.name, reason: ps.reason }),
					i18n.t('_email.avatarDecorationRequestRejected.text', { name: request.name, reason: ps.reason }));
			}
		});
	}
}
