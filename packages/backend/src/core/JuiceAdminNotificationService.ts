/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { RoleService } from '@/core/RoleService.js';
import { SystemWebhookService, type EmojiRequestCreatedPayload, type SignupApplicationCreatedPayload, type RequestSummary, type ContactFormPayload } from '@/core/SystemWebhookService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { LoggerService } from '@/core/LoggerService.js';
import type Logger from '@/logger.js';
import type { Packed } from '@/misc/json-schema.js';
import type { ImportRequestType } from '@/models/ImportRequest.js';

// JUICE: 絵文字申請・承認式登録申請が来たことをモデレータに通知する。
// AbuseReportNotificationService(通報の通知)と同じ「モデレータ一覧取得→admin streamへpublish→
// SystemWebhookへenqueue」というパターンを、通報ほど複雑な通知先カスタマイズ(メール等)を必要としない
// この2つのイベント向けに軽量にまとめたもの。あわせてnotificationService.createNotification()で
// 通常の通知(🔔の通知一覧)にも残す。admin streamはアプリを開いている間だけのリアルタイム
// トースト・バナー用、こちらはオフライン/リロード後でも遡って確認できるようにするためのもの
//
// 呼び出し元(emoji-requests/create.ts・SignupApiService.ts)では、このサービスを呼ぶ時点で
// 既にDBへの書き込み(絵文字申請の作成、あるいはアカウント作成・checkCode発行)が完了しており、
// 取り消せない副作用が確定している。通知処理の失敗がそこに巻き込まれて呼び出し元へエラーとして
// 伝播すると、実際には成功している処理がクライアントには失敗として見えてしまうため、
// 通知の失敗はここで握りつぶしログに残すだけにとどめ、呼び出し元には影響させない。
@Injectable()
export class JuiceAdminNotificationService {
	private logger: Logger;

	constructor(
		private roleService: RoleService,
		private globalEventService: GlobalEventService,
		private systemWebhookService: SystemWebhookService,
		private notificationService: NotificationService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('juice-admin-notification');
	}

	/**
	 * JUICE: モデレーター(isModerator/isAdministrator)に加えて、対象ポリシーを個別に
	 * 付与されているユーザーもあわせて通知先とする。Setで重ねているので重複は出ない。
	 * includeRoot: trueを明示しないと、ロール割り当てを一切持たないブートストラップ直後の
	 * root(自分自身にモデレーター/管理者ロールを割り当てていない、インストール直後によくある構成)が
	 * 通知先から漏れる(RoleService.getModeratorIdsのincludeRootは既定false)ため必須
	 */
	@bindThis
	private async getRecipientIds(policyName: 'canApproveEmojiRequests' | 'canApproveAvatarDecorationRequests' | 'canApproveImportRequests' | 'canApproveSignups' | 'canProcessContactForms'): Promise<string[]> {
		const [moderatorIds, policyHolderIds] = await Promise.all([
			this.roleService.getModeratorIds({ includeAdmins: true, includeRoot: true, excludeExpire: true }),
			this.roleService.getUserIdsWithRolePolicy(policyName, { excludeExpire: true }),
		]);

		return [...new Set([...moderatorIds, ...policyHolderIds])];
	}

	// JUICE: 1回の送信でまとめて作られた申請を、1つのペイロード(1件目の値+件数+一覧)にまとめる
	private summarize(requester: Packed<'UserLite'>, requests: RequestSummary[]): EmojiRequestCreatedPayload {
		const first = requests[0];
		return {
			id: first.id,
			name: first.name,
			category: first.category,
			requester,
			count: requests.length,
			requests: requests.map(r => ({ id: r.id, name: r.name, category: r.category })),
		};
	}

	/**
	 * JUICE: 絵文字申請が来たことを知らせる。1回の送信でまとめて作られた申請は、通知もWebhookも1つにまとめる
	 */
	@bindThis
	public async notifyNewEmojiRequests(requester: Packed<'UserLite'>, requests: RequestSummary[]): Promise<void> {
		if (requests.length === 0) return;
		try {
			const payload = this.summarize(requester, requests);
			const recipientIds = await this.getRecipientIds('canApproveEmojiRequests');

			for (const recipientId of recipientIds) {
				this.globalEventService.publishAdminStream(recipientId, 'newEmojiRequest', payload);
				// JUICE: 申請者はnotifierId(第4引数)ではなくdata内のrequesterIdとして渡す。
				// notifierIdにすると、通知先(モデレーター)がこの申請者を別件でミュートしているだけで
				// 通知が黙って作られなくなるため(管理用通知はミュートの影響を受けてはならない)
				this.notificationService.createNotification(recipientId, 'newEmojiRequest', {
					requesterId: payload.requester.id,
					requestId: payload.id,
					name: payload.name,
					category: payload.category,
					count: payload.count,
				});
			}

			await this.systemWebhookService.enqueueSystemWebhook('emojiRequestCreated', payload);
		} catch (err) {
			this.logger.error('Failed to notify new emoji request', { stack: err });
		}
	}

	/**
	 * JUICE: 承認式にしたインポートの申請が来たことを知らせる
	 */
	@bindThis
	public async notifyNewImportRequest(requester: Packed<'UserLite'>, request: { id: string; importType: string }): Promise<void> {
		try {
			const recipientIds = await this.getRecipientIds('canApproveImportRequests');
			for (const recipientId of recipientIds) {
				// 申請した本人がモデレーターのときも、自分の申請は自分で通せないわけではないので、そのまま知らせる
				this.globalEventService.publishAdminStream(recipientId, 'newImportRequest', { id: request.id, importType: request.importType, requester });
				// JUICE: notifierIdを使わない理由はnotifyNewEmojiRequestと同じ
				this.notificationService.createNotification(recipientId, 'newImportRequest', {
					requesterId: requester.id,
					requestId: request.id,
					importType: request.importType as ImportRequestType,
				});
			}
		} catch (err) {
			this.logger.error('Failed to notify new import request', { stack: err });
		}
	}

	@bindThis
	public async notifyNewSignupApplication(payload: SignupApplicationCreatedPayload): Promise<void> {
		try {
			const recipientIds = await this.getRecipientIds('canApproveSignups');

			for (const recipientId of recipientIds) {
				this.globalEventService.publishAdminStream(recipientId, 'newSignupApplication', payload);
				// JUICE: notifierIdを使わない理由はnotifyNewEmojiRequestと同じ
				this.notificationService.createNotification(recipientId, 'newSignupApplication', {
					applicantId: payload.applicant.id,
					reason: payload.reason,
				});
			}

			await this.systemWebhookService.enqueueSystemWebhook('signupApplicationCreated', payload);
		} catch (err) {
			this.logger.error('Failed to notify new signup application', { stack: err });
		}
	}

	/**
	 * JUICE: アバターデコレーション申請が来たことを知らせる(まとめ方は絵文字申請と同じ)
	 */
	@bindThis
	public async notifyNewAvatarDecorationRequests(requester: Packed<'UserLite'>, requests: RequestSummary[]): Promise<void> {
		if (requests.length === 0) return;
		try {
			const payload = this.summarize(requester, requests);
			const recipientIds = await this.getRecipientIds('canApproveAvatarDecorationRequests');

			for (const recipientId of recipientIds) {
				this.globalEventService.publishAdminStream(recipientId, 'newAvatarDecorationRequest', payload);
				// JUICE: notifierIdを使わない理由はnotifyNewEmojiRequestと同じ
				this.notificationService.createNotification(recipientId, 'newAvatarDecorationRequest', {
					requesterId: payload.requester.id,
					requestId: payload.id,
					name: payload.name,
					category: payload.category,
					count: payload.count,
				});
			}

			await this.systemWebhookService.enqueueSystemWebhook('avatarDecorationRequestCreated', payload);
		} catch (err) {
			this.logger.error('Failed to notify new avatar decoration request', { stack: err });
		}
	}

	@bindThis
	public async notifyNewContactForm(payload: ContactFormPayload): Promise<void> {
		try {
			const recipientIds = await this.getRecipientIds('canProcessContactForms');

			// JUICE: 問い合わせ本文にはメールアドレス・IPアドレス等のPIIが含まれるため、
			// リアルタイム通知(admin stream)にはPIIを含まない最小限の情報のみを載せる。
			// Webhook側(enqueueSystemWebhook)は既存のContactFormPayloadをそのまま使う
			const streamPayload = {
				id: payload.id,
				subject: payload.subject,
				category: payload.category,
			};

			for (const recipientId of recipientIds) {
				this.globalEventService.publishAdminStream(recipientId, 'newContactForm', streamPayload);
				this.notificationService.createNotification(recipientId, 'newContactForm', {
					contactFormId: streamPayload.id,
					subject: streamPayload.subject,
					category: streamPayload.category,
				});
			}

			await this.systemWebhookService.enqueueSystemWebhook('receivedContactForm', payload);
		} catch (err) {
			this.logger.error('Failed to notify new contact form', { stack: err });
		}
	}
}
