/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { ContactFormsRepository } from '@/models/_.js';
import type { MiContactForm } from '@/models/ContactForm.js';
import { bindThis } from '@/decorators.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import type { Packed } from '@/misc/json-schema.js';

// JUICE: misskey-tempuraのコンタクトフォームを参考に追加
@Injectable()
export class ContactFormEntityService {
	constructor(
		@Inject(DI.contactFormsRepository)
		private contactFormsRepository: ContactFormsRepository,

		private userEntityService: UserEntityService,
	) {
	}

	@bindThis
	public async pack(
		src: MiContactForm['id'] | MiContactForm,
		options?: {
			// JUICE: モデレーター権限を持たないロールポリシー経由の処理担当者には、
			// メールアドレス・IPアドレスといったPIIを見せない(処理そのものは委譲するが、
			// 個人情報の閲覧はモデレーター/管理者に限定する)
			maskPii?: boolean;
		},
	): Promise<Packed<'ContactForm'>> {
		const contactForm = typeof src === 'object' ? src : await this.contactFormsRepository.findOneOrFail({
			where: { id: src },
			relations: { user: true, assignedUser: true },
		});

		const maskPii = options?.maskPii ?? false;

		return {
			id: contactForm.id,
			createdAt: contactForm.createdAt.toISOString(),
			updatedAt: contactForm.updatedAt?.toISOString() ?? null,
			subject: contactForm.subject,
			content: contactForm.content,
			// JUICE: 送信者を特定できる情報はメールアドレス・IP以外(氏名・Misskeyユーザー名・
			// 連携アカウント・User-Agent)もマスクする。返信に必要な場合はモデレーターへ回す
			name: maskPii ? null : contactForm.name,
			email: maskPii ? null : contactForm.email,
			misskeyUsername: maskPii ? null : contactForm.misskeyUsername,
			replyMethod: contactForm.replyMethod,
			category: contactForm.category,
			status: contactForm.status,
			adminNote: contactForm.adminNote,
			ipAddress: maskPii ? null : contactForm.ipAddress,
			userAgent: maskPii ? null : contactForm.userAgent,
			user: maskPii ? null : (contactForm.user ? await this.userEntityService.pack(contactForm.user, undefined, { schema: 'UserLite' }) : null),
			assignedUser: contactForm.assignedUser ? await this.userEntityService.pack(contactForm.assignedUser, undefined, { schema: 'UserLite' }) : null,
			assignedNickname: contactForm.assignedNickname,
		};
	}

	@bindThis
	public async packMany(
		contactForms: MiContactForm[],
		options?: { maskPii?: boolean },
	): Promise<Packed<'ContactForm'>[]> {
		return Promise.all(contactForms.map(contactForm => this.pack(contactForm, options)));
	}
}
