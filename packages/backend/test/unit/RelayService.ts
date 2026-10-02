/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import { afterAll, beforeAll, describe, test, expect, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test } from '@nestjs/testing';
import { mockDeep } from 'vitest-mock-extended';
import type { TestingModule } from '@nestjs/testing';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { IdService } from '@/core/IdService.js';
import { QueueService } from '@/core/QueueService.js';
import { RelayService } from '@/core/RelayService.js';
import { SystemAccountService } from '@/core/SystemAccountService.js';
import { GlobalModule } from '@/GlobalModule.js';
import { UtilityService } from '@/core/UtilityService.js';

describe('RelayService', () => {
	let app: TestingModule;
	let relayService: RelayService;
	let queueService: Mocked<QueueService>;

	beforeAll(async () => {
		app = await Test.createTestingModule({
			imports: [
				GlobalModule,
			],
			providers: [
				IdService,
				ApRendererService,
				RelayService,
				UserEntityService,
				SystemAccountService,
				UtilityService,
			],
		})
			.useMocker((token) => {
				if (token === QueueService) {
					return { deliver: vi.fn() };
				}
				if (typeof token === 'function') {
					return mockDeep<typeof token>();
				}
			})
			.compile();

		app.enableShutdownHooks();

		relayService = app.get<RelayService>(RelayService);
		queueService = app.get<QueueService>(QueueService) as Mocked<QueueService>;
	});

	afterAll(async () => {
		await app.close();
	});

	test('addRelay', async () => {
		const result = await relayService.addRelay('https://example.com');

		expect(result.inbox).toBe('https://example.com');
		expect(result.status).toBe('requesting');
		expect(queueService.deliver).toHaveBeenCalled();
		expect(queueService.deliver.mock.lastCall![1]?.type).toBe('Follow');
		expect(queueService.deliver.mock.lastCall![2]).toBe('https://example.com');
		//expect(queueService.deliver.mock.lastCall![0].username).toBe('relay.actor');
	});

	test('listRelay', async () => {
		const result = await relayService.listRelay();

		expect(result.length).toBe(1);
		expect(result[0].inbox).toBe('https://example.com');
		expect(result[0].status).toBe('requesting');
	});

	test('removeRelay: succ', async () => {
		await relayService.removeRelay('https://example.com');

		expect(queueService.deliver).toHaveBeenCalled();
		expect(queueService.deliver.mock.lastCall![1]?.type).toBe('Undo');
		expect(typeof queueService.deliver.mock.lastCall![1]?.object).toBe('object');
		expect((queueService.deliver.mock.lastCall![1]?.object as any).type).toBe('Follow');
		expect(queueService.deliver.mock.lastCall![2]).toBe('https://example.com');
		//expect(queueService.deliver.mock.lastCall![0].username).toBe('relay.actor');

		const list = await relayService.listRelay();
		expect(list.length).toBe(0);
	});

	test('removeRelay: fail', async () => {
		await expect(relayService.removeRelay('https://x.example.com'))
			.rejects.toThrow('relay not found');
	});

	test('getRelayForActor (JUICE)', async () => {
		const relay = await relayService.addRelay('https://relay-for-actor.example.com');
		await relayService.relayAccepted(relay.id, { inbox: relay.inbox, sharedInbox: null });

		const matchedByInbox = await relayService.getRelayForActor({ inbox: 'https://relay-for-actor.example.com', sharedInbox: null });
		expect(matchedByInbox?.id).toBe(relay.id);

		const matchedBySharedInbox = await relayService.getRelayForActor({ inbox: null, sharedInbox: 'https://relay-for-actor.example.com' });
		expect(matchedBySharedInbox?.id).toBe(relay.id);

		const notMatched = await relayService.getRelayForActor({ inbox: 'https://not-a-relay.example.com', sharedInbox: null });
		expect(notMatched).toBeNull();

		await relayService.removeRelay('https://relay-for-actor.example.com');
	});

	test('getRelayForActorのキャッシュは削除・再登録のたびに即座に反映される (JUICE)', async () => {
		const relay = await relayService.addRelay('https://cache-invalidation.example.com');
		await relayService.relayAccepted(relay.id, { inbox: relay.inbox, sharedInbox: null });

		const matchedBefore = await relayService.getRelayForActor({ inbox: 'https://cache-invalidation.example.com', sharedInbox: null });
		expect(matchedBefore?.id).toBe(relay.id);

		await relayService.removeRelay('https://cache-invalidation.example.com');

		// 10分キャッシュが即座に無効化されていなければ、削除直後でも古いrelayを返し続けてしまう
		const matchedAfterRemove = await relayService.getRelayForActor({ inbox: 'https://cache-invalidation.example.com', sharedInbox: null });
		expect(matchedAfterRemove).toBeNull();

		// 同じホストを再登録すると新しいIDが発行される。承認直後からキャッシュ待ちせず認識できることを確認する
		const readded = await relayService.addRelay('https://cache-invalidation.example.com');
		expect(readded.id).not.toBe(relay.id);
		await relayService.relayAccepted(readded.id, { inbox: readded.inbox, sharedInbox: null });

		const matchedAfterReadd = await relayService.getRelayForActor({ inbox: 'https://cache-invalidation.example.com', sharedInbox: null });
		expect(matchedAfterReadd?.id).toBe(readded.id);

		await relayService.removeRelay('https://cache-invalidation.example.com');
	});
});
