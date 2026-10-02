/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { UsersRepository } from '@/models/_.js';
import type { MiRemoteUser, MiUser } from '@/models/User.js';
import { resolveRemoteAvatarDecorationSettings } from '@/models/JuiceSettings.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { LoggerService } from '@/core/LoggerService.js';
import type Logger from '@/logger.js';
import { appendQuery, query } from '@/misc/prelude/url.js';
import { bindThis } from '@/decorators.js';
import { StatusError } from '@/misc/status-error.js';

// JUICE: アイコンのデコレーションはActivityPubでは送られてこないので、デコレーションを持つ実装(Misskey系)の
// ユーザーは、相手のサーバーのAPI(users/show)から取ってくる
const SUPPORTED_SOFTWARE = ['misskey', 'cherrypick', 'sharkey'];

// ローカルのデコレーションと同じ上限・範囲(不正な値で表示を崩されないように)
const MAX_DECORATIONS = 16;

type RemoteDecoration = NonNullable<MiUser['avatarDecorations']>[number];

/**
 * JUICE: リモートのユーザーのアイコンのデコレーションを表示する。
 * misskey-tempuraの「リモートのデコレーション」を参考にしたが、相手のデコレーションをこのサーバーのデコレーションとして
 * 登録はしない。画像のURLはそのユーザーの付けているデコレーション(avatarDecorations)に一緒に持ち、表示するときは
 * メディアプロキシ経由にする
 */
@Injectable()
export class RemoteAvatarDecorationService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private juiceSettingsService: JuiceSettingsService,
		private federatedInstanceService: FederatedInstanceService,
		private httpRequestService: HttpRequestService,
		private globalEventService: GlobalEventService,
		private loggerService: LoggerService,
	) {
		this.logger = this.loggerService.getLogger('remote-avatar-decoration');
	}

	/**
	 * 表示に使うリモートのデコレーションの画像のURL(メディアプロキシ経由)
	 */
	@bindThis
	public getProxiedUrl(url: string): string {
		return appendQuery(`${this.config.mediaProxy}/image.webp`, query({ url }));
	}

	/**
	 * リモートのデコレーションを表示するか(コントロールパネルのJUICE設定)
	 */
	@bindThis
	public async isEnabled(): Promise<boolean> {
		return resolveRemoteAvatarDecorationSettings(await this.juiceSettingsService.fetch()).remoteAvatarDecorationsEnabled;
	}

	/**
	 * そのユーザーのデコレーションを、相手のサーバーから取ってきて差し替える。失敗しても何もしない(表示できないだけ)
	 */
	@bindThis
	public async refresh(user: MiRemoteUser): Promise<void> {
		if (!await this.isEnabled()) return;
		// 初めて見るサーバーは、ソフトウェアの情報がまだ取れていない(ユーザーの登録と並行して取りに行く)ので、そのときは試してみる。
		// Misskey系でなければusers/showが無く、デコレーションを取り出せないだけ
		const instance = await this.federatedInstanceService.fetch(user.host);
		// Misskey系でなくなったサーバーのユーザーは、前に取ったデコレーションを外す
		if (instance?.softwareName != null && !SUPPORTED_SOFTWARE.includes(instance.softwareName.toLowerCase())) return await this.save(user, []);

		let body: unknown;
		try {
			// アカウントのドメインを別のドメインに任せているサーバーもあるので、APIはPersonのURIのサーバーに聞く
			const apiHost = new URL(user.uri).host;
			const res = await this.httpRequestService.send(`https://${apiHost}/api/users/show`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				// 相手のサーバーから見ると、このユーザーはローカルのユーザー
				body: JSON.stringify({ username: user.username }),
				timeout: 10 * 1000,
				size: 1024 * 1024,
			});
			body = await res.json();
		} catch (err) {
			this.logger.debug(`failed to fetch avatar decorations of ${user.username}@${user.host}: ${err}`);
			// 相手のサーバーにユーザーがいない(消された等)ときは外す。一時的な失敗(タイムアウト・5xx等)ではそのまま
			if (err instanceof StatusError && (err.statusCode === 404 || err.statusCode === 410)) await this.save(user, []);
			return;
		}

		const decorations = this.parseDecorations(body);
		if (decorations == null) return;
		await this.save(user, decorations);
	}

	private async save(user: MiRemoteUser, decorations: RemoteDecoration[]): Promise<void> {
		if (JSON.stringify(decorations) === JSON.stringify(user.avatarDecorations)) return;
		await this.usersRepository.update(user.id, { avatarDecorations: decorations });
		this.globalEventService.publishInternalEvent('remoteUserUpdated', { id: user.id });
	}

	// 相手のサーバーが返したユーザーの情報から、デコレーションを取り出す(形が正しいものだけ。取れなければnull)
	private parseDecorations(body: unknown): RemoteDecoration[] | null {
		if (body == null || typeof body !== 'object' || !('avatarDecorations' in body)) return null;
		const raw = (body as { avatarDecorations: unknown }).avatarDecorations;
		if (!Array.isArray(raw)) return null;
		const decorations: RemoteDecoration[] = [];
		for (const item of raw.slice(0, MAX_DECORATIONS)) {
			if (item == null || typeof item !== 'object') continue;
			const { id, url, angle, flipH, offsetX, offsetY, scale } = item as Record<string, unknown>;
			if (typeof id !== 'string' || id.length === 0 || id.length > 64) continue;
			if (typeof url !== 'string' || url.length > 2048 || !/^https:\/\//.test(url)) continue;
			const num = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
			// 大きさ(mk-go・JUICEのサーバーが出す。1(既定)なら持たない)
			const size = num(scale, 0.1, 1);
			decorations.push({
				id,
				url,
				...(num(angle, -0.5, 0.5) ? { angle: num(angle, -0.5, 0.5) } : {}),
				...(flipH === true ? { flipH: true } : {}),
				...(num(offsetX, -0.25, 0.25) ? { offsetX: num(offsetX, -0.25, 0.25) } : {}),
				...(num(offsetY, -0.25, 0.25) ? { offsetY: num(offsetY, -0.25, 0.25) } : {}),
				...(size != null && size !== 1 ? { scale: size } : {}),
			});
		}
		return decorations;
	}
}
