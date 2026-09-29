/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import type { MiUser, SystemWebhooksRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { GlobalEvents, GlobalEventService } from '@/core/GlobalEventService.js';
import { MiSystemWebhook, type SystemWebhookEventType } from '@/models/SystemWebhook.js';
import { IdService } from '@/core/IdService.js';
import { QueueService } from '@/core/QueueService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { LoggerService } from '@/core/LoggerService.js';
import Logger from '@/logger.js';
import { Packed } from '@/misc/json-schema.js';
import { AbuseReportResolveType } from '@/models/AbuseUserReport.js';
import { ModeratorInactivityRemainingTime } from '@/queue/processors/CheckModeratorsActivityProcessorService.js';
import type { OnApplicationShutdown } from '@nestjs/common';

export type AbuseReportPayload = {
	id: string;
	targetUserId: string;
	targetUser: Packed<'UserLite'> | null;
	targetUserHost: string | null;
	reporterId: string;
	reporter: Packed<'UserLite'> | null;
	reporterHost: string | null;
	assigneeId: string | null;
	assignee: Packed<'UserLite'> | null;
	resolved: boolean;
	forwarded: boolean;
	comment: string;
	moderationNote: string;
	resolvedAs: AbuseReportResolveType | null;
};

export type InactiveModeratorsWarningPayload = {
	remainingTime: ModeratorInactivityRemainingTime;
};

// JUICE: 申請(絵文字・アバターデコレーション)1件の要約
export type RequestSummary = {
	id: string;
	name: string;
	category: string | null;
};

// JUICE: 絵文字申請が作成された時のWebhookペイロード。1回の送信(emoji-requests/create-many)でまとめて作られた申請は、
// 1つのペイロードにまとめる。id・name・categoryは1件目の申請(前からある受け取り側がそのまま使えるように残している)、
// countはまとめた件数、requestsはまとめた申請の一覧
export type EmojiRequestCreatedPayload = RequestSummary & {
	requester: Packed<'UserLite'>;
	count: number;
	requests: RequestSummary[];
};

// JUICE: 承認式登録の申請が作成された時のWebhookペイロード
// checkCode(未認証の状態照会用トークン)はモデレータ操作(承認/却下)にもフロントの
// トースト表示にも使われず、外部Webhook先に渡す必要性が無いため意図的に含めない。
export type SignupApplicationCreatedPayload = {
	applicant: Packed<'UserLite'>;
	reason: string | null;
};

// JUICE: アバターデコレーション申請が作成された時のWebhookペイロード(まとめ方は絵文字申請と同じ)
export type AvatarDecorationRequestCreatedPayload = EmojiRequestCreatedPayload;

// JUICE: misskey-tempuraのコンタクトフォームを参考に追加。コンタクトフォームが送信された時のWebhookペイロード
// 注意: email/ipAddress/userAgentを含むため、このイベントを有効にしたSystemWebhookの送信先URLへ
// 送信者のPIIが転送される。SystemWebhookの作成・編集自体はrequireModerator(要admin/system-webhook/*)の
// ため、admin/contact-form/*と同じ信頼レベルだが、転送先が外部サービス(Discord等)になりうる点は
// admin/contact-form/*のPII閲覧より一段見えにくい経路になるため、設定変更時は留意すること
export type ContactFormPayload = {
	id: string;
	subject: string;
	content: string;
	name: string | null;
	email: string | null;
	misskeyUsername: string | null;
	replyMethod: 'email' | 'misskey';
	category: string;
	status: 'pending' | 'in_progress' | 'resolved' | 'closed';
	ipAddress: string | null;
	userAgent: string | null;
	user: Packed<'UserLite'> | null;
};

export type SystemWebhookPayload<T extends SystemWebhookEventType> =
	T extends 'abuseReport' | 'abuseReportResolved' ? AbuseReportPayload :
	T extends 'userCreated' ? Packed<'UserLite'> :
	T extends 'inactiveModeratorsWarning' ? InactiveModeratorsWarningPayload :
	T extends 'inactiveModeratorsInvitationOnlyChanged' ? Record<string, never> :
	T extends 'emojiRequestCreated' ? EmojiRequestCreatedPayload :
	T extends 'signupApplicationCreated' ? SignupApplicationCreatedPayload :
	T extends 'avatarDecorationRequestCreated' ? AvatarDecorationRequestCreatedPayload :
	T extends 'receivedContactForm' ? ContactFormPayload :
		never;

@Injectable()
export class SystemWebhookService implements OnApplicationShutdown {
	private activeSystemWebhooksFetched = false;
	private activeSystemWebhooks: MiSystemWebhook[] = [];

	constructor(
		@Inject(DI.redisForSub)
		private redisForSub: Redis.Redis,
		@Inject(DI.systemWebhooksRepository)
		private systemWebhooksRepository: SystemWebhooksRepository,
		private idService: IdService,
		private queueService: QueueService,
		private moderationLogService: ModerationLogService,
		private globalEventService: GlobalEventService,
	) {
		this.redisForSub.on('message', this.onMessage);
	}

	@bindThis
	public async fetchActiveSystemWebhooks() {
		if (!this.activeSystemWebhooksFetched) {
			this.activeSystemWebhooks = await this.systemWebhooksRepository.findBy({
				isActive: true,
			});
			this.activeSystemWebhooksFetched = true;
		}

		return this.activeSystemWebhooks;
	}

	/**
	 * SystemWebhook の一覧を取得する.
	 */
	@bindThis
	public fetchSystemWebhooks(params?: {
		ids?: MiSystemWebhook['id'][];
		isActive?: MiSystemWebhook['isActive'];
		on?: MiSystemWebhook['on'];
	}): Promise<MiSystemWebhook[]> {
		const query = this.systemWebhooksRepository.createQueryBuilder('systemWebhook');
		if (params) {
			if (params.ids && params.ids.length > 0) {
				query.andWhere('systemWebhook.id IN (:...ids)', { ids: params.ids });
			}
			if (params.isActive !== undefined) {
				query.andWhere('systemWebhook.isActive = :isActive', { isActive: params.isActive });
			}
			if (params.on && params.on.length > 0) {
				query.andWhere(':on <@ systemWebhook.on', { on: params.on });
			}
		}

		return query.getMany();
	}

	/**
	 * SystemWebhook を作成する.
	 */
	@bindThis
	public async createSystemWebhook(
		params: {
			isActive: MiSystemWebhook['isActive'];
			name: MiSystemWebhook['name'];
			on: MiSystemWebhook['on'];
			url: MiSystemWebhook['url'];
			secret: MiSystemWebhook['secret'];
		},
		updater: MiUser,
	): Promise<MiSystemWebhook> {
		const id = this.idService.gen();
		await this.systemWebhooksRepository.insert({
			...params,
			id,
		});

		const webhook = await this.systemWebhooksRepository.findOneByOrFail({ id });
		this.globalEventService.publishInternalEvent('systemWebhookCreated', webhook);
		this.moderationLogService
			.log(updater, 'createSystemWebhook', {
				systemWebhookId: webhook.id,
				webhook: webhook,
			});

		return webhook;
	}

	/**
	 * SystemWebhook を更新する.
	 */
	@bindThis
	public async updateSystemWebhook(
		params: {
			id: MiSystemWebhook['id'];
			isActive: MiSystemWebhook['isActive'];
			name: MiSystemWebhook['name'];
			on: MiSystemWebhook['on'];
			url: MiSystemWebhook['url'];
			secret: MiSystemWebhook['secret'];
		},
		updater: MiUser,
	): Promise<MiSystemWebhook> {
		const beforeEntity = await this.systemWebhooksRepository.findOneByOrFail({ id: params.id });
		await this.systemWebhooksRepository.update(beforeEntity.id, {
			updatedAt: new Date(),
			isActive: params.isActive,
			name: params.name,
			on: params.on,
			url: params.url,
			secret: params.secret,
		});

		const afterEntity = await this.systemWebhooksRepository.findOneByOrFail({ id: beforeEntity.id });
		this.globalEventService.publishInternalEvent('systemWebhookUpdated', afterEntity);
		this.moderationLogService
			.log(updater, 'updateSystemWebhook', {
				systemWebhookId: beforeEntity.id,
				before: beforeEntity,
				after: afterEntity,
			});

		return afterEntity;
	}

	/**
	 * SystemWebhook を削除する.
	 */
	@bindThis
	public async deleteSystemWebhook(id: MiSystemWebhook['id'], updater: MiUser) {
		const webhook = await this.systemWebhooksRepository.findOneByOrFail({ id });
		await this.systemWebhooksRepository.delete(id);

		this.globalEventService.publishInternalEvent('systemWebhookDeleted', webhook);
		this.moderationLogService
			.log(updater, 'deleteSystemWebhook', {
				systemWebhookId: webhook.id,
				webhook,
			});
	}

	/**
	 * SystemWebhook をWebhook配送キューに追加する
	 * @see QueueService.systemWebhookDeliver
	 */
	@bindThis
	public async enqueueSystemWebhook<T extends SystemWebhookEventType>(
		type: T,
		content: SystemWebhookPayload<T>,
		opts?: {
			excludes?: MiSystemWebhook['id'][];
		},
	) {
		const webhooks = await this.fetchActiveSystemWebhooks()
			.then(webhooks => {
				return webhooks.filter(webhook => !opts?.excludes?.includes(webhook.id) && webhook.on.includes(type));
			});
		return Promise.all(
			webhooks.map(webhook => {
				return this.queueService.systemWebhookDeliver(webhook, type, content);
			}),
		);
	}

	@bindThis
	private async onMessage(_: string, data: string): Promise<void> {
		const obj = JSON.parse(data);
		if (obj.channel !== 'internal') {
			return;
		}

		const { type, body } = obj.message as GlobalEvents['internal']['payload'];
		switch (type) {
			case 'systemWebhookCreated': {
				if (body.isActive) {
					this.activeSystemWebhooks.push(MiSystemWebhook.deserialize(body));
				}
				break;
			}
			case 'systemWebhookUpdated': {
				if (body.isActive) {
					const i = this.activeSystemWebhooks.findIndex(a => a.id === body.id);
					if (i > -1) {
						this.activeSystemWebhooks[i] = MiSystemWebhook.deserialize(body);
					} else {
						this.activeSystemWebhooks.push(MiSystemWebhook.deserialize(body));
					}
				} else {
					this.activeSystemWebhooks = this.activeSystemWebhooks.filter(a => a.id !== body.id);
				}
				break;
			}
			case 'systemWebhookDeleted': {
				this.activeSystemWebhooks = this.activeSystemWebhooks.filter(a => a.id !== body.id);
				break;
			}
			default:
				break;
		}
	}

	@bindThis
	public dispose(): void {
		this.redisForSub.off('message', this.onMessage);
	}

	@bindThis
	public onApplicationShutdown(signal?: string | undefined): void {
		this.dispose();
	}
}
