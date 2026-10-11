/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { AvatarDecorationRequestsRepository, AvatarDecorationsRepository, DriveFilesRepository, UserProfilesRepository, UsersRepository } from '@/models/_.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { AvatarDecorationService } from '@/core/AvatarDecorationService.js';
import { DriveService } from '@/core/DriveService.js';
import { EmailService } from '@/core/EmailService.js';
import { EmailI18nService } from '@/core/EmailI18nService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { FILE_TYPE_IMAGE } from '@/const.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	// JUICE: モデレーター/管理者、またはcanApproveAvatarDecorationRequestsロールポリシーを持つユーザーのみ許可
	requiredRolePolicyOrModerator: 'canApproveAvatarDecorationRequests',
	kind: 'write:admin:avatar-decoration-requests-approve',

	errors: {
		noSuchRequest: {
			message: 'No such avatar decoration request.',
			code: 'NO_SUCH_REQUEST',
			id: '1ba00992-c405-4dea-b9ae-2872bcc656db',
		},
		alreadyReviewed: {
			message: 'This avatar decoration request has already been reviewed.',
			code: 'ALREADY_REVIEWED',
			id: '4699dbd2-11cf-48be-b7e2-d6738ab490d0',
		},
		// JUICE: 申請者が画像を差し替えたため、見ていた申請と中身が変わった(もう一度確かめてもらう)
		requestModified: {
			message: 'The image of this avatar decoration request has been replaced. Please check it again.',
			code: 'REQUEST_MODIFIED',
			id: '1409ef48-ae42-4606-b866-dd552d7d7bbd',
		},
		noSuchFile: {
			message: 'The attached file no longer exists.',
			code: 'NO_SUCH_FILE',
			id: 'c20e1914-c2d5-41ee-9a3a-d95daf4431cd',
		},
		unsupportedFileType: {
			message: 'Unsupported file type.',
			code: 'UNSUPPORTED_FILE_TYPE',
			id: 'd5e57192-b37a-4b4a-b438-65e874e3bb2a',
		},
		fileCopyFailed: {
			message: 'Failed to copy the attached file.',
			code: 'FILE_COPY_FAILED',
			id: '53f9329a-3da2-45fe-9e22-8319076d4c70',
		},
		// JUICE: 差し替え申請(既存のデコレーションの画像だけを差し替える)の対象が、申請〜承認の間に
		// 削除されていた場合
		noSuchTargetAvatarDecoration: {
			message: 'No such target avatar decoration.',
			code: 'NO_SUCH_TARGET_AVATAR_DECORATION',
			id: '2069a205-bb86-433e-8df8-ba64c745d2f3',
		},
		// JUICE: 承認時に申請内容(名前・説明・カテゴリ)を編集したのに、その理由(editReason)が
		// 指定されていない場合
		editReasonRequired: {
			message: 'A reason must be given when editing the request content upon approval.',
			code: 'EDIT_REASON_REQUIRED',
			id: '3a2f6e1d-7c9b-4a1e-9d5f-6b1c8e2a4f7d',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		requestId: { type: 'string', format: 'misskey:id' },
		// JUICE: モデレーターが見ていた申請の画像。申請者がその後に差し替えていたら断る(見ていない画像を公開・却下しないため)
		expectedFileId: { type: 'string', format: 'misskey:id', nullable: true },
		// JUICE: 承認時にモデレーターが申請内容を編集する場合に指定する(差し替え申請では無視される)。
		// 各上限はavatar-decoration-requests/createと同じ(avatar_decoration_requestテーブルの
		// 列定義に合わせる)。いずれか1つでも申請時点の値と異なる場合、editReasonの指定が必須になる
		name: { type: 'string', minLength: 1, maxLength: 256 },
		description: { type: 'string', maxLength: 2048 },
		category: { type: 'string', nullable: true, maxLength: 128 },
		editReason: { type: 'string', maxLength: 1024 },
	},
	required: ['requestId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.avatarDecorationRequestsRepository)
		private avatarDecorationRequestsRepository: AvatarDecorationRequestsRepository,

		@Inject(DI.avatarDecorationsRepository)
		private avatarDecorationsRepository: AvatarDecorationsRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private moderationLogService: ModerationLogService,
		private avatarDecorationService: AvatarDecorationService,
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

			const driveFile = request.fileId == null ? null : await this.driveFilesRepository.findOneBy({ id: request.fileId });
			if (driveFile == null) throw new ApiError(meta.errors.noSuchFile);
			if (!FILE_TYPE_IMAGE.includes(driveFile.type)) throw new ApiError(meta.errors.unsupportedFileType);

			// JUICE: 承認時にモデレーターが申請内容を編集できるようにする(差し替え申請ではnameを含む
			// メタデータ自体を使わないため、編集は適用しない)
			const isReplacement = request.targetAvatarDecorationId != null;
			const effectiveName = (!isReplacement && ps.name !== undefined) ? ps.name : request.name;
			const effectiveDescription = (!isReplacement && ps.description !== undefined) ? ps.description : request.description;
			const effectiveCategory = (!isReplacement && ps.category !== undefined) ? ps.category : request.category;
			const isEdited = !isReplacement && (
				effectiveName !== request.name ||
				effectiveDescription !== request.description ||
				effectiveCategory !== request.category
			);
			if (isEdited && (ps.editReason == null || ps.editReason.trim() === '')) {
				throw new ApiError(meta.errors.editReasonRequired);
			}

			const requester = await this.usersRepository.findOneByOrFail({ id: request.userId });

			// システム所有の複製を登録(申請者ファイル削除の影響回避。admin/emoji-requests/approveと同じ方式)
			let decorationFile: MiDriveFile;
			try {
				decorationFile = await this.driveService.uploadFromUrl({ url: driveFile.url, user: null, force: true, sensitive: driveFile.isSensitive });
			} catch {
				throw new ApiError(meta.errors.fileCopyFailed);
			}

			// JUICE: 差し替え申請なら対象デコレーションの画像のみを差し替え、そうでなければ従来通り新規作成
			let decoration: { id: string; name: string };
			// JUICE: 承認の処理の間に画像が差し替えられて承認できなかったとき、差し替え申請の対象のデコレーションを元の画像に戻す
			let revertReplacement: (() => Promise<void>) | null = null;
			if (request.targetAvatarDecorationId != null) {
				const targetDecoration = await this.avatarDecorationsRepository.findOneBy({ id: request.targetAvatarDecorationId });
				if (targetDecoration == null) throw new ApiError(meta.errors.noSuchTargetAvatarDecoration);

				await this.avatarDecorationService.update(targetDecoration.id, {
					url: decorationFile.url,
				}, me);
				revertReplacement = async () => {
					await this.avatarDecorationService.update(targetDecoration.id, {
						url: targetDecoration.url,
					});
				};

				decoration = targetDecoration;
			} else {
				decoration = await this.avatarDecorationService.create({
					name: effectiveName,
					description: effectiveDescription,
					url: decorationFile.url,
					roleIdsThatCanBeUsedThisDecoration: [],
					category: effectiveCategory,
				}, me);
			}

			// JUICE: 冒頭のstatusチェックとこの更新の間(ファイル複製・デコレーション作成という低速な処理を挟む)に
			// 同時に別の審査(承認/却下)が割り込むTOCTOUを防ぐため、WHERE句にstatus='pending'を含めた
			// 条件付きUPDATEで原子的に排他する。負けた側は既にデコレーションを作成済みだが後続の通知・メールは送らない
			const updateResult = await this.avatarDecorationRequestsRepository.update({ id: request.id, status: 'pending', fileId: driveFile.id }, {
				status: 'approved',
				reviewerId: me.id,
				reviewedAt: new Date(),
				resultAvatarDecorationId: decoration.id,
				// JUICE: 編集された場合、申請内容も実際に承認された(=編集後の)値に更新しておく
				...(isEdited ? {
					name: effectiveName,
					description: effectiveDescription,
					category: effectiveCategory,
					editReason: ps.editReason,
				} : {}),
			});
			if (updateResult.affected === 0) {
				// JUICE: 承認の処理の間に申請者が画像を差し替えていたら(まだ審査待ちのまま)、作ったデコレーションを消して
				// (差し替え申請なら元の画像に戻して)断る。見ていない画像の申請を承認済みにしないため
				const current = await this.avatarDecorationRequestsRepository.findOneBy({ id: request.id });
				if (current?.status === 'pending') {
					if (revertReplacement != null) await revertReplacement();
					else await this.avatarDecorationService.delete(decoration.id);
					throw new ApiError(meta.errors.requestModified);
				}
				throw new ApiError(meta.errors.alreadyReviewed);
			}

			this.moderationLogService.log(me, 'approveAvatarDecorationRequest', {
				requestId: request.id,
				requesterId: requester.id,
				requesterUsername: requester.username,
				requesterHost: requester.host,
				avatarDecorationId: decoration.id,
				avatarDecorationName: decoration.name,
				isReplacement: request.targetAvatarDecorationId != null,
				// JUICE: 承認時に申請内容を編集した場合、編集前の値と理由も記録しておく(監査用)
				...(isEdited ? {
					edited: true,
					editReason: ps.editReason,
					originalName: request.name,
					originalDescription: request.description,
					originalCategory: request.category,
				} : {}),
			});

			if (request.deleteFileAfterReview) {
				this.driveService.deleteFile(driveFile, false, me);
			}

			// JUICE: 申請者本人へアプリ内通知(メールとは別チャンネル、メール設定に関わらず常に送る)。
			// 承認時に編集された場合があるため、申請時点の名前(request.name)ではなく実際に
			// 作成/更新されたアバターデコレーションの名前(decoration.name)を使う
			this.notificationService.createNotification(request.userId, 'avatarDecorationRequestApproved', {
				requestId: request.id,
				name: decoration.name,
			});

			const profile = await this.userProfilesRepository.findOneBy({ userId: request.userId });
			if (profile?.email != null && profile.emailVerified && profile.receiveAvatarDecorationRequestResultEmail) {
				const lang = await this.emailI18nService.resolveLang(profile.emailLang);
				const i18n = this.emailI18nService.getI18n(lang);
				this.emailService.sendEmail(profile.email, i18n.t('_email.avatarDecorationRequestApproved.subject', { name: decoration.name }),
					i18n.t('_email.avatarDecorationRequestApproved.html', { name: decoration.name }),
					i18n.t('_email.avatarDecorationRequestApproved.text', { name: decoration.name }));
			}
		});
	}
}
