/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { RemoteAvatarDecorationService } from '@/core/RemoteAvatarDecorationService.js';
import type { MiRemoteUser } from '@/models/User.js';
import { StatusError } from '@/misc/status-error.js';

// JUICE: リモートのアイコンのデコレーションの取り込み(相手のサーバーのusers/showから、形の正しいものだけ持つ)
describe('RemoteAvatarDecorationService', () => {
	let settings: Record<string, unknown>;
	let softwareName: string | null;
	let responseBody: unknown;
	const update = vi.fn();
	const publish = vi.fn();
	const send = vi.fn();
	let service: RemoteAvatarDecorationService;

	const user = {
		id: 'u1',
		username: 'alice',
		host: 'remote.example.com',
		uri: 'https://ap.remote.example.com/users/u1',
		avatarDecorations: [],
	} as unknown as MiRemoteUser;

	beforeEach(() => {
		settings = {};
		softwareName = 'misskey';
		responseBody = { avatarDecorations: [] };
		update.mockReset();
		publish.mockReset();
		send.mockReset();
		send.mockImplementation(async () => ({ json: async () => responseBody }));
		service = new RemoteAvatarDecorationService(
			{ mediaProxy: 'https://local.example.com/proxy' } as never,
			{ update } as never,
			{ fetch: async () => settings } as never,
			{ fetch: async () => ({ softwareName }) } as never,
			{ send } as never,
			{ publishInternalEvent: publish } as never,
			{ getLogger: () => ({ debug: () => {} }) } as never,
		);
	});

	test('メディアプロキシ経由のURLにする', () => {
		expect(service.getProxiedUrl('https://remote.example.com/a.png')).toBe('https://local.example.com/proxy/image.webp?url=https%3A%2F%2Fremote.example.com%2Fa.png');
	});

	test('PersonのURIのサーバーのusers/showから取り込み、値を範囲に収める', async () => {
		responseBody = {
			avatarDecorations: [
				{ id: 'd1', url: 'https://remote.example.com/d1.png', angle: 2, flipH: true, offsetX: -1, offsetY: 0.1 },
				{ id: 'd2', url: 'http://remote.example.com/d2.png' },
				{ id: 'd3' },
				{ id: '', url: 'https://remote.example.com/d4.png' },
			],
		};
		await service.refresh(user);
		expect(send.mock.calls[0][0]).toBe('https://ap.remote.example.com/api/users/show');
		expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({ username: 'alice' });
		expect(update).toHaveBeenCalledWith('u1', {
			avatarDecorations: [{ id: 'd1', url: 'https://remote.example.com/d1.png', angle: 0.5, flipH: true, offsetX: -0.25, offsetY: 0.1 }],
		});
		expect(publish).toHaveBeenCalledWith('remoteUserUpdated', { id: 'u1' });
	});

	// JUICE: 大きさ(scale)はmk-goと同じ形。0.1〜1に収め、1(今までと同じ大きさ)は持たない。数でないものは捨てる
	test('大きさ(scale)を0.1〜1に収め、1と数でないものは持たない', async () => {
		responseBody = {
			avatarDecorations: [
				{ id: 'd1', url: 'https://remote.example.com/d1.png', scale: 0.5 },
				{ id: 'd2', url: 'https://remote.example.com/d2.png', scale: 5 },
				{ id: 'd3', url: 'https://remote.example.com/d3.png', scale: 0 },
				{ id: 'd4', url: 'https://remote.example.com/d4.png', scale: -2 },
				{ id: 'd5', url: 'https://remote.example.com/d5.png', scale: '0.5' },
				{ id: 'd6', url: 'https://remote.example.com/d6.png', scale: Number.NaN },
				{ id: 'd7', url: 'https://remote.example.com/d7.png', scale: 1 },
			],
		};
		await service.refresh(user);
		const saved = update.mock.calls[0][1].avatarDecorations as { id: string; scale?: number }[];
		expect(saved.map(d => [d.id, d.scale])).toEqual([
			['d1', 0.5],
			['d2', undefined],
			['d3', 0.1],
			['d4', 0.1],
			['d5', undefined],
			['d6', undefined],
			['d7', undefined],
		]);
		for (const d of saved) if (d.scale === undefined) expect('scale' in d).toBe(false);
	});

	test('変わっていなければ書き込まない', async () => {
		await service.refresh(user);
		expect(send).toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});

	test('設定で無効なら取りに行かない', async () => {
		settings = { remoteAvatarDecorationsEnabled: false };
		await service.refresh(user);
		expect(send).not.toHaveBeenCalled();
	});

	test('Misskey系でないサーバーには取りに行かない', async () => {
		softwareName = 'mastodon';
		await service.refresh(user);
		expect(send).not.toHaveBeenCalled();
	});

	test('ソフトウェアがまだ分からないサーバーには試しに取りに行く', async () => {
		softwareName = null;
		await service.refresh(user);
		expect(send).toHaveBeenCalled();
	});

	test('Misskey系でなくなったサーバー・相手にいないユーザーは、前に取ったデコレーションを外す', async () => {
		const decorated = { ...user, avatarDecorations: [{ id: 'd1', url: 'https://remote.example.com/d1.png' }] } as MiRemoteUser;
		softwareName = 'mastodon';
		await service.refresh(decorated);
		expect(update).toHaveBeenLastCalledWith('u1', { avatarDecorations: [] });

		softwareName = 'misskey';
		update.mockReset();
		send.mockRejectedValueOnce(new StatusError('404 Not Found', 404));
		await service.refresh(decorated);
		expect(update).toHaveBeenLastCalledWith('u1', { avatarDecorations: [] });

		// 一時的な失敗ではそのまま
		update.mockReset();
		send.mockRejectedValueOnce(new StatusError('503 Service Unavailable', 503));
		await service.refresh(decorated);
		expect(update).not.toHaveBeenCalled();
	});

	test('取得に失敗したり形が違ったりしたら何もしない', async () => {
		send.mockRejectedValueOnce(new Error('timeout'));
		await service.refresh(user);
		responseBody = { avatarDecorations: 'nope' };
		await service.refresh(user);
		expect(update).not.toHaveBeenCalled();
	});
});
