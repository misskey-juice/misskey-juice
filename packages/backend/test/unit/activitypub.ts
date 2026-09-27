/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { describe, beforeAll, beforeEach, test, vi } from 'vitest';
import { Test } from '@nestjs/testing';

import { MockResolver } from '../misc/mock-resolver.js';
import type { IActor, IApDocument, ICollection, IObject, IPost } from '@/core/activitypub/type.js';
import type { MiRemoteUser } from '@/models/User.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import { ApImageService } from '@/core/activitypub/models/ApImageService.js';
import { ApNoteService } from '@/core/activitypub/models/ApNoteService.js';
import { ApPersonService } from '@/core/activitypub/models/ApPersonService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { JsonLdService } from '@/core/activitypub/JsonLdService.js';
import { CONTEXT, JUICE_NAMESPACE, LEGACY_JUICE_NAMESPACES, normalizeLegacyJuiceProperties } from '@/core/activitypub/misc/contexts.js';
import { GlobalModule } from '@/GlobalModule.js';
import { CoreModule } from '@/core/CoreModule.js';
import { FederatedInstanceService } from '@/core/FederatedInstanceService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { MiMeta, MiNote, NotesRepository, UserProfilesRepository } from '@/models/_.js';
import { DI } from '@/di-symbols.js';
import { secureRndstr } from '@/misc/secure-rndstr.js';
import { DownloadService } from '@/core/DownloadService.js';
import { genAidx } from '@/misc/id/aidx.js';

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);

const host = 'https://host1.test';

type NonTransientIActor = IActor & { id: string };
type NonTransientIPost = IPost & { id: string };

function createRandomActor({ actorHost = host } = {}): NonTransientIActor {
	const preferredUsername = secureRndstr(8);
	const actorId = `${actorHost}/users/${preferredUsername.toLowerCase()}`;

	return {
		'@context': 'https://www.w3.org/ns/activitystreams',
		id: actorId,
		type: 'Person',
		preferredUsername,
		inbox: `${actorId}/inbox`,
		outbox: `${actorId}/outbox`,
	};
}

function createRandomNote(actor: NonTransientIActor): NonTransientIPost {
	const id = secureRndstr(8);
	const noteId = `${new URL(actor.id).origin}/notes/${id}`;

	return {
		id: noteId,
		type: 'Note',
		attributedTo: actor.id,
		content: 'test test foo',
	};
}

function createRandomNotes(actor: NonTransientIActor, length: number): NonTransientIPost[] {
	return new Array(length).fill(null).map(() => createRandomNote(actor));
}

function createRandomFeaturedCollection(actor: NonTransientIActor, length: number): ICollection {
	const items = createRandomNotes(actor, length);

	return {
		'@context': 'https://www.w3.org/ns/activitystreams',
		type: 'Collection',
		id: actor.outbox as string,
		totalItems: items.length,
		items,
	};
}

async function createRandomRemoteUser(
	resolver: MockResolver,
	personService: ApPersonService,
): Promise<MiRemoteUser> {
	const actor = createRandomActor();
	resolver.register(actor.id, actor);

	return await personService.createPerson(actor.id, resolver);
}

describe('ActivityPub', () => {
	let userProfilesRepository: UserProfilesRepository;
	let notesRepository: NotesRepository;
	let imageService: ApImageService;
	let noteService: ApNoteService;
	let personService: ApPersonService;
	let rendererService: ApRendererService;
	let jsonLdService: JsonLdService;
	let resolver: MockResolver;

	const metaInitial = {
		cacheRemoteFiles: true,
		cacheRemoteSensitiveFiles: true,
		enableFanoutTimeline: true,
		enableFanoutTimelineDbFallback: true,
		perUserHomeTimelineCacheMax: 100,
		perLocalUserUserTimelineCacheMax: 100,
		perRemoteUserUserTimelineCacheMax: 100,
		blockedHosts: [] as string[],
		sensitiveWords: [] as string[],
		prohibitedWords: [] as string[],
	} as MiMeta;
	const meta = { ...metaInitial };

	function updateMeta(newMeta: Partial<MiMeta>): void {
		for (const key in meta) {
			delete (meta as any)[key];
		}
		Object.assign(meta, newMeta);
	}

	beforeAll(async () => {
		const app = await Test.createTestingModule({
			imports: [GlobalModule, CoreModule],
		})
			.overrideProvider(DownloadService).useValue({
				async downloadUrl(url: string, path: string): Promise<{ filename: string }> {
					if (url.endsWith('.png')) {
						fs.copyFileSync(
							_dirname + '/../resources/hw.png',
							path,
						);
					}
					return {
						filename: 'dummy.tmp',
					};
				},
			})
			.overrideProvider(DI.meta).useFactory({ factory: () => meta })
			.compile();

		await app.init();
		app.enableShutdownHooks();

		userProfilesRepository = app.get(DI.userProfilesRepository);
		notesRepository = app.get(DI.notesRepository);

		noteService = app.get<ApNoteService>(ApNoteService);
		personService = app.get<ApPersonService>(ApPersonService);
		rendererService = app.get<ApRendererService>(ApRendererService);
		imageService = app.get<ApImageService>(ApImageService);
		jsonLdService = app.get<JsonLdService>(JsonLdService);
		resolver = new MockResolver(await app.resolve<LoggerService>(LoggerService));

		// Prevent ApPersonService from fetching instance, as it causes Jest import-after-test error
		const federatedInstanceService = app.get<FederatedInstanceService>(FederatedInstanceService);
		vi.spyOn(federatedInstanceService, 'fetch').mockImplementation(() => new Promise(() => { }));
	});

	beforeEach(() => {
		resolver.clear();
	});

	describe('Parse minimum object', () => {
		const actor = createRandomActor();

		const post = {
			'@context': 'https://www.w3.org/ns/activitystreams',
			id: `${host}/users/${secureRndstr(8)}`,
			type: 'Note',
			attributedTo: actor.id,
			to: 'https://www.w3.org/ns/activitystreams#Public',
			content: 'あ',
		};

		test('Minimum Actor', async () => {
			resolver.register(actor.id, actor);

			const user = await personService.createPerson(actor.id, resolver);

			assert.deepStrictEqual(user.uri, actor.id);
			assert.deepStrictEqual(user.username, actor.preferredUsername);
			assert.deepStrictEqual(user.inbox, actor.inbox);
		});

		test('Minimum Note', async () => {
			resolver.register(actor.id, actor);
			resolver.register(post.id, post);

			const note = await noteService.createNote(post.id, undefined, resolver, true);

			assert.deepStrictEqual(note?.uri, post.id);
			assert.deepStrictEqual(note.visibility, 'public');
			assert.deepStrictEqual(note.text, post.content);
		});
	});

	// JUICE: Mastodon・Fedibird等で編集された投稿(Update)の受け取り
	describe('Note edit via Update (JUICE)', () => {
		async function setup(extra: Record<string, unknown> = {}) {
			const actor = createRandomActor();
			const post = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				id: `${host}/notes/${secureRndstr(8)}`,
				type: 'Note',
				attributedTo: actor.id,
				to: 'https://www.w3.org/ns/activitystreams#Public',
				content: 'before',
				...extra,
			};
			resolver.register(actor.id, actor);
			resolver.register(post.id, post);
			const note = await noteService.createNote(post.id, undefined, resolver, true);
			const user = await personService.fetchPerson(actor.id) as MiRemoteUser;
			return { actor, post, note: note!, user };
		}

		test('編集日時付きのUpdateで、本文・CW・編集日時が差し替わる', async () => {
			const { post, note, user } = await setup();
			const updated = new Date(Date.now() - 1000).toISOString();
			const result = await noteService.updateNote({ ...post, content: 'after', summary: 'cw', updated }, user, resolver);
			assert.strictEqual(result, 'ok: Note updated');
			const after = await notesRepository.findOneByOrFail({ id: note.id });
			assert.strictEqual(after.text, 'after');
			assert.strictEqual(after.cw, 'cw');
			assert.strictEqual(after.updatedAt?.toISOString(), updated);
			// 公開範囲は変わらない
			assert.strictEqual(after.visibility, note.visibility);
		});

		test('遅れて届いた古い編集では戻さない', async () => {
			const { post, note, user } = await setup();
			const newer = new Date(Date.now() - 1000).toISOString();
			const older = new Date(Date.now() - 5000).toISOString();
			await noteService.updateNote({ ...post, content: 'newer', updated: newer }, user, resolver);
			const result = await noteService.updateNote({ ...post, content: 'older', updated: older }, user, resolver);
			assert.strictEqual(result, 'skip: older or same edit');
			assert.strictEqual((await notesRepository.findOneByOrFail({ id: note.id })).text, 'newer');
		});

		test('編集日時の無いUpdateは編集として扱わない', async () => {
			const { post, note, user } = await setup();
			const result = await noteService.updateNote({ ...post, content: 'after' }, user, resolver);
			assert.strictEqual(result, 'skip: not an edit (no updated)');
			const after = await notesRepository.findOneByOrFail({ id: note.id });
			assert.strictEqual(after.text, 'before');
			assert.strictEqual(after.updatedAt, null);
		});

		test('投稿者以外からのUpdate・知らない投稿のUpdateは反映しない', async () => {
			const { post, note } = await setup();
			const other = createRandomActor();
			resolver.register(other.id, other);
			const otherUser = await personService.createPerson(other.id, resolver) as MiRemoteUser;
			const updated = new Date(Date.now() - 1000).toISOString();
			assert.strictEqual(await noteService.updateNote({ ...post, content: 'hijacked', updated }, otherUser, resolver), 'skip: actor is not the author');
			assert.strictEqual((await notesRepository.findOneByOrFail({ id: note.id })).text, 'before');

			const unknown = { ...post, id: `${host}/notes/${secureRndstr(8)}`, content: 'new', updated };
			const { user } = await setup();
			assert.strictEqual(await noteService.updateNote(unknown, user, resolver), 'skip: note not found');
			assert.strictEqual(await notesRepository.countBy({ uri: unknown.id }), 0);
		});
	});

	describe('AI generated flag (JUICE)', () => {
		test('_juice_isAIGenerated: true が isAIGenerated に反映される', async () => {
			const actor = createRandomActor();
			const post = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				id: `${host}/notes/${secureRndstr(8)}`,
				type: 'Note',
				attributedTo: actor.id,
				to: 'https://www.w3.org/ns/activitystreams#Public',
				content: 'AI generated note',
				_juice_isAIGenerated: true,
			};

			resolver.register(actor.id, actor);
			resolver.register(post.id, post);

			const note = await noteService.createNote(post.id, undefined, resolver, true);

			assert.strictEqual(note?.isAIGenerated, true);
		});

		test('_juice_isAIGenerated 未指定の場合は isAIGenerated が false になる', async () => {
			const actor = createRandomActor();
			const post = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				id: `${host}/notes/${secureRndstr(8)}`,
				type: 'Note',
				attributedTo: actor.id,
				to: 'https://www.w3.org/ns/activitystreams#Public',
				content: 'normal note',
			};

			resolver.register(actor.id, actor);
			resolver.register(post.id, post);

			const note = await noteService.createNote(post.id, undefined, resolver, true);

			assert.strictEqual(note?.isAIGenerated, false);
		});
	});

	// JUICE: Mastodon/Akkomaが実際に送ってくるcontentMapの形("a sub key named after the
	// language's ISO 639-1 code"、Akkoma AP拡張ドキュメントより)を模したペイロードで、
	// ApNoteService側のcontentMap→note.lang抽出が実際に動作することを確認する
	describe('Language tag from contentMap (Mastodon/Akkoma compat, JUICE)', () => {
		test('Mastodon/Akkoma形式のcontentMap(リージョン無しのISO 639-1コード)からnote.langが取れる', async () => {
			const actor = createRandomActor();
			const post = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				id: `${host}/notes/${secureRndstr(8)}`,
				type: 'Note',
				attributedTo: actor.id,
				to: 'https://www.w3.org/ns/activitystreams#Public',
				content: 'Look at that!',
				contentMap: { en: 'Look at that!' },
			};

			resolver.register(actor.id, actor);
			resolver.register(post.id, post);

			const note = await noteService.createNote(post.id, undefined, resolver, true);

			assert.strictEqual(note?.lang, 'en');
		});

		test('リージョン付き(zh-CN等)のcontentMapキーもそのままnote.langへ渡る', async () => {
			const actor = createRandomActor();
			const post = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				id: `${host}/notes/${secureRndstr(8)}`,
				type: 'Note',
				attributedTo: actor.id,
				to: 'https://www.w3.org/ns/activitystreams#Public',
				content: '你好',
				contentMap: { 'zh-CN': '你好' },
			};

			resolver.register(actor.id, actor);
			resolver.register(post.id, post);

			const note = await noteService.createNote(post.id, undefined, resolver, true);

			assert.strictEqual(note?.lang, 'zh-CN');
		});

		test('contentMapが無ければnote.langはnullになる', async () => {
			const actor = createRandomActor();
			const post = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				id: `${host}/notes/${secureRndstr(8)}`,
				type: 'Note',
				attributedTo: actor.id,
				to: 'https://www.w3.org/ns/activitystreams#Public',
				content: 'no language tag',
			};

			resolver.register(actor.id, actor);
			resolver.register(post.id, post);

			const note = await noteService.createNote(post.id, undefined, resolver, true);

			assert.strictEqual(note?.lang, null);
		});

		// JUICE: MastodonがcontentMap送出時にリージョンを主言語サブタグへ切り詰めてしまうため、
		// JUICE間連合ではリージョンを保持したnote.langそのものを_juice_langとして別途送出し、
		// 受信側はそちらを優先する(contentMapのみ・_juice_lang無しのMastodon/Akkoma等からの
		// ノートは、これまで通りcontentMapのキーがそのまま採用される)
		test('_juice_langがcontentMapより優先される(JUICE間連合、リージョン情報の保持)', async () => {
			const actor = createRandomActor();
			const post = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				id: `${host}/notes/${secureRndstr(8)}`,
				type: 'Note',
				attributedTo: actor.id,
				to: 'https://www.w3.org/ns/activitystreams#Public',
				content: 'hello',
				// Mastodon互換のため主言語サブタグへ切り詰められたcontentMap
				contentMap: { en: 'hello' },
				// JUICE間連合用の、リージョンを保持した本来のnote.lang
				_juice_lang: 'en-US',
			};

			resolver.register(actor.id, actor);
			resolver.register(post.id, post);

			const note = await noteService.createNote(post.id, undefined, resolver, true);

			assert.strictEqual(note?.lang, 'en-US');
		});
	});

	describe('Name field', () => {
		test('Truncate long name', async () => {
			const actor = {
				...createRandomActor(),
				name: secureRndstr(129),
			};

			resolver.register(actor.id, actor);

			const user = await personService.createPerson(actor.id, resolver);

			assert.deepStrictEqual(user.name, actor.name.slice(0, 128));
		});

		test('Normalize empty name', async () => {
			const actor = {
				...createRandomActor(),
				name: '',
			};

			resolver.register(actor.id, actor);

			const user = await personService.createPerson(actor.id, resolver);

			assert.strictEqual(user.name, null);
		});
	});

	describe('alsoKnownAs field', () => {
		test('Handle alsoKnownAs as an array', async () => {
			const actor = {
				...createRandomActor(),
				alsoKnownAs: ['https://example.com/users/alice', 'https://example.com/users/alice2'],
			};

			resolver.register(actor.id, actor);

			const user = await personService.createPerson(actor.id, resolver);

			assert.deepStrictEqual(user.alsoKnownAs, actor.alsoKnownAs);
		});

		test('Handle alsoKnownAs as a string', async () => {
			const actor = {
				...createRandomActor(),
				alsoKnownAs: 'https://example.com/users/alice',
			};

			resolver.register(actor.id, actor);

			const user = await personService.createPerson(actor.id, resolver);

			assert.deepStrictEqual(user.alsoKnownAs, [actor.alsoKnownAs]);
		});

		test('Update person with alsoKnownAs as a string', async () => {
			const actor = createRandomActor();
			resolver.register(actor.id, actor);
			const user = await personService.createPerson(actor.id, resolver);

			const updatedActor = {
				...actor,
				alsoKnownAs: 'https://example.com/users/alice',
			};
			resolver.register(actor.id, updatedActor);

			await personService.updatePerson(actor.id, resolver, updatedActor);

			const updatedUser = await personService.fetchPerson(actor.id);
			assert.deepStrictEqual(updatedUser?.alsoKnownAs, [updatedActor.alsoKnownAs]);
		});
	});

	describe('Collection visibility', () => {
		test('Public following/followers', async () => {
			const actor = createRandomActor();
			actor.following = {
				id: `${actor.id}/following`,
				type: 'OrderedCollection',
				totalItems: 0,
				first: `${actor.id}/following?page=1`,
			};
			actor.followers = `${actor.id}/followers`;

			resolver.register(actor.id, actor);
			resolver.register(actor.followers, {
				id: actor.followers,
				type: 'OrderedCollection',
				totalItems: 0,
				first: `${actor.followers}?page=1`,
			});

			const user = await personService.createPerson(actor.id, resolver);
			const userProfile = await userProfilesRepository.findOneByOrFail({ userId: user.id });

			assert.deepStrictEqual(userProfile.followingVisibility, 'public');
			assert.deepStrictEqual(userProfile.followersVisibility, 'public');
		});

		test('Private following/followers', async () => {
			const actor = createRandomActor();
			actor.following = {
				id: `${actor.id}/following`,
				type: 'OrderedCollection',
				totalItems: 0,
				// first: …
			};
			actor.followers = `${actor.id}/followers`;

			resolver.register(actor.id, actor);
			//resolver.register(actor.followers, { … });

			const user = await personService.createPerson(actor.id, resolver);
			const userProfile = await userProfilesRepository.findOneByOrFail({ userId: user.id });

			assert.deepStrictEqual(userProfile.followingVisibility, 'private');
			assert.deepStrictEqual(userProfile.followersVisibility, 'private');
		});
	});

	describe('Renderer', () => {
		test('Render an announce with visibility: followers', () => {
			rendererService.renderAnnounce('https://example.com/notes/00example', {
				id: genAidx(Date.now()),
				visibility: 'followers',
			} as MiNote);
		});
	});

	describe('Featured', () => {
		test('Fetch featured notes from IActor', async () => {
			const actor = createRandomActor();
			actor.featured = `${actor.id}/collections/featured`;

			const featured = createRandomFeaturedCollection(actor, 5);

			resolver.register(actor.id, actor);
			resolver.register(actor.featured, featured);

			await personService.createPerson(actor.id, resolver);

			// All notes in `featured` are same-origin, no need to fetch notes again
			assert.deepStrictEqual(resolver.remoteGetTrials(), [actor.id, actor.featured]);

			// Created notes without resolving anything
			for (const item of featured.items as IPost[]) {
				const note = await noteService.fetchNote(item);
				assert.ok(note);
				assert.strictEqual(note.text, 'test test foo');
				assert.strictEqual(note.uri, item.id);
			}
		});

		test('Fetch featured notes from IActor pointing to another remote server', async () => {
			const actor1 = createRandomActor();
			actor1.featured = `${actor1.id}/collections/featured`;
			const actor2 = createRandomActor({ actorHost: 'https://host2.test' });

			const actor2Note = createRandomNote(actor2);
			const featured = createRandomFeaturedCollection(actor1, 0);
			(featured.items as IPost[]).push({
				...actor2Note,
				content: 'test test bar', // fraud!
			});

			resolver.register(actor1.id, actor1);
			resolver.register(actor1.featured, featured);
			resolver.register(actor2.id, actor2);
			resolver.register(actor2Note.id, actor2Note);

			await personService.createPerson(actor1.id, resolver);

			// actor2Note is from a different server and needs to be fetched again
			assert.deepStrictEqual(
				resolver.remoteGetTrials(),
				[actor1.id, actor1.featured, actor2Note.id, actor2.id],
			);

			const note = await noteService.fetchNote(actor2Note.id);
			assert.ok(note);

			// Reflects the original content instead of the fraud
			assert.strictEqual(note.text, 'test test foo');
			assert.strictEqual(note.uri, actor2Note.id);
		});

		test('Fetch a note that is a featured note of the attributed actor', async () => {
			const actor = createRandomActor();
			actor.featured = `${actor.id}/collections/featured`;

			const featured = createRandomFeaturedCollection(actor, 5);
			const firstNote = (featured.items as NonTransientIPost[])[0];

			resolver.register(actor.id, actor);
			resolver.register(actor.featured, featured);
			resolver.register(firstNote.id, firstNote);

			const note = await noteService.createNote(firstNote.id as string, undefined, resolver);
			assert.strictEqual(note?.uri, firstNote.id);
		});
	});

	describe('Images', () => {
		test('Render image document with dimensions', () => {
			const rendered = rendererService.renderDocument({
				id: genAidx(Date.now()),
				type: 'image/png',
				webpublicType: null,
				url: 'https://example.test/files/image.png',
				webpublicUrl: null,
				comment: null,
				isSensitive: false,
				properties: { width: 3600, height: 1890 },
				uri: null,
				userHost: null,
				isLink: false,
				webpublicAccessKey: null,
			} as MiDriveFile);

			assert.strictEqual(rendered.type, 'Document');
			assert.strictEqual(rendered.mediaType, 'image/png');
			assert.strictEqual(rendered.width, 3600);
			assert.strictEqual(rendered.height, 1890);
		});

		test('Create images', async () => {
			const imageObject: IApDocument = {
				type: 'Document',
				mediaType: 'image/png',
				url: 'http://host1.test/foo.png',
				name: '',
			};
			const driveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				imageObject,
			);
			assert.ok(driveFile && !driveFile.isLink);

			const sensitiveImageObject: IApDocument = {
				type: 'Document',
				mediaType: 'image/png',
				url: 'http://host1.test/bar.png',
				name: '',
				sensitive: true,
			};
			const sensitiveDriveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				sensitiveImageObject,
			);
			assert.ok(sensitiveDriveFile && !sensitiveDriveFile.isLink);
		});

		test('cacheRemoteFiles=false disables caching', async () => {
			updateMeta({ ...metaInitial, cacheRemoteFiles: false });

			const imageObject: IApDocument = {
				type: 'Document',
				mediaType: 'image/png',
				url: 'http://host1.test/foo.png',
				name: '',
			};
			const driveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				imageObject,
			);
			assert.ok(driveFile && driveFile.isLink);

			const sensitiveImageObject: IApDocument = {
				type: 'Document',
				mediaType: 'image/png',
				url: 'http://host1.test/bar.png',
				name: '',
				sensitive: true,
			};
			const sensitiveDriveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				sensitiveImageObject,
			);
			assert.ok(sensitiveDriveFile && sensitiveDriveFile.isLink);
		});

		test('cacheRemoteSensitiveFiles=false only affects sensitive files', async () => {
			updateMeta({ ...metaInitial, cacheRemoteSensitiveFiles: false });

			const imageObject: IApDocument = {
				type: 'Document',
				mediaType: 'image/png',
				url: 'http://host1.test/foo.png',
				name: '',
			};
			const driveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				imageObject,
			);
			assert.ok(driveFile && !driveFile.isLink);

			const sensitiveImageObject: IApDocument = {
				type: 'Document',
				mediaType: 'image/png',
				url: 'http://host1.test/bar.png',
				name: '',
				sensitive: true,
			};
			const sensitiveDriveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				sensitiveImageObject,
			);
			assert.ok(sensitiveDriveFile && sensitiveDriveFile.isLink);
		});

		test('Link is not an attachment files', async () => {
			const linkObject: IObject = {
				type: 'Link',
				href: 'https://example.com/',
			};
			const driveFile = await imageService.createImage(
				await createRandomRemoteUser(resolver, personService),
				linkObject,
			);
			assert.strictEqual(driveFile, null);
		});
	});

	describe('JSON-LD', () => {
		test('Compaction', async () => {
			const jsonLd = jsonLdService.use();

			const object = {
				'@context': [
					'https://www.w3.org/ns/activitystreams',
					{
						_misskey_quote: 'https://misskey-hub.net/ns#_misskey_quote',
						unknown: 'https://example.org/ns#unknown',
						undefined: null,
					},
				],
				id: 'https://example.com/notes/42',
				type: 'Note',
				attributedTo: 'https://example.com/users/1',
				to: ['https://www.w3.org/ns/activitystreams#Public'],
				content: 'test test foo',
				_misskey_quote: 'https://example.com/notes/1',
				unknown: 'test test bar',
				undefined: 'test test baz',
			};
			const compacted = await jsonLd.compact(object);

			assert.deepStrictEqual(compacted, {
				'@context': CONTEXT,
				id: 'https://example.com/notes/42',
				type: 'Note',
				attributedTo: 'https://example.com/users/1',
				to: 'as:Public',
				content: 'test test foo',
				_misskey_quote: 'https://example.com/notes/1',
				'https://example.org/ns#unknown': 'test test bar',
				// undefined: 'test test baz',
			});
		});

		// JUICE: リポジトリを組織へ移したのに合わせて独自プロパティの名前空間を変えた。古い名前空間のJUICEから
		// LD署名付き(リレー経由)で届いたactivityも、独自プロパティを読めること
		describe('JUICE独自プロパティの名前空間', () => {
			const legacy = LEGACY_JUICE_NAMESPACES[0];
			const legacyContext = JSON.parse(JSON.stringify(CONTEXT).replaceAll(JUICE_NAMESPACE, legacy));
			const juiceProperties = {
				_juice_isAIGenerated: true,
				_juice_isNovel: true,
				_juice_lang: 'ja',
				_juice_summaryIsAIGeneratedFallback: false,
				_juice_originalCw: 'もとのCW',
			};
			const createActivity = (context: unknown) => ({
				'@context': context,
				id: 'https://remote.example/notes/1/activity',
				type: 'Create',
				actor: 'https://remote.example/users/1',
				object: {
					id: 'https://remote.example/notes/1',
					type: 'Note',
					attributedTo: 'https://remote.example/users/1',
					content: 'test',
					...juiceProperties,
				},
			});

			test('古い名前空間のプロパティは、compactすると完全なIRIのキーになり、読み替えると短い名前と元の値に戻る', async () => {
				const jsonLd = jsonLdService.use();
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const compacted = await jsonLd.compact(createActivity(legacyContext)) as any;

				// compactしただけでは、今の名前空間の短い名前にならない
				for (const [name, value] of Object.entries(juiceProperties)) {
					assert.strictEqual(compacted.object[name], undefined);
					assert.strictEqual(compacted.object[`${legacy}${name}`], value);
				}

				normalizeLegacyJuiceProperties(compacted);
				for (const [name, value] of Object.entries(juiceProperties)) {
					assert.strictEqual(compacted.object[name], value);
				}
				assert.ok(Object.keys(compacted.object).every(key => !key.startsWith(legacy)));
				assert.strictEqual(compacted.object.content, 'test');
			});

			test('今の名前空間のプロパティは、compactしても短い名前のまま', async () => {
				const jsonLd = jsonLdService.use();
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const compacted = await jsonLd.compact(createActivity(CONTEXT)) as any;
				for (const [name, value] of Object.entries(juiceProperties)) {
					assert.strictEqual(compacted.object[name], value);
				}
			});

			test('短い名前のキーが既にあれば、古い名前空間のキーでは上書きしない', () => {
				const object = { _juice_isNovel: false, [`${legacy}_juice_isNovel`]: true, [`${legacy}unknown`]: 'x' };
				normalizeLegacyJuiceProperties(object);
				assert.deepStrictEqual(object, { _juice_isNovel: false });
			});
		});
	});
});
