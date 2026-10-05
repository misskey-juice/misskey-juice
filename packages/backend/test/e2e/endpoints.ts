/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, afterAll, test, expect, vi } from 'vitest';
// node-fetch only supports it's own Blob yet
// https://github.com/node-fetch/node-fetch/pull/1664
import { Blob } from 'node-fetch';
import { api, castAsError, initTestDb, post, randomString, role, signup, simpleGet, uploadFile } from '../utils.js';
import type * as misskey from 'misskey-js';
import { MiUser, MiNote, MiRelay, MiFollowing, MiFollowRequest, MiUserPending, MiUserProfile } from '@/models/_.js';

const waitForPushToTlOptions = { timeout: 3000, interval: 25 };

describe('Endpoints', () => {
	let alice: misskey.entities.SignupSuccessResponse;
	let bob: misskey.entities.SignupSuccessResponse;
	let carol: misskey.entities.SignupSuccessResponse;
	let dave: misskey.entities.SignupSuccessResponse;

	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
		bob = await signup({ username: 'bob' });
		carol = await signup({ username: 'carol' });
		dave = await signup({ username: 'dave' });
		await api('admin/update-meta', { federation: 'all' }, alice as misskey.entities.SignupSuccessResponse);
	}, 1000 * 60 * 2);

	describe('signup', () => {
		test('不正なユーザー名でアカウントが作成できない', async () => {
			const res = await api('signup', {
				username: 'test.',
				password: 'test',
			});
			assert.strictEqual(res.status, 400);
		});

		test('空のパスワードでアカウントが作成できない', async () => {
			const res = await api('signup', {
				username: 'test',
				password: '',
			});
			assert.strictEqual(res.status, 400);
		});

		test('正しくアカウントが作成できる', async () => {
			const me = {
				username: 'test1',
				password: 'test1',
			};

			const res = await api('signup', me);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.ok(res.body && !('pendingApproval' in res.body));
			assert.strictEqual(res.body.username, me.username);
		});

		test('同じユーザー名のアカウントは作成できない', async () => {
			const res = await api('signup', {
				username: 'test1',
				password: 'test1',
			});

			assert.strictEqual(res.status, 400);
		});

		test('emailLang を指定してもアカウントが作成できる', async () => {
			const username = randomString();
			const res = await api('signup', {
				username,
				password: 'test1',
				emailLang: 'en-US',
			});

			assert.strictEqual(res.status, 200);
			assert.ok(res.body && !('pendingApproval' in res.body));
			assert.strictEqual(res.body.username, username);
		});
	});

	describe('signin-flow', () => {
		test('間違ったパスワードでサインインできない', async () => {
			const res = await api('signin-flow', {
				username: 'test1',
				password: 'bar',
			});

			assert.strictEqual(res.status, 403);
		});

		test('クエリをインジェクションできない', async () => {
			const res = await api('signin-flow', {
				username: 'test1',
				// @ts-expect-error password must be string
				password: {
					$gt: '',
				},
			});

			assert.strictEqual(res.status, 400);
		});

		test('正しい情報でサインインできる', async () => {
			const res = await api('signin-flow', {
				username: 'test1',
				password: 'test1',
			});

			assert.strictEqual(res.status, 200);
		});
	});

	describe('i/update', () => {
		test('アカウント設定を更新できる', async () => {
			const myName = '大室櫻子';
			const myLocation = '七森中';
			const myBirthday = '2000-09-07';

			const res = await api('i/update', {
				name: myName,
				location: myLocation,
				birthday: myBirthday,
			}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body.name, myName);
			assert.strictEqual(res.body.location, myLocation);
			assert.strictEqual(res.body.birthday, myBirthday);
		});

		test('名前を空白のみにした場合nullになる', async () => {
			const res = await api('i/update', {
				name: ' ',
			}, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.name, null);
		});

		test('名前の前後に空白（ホワイトスペース）を入れてもトリムされる', async () => {
			const res = await api('i/update', {
				// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#white_space
				name: ' あ い う \u0009\u000b\u000c\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\ufeff',
			}, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.name, 'あ い う');
		});

		test('誕生日の設定を削除できる', async () => {
			await api('i/update', {
				birthday: '2000-09-07',
			}, alice);

			const res = await api('i/update', {
				birthday: null,
			}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body.birthday, null);
		});

		test('不正な誕生日の形式で怒られる', async () => {
			const res = await api('i/update', {
				birthday: '2000/09/07',
			}, alice);
			assert.strictEqual(res.status, 400);
		});
	});

	describe('users/show', () => {
		test('ユーザーが取得できる', async () => {
			const res = await api('users/show', {
				userId: alice.id,
			}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual((res.body as unknown as { id: string }).id, alice.id);
		});

		test('ユーザーが存在しなかったら怒る', async () => {
			const res = await api('users/show', {
				userId: '000000000000000000000000',
			});
			assert.strictEqual(res.status, 404);
		});

		test('間違ったIDで怒られる', async () => {
			const res = await api('users/show', {
				userId: 'kyoppie',
			});
			assert.strictEqual(res.status, 404);
		});
	});

	describe('notes/show', () => {
		test('投稿が取得できる', async () => {
			const myPost = await post(alice, {
				text: 'test',
			});

			const res = await api('notes/show', {
				noteId: myPost.id,
			}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body.id, myPost.id);
			assert.strictEqual(res.body.text, myPost.text);
		});

		test('投稿が存在しなかったら怒る', async () => {
			const res = await api('notes/show', {
				noteId: '000000000000000000000000',
			});
			assert.strictEqual(res.status, 400);
		});

		test('間違ったIDで怒られる', async () => {
			const res = await api('notes/show', {
				noteId: 'kyoppie',
			});
			assert.strictEqual(res.status, 400);
		});
	});

	describe('notes/reactions/create', () => {
		test('リアクションできる', async () => {
			const bobPost = await post(bob, { text: 'hi' });

			const res = await api('notes/reactions/create', {
				noteId: bobPost.id,
				reaction: '🚀',
			}, alice);

			assert.strictEqual(res.status, 204);

			const resNote = await api('notes/show', {
				noteId: bobPost.id,
			}, alice);

			assert.strictEqual(resNote.status, 200);
			assert.strictEqual(resNote.body.reactions['🚀'], 1);
		});

		test('自分の投稿にもリアクションできる', async () => {
			const myPost = await post(alice, { text: 'hi' });

			const res = await api('notes/reactions/create', {
				noteId: myPost.id,
				reaction: '🚀',
			}, alice);

			assert.strictEqual(res.status, 204);
		});

		test('二重にリアクションすると上書きされる', async () => {
			const bobPost = await post(bob, { text: 'hi' });

			await api('notes/reactions/create', {
				noteId: bobPost.id,
				reaction: '🥰',
			}, alice);

			const res = await api('notes/reactions/create', {
				noteId: bobPost.id,
				reaction: '🚀',
			}, alice);

			assert.strictEqual(res.status, 204);

			const resNote = await api('notes/show', {
				noteId: bobPost.id,
			}, alice);

			assert.strictEqual(resNote.status, 200);
			assert.deepStrictEqual(resNote.body.reactions, { '🚀': 1 });
		});

		test('存在しない投稿にはリアクションできない', async () => {
			const res = await api('notes/reactions/create', {
				noteId: '000000000000000000000000',
				reaction: '🚀',
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('リノートにリアクションできない', async () => {
			const bobNote = await post(bob, { text: 'hi' });
			const bobRenote = await post(bob, { renoteId: bobNote.id });

			const res = await api('notes/reactions/create', {
				noteId: bobRenote.id,
				reaction: '🚀',
			}, alice);

			assert.strictEqual(res.status, 400);
			assert.ok(res.body);
			assert.strictEqual(castAsError(res.body).error.code, 'CANNOT_REACT_TO_RENOTE');
		});

		test('引用にリアクションできる', async () => {
			const bobNote = await post(bob, { text: 'hi' });
			const bobRenote = await post(bob, { text: 'hi again', renoteId: bobNote.id });

			const res = await api('notes/reactions/create', {
				noteId: bobRenote.id,
				reaction: '🚀',
			}, alice);

			assert.strictEqual(res.status, 204);
		});

		test('空文字列のリアクションは\u2764にフォールバックされる', async () => {
			const bobNote = await post(bob, { text: 'hi' });

			const res = await api('notes/reactions/create', {
				noteId: bobNote.id,
				reaction: '',
			}, alice);

			assert.strictEqual(res.status, 204);

			const reaction = await api('notes/reactions', {
				noteId: bobNote.id,
			});

			assert.strictEqual(reaction.body.length, 1);
			assert.strictEqual(reaction.body[0].type, '\u2764');
		});

		test('絵文字ではない文字列のリアクションは\u2764にフォールバックされる', async () => {
			const bobNote = await post(bob, { text: 'hi' });

			const res = await api('notes/reactions/create', {
				noteId: bobNote.id,
				reaction: 'Hello!',
			}, alice);

			assert.strictEqual(res.status, 204);

			const reaction = await api('notes/reactions', {
				noteId: bobNote.id,
			});

			assert.strictEqual(reaction.body.length, 1);
			assert.strictEqual(reaction.body[0].type, '\u2764');
		});

		test('空のパラメータで怒られる', async () => {
			// @ts-expect-error param must not be empty
			const res = await api('notes/reactions/create', {}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('間違ったIDで怒られる', async () => {
			const res = await api('notes/reactions/create', {
				noteId: 'kyoppie',
				reaction: '🚀',
			}, alice);

			assert.strictEqual(res.status, 400);
		});
	});

	describe('following/create', () => {
		test('フォローできる', async () => {
			const res = await api('following/create', {
				userId: alice.id,
			}, bob);

			assert.strictEqual(res.status, 200);

			const connection = await initTestDb(true);
			const Users = connection.getRepository(MiUser);
			const newBob = await Users.findOneByOrFail({ id: bob.id });
			assert.strictEqual(newBob.followersCount, 0);
			assert.strictEqual(newBob.followingCount, 1);
			const newAlice = await Users.findOneByOrFail({ id: alice.id });
			assert.strictEqual(newAlice.followersCount, 1);
			assert.strictEqual(newAlice.followingCount, 0);
			connection.destroy();
		});

		test('既にフォローしている場合は怒る', async () => {
			const res = await api('following/create', {
				userId: alice.id,
			}, bob);

			assert.strictEqual(res.status, 400);
		});

		test('存在しないユーザーはフォローできない', async () => {
			const res = await api('following/create', {
				userId: '000000000000000000000000',
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('自分自身はフォローできない', async () => {
			const res = await api('following/create', {
				userId: alice.id,
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('空のパラメータで怒られる', async () => {
			// @ts-expect-error params must not be empty
			const res = await api('following/create', {}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('間違ったIDで怒られる', async () => {
			const res = await api('following/create', {
				userId: 'foo',
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('新規アカウントからのフォローをリクエスト化する設定が有効な場合、鍵アカウントでなくてもフォローリクエストになる(JUICE独自)', async () => {
			const troll = await signup({ username: 'newFollowTroll' });

			const enable = await api('admin/juice/update-settings', {
				newAccountFollowRequestEnabled: true,
				newAccountFollowRequestThresholdMs: 24 * 60 * 60 * 1000,
			}, alice);
			assert.strictEqual(enable.status, 204);

			try {
				const res = await api('following/create', {
					userId: carol.id,
				}, troll);
				assert.strictEqual(res.status, 200);

				const connection = await initTestDb(true);
				const Followings = connection.getRepository(MiFollowing);
				const FollowRequests = connection.getRepository(MiFollowRequest);
				const isFollowing = await Followings.exists({ where: { followerId: troll.id, followeeId: carol.id } });
				const hasRequest = await FollowRequests.exists({ where: { followerId: troll.id, followeeId: carol.id } });
				connection.destroy();

				assert.strictEqual(isFollowing, false);
				assert.strictEqual(hasRequest, true);
			} finally {
				const reset = await api('admin/juice/update-settings', {
					newAccountFollowRequestEnabled: false,
				}, alice);
				assert.strictEqual(reset.status, 204);
			}
		});

		test('新規アカウントからのフォローをリクエスト化する設定が無効な場合は、新規アカウントでも即座にフォローできる(JUICE独自)', async () => {
			const freshUser = await signup({ username: 'freshFollowerDefault' });

			const res = await api('following/create', {
				userId: dave.id,
			}, freshUser);
			assert.strictEqual(res.status, 200);

			const connection = await initTestDb(true);
			const Followings = connection.getRepository(MiFollowing);
			const isFollowing = await Followings.exists({ where: { followerId: freshUser.id, followeeId: dave.id } });
			connection.destroy();

			assert.strictEqual(isFollowing, true);
		});
	});

	describe('following/delete', () => {
		test('フォロー解除できる', async () => {
			await api('following/create', {
				userId: alice.id,
			}, bob);

			const res = await api('following/delete', {
				userId: alice.id,
			}, bob);

			assert.strictEqual(res.status, 200);

			const connection = await initTestDb(true);
			const Users = connection.getRepository(MiUser);
			const newBob = await Users.findOneByOrFail({ id: bob.id });
			assert.strictEqual(newBob.followersCount, 0);
			assert.strictEqual(newBob.followingCount, 0);
			const newAlice = await Users.findOneByOrFail({ id: alice.id });
			assert.strictEqual(newAlice.followersCount, 0);
			assert.strictEqual(newAlice.followingCount, 0);
			connection.destroy();
		});

		test('フォローしていない場合は怒る', async () => {
			const res = await api('following/delete', {
				userId: alice.id,
			}, bob);

			assert.strictEqual(res.status, 400);
		});

		test('存在しないユーザーはフォロー解除できない', async () => {
			const res = await api('following/delete', {
				userId: '000000000000000000000000',
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('自分自身はフォロー解除できない', async () => {
			const res = await api('following/delete', {
				userId: alice.id,
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('空のパラメータで怒られる', async () => {
			// @ts-expect-error params must not be empty
			const res = await api('following/delete', {}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('間違ったIDで怒られる', async () => {
			const res = await api('following/delete', {
				userId: 'kyoppie',
			}, alice);

			assert.strictEqual(res.status, 400);
		});
	});

	describe('channels/search', () => {
		test('空白検索で一覧を取得できる', async () => {
			await api('channels/create', {
				name: 'aaa',
				description: 'bbb',
			}, bob);
			await api('channels/create', {
				name: 'ccc1',
				description: 'ddd1',
			}, bob);
			await api('channels/create', {
				name: 'ccc2',
				description: 'ddd2',
			}, bob);

			const res = await api('channels/search', {
				query: '',
			}, bob);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && Array.isArray(res.body), true);
			assert.strictEqual(res.body.length, 3);
		});
		test('名前のみの検索で名前を検索できる', async () => {
			const res = await api('channels/search', {
				query: 'aaa',
				type: 'nameOnly',
			}, bob);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && Array.isArray(res.body), true);
			assert.strictEqual(res.body.length, 1);
			assert.strictEqual(res.body[0].name, 'aaa');
		});
		test('名前のみの検索で名前を複数検索できる', async () => {
			const res = await api('channels/search', {
				query: 'ccc',
				type: 'nameOnly',
			}, bob);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && Array.isArray(res.body), true);
			assert.strictEqual(res.body.length, 2);
		});
		test('名前のみの検索で説明は検索できない', async () => {
			const res = await api('channels/search', {
				query: 'bbb',
				type: 'nameOnly',
			}, bob);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && Array.isArray(res.body), true);
			assert.strictEqual(res.body.length, 0);
		});
		test('名前と説明の検索で名前を検索できる', async () => {
			const res = await api('channels/search', {
				query: 'ccc1',
			}, bob);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && Array.isArray(res.body), true);
			assert.strictEqual(res.body.length, 1);
			assert.strictEqual(res.body[0].name, 'ccc1');
		});
		test('名前と説明での検索で説明を検索できる', async () => {
			const res = await api('channels/search', {
				query: 'ddd1',
			}, bob);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && Array.isArray(res.body), true);
			assert.strictEqual(res.body.length, 1);
			assert.strictEqual(res.body[0].name, 'ccc1');
		});
		test('名前と説明の検索で名前を複数検索できる', async () => {
			const res = await api('channels/search', {
				query: 'ccc',
			}, bob);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && Array.isArray(res.body), true);
			assert.strictEqual(res.body.length, 2);
		});
		test('名前と説明での検索で説明を複数検索できる', async () => {
			const res = await api('channels/search', {
				query: 'ddd',
			}, bob);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && Array.isArray(res.body), true);
			assert.strictEqual(res.body.length, 2);
		});
	});

	describe('drive', () => {
		test('ドライブ情報を取得できる', async () => {
			const res = await api('drive', {}, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			expect(res.body).toHaveProperty('usage', 0);
		});
	});

	describe('drive/files/create', () => {
		const assignRole = async (userId: string, policies: Record<string, unknown>) => {
			const createdRole = await role(alice, {}, policies);

			const assign = await api('admin/roles/assign', {
				userId,
				roleId: createdRole.id,
			}, alice);

			assert.strictEqual(assign.status, 204);

			return createdRole;
		};

		const cleanupRole = async (userId: string, roleId: string) => {
			await api('admin/roles/unassign', {
				userId,
				roleId,
			}, alice);

			await api('admin/roles/delete', {
				roleId,
			}, alice);
		};

		test('ファイルを作成できる', async () => {
			const res = await uploadFile(alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body!.name, '192.jpg');
		});

		test('ファイルに名前を付けられる', async () => {
			const res = await uploadFile(alice, { name: 'Belmond.jpg' });

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body!.name, 'Belmond.jpg');
		});

		test('ファイルに名前を付けられるが、拡張子は正しいものになる', async () => {
			const res = await uploadFile(alice, { name: 'Belmond.png' });

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body!.name, 'Belmond.png.jpg');
		});

		test('ファイル無しで怒られる', async () => {
			// @ts-expect-error params must not be empty
			const res = await api('drive/files/create', {}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('SVGファイルを作成できる', async () => {
			const res = await uploadFile(alice, { path: 'image.svg' });

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body!.name, 'image.svg');
			assert.strictEqual(res.body!.type, 'image/svg+xml');
		});

		for (const type of ['webp', 'avif']) {
			const mediaType = `image/${type}`;

			const getWebpublicType = async (user: misskey.entities.SignupSuccessResponse, fileId: string): Promise<string> => {
				// drive/files/create does not expose webpublicType directly, so get it by posting it
				const res = await post(user, {
					text: mediaType,
					fileIds: [fileId],
				});
				const apRes = await simpleGet(`notes/${res.id}`, 'application/activity+json');
				assert.strictEqual(apRes.status, 200);
				assert.ok(Array.isArray(apRes.body.attachment));
				return apRes.body.attachment[0].mediaType;
			};

			test(`透明な${type}ファイルを作成できる`, async () => {
				const path = `with-alpha.${type}`;
				const res = await uploadFile(alice, { path });

				assert.strictEqual(res.status, 200);
				assert.strictEqual(res.body!.name, path);
				assert.strictEqual(res.body!.type, mediaType);

				const webpublicType = await getWebpublicType(alice, res.body!.id);
				assert.strictEqual(webpublicType, 'image/webp');
			});

			test(`透明じゃない${type}ファイルを作成できる`, async () => {
				const path = `without-alpha.${type}`;
				const res = await uploadFile(alice, { path });
				assert.strictEqual(res.status, 200);
				assert.strictEqual(res.body!.name, path);
				assert.strictEqual(res.body!.type, mediaType);

				const webpublicType = await getWebpublicType(alice, res.body!.id);
				assert.strictEqual(webpublicType, 'image/webp');
			});
		}

		test('uploadableFileTypes が */* なら任意のファイルをアップロードできる', async () => {
			const createdRole = await assignRole(bob.id, {
				uploadableFileTypes: {
					useDefault: false,
					priority: 1,
					value: ['*/*'],
				},
			});

			try {
				const res = await uploadFile(bob, {
					blob: new Blob([new Uint8Array(10)]),
				});

				assert.strictEqual(res.status, 200);
			} finally {
				await cleanupRole(bob.id, createdRole.id);
			}
		});

		test('uploadableFileTypes に含まれない MIME type は拒否される', async () => {
			const createdRole = await assignRole(bob.id, {
				uploadableFileTypes: {
					useDefault: false,
					priority: 1,
					value: ['image/png'],
				},
			});

			try {
				const res = await uploadFile(bob, { path: '192.jpg' });

				assert.strictEqual(res.status, 400);
				assert.ok(res.body);
				assert.strictEqual(castAsError(res.body).error.code, 'UNALLOWED_FILE_TYPE');
			} finally {
				await cleanupRole(bob.id, createdRole.id);
			}
		});

		test('maxFileSizeMb 制限付きロールでも制限内ならアップロードできる', async () => {
			const allowAllTypesRole = await assignRole(bob.id, {
				uploadableFileTypes: {
					useDefault: false,
					priority: 1,
					value: ['*/*'],
				},
			});
			const tinyAttachmentRole = await assignRole(bob.id, {
				maxFileSizeMb: {
					useDefault: false,
					priority: 1,
					value: 10 / 1024 / 1024, // 10バイト
				},
			});

			try {
				const res = await uploadFile(bob, {
					blob: new Blob([new Uint8Array(10)]),
				});

				assert.strictEqual(res.status, 200);
			} finally {
				await cleanupRole(bob.id, tinyAttachmentRole.id);
				await cleanupRole(bob.id, allowAllTypesRole.id);
			}
		});

		test('maxFileSizeMb 制限を超えると 413 になる', async () => {
			const allowAllTypesRole = await assignRole(bob.id, {
				uploadableFileTypes: {
					useDefault: false,
					priority: 1,
					value: ['*/*'],
				},
			});
			const tinyAttachmentRole = await assignRole(bob.id, {
				maxFileSizeMb: {
					useDefault: false,
					priority: 1,
					value: 10 / 1024 / 1024, // 10バイト
				},
			});

			try {
				const res = await uploadFile(bob, {
					blob: new Blob([new Uint8Array(11)]),
				});

				assert.strictEqual(res.status, 413);
				assert.ok(res.body);
				assert.strictEqual(castAsError(res.body).error.code, 'MAX_FILE_SIZE_EXCEEDED');
			} finally {
				await cleanupRole(bob.id, tinyAttachmentRole.id);
				await cleanupRole(bob.id, allowAllTypesRole.id);
			}
		});
	});

	describe('drive/files/update', () => {
		test('名前を更新できる', async () => {
			const file = (await uploadFile(alice)).body;
			const newName = 'いちごパスタ.png';

			const res = await api('drive/files/update', {
				fileId: file!.id,
				name: newName,
			}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body.name, newName);
		});

		test('他人のファイルは更新できない', async () => {
			const file = (await uploadFile(alice)).body;

			const res = await api('drive/files/update', {
				fileId: file!.id,
				name: 'いちごパスタ.png',
			}, bob);

			assert.strictEqual(res.status, 400);
		});

		test('親フォルダを更新できる', async () => {
			const file = (await uploadFile(alice)).body;
			const folder = (await api('drive/folders/create', {
				name: 'test',
			}, alice)).body;

			const res = await api('drive/files/update', {
				fileId: file!.id,
				folderId: folder.id,
			}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body.folderId, folder.id);
		});

		test('親フォルダを無しにできる', async () => {
			const file = (await uploadFile(alice)).body;

			const folder = (await api('drive/folders/create', {
				name: 'test',
			}, alice)).body;

			await api('drive/files/update', {
				fileId: file!.id,
				folderId: folder.id,
			}, alice);

			const res = await api('drive/files/update', {
				fileId: file!.id,
				folderId: null,
			}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body.folderId, null);
		});

		test('他人のフォルダには入れられない', async () => {
			const file = (await uploadFile(alice)).body;
			const folder = (await api('drive/folders/create', {
				name: 'test',
			}, bob)).body;

			const res = await api('drive/files/update', {
				fileId: file!.id,
				folderId: folder.id,
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('存在しないフォルダで怒られる', async () => {
			const file = (await uploadFile(alice)).body;

			const res = await api('drive/files/update', {
				fileId: file!.id,
				folderId: '000000000000000000000000',
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('不正なフォルダIDで怒られる', async () => {
			const file = (await uploadFile(alice)).body;

			const res = await api('drive/files/update', {
				fileId: file!.id,
				folderId: 'foo',
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('ファイルが存在しなかったら怒る', async () => {
			const res = await api('drive/files/update', {
				fileId: '000000000000000000000000',
				name: 'いちごパスタ.png',
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('不正なファイル名で怒られる', async () => {
			const file = (await uploadFile(alice)).body;
			const newName = '';

			const res = await api('drive/files/update', {
				fileId: file!.id,
				name: newName,
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('間違ったIDで怒られる', async () => {
			const res = await api('drive/files/update', {
				fileId: 'kyoppie',
				name: 'いちごパスタ.png',
			}, alice);

			assert.strictEqual(res.status, 400);
		});
	});

	describe('drive/folders/create', () => {
		test('フォルダを作成できる', async () => {
			const res = await api('drive/folders/create', {
				name: 'test',
			}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body.name, 'test');
		});
	});

	describe('drive/folders/update', () => {
		test('名前を更新できる', async () => {
			const folder = (await api('drive/folders/create', {
				name: 'test',
			}, alice)).body;

			const res = await api('drive/folders/update', {
				folderId: folder.id,
				name: 'new name',
			}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body.name, 'new name');
		});

		test('他人のフォルダを更新できない', async () => {
			const folder = (await api('drive/folders/create', {
				name: 'test',
			}, bob)).body;

			const res = await api('drive/folders/update', {
				folderId: folder.id,
				name: 'new name',
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('親フォルダを更新できる', async () => {
			const folder = (await api('drive/folders/create', {
				name: 'test',
			}, alice)).body;
			const parentFolder = (await api('drive/folders/create', {
				name: 'parent',
			}, alice)).body;

			const res = await api('drive/folders/update', {
				folderId: folder.id,
				parentId: parentFolder.id,
			}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body.parentId, parentFolder.id);
		});

		test('親フォルダを無しに更新できる', async () => {
			const folder = (await api('drive/folders/create', {
				name: 'test',
			}, alice)).body;
			const parentFolder = (await api('drive/folders/create', {
				name: 'parent',
			}, alice)).body;
			await api('drive/folders/update', {
				folderId: folder.id,
				parentId: parentFolder.id,
			}, alice);

			const res = await api('drive/folders/update', {
				folderId: folder.id,
				parentId: null,
			}, alice);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body === 'object' && !Array.isArray(res.body), true);
			assert.strictEqual(res.body.parentId, null);
		});

		test('他人のフォルダを親フォルダに設定できない', async () => {
			const folder = (await api('drive/folders/create', {
				name: 'test',
			}, alice)).body;
			const parentFolder = (await api('drive/folders/create', {
				name: 'parent',
			}, bob)).body;

			const res = await api('drive/folders/update', {
				folderId: folder.id,
				parentId: parentFolder.id,
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('フォルダが循環するような構造にできない', async () => {
			const folder = (await api('drive/folders/create', {
				name: 'test',
			}, alice)).body;
			const parentFolder = (await api('drive/folders/create', {
				name: 'parent',
			}, alice)).body;
			await api('drive/folders/update', {
				folderId: parentFolder.id,
				parentId: folder.id,
			}, alice);

			const res = await api('drive/folders/update', {
				folderId: folder.id,
				parentId: parentFolder.id,
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('フォルダが循環するような構造にできない(再帰的)', async () => {
			const folderA = (await api('drive/folders/create', {
				name: 'test',
			}, alice)).body;
			const folderB = (await api('drive/folders/create', {
				name: 'test',
			}, alice)).body;
			const folderC = (await api('drive/folders/create', {
				name: 'test',
			}, alice)).body;
			await api('drive/folders/update', {
				folderId: folderB.id,
				parentId: folderA.id,
			}, alice);
			await api('drive/folders/update', {
				folderId: folderC.id,
				parentId: folderB.id,
			}, alice);

			const res = await api('drive/folders/update', {
				folderId: folderA.id,
				parentId: folderC.id,
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('フォルダが循環するような構造にできない(自身)', async () => {
			const folderA = (await api('drive/folders/create', {
				name: 'test',
			}, alice)).body;

			const res = await api('drive/folders/update', {
				folderId: folderA.id,
				parentId: folderA.id,
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('存在しない親フォルダを設定できない', async () => {
			const folder = (await api('drive/folders/create', {
				name: 'test',
			}, alice)).body;

			const res = await api('drive/folders/update', {
				folderId: folder.id,
				parentId: '000000000000000000000000',
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('不正な親フォルダIDで怒られる', async () => {
			const folder = (await api('drive/folders/create', {
				name: 'test',
			}, alice)).body;

			const res = await api('drive/folders/update', {
				folderId: folder.id,
				parentId: 'foo',
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('存在しないフォルダを更新できない', async () => {
			const res = await api('drive/folders/update', {
				folderId: '000000000000000000000000',
			}, alice);

			assert.strictEqual(res.status, 400);
		});

		test('不正なフォルダIDで怒られる', async () => {
			const res = await api('drive/folders/update', {
				folderId: 'foo',
			}, alice);

			assert.strictEqual(res.status, 400);
		});
	});

	describe('notes/replies', () => {
		test('自分に閲覧権限のない投稿は含まれない', async () => {
			const alicePost = await post(alice, {
				text: 'foo',
			});

			await post(bob, {
				replyId: alicePost.id,
				text: 'bar',
				visibility: 'specified',
				visibleUserIds: [alice.id],
			});

			const res = await api('notes/replies', {
				noteId: alicePost.id,
			}, carol);

			assert.strictEqual(res.status, 200);
			assert.strictEqual(Array.isArray(res.body), true);
			assert.strictEqual(res.body.length, 0);
		});
	});

	describe('notes/timeline', () => {
		test('フォロワー限定投稿が含まれる', async () => {
			await api('following/create', {
				userId: carol.id,
			}, dave);

			const carolPost = await post(carol, {
				text: 'foo',
				visibility: 'followers',
			});

			await vi.waitFor(async () => {
				const res = await api('notes/timeline', {}, dave);

				assert.strictEqual(res.status, 200);
				assert.strictEqual(Array.isArray(res.body), true);
				assert.strictEqual(res.body.length, 1);
				assert.strictEqual(res.body[0].id, carolPost.id);
			}, waitForPushToTlOptions);
		});
	});

	describe('URL preview', () => {
		test('Error from summaly becomes HTTP 422', async () => {
			const res = await simpleGet('/url?url=https://e:xample.com');
			assert.strictEqual(res.status, 422);
			assert.strictEqual(res.body.error.code, 'URL_PREVIEW_FAILED');
		});
	});

	describe('パーソナルメモ機能のテスト', () => {
		test('他者に関するメモを更新できる', async () => {
			const memo = '10月まで低浮上とのこと。';

			const res1 = await api('users/update-memo', {
				memo,
				userId: bob.id,
			}, alice);

			const res2 = await api('users/show', {
				userId: bob.id,
			}, alice);
			assert.strictEqual(res1.status, 204);
			assert.strictEqual((res2.body as unknown as { memo: string })?.memo, memo);
		});

		test('自分に関するメモを更新できる', async () => {
			const memo = 'チケットを月末までに買う。';

			const res1 = await api('users/update-memo', {
				memo,
				userId: alice.id,
			}, alice);

			const res2 = await api('users/show', {
				userId: alice.id,
			}, alice);
			assert.strictEqual(res1.status, 204);
			assert.strictEqual((res2.body as unknown as { memo: string })?.memo, memo);
		});

		test('メモを削除できる', async () => {
			const memo = '10月まで低浮上とのこと。';

			await api('users/update-memo', {
				memo,
				userId: bob.id,
			}, alice);

			await api('users/update-memo', {
				memo: '',
				userId: bob.id,
			}, alice);

			const res = await api('users/show', {
				userId: bob.id,
			}, alice);

			// memoには常に文字列かnullが入っている(5cac151)
			assert.strictEqual((res.body as unknown as { memo: string | null }).memo, null);
		});

		test('メモは個人ごとに独立して保存される', async () => {
			const memoAliceToBob = '10月まで低浮上とのこと。';
			const memoCarolToBob = '例の件について今度問いただす。';

			await Promise.all([
				api('users/update-memo', {
					memo: memoAliceToBob,
					userId: bob.id,
				}, alice),
				api('users/update-memo', {
					memo: memoCarolToBob,
					userId: bob.id,
				}, carol),
			]);

			const [resAlice, resCarol] = await Promise.all([
				api('users/show', {
					userId: bob.id,
				}, alice),
				api('users/show', {
					userId: bob.id,
				}, carol),
			]);

			assert.strictEqual((resAlice.body as unknown as { memo: string }).memo, memoAliceToBob);
			assert.strictEqual((resCarol.body as unknown as { memo: string }).memo, memoCarolToBob);
		});
	});

	describe('お知らせリアクション', () => {
		let userAnnouncementId: string;

		beforeAll(async () => {
			const res = await api('admin/announcements/create', {
				title: 'user announcement',
				text: 'for bob only',
				imageUrl: null,
				userId: bob.id,
			}, alice);
			userAnnouncementId = res.body.id;
		});

		test('宛先本人でもユーザー宛てお知らせにはリアクションできない', async () => {
			const res = await api('announcements/reactions/create', {
				announcementId: userAnnouncementId,
				reaction: '❤',
			}, bob);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'REACTION_NOT_ALLOWED');
		});

		test('宛先本人でもユーザー宛てお知らせのリアクションは削除できない', async () => {
			const res = await api('announcements/reactions/delete', {
				announcementId: userAnnouncementId,
				reaction: '❤',
			}, bob);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'REACTION_NOT_ALLOWED');
		});

		test('無関係な第三者はユーザー宛てお知らせにリアクションできない', async () => {
			const res = await api('announcements/reactions/create', {
				announcementId: userAnnouncementId,
				reaction: '❤',
			}, carol);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_ANNOUNCEMENT');
		});

		test('無関係な第三者はユーザー宛てお知らせのリアクションを削除できない', async () => {
			const res = await api('announcements/reactions/delete', {
				announcementId: userAnnouncementId,
				reaction: '❤',
			}, carol);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_ANNOUNCEMENT');
		});

		test('宛先本人・無関係な第三者・未認証ユーザーいずれもユーザー宛てお知らせのリアクション一覧を取得できない', async () => {
			const byBob = await api('announcements/reactions', {
				announcementId: userAnnouncementId,
			}, bob);
			assert.strictEqual(byBob.status, 400);
			assert.strictEqual(castAsError(byBob.body as any).error.code, 'NO_SUCH_ANNOUNCEMENT');

			const byCarol = await api('announcements/reactions', {
				announcementId: userAnnouncementId,
			}, carol);
			assert.strictEqual(byCarol.status, 400);
			assert.strictEqual(castAsError(byCarol.body as any).error.code, 'NO_SUCH_ANNOUNCEMENT');

			const anonymous = await api('announcements/reactions', {
				announcementId: userAnnouncementId,
			});
			assert.strictEqual(anonymous.status, 400);
			assert.strictEqual(castAsError(anonymous.body as any).error.code, 'NO_SUCH_ANNOUNCEMENT');
		});
	});

	describe('お知らせ投票', () => {
		let userAnnouncementId: string;

		beforeAll(async () => {
			const res = await api('admin/announcements/create', {
				title: 'user announcement (poll)',
				text: 'for bob only',
				imageUrl: null,
				userId: bob.id,
			}, alice);
			userAnnouncementId = res.body.id;
		});

		test('個人宛てのお知らせには投票を追加できない', async () => {
			const res = await api('admin/announcements/create', {
				title: 'user announcement with poll',
				text: 'should be rejected',
				imageUrl: null,
				userId: bob.id,
				poll: { choices: ['A', 'B'] },
			}, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'POLL_NOT_ALLOWED');
		});

		test('宛先本人でも個人宛てお知らせには投票できない', async () => {
			const res = await api('announcements/polls/vote', {
				announcementId: userAnnouncementId,
				choice: 0,
			}, bob);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'POLL_NOT_ALLOWED');
		});

		test('無関係な第三者は個人宛てお知らせに投票できない', async () => {
			const res = await api('announcements/polls/vote', {
				announcementId: userAnnouncementId,
				choice: 0,
			}, carol);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_ANNOUNCEMENT');
		});

		test('選択肢付きの全体お知らせを作成し、投票できる', async () => {
			const created = await api('admin/announcements/create', {
				title: 'global announcement with poll',
				text: 'vote please',
				imageUrl: null,
				poll: { choices: ['A', 'B', 'C'] },
			}, alice);
			assert.strictEqual(created.status, 200);
			assert.notStrictEqual(created.body.poll, null);
			assert.deepStrictEqual(created.body.poll!.choices.map((c: { text: string }) => c.text), ['A', 'B', 'C']);

			const announcementId = created.body.id;

			const vote = await api('announcements/polls/vote', {
				announcementId,
				choice: 1,
			}, bob);
			assert.strictEqual(vote.status, 204);

			const list = await api('admin/announcements/list', {}, alice);
			const packed = list.body.find((a: { id: string }) => a.id === announcementId);
			assert.notStrictEqual(packed, undefined);
			assert.notStrictEqual(packed!.poll, null);
			assert.strictEqual(packed!.poll!.choices[1].votes, 1);
		});

		test('不正な選択肢IDには投票できない', async () => {
			const created = await api('admin/announcements/create', {
				title: 'global announcement with poll 2',
				text: 'vote please',
				imageUrl: null,
				poll: { choices: ['A', 'B'] },
			}, alice);
			const announcementId = created.body.id;

			const res = await api('announcements/polls/vote', {
				announcementId,
				choice: 5,
			}, bob);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'INVALID_CHOICE');
		});

		test('単一選択の投票に同じユーザーが二重投票できない', async () => {
			const created = await api('admin/announcements/create', {
				title: 'global announcement with poll 3',
				text: 'vote please',
				imageUrl: null,
				poll: { choices: ['A', 'B'] },
			}, alice);
			const announcementId = created.body.id;

			const first = await api('announcements/polls/vote', {
				announcementId,
				choice: 0,
			}, bob);
			assert.strictEqual(first.status, 204);

			const second = await api('announcements/polls/vote', {
				announcementId,
				choice: 1,
			}, bob);
			assert.strictEqual(second.status, 400);
			assert.strictEqual(castAsError(second.body as any).error.code, 'ALREADY_VOTED');
		});

		test('複数選択可の投票では同じユーザーが複数の選択肢に投票できる', async () => {
			const created = await api('admin/announcements/create', {
				title: 'global announcement with multiple poll',
				text: 'vote please',
				imageUrl: null,
				poll: { choices: ['A', 'B'], multiple: true },
			}, alice);
			const announcementId = created.body.id;

			const first = await api('announcements/polls/vote', {
				announcementId,
				choice: 0,
			}, bob);
			assert.strictEqual(first.status, 204);

			const second = await api('announcements/polls/vote', {
				announcementId,
				choice: 1,
			}, bob);
			assert.strictEqual(second.status, 204);
		});
	});

	describe('email-address/available (JUICE)', () => {
		test('+タグを禁止すると、既存のアカウントが無くても+を含むアドレスは使えない', async () => {
			await api('admin/juice/update-settings', { blockEmailPlusAliasRegistration: true }, alice);
			try {
				const plus = await api('email-address/available', { emailAddress: 'nobody-juice+1@example.com' }, alice);
				assert.strictEqual(plus.status, 200);
				assert.deepStrictEqual(plus.body, { available: false, reason: 'plusTag' });

				const plain = await api('email-address/available', { emailAddress: 'nobody-juice@example.com' }, alice);
				assert.strictEqual(plain.status, 200);
				assert.deepStrictEqual(plain.body, { available: true, reason: null });
			} finally {
				await api('admin/juice/update-settings', { blockEmailPlusAliasRegistration: false }, alice);
			}

			const off = await api('email-address/available', { emailAddress: 'nobody-juice+1@example.com' }, alice);
			assert.deepStrictEqual(off.body, { available: true, reason: null });
		});
	});

	describe('email-address/available (JUICE, Gmail dot)', () => {
		test('Gmailのドットを禁止すると、既存のアカウントが無くても.を含むGmailのアドレスは使えない(ほかのドメインは使える)', async () => {
			await api('admin/juice/update-settings', { blockEmailDotAliasRegistration: true }, alice);
			try {
				const gmailDot = await api('email-address/available', { emailAddress: 'no.body.juice@Gmail.com' }, alice);
				assert.deepStrictEqual(gmailDot.body, { available: false, reason: 'gmailDot' });

				const googlemailDot = await api('email-address/available', { emailAddress: 'no.body.juice@googlemail.com' }, alice);
				assert.deepStrictEqual(googlemailDot.body, { available: false, reason: 'gmailDot' });

				const gmailPlain = await api('email-address/available', { emailAddress: 'nobodyjuice@gmail.com' }, alice);
				assert.deepStrictEqual(gmailPlain.body, { available: true, reason: null });

				const otherDot = await api('email-address/available', { emailAddress: 'no.body.juice@example.com' }, alice);
				assert.deepStrictEqual(otherDot.body, { available: true, reason: null });
			} finally {
				await api('admin/juice/update-settings', { blockEmailDotAliasRegistration: false }, alice);
			}

			const off = await api('email-address/available', { emailAddress: 'no.body.juice@gmail.com' }, alice);
			assert.deepStrictEqual(off.body, { available: true, reason: null });
		});
	});

	describe('確認のリンクを開いたときのメールアドレスの確認 (JUICE)', () => {
		test('メールアドレスの変更: 受付の後に、同じアドレスがほかのアカウントで確認済みになっていたら確認済みにしない', async () => {
			const connection = await initTestDb(true);
			const profiles = connection.getRepository(MiUserProfile);
			const first = await signup();
			const second = await signup();
			const email = `dup-verify-${randomString()}@example.com`;
			const code = randomString();
			await profiles.update({ userId: first.id }, { email, emailVerified: true });
			await profiles.update({ userId: second.id }, { email, emailVerified: false, emailVerifyCode: code });

			const res = await api('verify-email', { code });
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'EMAIL_ALREADY_USED');
			assert.strictEqual((await profiles.findOneByOrFail({ userId: second.id })).emailVerified, false);
		});

		test('メールアドレスの変更: 受付の後に+タグを禁止したら確認済みにしない', async () => {
			const connection = await initTestDb(true);
			const profiles = connection.getRepository(MiUserProfile);
			const user = await signup();
			const code = randomString();
			await profiles.update({ userId: user.id }, { email: `plus-verify-${randomString()}+1@example.com`, emailVerified: false, emailVerifyCode: code });
			await api('admin/juice/update-settings', { blockEmailPlusAliasRegistration: true }, alice);
			try {
				const res = await api('verify-email', { code });
				assert.strictEqual(res.status, 400);
				assert.strictEqual(castAsError(res.body as any).error.code, 'UNAVAILABLE_EMAIL');
			} finally {
				await api('admin/juice/update-settings', { blockEmailPlusAliasRegistration: false }, alice);
			}
		});

		test('新規登録: 同じアドレスで受け付けた登録は、先に確認した方だけがアカウントになる', async () => {
			const connection = await initTestDb(true);
			const pendings = connection.getRepository(MiUserPending);
			const email = `dup-signup-${randomString()}@example.com`;
			const usernames = [randomString(), randomString()];
			await api('admin/update-meta', { emailRequiredForSignup: true }, alice);
			try {
				for (const username of usernames) {
					const res = await api('signup', { username, password: 'test', emailAddress: email });
					assert.strictEqual(res.status, 204);
				}
				const codes = await Promise.all(usernames.map(async username => (await pendings.findOneByOrFail({ username })).code));

				const first = await api('signup-pending', { code: codes[0] });
				assert.strictEqual(first.status, 200);
				const second = await api('signup-pending', { code: codes[1] });
				assert.strictEqual(second.status, 400);
				// 断った登録は残さない
				assert.strictEqual(await pendings.countBy({ username: usernames[1] }), 0);
			} finally {
				await api('admin/update-meta', { emailRequiredForSignup: false }, alice);
			}
		});

		test('新規登録: 受付の後に+タグを禁止したら、アカウントを作らない', async () => {
			const connection = await initTestDb(true);
			const pendings = connection.getRepository(MiUserPending);
			const username = randomString();
			await api('admin/update-meta', { emailRequiredForSignup: true }, alice);
			try {
				const res = await api('signup', { username, password: 'test', emailAddress: `plus-signup-${randomString()}+1@example.com` });
				assert.strictEqual(res.status, 204);
				const { code } = await pendings.findOneByOrFail({ username });
				await api('admin/juice/update-settings', { blockEmailPlusAliasRegistration: true }, alice);
				try {
					const confirmed = await api('signup-pending', { code });
					assert.strictEqual(confirmed.status, 400);
					assert.match(JSON.stringify(confirmed.body), /UNAVAILABLE_EMAIL/);
					assert.strictEqual(await pendings.countBy({ username }), 0);
				} finally {
					await api('admin/juice/update-settings', { blockEmailPlusAliasRegistration: false }, alice);
				}
			} finally {
				await api('admin/update-meta', { emailRequiredForSignup: false }, alice);
			}
		});
	});

	describe('admin/juice', () => {
		test('管理者は設定を取得できる', async () => {
			const res = await api('admin/juice/settings', {}, alice);
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.body, {
				approvalRequiredForSignup: false,
				signupReasonRequired: true,
				signupReasonMaxLength: 4096,
				invitationRegistrationEnabled: true,
				exploreOtherServersEnabled: true,
				defaultEmailLang: 'ja-JP',
				emojiRequestEnabled: false,
				emojiRequestRequireCategory: false,
				emojiRequestRequireTags: false,
				emojiRequestRequireLicense: false,
				avatarDecorationRequestEnabled: false,
				avatarDecorationRequestRequireCategory: false,
				avatarDecorationRequestRequireDescription: false,
				remoteAvatarDecorationsEnabled: true,
				rankingAggregationPeriodHours: 12,
				rankingDisplayCount: 3,
				relayTimelineEnabled: false,
				mediaTimelineEnabled: false,
				latexEnabled: true,
				reactionPiggybackOnRemoteEnabled: false,
				contactFormEnabled: true,
				contactFormLimit: 3,
				contactFormRequireAuth: false,
				contactFormContentMaxLength: 10000,
				contactFormCategories: [
					{ key: 'general', text: '一般', enabled: true, order: 1, isDefault: true },
					{ key: 'bug_report', text: 'バグ報告', enabled: true, order: 2, isDefault: false },
					{ key: 'feature_request', text: '機能要望', enabled: true, order: 3, isDefault: false },
					{ key: 'account_issue', text: 'アカウント関連', enabled: true, order: 4, isDefault: false },
					{ key: 'technical_issue', text: '技術的な問題', enabled: true, order: 5, isDefault: false },
					{ key: 'content_issue', text: 'コンテンツ関連', enabled: true, order: 6, isDefault: false },
					{ key: 'other', text: 'その他', enabled: true, order: 7, isDefault: false },
				],
				customSplashText: [],
				newAccountFollowRequestEnabled: false,
				newAccountFollowRequestThresholdMs: 24 * 60 * 60 * 1000,
				importApprovalRequiredTypes: ['following'],
				reportCategories: [
					{ key: 'spam', text: 'スパム', enabled: true, order: 1, isDefault: false },
					{ key: 'harassment', text: '嫌がらせ・迷惑行為', enabled: true, order: 2, isDefault: false },
					{ key: 'inappropriate_content', text: '不適切なコンテンツ', enabled: true, order: 3, isDefault: false },
					{ key: 'impersonation', text: 'なりすまし', enabled: true, order: 4, isDefault: false },
					{ key: 'copyright', text: '著作権侵害', enabled: true, order: 5, isDefault: false },
					{ key: 'personal_info', text: '個人情報の晒し', enabled: true, order: 6, isDefault: false },
					{ key: 'other', text: 'その他', enabled: true, order: 7, isDefault: true },
				],
				blockEmailDotAliasRegistration: false,
				blockEmailPlusAliasRegistration: false,
				disposableEmailBlocklistEnabled: false,
				disposableEmailAllowDomains: [],
				disposableEmailBlocklistCount: 0,
				disposableEmailBlocklistFetchedAt: null,
				aiGeneratedFallbackCwEnabled: false,
				novelFallbackCwEnabled: false,
				discordOauthEnabled: false,
				discordOauthClientId: null,
				discordOauthClientSecret: null,
				googleOauthEnabled: false,
				googleOauthClientId: null,
				googleOauthClientSecret: null,
				githubOauthEnabled: false,
				githubOauthClientId: null,
				githubOauthClientSecret: null,
				gitlabOauthEnabled: false,
				gitlabOauthClientId: null,
				gitlabOauthClientSecret: null,
				microsoftOauthEnabled: false,
				microsoftOauthClientId: null,
				microsoftOauthClientSecret: null,
				midiPlayerMaxSize: 500 * 1024,
				drawRoomEnabled: true,
				drawRoomMaxRoomMegabytes: 256,
			});
		});

		test('管理者は設定を更新でき、値が往復する', async () => {
			const res = await api('admin/juice/update-settings', {
				signupReasonMaxLength: 1000,
				defaultEmailLang: 'en-US',
				rankingAggregationPeriodHours: 6,
				midiPlayerMaxSize: 1024 * 1024,
			}, alice);
			assert.strictEqual(res.status, 204);

			const after = await api('admin/juice/settings', {}, alice);
			assert.strictEqual(after.status, 200);
			assert.strictEqual(after.body.signupReasonMaxLength, 1000);
			assert.strictEqual(after.body.defaultEmailLang, 'en-US');
			assert.strictEqual(after.body.rankingAggregationPeriodHours, 6);
			assert.strictEqual(after.body.midiPlayerMaxSize, 1024 * 1024);

			// 他のテストに影響しないよう元に戻す
			const reset = await api('admin/juice/update-settings', {
				approvalRequiredForSignup: false,
				signupReasonRequired: true,
				signupReasonMaxLength: 4096,
				defaultEmailLang: 'ja-JP',
				rankingAggregationPeriodHours: 12,
				midiPlayerMaxSize: 500 * 1024,
			}, alice);
			assert.strictEqual(reset.status, 204);
		});

		test('MIDIプレイヤーの最大サイズはしきい値の範囲外だと更新を拒否する', async () => {
			const tooSmall = await api('admin/juice/update-settings', { midiPlayerMaxSize: 1023 }, alice);
			assert.strictEqual(tooSmall.status, 400);

			const tooLarge = await api('admin/juice/update-settings', { midiPlayerMaxSize: 50 * 1024 * 1024 + 1 }, alice);
			assert.strictEqual(tooLarge.status, 400);
		});

		test('管理者以外は設定を取得できない', async () => {
			const res = await api('admin/juice/settings', {}, bob);
			assert.strictEqual(res.status, 403);
		});

		test('管理者以外は設定を更新できない', async () => {
			const res = await api('admin/juice/update-settings', {}, bob);
			assert.strictEqual(res.status, 403);
		});

		test('未認証では設定を取得できない', async () => {
			const res = await api('admin/juice/settings', {});
			assert.strictEqual(res.status, 401);
		});

		test('未認証では設定を更新できない', async () => {
			const res = await api('admin/juice/update-settings', {});
			assert.strictEqual(res.status, 401);
		});
	});

	// JUICE: ロールベースの承認権限委譲(canApproveEmojiRequests)のe2eテスト。
	// emoji-requests機能自体の網羅的なテストは既存の対象外(既存のカバレッジ無し)のため、
	// ここでは新規追加した「モデレーターでなくても、ロールで承認権限を付与できる」経路のみ検証する。
	describe('emoji-requests (role-based approval)', () => {
		beforeAll(async () => {
			await api('admin/juice/update-settings', { emojiRequestEnabled: true }, alice);
		});

		afterAll(async () => {
			await api('admin/juice/update-settings', { emojiRequestEnabled: false }, alice);
		});

		test('モデレーターでなくても、ロールで権限を付与されていれば一覧取得・却下ができる', async () => {
			const approver = await signup({ username: 'emojiRequestApprover' });
			const approverRole = await role(alice, { isModerator: false, name: 'Emoji Request Approver Role' }, {
				canApproveEmojiRequests: { priority: 0, useDefault: false, value: true },
			});
			await api('admin/roles/assign', { userId: approver.id, roleId: approverRole.id }, alice);

			const file = await uploadFile(bob);
			const created = await api('emoji-requests/create', {
				fileId: file.body!.id,
				name: 'role_approver_emoji',
			}, bob);
			assert.strictEqual(created.status, 200);

			const list = await api('admin/emoji-requests/list', { state: 'pending' }, approver);
			assert.strictEqual(list.status, 200);
			assert.notStrictEqual((list.body as any[]).find((r: any) => r.id === created.body.id), undefined);

			const reject = await api('admin/emoji-requests/reject', {
				requestId: created.body.id,
				reason: 'role-based approver',
			}, approver);
			assert.strictEqual(reject.status, 204);

			// JUICE: 却下したユーザー(モデレーターでない権限付与ユーザー)がreviewerとして記録されることを確認
			const rejectedList = await api('admin/emoji-requests/list', { state: 'rejected' }, approver);
			assert.strictEqual(rejectedList.status, 200);
			const rejected = (rejectedList.body as any[]).find((r: any) => r.id === created.body.id);
			assert.notStrictEqual(rejected, undefined);
			assert.strictEqual(rejected.reviewer.id, approver.id);
		});
	});

	// JUICE: 同一画面から複数件をまとめて申請できるemoji-requests/create-manyのe2eテスト
	describe('emoji-requests/create-many', () => {
		beforeAll(async () => {
			await api('admin/juice/update-settings', { emojiRequestEnabled: true }, alice);
		});

		afterAll(async () => {
			await api('admin/juice/update-settings', { emojiRequestEnabled: false }, alice);
		});

		test('複数件をまとめて作成できる', async () => {
			const file1 = await uploadFile(bob);
			const file2 = await uploadFile(bob);
			const created = await api('emoji-requests/create-many', {
				requests: [
					{ fileId: file1.body!.id, name: 'batch_emoji_one' },
					{ fileId: file2.body!.id, name: 'batch_emoji_two' },
				],
			}, bob);
			assert.strictEqual(created.status, 200);
			assert.strictEqual((created.body as any[]).length, 2);
			assert.strictEqual((created.body as any[])[0].name, 'batch_emoji_one');
			assert.strictEqual((created.body as any[])[1].name, 'batch_emoji_two');

			const list = await api('admin/emoji-requests/list', { state: 'pending' }, alice);
			assert.strictEqual(list.status, 200);
			for (const item of created.body as any[]) {
				assert.notStrictEqual((list.body as any[]).find((r: any) => r.id === item.id), undefined);
				await api('admin/emoji-requests/reject', { requestId: item.id, reason: 'cleanup' }, alice);
			}
		});

		test('1件でも無効なファイルがあれば全体が拒否され、有効な方も作成されない', async () => {
			const file1 = await uploadFile(bob);

			const created = await api('emoji-requests/create-many', {
				requests: [
					{ fileId: file1.body!.id, name: 'batch_valid_notcreated' },
					{ fileId: '000000000000000000000000', name: 'batch_invalid_notcreated' },
				],
			}, bob);
			assert.strictEqual(created.status, 400);
			assert.strictEqual(castAsError(created.body as any).error.code, 'NO_SUCH_FILE');

			const after = await api('emoji-requests/list', { limit: 100 }, bob);
			assert.strictEqual((after.body as any[]).some((r: any) => r.name === 'batch_valid_notcreated'), false);
		});

		test('申請数の上限を超えるバッチは全体が拒否される', async () => {
			// JUICE: emojiRequestLimitの既定値は3。既にpending中の申請が無い前提で、
			// 上限を超える4件を一度に送って拒否されることを確認する
			const files = await Promise.all([1, 2, 3, 4].map(() => uploadFile(bob)));
			const created = await api('emoji-requests/create-many', {
				requests: files.map((f, i) => ({ fileId: f.body!.id, name: `batch_over_limit_${i}` })),
			}, bob);
			assert.strictEqual(created.status, 400);
			assert.strictEqual(castAsError(created.body as any).error.code, 'TOO_MANY_PENDING_REQUESTS');

			const after = await api('emoji-requests/list', { limit: 100 }, bob);
			assert.strictEqual((after.body as any[]).some((r: any) => r.name.startsWith('batch_over_limit_')), false);
		});
	});

	// JUICE: 絵文字申請と同じ仕組みで実装したアバターデコレーション申請機能のe2eテスト
	describe('avatar-decoration-requests', () => {
		beforeAll(async () => {
			await api('admin/juice/update-settings', { avatarDecorationRequestEnabled: true }, alice);
		});

		afterAll(async () => {
			await api('admin/juice/update-settings', { avatarDecorationRequestEnabled: false }, alice);
		});

		test('機能が無効な場合は申請できない', async () => {
			await api('admin/juice/update-settings', { avatarDecorationRequestEnabled: false }, alice);
			const file = await uploadFile(bob);
			const res = await api('avatar-decoration-requests/create', {
				fileId: file.body!.id,
				name: 'disabled_deco',
			}, bob);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'FUNCTION_DISABLED');
			await api('admin/juice/update-settings', { avatarDecorationRequestEnabled: true }, alice);
		});

		test('一般ユーザーが申請を作成できる', async () => {
			const file = await uploadFile(bob);
			const res = await api('avatar-decoration-requests/create', {
				fileId: file.body!.id,
				name: 'sparkle_crown',
				description: 'きらきらクラウン',
				category: 'fun',
			}, bob);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.status, 'pending');
			assert.strictEqual(res.body.name, 'sparkle_crown');
			assert.strictEqual(res.body.description, 'きらきらクラウン');
			assert.strictEqual(res.body.category, 'fun');
		});

		test('モデレータは承認待ち一覧で申請を確認できる', async () => {
			const file = await uploadFile(bob);
			const created = await api('avatar-decoration-requests/create', {
				fileId: file.body!.id,
				name: 'listed_deco',
			}, bob);
			assert.strictEqual(created.status, 200);

			const list = await api('admin/avatar-decoration-requests/list', { state: 'pending' }, alice);
			assert.strictEqual(list.status, 200);
			const found = (list.body as any[]).find((r: any) => r.id === created.body.id);
			assert.notStrictEqual(found, undefined);
			assert.strictEqual(found!.user.username, 'bob');

			// 以降のテストがavatarDecorationRequestLimit(既定3件)に引っかからないよう却下して片付ける
			await api('admin/avatar-decoration-requests/reject', { requestId: created.body.id, reason: 'cleanup' }, alice);
		});

		// NOTE: 承認時のファイル複製(システム所有コピー)はconfig.url(この環境ではmisskey.local)への
		// 実ネットワークfetchを伴うため、テスト環境では実際に到達できずFILE_COPY_FAILEDになる
		// (misskey.localはCI/devcontainerどちらも名前解決されない)。ここでは複製の成否そのものではなく、
		// 複製に失敗した場合に申請がapproved状態へ中途半端に遷移しない(pendingのまま・
		// resultAvatarDecorationIdがnullのまま)ことを確認する。複製自体が成功するケースは、
		// 実サーバーへの手動確認(curl)で別途確認済み。
		test('複製に失敗した場合、申請はpendingのまま残る', async () => {
			const file = await uploadFile(bob);
			const created = await api('avatar-decoration-requests/create', {
				fileId: file.body!.id,
				name: 'approved_deco',
			}, bob);
			assert.strictEqual(created.status, 200);

			const approve = await api('admin/avatar-decoration-requests/approve', { requestId: created.body.id }, alice);
			assert.strictEqual(approve.status, 400);
			assert.strictEqual(castAsError(approve.body as any).error.code, 'FILE_COPY_FAILED');

			const list = await api('avatar-decoration-requests/list', {}, bob);
			const reviewed = (list.body as any[]).find((r: any) => r.id === created.body.id);
			assert.notStrictEqual(reviewed, undefined);
			assert.strictEqual(reviewed!.status, 'pending');
			assert.strictEqual(reviewed!.resultAvatarDecorationId, null);

			// 以降のテストがavatarDecorationRequestLimit(既定3件)に引っかからないよう却下して片付ける
			await api('admin/avatar-decoration-requests/reject', { requestId: created.body.id, reason: 'cleanup' }, alice);
		});

		test('モデレータが却下すると理由が保存される', async () => {
			const file = await uploadFile(bob);
			const created = await api('avatar-decoration-requests/create', {
				fileId: file.body!.id,
				name: 'rejected_deco',
			}, bob);
			assert.strictEqual(created.status, 200);

			const reject = await api('admin/avatar-decoration-requests/reject', {
				requestId: created.body.id,
				reason: '不適切な画像のため',
			}, alice);
			assert.strictEqual(reject.status, 204);

			const list = await api('avatar-decoration-requests/list', {}, bob);
			const reviewed = (list.body as any[]).find((r: any) => r.id === created.body.id);
			assert.notStrictEqual(reviewed, undefined);
			assert.strictEqual(reviewed!.status, 'rejected');
			assert.strictEqual(reviewed!.rejectReason, '不適切な画像のため');
			// JUICE: reviewer(審査したモデレーター)は通報のassigneeと同様、申請者自身には公開しない
			assert.strictEqual((reviewed as any).reviewer, undefined);

			// JUICE: reviewerは管理画面向けの一覧でのみ公開される
			const adminList = await api('admin/avatar-decoration-requests/list', { state: 'rejected' }, alice);
			assert.strictEqual(adminList.status, 200);
			const adminReviewed = (adminList.body as any[]).find((r: any) => r.id === created.body.id);
			assert.notStrictEqual(adminReviewed, undefined);
			assert.strictEqual(adminReviewed.reviewer.id, alice.id);
		});

		test('一般ユーザーは管理者用エンドポイントを使えない', async () => {
			const list = await api('admin/avatar-decoration-requests/list', {}, bob);
			assert.strictEqual(list.status, 403);
			// JUICE: フロントエンドがROLE_PERMISSION_DENIEDを見て専用の権限不足ダイアログを出すため、
			// このコードで返ることを保証しておく(requireModerator由来の他の403と同じコード)
			assert.strictEqual(castAsError(list.body as any).error.code, 'ROLE_PERMISSION_DENIED');

			const approve = await api('admin/avatar-decoration-requests/approve', { requestId: '000000000000000000000000' }, bob);
			assert.strictEqual(approve.status, 403);
			assert.strictEqual(castAsError(approve.body as any).error.code, 'ROLE_PERMISSION_DENIED');

			const reject = await api('admin/avatar-decoration-requests/reject', { requestId: '000000000000000000000000', reason: 'x' }, bob);
			assert.strictEqual(reject.status, 403);
			assert.strictEqual(castAsError(reject.body as any).error.code, 'ROLE_PERMISSION_DENIED');
		});

		// JUICE: モデレーターでなくても、ロールでcanApproveAvatarDecorationRequestsが付与されていれば承認・却下できる
		test('モデレーターでなくても、ロールで権限を付与されていれば一覧取得・却下ができる', async () => {
			const approver = await signup({ username: 'decoApprover' });
			const approverRole = await role(alice, { isModerator: false, name: 'Avatar Decoration Approver Role' }, {
				canApproveAvatarDecorationRequests: { priority: 0, useDefault: false, value: true },
			});
			await api('admin/roles/assign', { userId: approver.id, roleId: approverRole.id }, alice);

			const file = await uploadFile(bob);
			const created = await api('avatar-decoration-requests/create', {
				fileId: file.body!.id,
				name: 'role_approver_deco',
			}, bob);
			assert.strictEqual(created.status, 200);

			const list = await api('admin/avatar-decoration-requests/list', { state: 'pending' }, approver);
			assert.strictEqual(list.status, 200);
			assert.notStrictEqual((list.body as any[]).find((r: any) => r.id === created.body.id), undefined);

			const reject = await api('admin/avatar-decoration-requests/reject', {
				requestId: created.body.id,
				reason: 'role-based approver',
			}, approver);
			assert.strictEqual(reject.status, 204);
		});
	});

	// JUICE: 同一画面から複数件をまとめて申請できるavatar-decoration-requests/create-manyのe2eテスト
	describe('avatar-decoration-requests/create-many', () => {
		beforeAll(async () => {
			await api('admin/juice/update-settings', { avatarDecorationRequestEnabled: true }, alice);
		});

		afterAll(async () => {
			await api('admin/juice/update-settings', { avatarDecorationRequestEnabled: false }, alice);
		});

		test('複数件をまとめて作成できる', async () => {
			const file1 = await uploadFile(bob);
			const file2 = await uploadFile(bob);
			const created = await api('avatar-decoration-requests/create-many', {
				requests: [
					{ fileId: file1.body!.id, name: 'batch_deco_one' },
					{ fileId: file2.body!.id, name: 'batch_deco_two' },
				],
			}, bob);
			assert.strictEqual(created.status, 200);
			assert.strictEqual((created.body as any[]).length, 2);
			assert.strictEqual((created.body as any[])[0].name, 'batch_deco_one');
			assert.strictEqual((created.body as any[])[1].name, 'batch_deco_two');

			const list = await api('admin/avatar-decoration-requests/list', { state: 'pending' }, alice);
			assert.strictEqual(list.status, 200);
			for (const item of created.body as any[]) {
				assert.notStrictEqual((list.body as any[]).find((r: any) => r.id === item.id), undefined);
				await api('admin/avatar-decoration-requests/reject', { requestId: item.id, reason: 'cleanup' }, alice);
			}
		});

		test('1件でも無効なファイルがあれば全体が拒否され、有効な方も作成されない', async () => {
			const file1 = await uploadFile(bob);

			const created = await api('avatar-decoration-requests/create-many', {
				requests: [
					{ fileId: file1.body!.id, name: 'batch_deco_valid_notcreated' },
					{ fileId: '000000000000000000000000', name: 'batch_deco_invalid_notcreated' },
				],
			}, bob);
			assert.strictEqual(created.status, 400);
			assert.strictEqual(castAsError(created.body as any).error.code, 'NO_SUCH_FILE');

			const after = await api('avatar-decoration-requests/list', { limit: 100 }, bob);
			assert.strictEqual((after.body as any[]).some((r: any) => r.name === 'batch_deco_valid_notcreated'), false);
		});

		test('申請数の上限を超えるバッチは全体が拒否される', async () => {
			// JUICE: avatarDecorationRequestLimitの既定値は3。既にpending中の申請が無い前提で、
			// 上限を超える4件を一度に送って拒否されることを確認する
			const files = await Promise.all([1, 2, 3, 4].map(() => uploadFile(bob)));
			const created = await api('avatar-decoration-requests/create-many', {
				requests: files.map((f, i) => ({ fileId: f.body!.id, name: `batch_deco_over_limit_${i}` })),
			}, bob);
			assert.strictEqual(created.status, 400);
			assert.strictEqual(castAsError(created.body as any).error.code, 'TOO_MANY_PENDING_REQUESTS');

			const after = await api('avatar-decoration-requests/list', { limit: 100 }, bob);
			assert.strictEqual((after.body as any[]).some((r: any) => r.name.startsWith('batch_deco_over_limit_')), false);
		});
	});

	describe('juice/ranking', () => {
		test('未認証でもランキングを取得でき、形が仕様通り', async () => {
			const res = await api('juice/ranking', {});
			assert.strictEqual(res.status, 200);
			assert.strictEqual(typeof res.body.periodHours, 'number');
			assert.strictEqual(Array.isArray(res.body.posts), true);
			assert.strictEqual(Array.isArray(res.body.reactions), true);
		});

		test('集計期間の設定変更がperiodHoursへ反映される', async () => {
			const update = await api('admin/juice/update-settings', {
				rankingAggregationPeriodHours: 3,
			}, alice);
			assert.strictEqual(update.status, 204);

			const res = await api('juice/ranking', {});
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.periodHours, 3);

			// 他のテストに影響しないよう元に戻す
			const reset = await api('admin/juice/update-settings', {
				rankingAggregationPeriodHours: 12,
			}, alice);
			assert.strictEqual(reset.status, 204);
		});
	});

	describe('notes/relay-timeline (JUICE)', () => {
		test('機能が無効な間はfunctionDisabledで弾かれる', async () => {
			const res = await api('notes/relay-timeline', {});
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'FUNCTION_DISABLED');
		});

		test('relayIdが付いた公開ノートのみを返す', async () => {
			const enable = await api('admin/juice/update-settings', {
				relayTimelineEnabled: true,
			}, alice);
			assert.strictEqual(enable.status, 204);

			const connection = await initTestDb(true);
			const Notes = connection.getRepository(MiNote);
			const Relays = connection.getRepository(MiRelay);

			// 投稿を先に作ってから relay 行を追加する(先にstatus:'accepted'のrelayを作ると、
			// notes/create のたびに実配送(RelayService.deliverToRelays)が走ってしまうため)
			const relayNote = (await api('notes/create', { text: 'via relay (JUICE test)' }, alice)).body.createdNote;
			const normalNote = (await api('notes/create', { text: 'not via relay (JUICE test)' }, alice)).body.createdNote;

			const relay = await Relays.save(Relays.create({
				id: randomString(),
				inbox: `https://relay.example.com/${randomString()}/inbox`,
				status: 'accepted',
			}));
			await Notes.update({ id: relayNote.id }, { relayId: relay.id });

			const res = await api('notes/relay-timeline', {});
			assert.strictEqual(res.status, 200);
			const ids = (res.body as misskey.entities.Note[]).map(n => n.id);
			assert.strictEqual(ids.includes(relayNote.id), true);
			assert.strictEqual(ids.includes(normalNote.id), false);

			const found = (res.body as misskey.entities.Note[]).find(n => n.id === relayNote.id);
			assert.strictEqual((found as any).relayId, relay.id);

			// 他のテストに影響しないよう元に戻す(リレー行の削除でON DELETE SET NULLによりnote側のrelayIdも自動でnullになる)
			await Relays.delete({ id: relay.id });
			const reset = await api('admin/juice/update-settings', {
				relayTimelineEnabled: false,
			}, alice);
			assert.strictEqual(reset.status, 204);
		});

		test('relayIdsパラメータを指定すると、該当する複数リレー経由のノートのみに絞り込める', async () => {
			const enable = await api('admin/juice/update-settings', {
				relayTimelineEnabled: true,
			}, alice);
			assert.strictEqual(enable.status, 204);

			const connection = await initTestDb(true);
			const Notes = connection.getRepository(MiNote);
			const Relays = connection.getRepository(MiRelay);

			const noteA = (await api('notes/create', { text: 'via relay A (JUICE test)' }, alice)).body.createdNote;
			const noteB = (await api('notes/create', { text: 'via relay B (JUICE test)' }, alice)).body.createdNote;
			const noteC = (await api('notes/create', { text: 'via relay C (JUICE test)' }, alice)).body.createdNote;

			const relayA = await Relays.save(Relays.create({
				id: randomString(),
				inbox: `https://relay-a.example.com/${randomString()}/inbox`,
				status: 'accepted',
			}));
			const relayB = await Relays.save(Relays.create({
				id: randomString(),
				inbox: `https://relay-b.example.com/${randomString()}/inbox`,
				status: 'accepted',
			}));
			const relayC = await Relays.save(Relays.create({
				id: randomString(),
				inbox: `https://relay-c.example.com/${randomString()}/inbox`,
				status: 'accepted',
			}));
			await Notes.update({ id: noteA.id }, { relayId: relayA.id });
			await Notes.update({ id: noteB.id }, { relayId: relayB.id });
			await Notes.update({ id: noteC.id }, { relayId: relayC.id });

			// 複数(2件)を選択した場合は、その両方が含まれ、選択していないものは除外される
			const res = await api('notes/relay-timeline', { relayIds: [relayA.id, relayB.id] });
			assert.strictEqual(res.status, 200);
			const ids = (res.body as misskey.entities.Note[]).map(n => n.id);
			assert.strictEqual(ids.includes(noteA.id), true);
			assert.strictEqual(ids.includes(noteB.id), true);
			assert.strictEqual(ids.includes(noteC.id), false);

			// 他のテストに影響しないよう元に戻す
			await Relays.delete({ id: relayA.id });
			await Relays.delete({ id: relayB.id });
			await Relays.delete({ id: relayC.id });
			const reset = await api('admin/juice/update-settings', {
				relayTimelineEnabled: false,
			}, alice);
			assert.strictEqual(reset.status, 204);
		});

		// JUICE: filteredLanguages(言語フィルタ)。リージョン無しの言語タグ(Mastodon/Pleroma/Akkoma等)
		// との互換のため、主言語サブタグ単位で突き合わせる(完全一致ではない)
		test('言語フィルタが適用され、リージョン無しの言語タグもリージョン付きのフィルタ設定に一致する', async () => {
			const enable = await api('admin/juice/update-settings', {
				relayTimelineEnabled: true,
			}, alice);
			assert.strictEqual(enable.status, 204);

			const connection = await initTestDb(true);
			const Notes = connection.getRepository(MiNote);
			const Relays = connection.getRepository(MiRelay);

			const noteEnBare = (await api('notes/create', { text: 'hi (region-less, JUICE test)', lang: 'en' }, alice)).body.createdNote;
			const noteFr = (await api('notes/create', { text: 'bonjour (JUICE test)', lang: 'fr' }, alice)).body.createdNote;

			const relay = await Relays.save(Relays.create({
				id: randomString(),
				inbox: `https://relay.example.com/${randomString()}/inbox`,
				status: 'accepted',
			}));
			await Notes.update({ id: noteEnBare.id }, { relayId: relay.id });
			await Notes.update({ id: noteFr.id }, { relayId: relay.id });

			await api('i/update', { filteredLanguages: ['en-US'] }, alice);

			const res = await api('notes/relay-timeline', {}, alice);
			assert.strictEqual(res.status, 200);
			const ids = (res.body as misskey.entities.Note[]).map(n => n.id);
			assert.strictEqual(ids.includes(noteEnBare.id), true);
			assert.strictEqual(ids.includes(noteFr.id), false);

			// 他のテストに影響しないよう元に戻す
			await api('i/update', { filteredLanguages: [] }, alice);
			await Relays.delete({ id: relay.id });
			const reset = await api('admin/juice/update-settings', {
				relayTimelineEnabled: false,
			}, alice);
			assert.strictEqual(reset.status, 204);
		});
	});

	describe('juice/relays', () => {
		test('機能が無効な間はfunctionDisabledで弾かれる', async () => {
			const res = await api('juice/relays', {});
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'FUNCTION_DISABLED');
		});

		test('status:accepted のリレーのみを{id,host}で返す', async () => {
			const enable = await api('admin/juice/update-settings', {
				relayTimelineEnabled: true,
			}, alice);
			assert.strictEqual(enable.status, 204);

			const connection = await initTestDb(true);
			const Relays = connection.getRepository(MiRelay);

			const accepted = await Relays.save(Relays.create({
				id: randomString(),
				inbox: `https://relay-accepted.example.com/${randomString()}/inbox`,
				status: 'accepted',
			}));
			const requesting = await Relays.save(Relays.create({
				id: randomString(),
				inbox: `https://relay-requesting.example.com/${randomString()}/inbox`,
				status: 'requesting',
			}));

			const res = await api('juice/relays', {});
			assert.strictEqual(res.status, 200);
			const ids = (res.body as { id: string, host: string }[]).map(r => r.id);
			assert.strictEqual(ids.includes(accepted.id), true);
			assert.strictEqual(ids.includes(requesting.id), false);

			const found = (res.body as { id: string, host: string }[]).find(r => r.id === accepted.id);
			assert.strictEqual(found?.host, 'relay-accepted.example.com');

			// 他のテストに影響しないよう元に戻す
			await Relays.delete({ id: accepted.id });
			await Relays.delete({ id: requesting.id });
			const reset = await api('admin/juice/update-settings', {
				relayTimelineEnabled: false,
			}, alice);
			assert.strictEqual(reset.status, 204);
		});
	});

	describe('i/juice/update-email-lang', () => {
		afterAll(async () => {
			// 他のテストに影響しないよう元に戻す
			const reset = await api('i/juice/update-email-lang', { emailLang: null }, alice);
			assert.strictEqual(reset.status, 204);
		});

		test('メールの言語を変更でき、値が i に反映される', async () => {
			const res = await api('i/juice/update-email-lang', { emailLang: 'en-US' }, alice);
			assert.strictEqual(res.status, 204);

			const i = await api('i', {}, alice);
			assert.strictEqual(i.status, 200);
			assert.strictEqual(i.body.emailLang, 'en-US');
		});

		test('null を指定すると未設定に戻せる', async () => {
			const set = await api('i/juice/update-email-lang', { emailLang: 'ja-JP' }, alice);
			assert.strictEqual(set.status, 204);

			const res = await api('i/juice/update-email-lang', { emailLang: null }, alice);
			assert.strictEqual(res.status, 204);

			const i = await api('i', {}, alice);
			assert.strictEqual(i.status, 200);
			assert.strictEqual(i.body.emailLang, null);
		});

		test('サポート対象外の言語コードは拒否される', async () => {
			const res = await api('i/juice/update-email-lang', { emailLang: 'xx-XX' } as any, alice);
			assert.strictEqual(res.status, 400);
		});

		test('未認証では変更できない', async () => {
			const res = await api('i/juice/update-email-lang', { emailLang: 'en-US' });
			assert.strictEqual(res.status, 401);
		});
	});

	describe('i/juice/update-mute-ai-generated', () => {
		afterAll(async () => {
			// 他のテストに影響しないよう元に戻す
			const reset = await api('i/juice/update-mute-ai-generated', { muteAIGeneratedNotes: 'none' }, alice);
			assert.strictEqual(reset.status, 204);
		});

		test('AI生成物ミュート設定(mute)を変更でき、値が i に反映される', async () => {
			const res = await api('i/juice/update-mute-ai-generated', { muteAIGeneratedNotes: 'mute' }, alice);
			assert.strictEqual(res.status, 204);

			const i = await api('i', {}, alice);
			assert.strictEqual(i.status, 200);
			assert.strictEqual(i.body.muteAIGeneratedNotes, 'mute');
		});

		test('AI生成物ミュート設定(hardMute)を変更でき、値が i に反映される', async () => {
			const res = await api('i/juice/update-mute-ai-generated', { muteAIGeneratedNotes: 'hardMute' }, alice);
			assert.strictEqual(res.status, 204);

			const i = await api('i', {}, alice);
			assert.strictEqual(i.status, 200);
			assert.strictEqual(i.body.muteAIGeneratedNotes, 'hardMute');
		});

		test('不正な値は拒否される', async () => {
			const res = await api('i/juice/update-mute-ai-generated', { muteAIGeneratedNotes: 'invalid' } as any, alice);
			assert.strictEqual(res.status, 400);
		});

		test('未認証では変更できない', async () => {
			const res = await api('i/juice/update-mute-ai-generated', { muteAIGeneratedNotes: 'mute' });
			assert.strictEqual(res.status, 401);
		});
	});

	describe('notes/juice/update-ai-generated', () => {
		test('自分のノートのAI生成物フラグを変更できる', async () => {
			const note = await post(alice, { text: 'test' });
			assert.strictEqual(note.isAIGenerated, false);

			const res = await api('notes/juice/update-ai-generated', { noteId: note.id, isAIGenerated: true }, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.isAIGenerated, true);

			const show = await api('notes/show', { noteId: note.id }, alice);
			assert.strictEqual(show.status, 200);
			assert.strictEqual(show.body.isAIGenerated, true);
		});

		test('他人のノートは変更できない', async () => {
			const note = await post(alice, { text: 'test' });

			const res = await api('notes/juice/update-ai-generated', { noteId: note.id, isAIGenerated: true }, bob);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body).error.code, 'ACCESS_DENIED');
		});

		test('モデレーターでも他人のノートは変更できない(モデレーション操作ではないため)', async () => {
			const moderator = await signup({ username: 'aiFlagModerator' });
			const moderatorRole = await role(alice, { isModerator: true, name: 'AI Flag Test Moderator Role' });
			await api('admin/roles/assign', { userId: moderator.id, roleId: moderatorRole.id }, alice);

			const note = await post(alice, { text: 'test' });

			const res = await api('notes/juice/update-ai-generated', { noteId: note.id, isAIGenerated: true }, moderator);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body).error.code, 'ACCESS_DENIED');
		});

		test('存在しないノートは失敗する', async () => {
			const res = await api('notes/juice/update-ai-generated', { noteId: '000000000000000000000000', isAIGenerated: true }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body).error.code, 'NO_SUCH_NOTE');
		});

		test('未認証では変更できない', async () => {
			const note = await post(alice, { text: 'test' });
			const res = await api('notes/juice/update-ai-generated', { noteId: note.id, isAIGenerated: true });
			assert.strictEqual(res.status, 401);
		});
	});

	describe('AI生成物フラグ (notes/create)', () => {
		test('isAIGenerated を指定して投稿できる', async () => {
			const note = await post(alice, { text: 'test', isAIGenerated: true });
			assert.strictEqual(note.isAIGenerated, true);
		});

		test('未指定の場合は false になる', async () => {
			const note = await post(alice, { text: 'test' });
			assert.strictEqual(note.isAIGenerated, false);
		});

		test('リノートには isAIGenerated が伝播しない(元ノートの値は renote 側にネストされる)', async () => {
			const original = await post(alice, { text: 'test', isAIGenerated: true });
			const renote = await post(bob, { renoteId: original.id });

			assert.strictEqual(renote.isAIGenerated, false);

			const show = await api('notes/show', { noteId: renote.id }, alice);
			assert.strictEqual(show.status, 200);
			assert.strictEqual(show.body.renote?.isAIGenerated, true);
		});
	});

	describe('AI生成物フラグ (drive)', () => {
		test('drive/files/update で isAIGenerated を変更できる', async () => {
			const file = await uploadFile(alice);
			assert.strictEqual(file.body?.isAIGenerated, false);

			const res = await api('drive/files/update', { fileId: file.body!.id, isAIGenerated: true }, alice);
			assert.strictEqual(res.status, 200);
			assert.strictEqual(res.body.isAIGenerated, true);
		});

		test('drive/files で isAIGenerated を絞り込める', async () => {
			const marked = await uploadFile(alice);
			await api('drive/files/update', { fileId: marked.body!.id, isAIGenerated: true }, alice);
			const unmarked = await uploadFile(alice);

			const res = await api('drive/files', { isAIGenerated: true }, alice);
			assert.strictEqual(res.status, 200);
			const ids = (res.body as misskey.entities.DriveFile[]).map(f => f.id);
			assert.ok(ids.includes(marked.body!.id));
			assert.ok(!ids.includes(unmarked.body!.id));
		});
	});

	// JUICE: 連合の診断。相手のサーバーへ実際に問い合わせるので、モデレーター以上だけが使え、
	// このサーバーが知っているサーバー(instancesテーブルにあるもの)だけを対象にする。
	// 診断の中身(各項目の判定)はtest/unit/FederationDiagnosisService.tsで確かめる
	describe('admin/federation/diagnose-instance', () => {
		test('ログインしていなければ使えない', async () => {
			const res = await api('admin/federation/diagnose-instance', { host: 'unknown.example' });
			assert.strictEqual(res.status, 401);
			assert.strictEqual(castAsError(res.body as any).error.code, 'CREDENTIAL_REQUIRED');
		});

		test('一般ユーザーは使えない', async () => {
			const res = await api('admin/federation/diagnose-instance', { host: 'unknown.example' }, bob);
			assert.strictEqual(res.status, 403);
			assert.strictEqual(castAsError(res.body as any).error.code, 'ROLE_PERMISSION_DENIED');
		});

		test('管理者でも、このサーバーが知らないサーバーは診断できない', async () => {
			const res = await api('admin/federation/diagnose-instance', { host: 'unknown.example' }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_INSTANCE');
		});

		test('モデレーターは使える(知らないサーバーなら NO_SUCH_INSTANCE)', async () => {
			const moderator = await signup({ username: `diag${randomString('abcdefghijklmnopqrstuvwxyz', 8)}` });
			const moderatorRole = await role(alice, { isModerator: true, name: 'Federation Diagnosis Moderator Role' });
			const assign = await api('admin/roles/assign', { userId: moderator.id, roleId: moderatorRole.id }, alice);
			assert.strictEqual(assign.status, 204);

			// 大文字で渡しても同じ扱い(ホスト名は小文字に揃えてから探す)
			const res = await api('admin/federation/diagnose-instance', { host: 'Unknown.Example' }, moderator);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_INSTANCE');
		});

		test('hostが空なら INVALID_PARAM', async () => {
			const res = await api('admin/federation/diagnose-instance', { host: '' }, alice);
			assert.strictEqual(res.status, 400);
			assert.strictEqual(castAsError(res.body as any).error.code, 'INVALID_PARAM');
		});
	});

	describe('承認式新規登録', () => {
		beforeAll(async () => {
			const res = await api('admin/juice/update-settings', {
				approvalRequiredForSignup: true,
				signupReasonRequired: true,
				signupReasonMaxLength: 4096,
			}, alice);
			assert.strictEqual(res.status, 204);
		});

		afterAll(async () => {
			const res = await api('admin/juice/update-settings', {
				approvalRequiredForSignup: false,
				signupReasonRequired: true,
				signupReasonMaxLength: 4096,
			}, alice);
			assert.strictEqual(res.status, 204);
		});

		test('理由なしでは登録できない', async () => {
			const res = await api('signup', {
				username: randomString(),
				password: 'test',
			});
			assert.strictEqual(res.status, 400);
		});

		test('理由ありなら未承認ユーザーが作成され、セッションは返らない', async () => {
			const res = await api('signup', {
				username: randomString(),
				password: 'test',
				reason: 'よろしくお願いします',
			});
			assert.strictEqual(res.status, 200);
			assert.strictEqual((res.body as any).pendingApproval, true);
			assert.strictEqual(typeof (res.body as any).checkCode, 'string');
		});

		test('未承認ユーザーはサインインできない', async () => {
			const username = randomString();
			const signupRes = await api('signup', { username, password: 'test', reason: 'test' });
			assert.strictEqual(signupRes.status, 200);

			const res = await api('signin-flow', { username, password: 'test' });
			assert.strictEqual(res.status, 403);
		});

		test('Moderator以外は承認待ち一覧を取得できない', async () => {
			const res = await api('admin/juice/pending-signups', {}, bob);
			assert.strictEqual(res.status, 403);
			assert.strictEqual(castAsError(res.body as any).error.code, 'ROLE_PERMISSION_DENIED');
		});

		test('Moderator以外は承認・却下できない', async () => {
			const username = randomString();
			const signupRes = await api('signup', { username, password: 'test', reason: 'test' });
			assert.strictEqual(signupRes.status, 200);

			const list = await api('admin/juice/pending-signups', {}, alice);
			const target = (list.body as Array<{ id: string, username: string }>).find(u => u.username === username);
			assert.ok(target);

			const approveRes = await api('admin/juice/approve-signup', { userId: target.id }, bob);
			assert.strictEqual(approveRes.status, 403);
			assert.strictEqual(castAsError(approveRes.body as any).error.code, 'ROLE_PERMISSION_DENIED');

			const declineRes = await api('admin/juice/decline-signup', { userId: target.id, reason: 'test decline reason' }, bob);
			assert.strictEqual(declineRes.status, 403);
			assert.strictEqual(castAsError(declineRes.body as any).error.code, 'ROLE_PERMISSION_DENIED');
		});

		// JUICE: モデレーターでなくても、ロールでcanApproveSignupsが付与されていれば承認・却下できる
		test('モデレーターでなくても、ロールで権限を付与されていれば承認待ち一覧取得・承認ができる', async () => {
			// このdescribeはapprovalRequiredForSignup: trueなので、approver自身のアカウントも
			// 審査を経て作る必要がある(signup() ヘルパーはpendingApproval応答を許容しないため使えない)
			const approverUsername = randomString();
			const approverSignup = await api('signup', { username: approverUsername, password: 'test', reason: 'approver setup' });
			assert.strictEqual(approverSignup.status, 200);
			const approverPendingList = await api('admin/juice/pending-signups', {}, alice);
			const approverPending = (approverPendingList.body as Array<{ id: string, username: string }>).find(u => u.username === approverUsername);
			assert.ok(approverPending);
			await api('admin/juice/approve-signup', { userId: approverPending.id }, alice);
			const approverSignin = await api('signin-flow', { username: approverUsername, password: 'test' });
			assert.strictEqual(approverSignin.status, 200);
			const approverSigninBody = approverSignin.body as unknown as { id: string, i: string };
			const approver = { id: approverSigninBody.id, token: approverSigninBody.i };

			const approverRole = await role(alice, { isModerator: false, name: 'Signup Approver Role' }, {
				canApproveSignups: { priority: 0, useDefault: false, value: true },
			});
			await api('admin/roles/assign', { userId: approver.id, roleId: approverRole.id }, alice);

			const username = randomString();
			const signupRes = await api('signup', { username, password: 'test', reason: 'test' });
			assert.strictEqual(signupRes.status, 200);

			const list = await api('admin/juice/pending-signups', {}, approver);
			assert.strictEqual(list.status, 200);
			const target = (list.body as Array<{ id: string, username: string }>).find(u => u.username === username);
			assert.ok(target);

			const approveRes = await api('admin/juice/approve-signup', { userId: target.id }, approver);
			assert.strictEqual(approveRes.status, 204);
		});

		test('Moderatorが承認すると一覧に理由が表示され、承認後サインインできる', async () => {
			const username = randomString();
			const signupRes = await api('signup', { username, password: 'test', reason: '審査してください' });
			assert.strictEqual(signupRes.status, 200);

			const list = await api('admin/juice/pending-signups', {}, alice);
			assert.strictEqual(list.status, 200);
			const target = (list.body as Array<{ id: string, username: string, signupReason: string | null }>).find(u => u.username === username);
			assert.ok(target);
			assert.strictEqual(target.signupReason, '審査してください');

			const approveRes = await api('admin/juice/approve-signup', { userId: target.id }, alice);
			assert.strictEqual(approveRes.status, 204);

			const signinRes = await api('signin-flow', { username, password: 'test' });
			assert.strictEqual(signinRes.status, 200);
		});

		test('Moderatorが却下するとアカウントが削除され、サインインできない', async () => {
			const username = randomString();
			const signupRes = await api('signup', { username, password: 'test', reason: 'test' });
			assert.strictEqual(signupRes.status, 200);

			const list = await api('admin/juice/pending-signups', {}, alice);
			const target = (list.body as Array<{ id: string, username: string }>).find(u => u.username === username);
			assert.ok(target);

			const declineRes = await api('admin/juice/decline-signup', { userId: target.id, reason: 'test decline reason' }, alice);
			assert.strictEqual(declineRes.status, 204);

			// 却下は承認前アカウントの物理削除(user行が即座に消える)なので、
			// サインイン試行は「未承認だから拒否」(403)ではなく「そもそも存在しない」(404)になる
			const signinRes = await api('signin-flow', { username, password: 'test' });
			assert.strictEqual(signinRes.status, 404);
		});

		test('却下されたユーザー名は再度登録申請できる', async () => {
			const username = randomString();
			const signupRes = await api('signup', { username, password: 'test', reason: 'test' });
			assert.strictEqual(signupRes.status, 200);

			const list = await api('admin/juice/pending-signups', {}, alice);
			const target = (list.body as Array<{ id: string, username: string }>).find(u => u.username === username);
			assert.ok(target);

			const declineRes = await api('admin/juice/decline-signup', { userId: target.id, reason: 'test decline reason' }, alice);
			assert.strictEqual(declineRes.status, 204);

			// 却下された時点で一度も承認されていないため、通常のアカウント削除と異なり
			// used_username に残らず、同じユーザー名で再度登録申請できる
			const retryRes = await api('signup', { username, password: 'test', reason: 'test again' });
			assert.strictEqual(retryRes.status, 200);
			assert.strictEqual((retryRes.body as any).pendingApproval, true);
			assert.strictEqual(typeof (retryRes.body as any).checkCode, 'string');
		});

		test('signup-check-status: 発行直後はpendingを返す', async () => {
			const username = randomString();
			const signupRes = await api('signup', { username, password: 'test', reason: 'test' });
			assert.strictEqual(signupRes.status, 200);
			const checkCode = (signupRes.body as any).checkCode as string;

			const res = await api('juice/signup-check-status', { code: checkCode });
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.body, { status: 'pending', reason: null });
		});

		test('signup-check-status: 承認するとapprovedになる', async () => {
			const username = randomString();
			const signupRes = await api('signup', { username, password: 'test', reason: 'test' });
			assert.strictEqual(signupRes.status, 200);
			const checkCode = (signupRes.body as any).checkCode as string;

			const list = await api('admin/juice/pending-signups', {}, alice);
			const target = (list.body as Array<{ id: string, username: string }>).find(u => u.username === username);
			assert.ok(target);
			const approveRes = await api('admin/juice/approve-signup', { userId: target.id }, alice);
			assert.strictEqual(approveRes.status, 204);

			const res = await api('juice/signup-check-status', { code: checkCode });
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.body, { status: 'approved', reason: null });
		});

		test('signup-check-status: 却下してユーザーが削除された後もdeclinedと理由を確認できる', async () => {
			const username = randomString();
			const signupRes = await api('signup', { username, password: 'test', reason: 'test' });
			assert.strictEqual(signupRes.status, 200);
			const checkCode = (signupRes.body as any).checkCode as string;

			const list = await api('admin/juice/pending-signups', {}, alice);
			const target = (list.body as Array<{ id: string, username: string }>).find(u => u.username === username);
			assert.ok(target);
			const declineRes = await api('admin/juice/decline-signup', { userId: target.id, reason: 'test decline reason' }, alice);
			assert.strictEqual(declineRes.status, 204);

			const res = await api('juice/signup-check-status', { code: checkCode });
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.body, { status: 'declined', reason: 'test decline reason' });
		});

		// JUICE: 承認/却下履歴一覧(admin/juice/signup-approval-history)のe2eテスト。
		// 却下されたアカウントは物理削除されるため、username/signupReasonのスナップショットが
		// 削除後も参照できること、reviewerが管理画面向けにのみ記録されることを確認する。
		test('signup-approval-history: 承認するとusername・reason・reviewerが履歴に記録される', async () => {
			const username = randomString();
			const signupRes = await api('signup', { username, password: 'test', reason: 'approve history test reason' });
			assert.strictEqual(signupRes.status, 200);

			const list = await api('admin/juice/pending-signups', {}, alice);
			const target = (list.body as Array<{ id: string, username: string }>).find(u => u.username === username);
			assert.ok(target);
			const approveRes = await api('admin/juice/approve-signup', { userId: target.id }, alice);
			assert.strictEqual(approveRes.status, 204);

			const history = await api('admin/juice/signup-approval-history', { state: 'approved' }, alice);
			assert.strictEqual(history.status, 200);
			const entry = (history.body as any[]).find((e: any) => e.username === username);
			assert.notStrictEqual(entry, undefined);
			assert.strictEqual(entry.signupReason, 'approve history test reason');
			assert.strictEqual(entry.status, 'approved');
			assert.strictEqual(entry.reviewer.id, alice.id);
			assert.notStrictEqual(entry.reviewedAt, null);
		});

		test('signup-approval-history: 却下してユーザーが削除された後もusername・signupReasonのスナップショットが残る', async () => {
			const username = randomString();
			const signupRes = await api('signup', { username, password: 'test', reason: 'decline history test reason' });
			assert.strictEqual(signupRes.status, 200);

			const list = await api('admin/juice/pending-signups', {}, alice);
			const target = (list.body as Array<{ id: string, username: string }>).find(u => u.username === username);
			assert.ok(target);
			const declineRes = await api('admin/juice/decline-signup', { userId: target.id, reason: 'decline history test reason for reject' }, alice);
			assert.strictEqual(declineRes.status, 204);

			const history = await api('admin/juice/signup-approval-history', { state: 'declined' }, alice);
			assert.strictEqual(history.status, 200);
			const entry = (history.body as any[]).find((e: any) => e.username === username);
			assert.notStrictEqual(entry, undefined);
			assert.strictEqual(entry.signupReason, 'decline history test reason');
			assert.strictEqual(entry.reason, 'decline history test reason for reject');
			assert.strictEqual(entry.status, 'declined');
			assert.strictEqual(entry.reviewer.id, alice.id);
		});

		test('signup-check-status: 存在しないコードはnotFoundを返す', async () => {
			const res = await api('juice/signup-check-status', { code: 'no-such-code' });
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.body, { status: 'notFound', reason: null });
		});

		test('juice/public-settings は無認証で現在の設定を反映する', async () => {
			const res = await api('juice/public-settings', {});
			assert.strictEqual(res.status, 200);
			assert.deepStrictEqual(res.body, {
				approvalRequiredForSignup: true,
				signupReasonRequired: true,
				signupReasonMaxLength: 4096,
				invitationRegistrationEnabled: true,
				exploreOtherServersEnabled: true,
				emojiRequestEnabled: false,
				emojiRequestRequireCategory: false,
				emojiRequestRequireTags: false,
				emojiRequestRequireLicense: false,
				avatarDecorationRequestEnabled: false,
				avatarDecorationRequestRequireCategory: false,
				avatarDecorationRequestRequireDescription: false,
				relayTimelineEnabled: false,
				mediaTimelineEnabled: false,
				latexEnabled: true,
				reactionPiggybackOnRemoteEnabled: false,
				importApprovalRequiredTypes: ['following'],
				contactFormEnabled: true,
				contactFormRequireAuth: false,
				contactFormContentMaxLength: 10000,
				contactFormCategories: [
					{ key: 'general', text: '一般', enabled: true, order: 1, isDefault: true },
					{ key: 'bug_report', text: 'バグ報告', enabled: true, order: 2, isDefault: false },
					{ key: 'feature_request', text: '機能要望', enabled: true, order: 3, isDefault: false },
					{ key: 'account_issue', text: 'アカウント関連', enabled: true, order: 4, isDefault: false },
					{ key: 'technical_issue', text: '技術的な問題', enabled: true, order: 5, isDefault: false },
					{ key: 'content_issue', text: 'コンテンツ関連', enabled: true, order: 6, isDefault: false },
					{ key: 'other', text: 'その他', enabled: true, order: 7, isDefault: false },
				],
				reportCategories: [
					{ key: 'spam', text: 'スパム', enabled: true, order: 1, isDefault: false },
					{ key: 'harassment', text: '嫌がらせ・迷惑行為', enabled: true, order: 2, isDefault: false },
					{ key: 'inappropriate_content', text: '不適切なコンテンツ', enabled: true, order: 3, isDefault: false },
					{ key: 'impersonation', text: 'なりすまし', enabled: true, order: 4, isDefault: false },
					{ key: 'copyright', text: '著作権侵害', enabled: true, order: 5, isDefault: false },
					{ key: 'personal_info', text: '個人情報の晒し', enabled: true, order: 6, isDefault: false },
					{ key: 'other', text: 'その他', enabled: true, order: 7, isDefault: true },
				],
				discordOauthEnabled: false,
				googleOauthEnabled: false,
				githubOauthEnabled: false,
				gitlabOauthEnabled: false,
				microsoftOauthEnabled: false,
				midiPlayerMaxSize: 500 * 1024,
				drawRoomEnabled: true,
				drawRoomMaxRoomMegabytes: 256,
			});
		});

		test('存在しないユーザーは承認できない', async () => {
			const res = await api('admin/juice/approve-signup', { userId: '000000000000000000000000' }, alice);
			assert.strictEqual(res.status, 404);
			assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_USER');
		});

		test('存在しないユーザーは却下できない', async () => {
			const res = await api('admin/juice/decline-signup', { userId: '000000000000000000000000', reason: 'test decline reason' }, alice);
			assert.strictEqual(res.status, 404);
			assert.strictEqual(castAsError(res.body as any).error.code, 'NO_SUCH_USER');
		});

		test('既に承認済みのユーザーを再度承認できない', async () => {
			const username = randomString();
			const signupRes = await api('signup', { username, password: 'test', reason: 'test' });
			assert.strictEqual(signupRes.status, 200);

			const list = await api('admin/juice/pending-signups', {}, alice);
			const target = (list.body as Array<{ id: string, username: string }>).find(u => u.username === username);
			assert.ok(target);

			const approveRes = await api('admin/juice/approve-signup', { userId: target.id }, alice);
			assert.strictEqual(approveRes.status, 204);

			const reapproveRes = await api('admin/juice/approve-signup', { userId: target.id }, alice);
			assert.strictEqual(reapproveRes.status, 400);
			assert.strictEqual(castAsError(reapproveRes.body as any).error.code, 'ALREADY_APPROVED');
		});

		test('既に承認済みのユーザーを却下できない', async () => {
			const username = randomString();
			const signupRes = await api('signup', { username, password: 'test', reason: 'test' });
			assert.strictEqual(signupRes.status, 200);

			const list = await api('admin/juice/pending-signups', {}, alice);
			const target = (list.body as Array<{ id: string, username: string }>).find(u => u.username === username);
			assert.ok(target);

			const approveRes = await api('admin/juice/approve-signup', { userId: target.id }, alice);
			assert.strictEqual(approveRes.status, 204);

			const declineRes = await api('admin/juice/decline-signup', { userId: target.id, reason: 'test decline reason' }, alice);
			assert.strictEqual(declineRes.status, 400);
			assert.strictEqual(castAsError(declineRes.body as any).error.code, 'ALREADY_APPROVED');
		});

		// 招待コードによる承認バイパスの e2e テストは意図的に置いていない:
		// SignupApiService.signup() の招待コード検証ブロックは
		// `process.env.NODE_ENV !== 'test'` の場合のみ実行される既存の仕様
		// (テスト実行を妨げないための既存の仕組み)のため、テスト環境では
		// 招待コード(ticket)が常に null のままになり、バイパス分岐
		// (`approvalRequiredForThisSignup = approvalRequiredForSignup && ticket == null`)
		// を e2e で意味のある形では再現できない。devcontainer 上の実サーバーで
		// 手動確認済み(実際の招待コード作成 → 理由なし即時登録 → 即サインイン)。
	});
});
