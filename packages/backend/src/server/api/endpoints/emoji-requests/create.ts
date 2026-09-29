/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ms from 'ms';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { DriveFilesRepository, MiMeta } from '@/models/_.js';
import { MiEmojiRequest } from '@/models/EmojiRequest.js';
import { MiEmoji } from '@/models/Emoji.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { RoleService } from '@/core/RoleService.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { resolveEmojiRequestSettings } from '@/models/JuiceSettings.js';
import { CaptchaService } from '@/core/CaptchaService.js';
import { JuiceAdminNotificationService } from '@/core/JuiceAdminNotificationService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { FILE_TYPE_IMAGE } from '@/const.js';
import { ApiError } from '@/server/api/error.js';

export const meta = {
	tags: ['emoji-requests'],

	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:emoji-requests',

	limit: {
		duration: ms('1day'),
		max: 10,
	},

	errors: {
		functionDisabled: {
			message: 'The emoji request feature is currently disabled.',
			code: 'FUNCTION_DISABLED',
			id: '1926c8ae-9ed6-4074-9c46-5f970c83a802',
		},
		noSuchFile: {
			message: 'No such file.',
			code: 'NO_SUCH_FILE',
			id: 'd3d24264-cf2e-49f0-a772-a124acfd76a9',
		},
		accessDenied: {
			message: 'You do not have permission to use this file.',
			code: 'ACCESS_DENIED',
			id: '813aa403-aed9-4ae3-a501-51110fcfce76',
		},
		unsupportedFileType: {
			message: 'Unsupported file type.',
			code: 'UNSUPPORTED_FILE_TYPE',
			id: 'b26a3c34-dd82-4562-956d-6492f2ac9c85',
		},
		tooManyPendingRequests: {
			message: 'You have too many pending emoji requests.',
			code: 'TOO_MANY_PENDING_REQUESTS',
			id: '12d24713-d080-458f-b80f-0c1905d96fb9',
		},
		// JUICE
		captchaFailed: {
			message: 'Captcha verification failed.',
			code: 'CAPTCHA_FAILED',
			id: 'e8f67388-909b-407a-851c-52311ed47c97',
		},
		// JUICE: 差し替え申請(既存の絵文字の画像だけを差し替える)関連
		noSuchTargetEmoji: {
			message: 'No such target emoji.',
			code: 'NO_SUCH_TARGET_EMOJI',
			id: 'b0f83cca-b274-4768-b21a-01a9b85ffd5c',
		},
		notEmojiOwner: {
			message: 'You can only request to replace an emoji that was created from your own approved request.',
			code: 'NOT_EMOJI_OWNER',
			id: 'e0e1a3f7-b710-4d65-bff5-2fe4cf0a5856',
		},
		duplicateReplacementRequest: {
			message: 'You already have a pending replacement request for this emoji.',
			code: 'DUPLICATE_REPLACEMENT_REQUEST',
			id: '25386898-f700-4108-9f4e-a39326d1017e',
		},
		// JUICE: 管理者設定で必須にできるフィールドの未入力チェック(差し替え申請では適用しない)
		categoryRequired: {
			message: 'Category is required.',
			code: 'CATEGORY_REQUIRED',
			id: '6f8a5c8e-3a89-4f16-8b1a-1e5f6c8d3a2b',
		},
		tagsRequired: {
			message: 'At least one tag is required.',
			code: 'TAGS_REQUIRED',
			id: '7c9b6d9f-4b9a-4a27-9c2b-2f6a7d9e4b3c',
		},
		licenseRequired: {
			message: 'License is required.',
			code: 'LICENSE_REQUIRED',
			id: '8dac7eaf-5cab-4b38-ad3c-3a7b8eaf5c4d',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		ref: 'EmojiRequestEntry',
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		fileId: { type: 'string', format: 'misskey:id' },
		// 各上限はemoji_requestテーブルの列定義に合わせる
		name: { type: 'string', pattern: '^[a-zA-Z0-9_]+$', maxLength: 128 },
		category: { type: 'string', nullable: true, maxLength: 128 },
		aliases: { type: 'array', items: { type: 'string', maxLength: 128 }, maxItems: 100, default: [] },
		license: { type: 'string', nullable: true, maxLength: 1024 },
		isSensitive: { type: 'boolean', default: false },
		localOnly: { type: 'boolean', default: false },
		deleteFileAfterReview: { type: 'boolean', default: false },
		// JUICE: 差し替え申請(既存の絵文字の画像だけを差し替える)。指定した場合、name等の他の
		// フィールドは無視され、承認されると対象絵文字の画像のみが差し替わる
		targetEmojiId: { type: 'string', format: 'misskey:id', nullable: true },
		// JUICE
		'hcaptcha-response': { type: 'string', nullable: true },
		'g-recaptcha-response': { type: 'string', nullable: true },
		'm-captcha-response': { type: 'string', nullable: true },
		'turnstile-response': { type: 'string', nullable: true },
		'testcaptcha-response': { type: 'string', nullable: true },
	},
	required: ['fileId', 'name'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		@Inject(DI.db)
		private db: DataSource,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private idService: IdService,
		private roleService: RoleService,
		private juiceSettingsService: JuiceSettingsService,
		private captchaService: CaptchaService,
		private juiceAdminNotificationService: JuiceAdminNotificationService,
		private userEntityService: UserEntityService,
	) {
		super(meta, paramDef, async (ps, me) => {
			// JUICE
			await this.captchaService.verifyRequestCaptcha(this.serverSettings, {
				hcaptcha: ps['hcaptcha-response'],
				mcaptcha: ps['m-captcha-response'],
				recaptcha: ps['g-recaptcha-response'],
				turnstile: ps['turnstile-response'],
				testcaptcha: ps['testcaptcha-response'],
			}).catch(err => {
				throw new ApiError(meta.errors.captchaFailed, { message: err.message });
			});

			const { emojiRequestEnabled, emojiRequestRequireCategory, emojiRequestRequireTags, emojiRequestRequireLicense } = resolveEmojiRequestSettings(await this.juiceSettingsService.fetch());
			if (!emojiRequestEnabled) throw new ApiError(meta.errors.functionDisabled);

			// JUICE: 管理者設定で必須にできるフィールドの未入力チェック。差し替え申請
			// (targetEmojiId指定時)はこれらのフィールド自体が使われないため対象外
			if (ps.targetEmojiId == null) {
				if (emojiRequestRequireCategory && (ps.category == null || ps.category.trim() === '')) throw new ApiError(meta.errors.categoryRequired);
				if (emojiRequestRequireTags && (ps.aliases == null || ps.aliases.length === 0)) throw new ApiError(meta.errors.tagsRequired);
				if (emojiRequestRequireLicense && (ps.license == null || ps.license.trim() === '')) throw new ApiError(meta.errors.licenseRequired);
			}

			const driveFile = await this.driveFilesRepository.findOneBy({ id: ps.fileId });
			if (driveFile == null) throw new ApiError(meta.errors.noSuchFile);
			if (driveFile.userId !== me.id) throw new ApiError(meta.errors.accessDenied);
			if (!FILE_TYPE_IMAGE.includes(driveFile.type)) throw new ApiError(meta.errors.unsupportedFileType);

			const policies = await this.roleService.getUserPolicies(me.id);

			// JUICE: pending件数の上限チェックからINSERTまでを、ユーザー単位のadvisory lockで
			// 直列化した上で同一トランザクション内で行う。そうしないと、同時に複数リクエストを
			// 投げることで上限チェック(SELECT)がINSERTと競合し、上限を超えてpending申請を
			// 作成できてしまう(TOCTOU)
			const request = await this.db.transaction(async em => {
				await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [me.id]);

				const pendingCount = await em.countBy(MiEmojiRequest, { userId: me.id, status: 'pending' });
				if (pendingCount >= policies.emojiRequestLimit) throw new ApiError(meta.errors.tooManyPendingRequests);

				// JUICE: 差し替え申請(既存の絵文字の画像だけを差し替える)。対象は申請者自身の
				// 承認済み申請(resultEmojiId)から作られた絵文字のみに限定する
				if (ps.targetEmojiId != null) {
					const targetEmoji = await em.findOneBy(MiEmoji, { id: ps.targetEmojiId });
					if (targetEmoji == null) throw new ApiError(meta.errors.noSuchTargetEmoji);

					const ownApprovedRequest = await em.findOneBy(MiEmojiRequest, {
						userId: me.id,
						resultEmojiId: ps.targetEmojiId,
						status: 'approved',
					});
					if (ownApprovedRequest == null) throw new ApiError(meta.errors.notEmojiOwner);

					const duplicatePending = await em.findOneBy(MiEmojiRequest, {
						userId: me.id,
						targetEmojiId: ps.targetEmojiId,
						status: 'pending',
					});
					if (duplicatePending != null) throw new ApiError(meta.errors.duplicateReplacementRequest);
				}

				const newRequest = {
					id: this.idService.gen(),
					userId: me.id,
					fileId: driveFile.id,
					name: ps.name,
					category: ps.category ?? null,
					aliases: ps.aliases ?? [],
					license: ps.license ?? null,
					isSensitive: ps.isSensitive ?? false,
					localOnly: ps.localOnly ?? false,
					status: 'pending' as const,
					deleteFileAfterReview: ps.deleteFileAfterReview ?? false,
					targetEmojiId: ps.targetEmojiId ?? null,
				};
				await em.insert(MiEmojiRequest, newRequest);
				return newRequest;
			});

			// JUICE: モデレータへ新規申請をリアルタイム通知(admin stream + SystemWebhook)
			await this.juiceAdminNotificationService.notifyNewEmojiRequests(await this.userEntityService.pack(me, null, { schema: 'UserLite' }), [{
				id: request.id,
				name: request.name,
				category: request.category,
			}]);

			return {
				id: request.id,
				createdAt: this.idService.parse(request.id).date.toISOString(),
				fileId: request.fileId,
				// JUICE: 一覧でサムネイル表示に使う
				fileUrl: driveFile.url,
				name: request.name,
				category: request.category,
				aliases: request.aliases,
				license: request.license,
				isSensitive: request.isSensitive,
				localOnly: request.localOnly,
				status: request.status,
				rejectReason: null,
				reviewedAt: null,
				resultEmojiId: null,
				targetEmojiId: request.targetEmojiId,
			};
		});
	}
}
