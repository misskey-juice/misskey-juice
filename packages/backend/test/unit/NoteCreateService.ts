/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { setTimeout } from 'node:timers/promises';
import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';

import { CoreModule } from '@/core/CoreModule.js';
import { NoteCreateService } from '@/core/NoteCreateService.js';
import { GlobalModule } from '@/GlobalModule.js';
import { MiNote } from '@/models/Note.js';
import { IPoll } from '@/models/Poll.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { IdService } from '@/core/IdService.js';
import { DI } from '@/di-symbols.js';
import type { MiUser, UserProfilesRepository, UsersRepository } from '@/models/_.js';

describe('NoteCreateService', () => {
	let app: TestingModule;
	let noteCreateService: NoteCreateService;

	beforeAll(async () => {
		app = await Test.createTestingModule({
			imports: [GlobalModule, CoreModule],
		}).compile();
		app.enableShutdownHooks();
		// JUICE: NoteEntityServiceは循環依存をonModuleInit()+moduleRef.get()で解決しているため、
		// compile()だけではそのフックが走らずreactionService等がundefinedのままになる。
		// is-renoteテストは private isRenote/isQuote しか呼ばないため今まで問題にならなかったが、
		// 実際にcreate()を呼ぶ(=NoteEntityService.pack()を経由する)auto-local-onlyテストのために必要
		await app.init();
		noteCreateService = app.get<NoteCreateService>(NoteCreateService);
	});

	afterAll(async () => {
		await app.close();
	});

	describe('is-renote', () => {
		const base: MiNote = {
			id: 'some-note-id',
			replyId: null,
			reply: null,
			renoteId: null,
			renote: null,
			threadId: null,
			text: null,
			name: null,
			cw: null,
			lang: null,
			userId: 'some-user-id',
			user: null,
			localOnly: false,
			isAIGenerated: false,
			hideFromMediaTimeline: false,
			isNovel: false,
			updatedAt: null,
			relayId: null,
			relay: null,
			reactionAcceptance: null,
			renoteCount: 0,
			repliesCount: 0,
			clippedCount: 0,
			pageCount: 0,
			reactions: {},
			visibility: 'public',
			uri: null,
			url: null,
			fileIds: [],
			attachedFileTypes: [],
			visibleUserIds: [],
			mentions: [],
			mentionedRemoteUsers: '',
			reactionAndUserPairCache: [],
			emojis: [],
			tags: [],
			hasPoll: false,
			channelId: null,
			channel: null,
			userHost: null,
			replyUserId: null,
			replyUserHost: null,
			renoteUserId: null,
			renoteUserHost: null,
			renoteChannelId: null,
		};

		const poll: IPoll = {
			choices: ['kinoko', 'takenoko'],
			multiple: false,
			expiresAt: null,
		};

		const file: MiDriveFile = {
			id: 'some-file-id',
			userId: null,
			user: null,
			userHost: null,
			md5: '',
			name: '',
			type: '',
			size: 0,
			comment: null,
			blurhash: null,
			properties: {},
			storedInternal: false,
			url: '',
			thumbnailUrl: null,
			webpublicUrl: null,
			webpublicType: null,
			accessKey: null,
			thumbnailAccessKey: null,
			webpublicAccessKey: null,
			uri: null,
			src: null,
			folderId: null,
			folder: null,
			isSensitive: false,
			isAIGenerated: false,
			isNovel: false,
			novelDownloadDisabled: false,
			maybeSensitive: false,
			maybePorn: false,
			isLink: false,
			requestHeaders: null,
			requestIp: null,
		};

		test('note without renote should not be Renote', () => {
			const note = { renote: null };
			expect(noteCreateService['isRenote'](note)).toBe(false);
		});

		test('note with renote should be Renote and not be Quote', () => {
			const note = { renote: base };
			expect(noteCreateService['isRenote'](note)).toBe(true);
			expect(noteCreateService['isQuote'](note)).toBe(false);
		});

		test('note with renote and text should be Quote', () => {
			const note = { renote: base, text: 'some-text' };
			expect(noteCreateService['isRenote'](note)).toBe(true);
			expect(noteCreateService['isQuote'](note)).toBe(true);
		});

		test('note with renote and cw should be Quote', () => {
			const note = { renote: base, cw: 'some-cw' };
			expect(noteCreateService['isRenote'](note)).toBe(true);
			expect(noteCreateService['isQuote'](note)).toBe(true);
		});

		test('note with renote and reply should be Quote', () => {
			const note = { renote: base, reply: { ...base, id: 'another-note-id' } };
			expect(noteCreateService['isRenote'](note)).toBe(true);
			expect(noteCreateService['isQuote'](note)).toBe(true);
		});

		test('note with renote and poll should be Quote', () => {
			const note = { renote: base, poll };
			expect(noteCreateService['isRenote'](note)).toBe(true);
			expect(noteCreateService['isQuote'](note)).toBe(true);
		});

		test('note with renote and non-empty files should be Quote', () => {
			const note = { renote: base, files: [file] };
			expect(noteCreateService['isRenote'](note)).toBe(true);
			expect(noteCreateService['isQuote'](note)).toBe(true);
		});
	});

	// JUICE: 装飾的なMFMを含む投稿を自動でローカルのみにする機能(ユーザー個別設定)のe2e的な検証。
	// create()を実際に呼び、DB上のuser_profileトグルとMFM本文/CWの組み合わせでlocalOnlyが
	// 期待通り反転する/しないことを確認する
	describe('auto local-only for decorative MFM', () => {
		let usersRepository: UsersRepository;
		let userProfilesRepository: UserProfilesRepository;
		let idService: IdService;
		let alice: MiUser;
		let remoteBob: MiUser;

		async function createUser(data: Partial<MiUser> = {}) {
			const user = await usersRepository
				.insert({
					id: idService.gen(),
					username: 'username',
					usernameLower: 'username',
					...data,
				})
				.then(x => usersRepository.findOneByOrFail(x.identifiers[0]));

			await userProfilesRepository.insert({
				userId: user.id,
			});

			return user;
		}

		beforeAll(() => {
			usersRepository = app.get<UsersRepository>(DI.usersRepository);
			userProfilesRepository = app.get<UserProfilesRepository>(DI.userProfilesRepository);
			idService = app.get<IdService>(IdService);
		});

		beforeEach(async () => {
			alice = await createUser({ username: 'alice' });
			remoteBob = await createUser({ username: 'bob', host: 'remote.example' });
		});

		afterEach(async () => {
			// create()は投稿後の処理(配送準備・返信数の加算等)を待たずに返すため、それが終わる前に
			// レコードを消したりapp.close()でDB接続を閉じたりすると、テスト終了後に
			// "Connection terminated" の未処理rejectionになりCIが落ちる。少し待って吐き出させる
			await setTimeout(500);
			await userProfilesRepository.deleteAll();
			await usersRepository.deleteAll();
		});

		test('markdown-style toggle off: bold text stays federated', async () => {
			const note = await noteCreateService.create(alice, { text: '**bold**' });
			expect(note.localOnly).toBe(false);
		});

		test('markdown-style toggle on + bold body: forced local-only', async () => {
			await userProfilesRepository.update(alice.id, { autoLocalOnlyForMarkdownMfm: true });
			const note = await noteCreateService.create(alice, { text: '**bold**' });
			expect(note.localOnly).toBe(true);
		});

		test('markdown-style toggle on + plain body: stays federated', async () => {
			await userProfilesRepository.update(alice.id, { autoLocalOnlyForMarkdownMfm: true });
			const note = await noteCreateService.create(alice, { text: 'hello world' });
			expect(note.localOnly).toBe(false);
		});

		test('markdown-style toggle on + fn-style body: stays federated (different category)', async () => {
			await userProfilesRepository.update(alice.id, { autoLocalOnlyForMarkdownMfm: true });
			const note = await noteCreateService.create(alice, { text: '$[tada hi]' });
			expect(note.localOnly).toBe(false);
		});

		test('fn-style toggle on + fn-style body: forced local-only', async () => {
			await userProfilesRepository.update(alice.id, { autoLocalOnlyForFnMfm: true });
			const note = await noteCreateService.create(alice, { text: '$[tada hi]' });
			expect(note.localOnly).toBe(true);
		});

		test('markdown-style toggle on + decorative CW only (plain body): forced local-only', async () => {
			await userProfilesRepository.update(alice.id, { autoLocalOnlyForMarkdownMfm: true });
			const note = await noteCreateService.create(alice, { text: 'hello', cw: '**spoiler**' });
			expect(note.localOnly).toBe(true);
		});

		test('markdown-style toggle on + bold body but specified visibility (DM): stays federated', async () => {
			await userProfilesRepository.update(alice.id, { autoLocalOnlyForMarkdownMfm: true });
			const note = await noteCreateService.create(alice, { text: '**bold**', visibility: 'specified', visibleUsers: [remoteBob] });
			expect(note.localOnly).toBe(false);
		});

		test('markdown-style toggle on + bold reply to a remote user: stays federated (thread not broken)', async () => {
			await userProfilesRepository.update(alice.id, { autoLocalOnlyForMarkdownMfm: true });
			const remoteNote = await noteCreateService.create(remoteBob, { text: 'hello from remote' });
			const note = await noteCreateService.create(alice, { text: '**bold**', reply: remoteNote });
			expect(note.localOnly).toBe(false);
		});
	});
});
