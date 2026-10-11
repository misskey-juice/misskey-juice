/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { EmojiRequestsRepository, DriveFilesRepository, UserProfilesRepository, UsersRepository } from '@/models/_.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '@/server/api/error.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { DriveService } from '@/core/DriveService.js';
import { EmailService } from '@/core/EmailService.js';
import { EmailI18nService } from '@/core/EmailI18nService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { FILE_TYPE_IMAGE } from '@/const.js';
import { normalizeEmojiAliases } from '@/misc/emoji-aliases.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	// JUICE: モデレーター/管理者、またはcanApproveEmojiRequestsロールポリシーを持つユーザーのみ許可
	requiredRolePolicyOrModerator: 'canApproveEmojiRequests',
	kind: 'write:admin:emoji-requests-approve',

	errors: {
		noSuchRequest: {
			message: 'No such emoji request.',
			code: 'NO_SUCH_REQUEST',
			id: '70aa6e51-e010-4ecf-8196-9110318934b5',
		},
		alreadyReviewed: {
			message: 'This emoji request has already been reviewed.',
			code: 'ALREADY_REVIEWED',
			id: '04175ccd-6d85-45c2-8692-6e8c0fa7dec4',
		},
		// JUICE: 申請者が画像を差し替えたため、見ていた申請と中身が変わった(もう一度確かめてもらう)
		requestModified: {
			message: 'The image of this emoji request has been replaced. Please check it again.',
			code: 'REQUEST_MODIFIED',
			id: '732b34eb-fd78-452a-9d4f-d98918f98e7d',
		},
		noSuchFile: {
			message: 'The attached file no longer exists.',
			code: 'NO_SUCH_FILE',
			id: 'e8d61214-e75d-439e-9465-aa0930d9ee0b',
		},
		unsupportedFileType: {
			message: 'Unsupported file type.',
			code: 'UNSUPPORTED_FILE_TYPE',
			id: '1aacbd75-25f4-4efc-99bd-093b4f994c73',
		},
		duplicateName: {
			message: 'An emoji with this name already exists.',
			code: 'DUPLICATE_NAME',
			id: '0c9df859-d222-46df-a548-f24997667eac',
		},
		fileCopyFailed: {
			message: 'Failed to copy the attached file.',
			code: 'FILE_COPY_FAILED',
			id: 'd420533b-5ceb-4425-bfd2-b4d4c56063a2',
		},
		// JUICE: 差し替え申請(既存の絵文字の画像だけを差し替える)の対象が、申請〜承認の間に
		// 削除されていた場合
		noSuchTargetEmoji: {
			message: 'No such target emoji.',
			code: 'NO_SUCH_TARGET_EMOJI',
			id: 'c0ad6008-dc80-48f4-b664-95a79f845f3a',
		},
		// JUICE: 承認時に申請内容(名前・カテゴリ・タグ・ライセンス・センシティブ/ローカル限定)を
		// 編集したのに、その理由(editReason)が指定されていない場合
		editReasonRequired: {
			message: 'A reason must be given when editing the request content upon approval.',
			code: 'EDIT_REASON_REQUIRED',
			id: '8f8f6c2a-9b0f-4b2e-8c8b-2e6d2f5c9c1a',
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
		// 各上限はemoji-requests/createと同じ(emoji_requestテーブルの列定義に合わせる)。
		// いずれか1つでも申請時点の値と異なる場合、editReasonの指定が必須になる
		name: { type: 'string', pattern: '^[a-zA-Z0-9_]+$', maxLength: 128 },
		category: { type: 'string', nullable: true, maxLength: 128 },
		aliases: { type: 'array', items: { type: 'string', maxLength: 128 }, maxItems: 100 },
		license: { type: 'string', nullable: true, maxLength: 1024 },
		isSensitive: { type: 'boolean' },
		localOnly: { type: 'boolean' },
		editReason: { type: 'string', maxLength: 1024 },
	},
	required: ['requestId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.emojiRequestsRepository)
		private emojiRequestsRepository: EmojiRequestsRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private moderationLogService: ModerationLogService,
		private customEmojiService: CustomEmojiService,
		private driveService: DriveService,
		private emailService: EmailService,
		private emailI18nService: EmailI18nService,
		private notificationService: NotificationService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const request = await this.emojiRequestsRepository.findOneBy({ id: ps.requestId });
			if (request == null) throw new ApiError(meta.errors.noSuchRequest);
			if (request.status !== 'pending') throw new ApiError(meta.errors.alreadyReviewed);
			if (ps.expectedFileId !== undefined && ps.expectedFileId !== request.fileId) throw new ApiError(meta.errors.requestModified);

			const driveFile = request.fileId == null ? null : await this.driveFilesRepository.findOneBy({ id: request.fileId });
			if (driveFile == null) throw new ApiError(meta.errors.noSuchFile);
			if (!FILE_TYPE_IMAGE.includes(driveFile.type)) throw new ApiError(meta.errors.unsupportedFileType);

			// JUICE: 承認時にモデレーターが申請内容を編集できるようにする(差し替え申請ではnameを含む
			// メタデータ自体を使わないため、編集は適用しない)
			const isReplacement = request.targetEmojiId != null;
			const effectiveName = (!isReplacement && ps.name !== undefined) ? ps.name : request.name;
			const effectiveCategory = (!isReplacement && ps.category !== undefined) ? ps.category : request.category;
			// JUICE: タグは全角スペースなどの空白でも分ける
			const effectiveAliases = (!isReplacement && ps.aliases !== undefined) ? normalizeEmojiAliases(ps.aliases) : request.aliases;
			const effectiveLicense = (!isReplacement && ps.license !== undefined) ? ps.license : request.license;
			const effectiveIsSensitive = (!isReplacement && ps.isSensitive !== undefined) ? ps.isSensitive : request.isSensitive;
			const effectiveLocalOnly = (!isReplacement && ps.localOnly !== undefined) ? ps.localOnly : request.localOnly;
			const isEdited = !isReplacement && (
				effectiveName !== request.name ||
				effectiveCategory !== request.category ||
				effectiveLicense !== request.license ||
				effectiveIsSensitive !== request.isSensitive ||
				effectiveLocalOnly !== request.localOnly ||
				JSON.stringify(effectiveAliases) !== JSON.stringify(request.aliases)
			);
			if (isEdited && (ps.editReason == null || ps.editReason.trim() === '')) {
				throw new ApiError(meta.errors.editReasonRequired);
			}

			// JUICE: 差し替え申請(既存の絵文字の画像だけを差し替える)。この場合はname等の変更を
			// 伴わないため、重複名チェックは不要
			if (request.targetEmojiId == null) {
				const isDuplicate = await this.customEmojiService.checkDuplicate(effectiveName);
				if (isDuplicate) throw new ApiError(meta.errors.duplicateName);
			}

			const requester = await this.usersRepository.findOneByOrFail({ id: request.userId });

			// システム所有の複製を登録(申請者ファイル削除の影響回避)
			let emojiFile: MiDriveFile;
			try {
				emojiFile = await this.driveService.uploadFromUrl({ url: driveFile.url, user: null, force: true, sensitive: driveFile.isSensitive });
			} catch {
				throw new ApiError(meta.errors.fileCopyFailed);
			}

			// JUICE: 差し替え申請なら対象絵文字の画像のみを差し替え、そうでなければ従来通り新規作成
			let emoji: { id: string; name: string };
			// JUICE: 承認の処理の間に画像が差し替えられて承認できなかったとき、差し替え申請の対象の絵文字を元の画像に戻す
			let revertReplacement: (() => Promise<void>) | null = null;
			if (request.targetEmojiId != null) {
				const targetEmoji = await this.customEmojiService.getEmojiById(request.targetEmojiId);
				if (targetEmoji == null) throw new ApiError(meta.errors.noSuchTargetEmoji);

				await this.customEmojiService.update({
					id: targetEmoji.id,
					originalUrl: emojiFile.url,
					publicUrl: emojiFile.webpublicUrl ?? emojiFile.url,
					fileType: emojiFile.webpublicType ?? emojiFile.type,
				}, me);
				revertReplacement = async () => {
					await this.customEmojiService.update({
						id: targetEmoji.id,
						originalUrl: targetEmoji.originalUrl,
						publicUrl: targetEmoji.publicUrl,
						fileType: targetEmoji.type ?? undefined,
					});
				};

				emoji = targetEmoji;
			} else {
				emoji = await this.customEmojiService.add({
					originalUrl: emojiFile.url,
					publicUrl: emojiFile.webpublicUrl ?? emojiFile.url,
					fileType: emojiFile.webpublicType ?? emojiFile.type,
					name: effectiveName,
					category: effectiveCategory,
					aliases: effectiveAliases,
					host: null,
					license: effectiveLicense,
					isSensitive: effectiveIsSensitive,
					localOnly: effectiveLocalOnly,
					roleIdsThatCanBeUsedThisEmojiAsReaction: [],
				}, me);
			}

			// JUICE: 冒頭のstatusチェックとこの更新の間(ファイル複製・絵文字作成という低速な処理を挟む)に
			// 同時に別の審査(承認/却下)が割り込むTOCTOUを防ぐため、WHERE句にstatus='pending'を含めた
			// 条件付きUPDATEで原子的に排他する。負けた側は既に絵文字を作成済みだが後続の通知・メールは送らない
			const updateResult = await this.emojiRequestsRepository.update({ id: request.id, status: 'pending', fileId: driveFile.id }, {
				status: 'approved',
				reviewerId: me.id,
				reviewedAt: new Date(),
				resultEmojiId: emoji.id,
				// JUICE: 編集された場合、申請内容も実際に承認された(=編集後の)値に更新しておく
				...(isEdited ? {
					name: effectiveName,
					category: effectiveCategory,
					aliases: effectiveAliases,
					license: effectiveLicense,
					isSensitive: effectiveIsSensitive,
					localOnly: effectiveLocalOnly,
					editReason: ps.editReason,
				} : {}),
			});
			if (updateResult.affected === 0) {
				// JUICE: 承認の処理の間に申請者が画像を差し替えていたら(まだ審査待ちのまま)、作った絵文字を消して
				// (差し替え申請なら元の画像に戻して)断る。見ていない画像の申請を承認済みにしないため
				const current = await this.emojiRequestsRepository.findOneBy({ id: request.id });
				if (current?.status === 'pending') {
					if (revertReplacement != null) await revertReplacement();
					else await this.customEmojiService.delete(emoji.id);
					throw new ApiError(meta.errors.requestModified);
				}
				throw new ApiError(meta.errors.alreadyReviewed);
			}

			this.moderationLogService.log(me, 'approveEmojiRequest', {
				requestId: request.id,
				requesterId: requester.id,
				requesterUsername: requester.username,
				requesterHost: requester.host,
				emojiId: emoji.id,
				emojiName: emoji.name,
				isReplacement: request.targetEmojiId != null,
				// JUICE: 承認時に申請内容を編集した場合、編集前の値と理由も記録しておく(監査用)
				...(isEdited ? {
					edited: true,
					editReason: ps.editReason,
					originalName: request.name,
					originalCategory: request.category,
					originalAliases: request.aliases,
					originalLicense: request.license,
					originalIsSensitive: request.isSensitive,
					originalLocalOnly: request.localOnly,
				} : {}),
			});

			if (request.deleteFileAfterReview) {
				this.driveService.deleteFile(driveFile, false, me);
			}

			// JUICE: 申請者本人へアプリ内通知(メールとは別チャンネル、メール設定に関わらず常に送る)。
			// 承認時に編集された場合があるため、申請時点の名前(request.name)ではなく実際に
			// 作成/更新された絵文字の名前(emoji.name)を使う
			this.notificationService.createNotification(request.userId, 'emojiRequestApproved', {
				requestId: request.id,
				name: emoji.name,
			});

			const profile = await this.userProfilesRepository.findOneBy({ userId: request.userId });
			if (profile?.email != null && profile.emailVerified && profile.receiveEmojiRequestResultEmail) {
				const lang = await this.emailI18nService.resolveLang(profile.emailLang);
				const i18n = this.emailI18nService.getI18n(lang);
				this.emailService.sendEmail(profile.email, i18n.t('_email.emojiRequestApproved.subject', { name: emoji.name }),
					i18n.t('_email.emojiRequestApproved.html', { name: emoji.name }),
					i18n.t('_email.emojiRequestApproved.text', { name: emoji.name }));
			}
		});
	}
}
