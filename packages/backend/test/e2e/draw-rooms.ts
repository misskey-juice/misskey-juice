/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 絵チャ(お絵かきチャット)のe2eテスト。公開範囲・人数上限・部屋主だけができる操作・
// ストリーム経由の線(メンバーだけが自分のレイヤーに描ける)・終了後の保存を検証する
import * as assert from 'assert';
import { describe, beforeAll, test, vi } from 'vitest';
import type { SignupSuccessResponse } from 'misskey-js/entities.js';
import type WebSocket from 'ws';
import { api, connectStream, role, signup } from '../utils.js';

type DrawRoom = { id: string; ownerId: string; members: { id: string }[]; isMember: boolean; isEnded: boolean; maxMembers: number; keepAfterEnd: boolean };

async function createRoom(user: SignupSuccessResponse, params: Partial<{ title: string; visibility: 'followers' | 'local'; maxMembers: number; canvasPreset: 'landscape' | 'portrait' | 'square' | 'square2048' | 'square3840'; keepAfterEnd: boolean }> = {}): Promise<DrawRoom> {
	const res = await api('draw-rooms/create', {
		title: 'test room',
		visibility: 'local',
		maxMembers: 4,
		canvasPreset: 'landscape',
		...params,
	}, user);
	assert.strictEqual(res.status, 200, JSON.stringify(res.body));
	return res.body as DrawRoom;
}

// JUICE: エラー時のレスポンス(error.code)も見たいので、bodyの型を付けずに呼ぶ
async function call(endpoint: string, params: Record<string, unknown>, user: SignupSuccessResponse): Promise<{ status: number; body: any }> {
	return await api(endpoint as any, params as any, user) as { status: number; body: any };
}

function sendToChannel(ws: WebSocket, type: string, body: unknown): void {
	ws.send(JSON.stringify({ type: 'ch', body: { id: 'a', type, body } }));
}

// 点の列を送る形式(1点5バイト: x・yは8倍したint16、筆圧は0〜255のuint8をbase64)にする
function encodePoints(points: [number, number, number][]): string {
	const buf = Buffer.alloc(points.length * 5);
	points.forEach(([x, y, pressure], i) => {
		buf.writeInt16LE(Math.round(x * 8), i * 5);
		buf.writeInt16LE(Math.round(y * 8), i * 5 + 2);
		buf.writeUInt8(Math.round(pressure * 255), i * 5 + 4);
	});
	return buf.toString('base64');
}

function stroke(id: string) {
	return { id, tool: 'pen', color: '#112233', size: 4, points: encodePoints([[10, 10, 0.5], [20, 20, 0.8], [30, 25, 1]]) };
}

async function layersOf(room: DrawRoom, user: SignupSuccessResponse) {
	const res = await api('draw-rooms/strokes', { roomId: room.id }, user);
	assert.strictEqual(res.status, 200);
	return res.body as { userId: string; strokes: { id: string }[] }[];
}

describe('絵チャ', () => {
	let alice: SignupSuccessResponse;
	let bob: SignupSuccessResponse;
	let carol: SignupSuccessResponse;
	let dave: SignupSuccessResponse;

	beforeAll(async () => {
		alice = await signup();
		bob = await signup();
		carol = await signup();
		dave = await signup();
		// bobだけがaliceをフォローしている
		await call('following/create', { userId: alice.id }, bob);
	}, 1000 * 60 * 2);

	test('部屋を作ると、部屋主がメンバーになる。開催中の部屋は1人1つまで', async () => {
		const room = await createRoom(alice);
		assert.strictEqual(room.ownerId, alice.id);
		assert.deepStrictEqual(room.members.map(m => m.id), [alice.id]);
		assert.strictEqual(room.isMember, true);

		const second = await call('draw-rooms/create', { title: 'second', visibility: 'local', maxMembers: 2, canvasPreset: 'square' }, alice);
		assert.strictEqual(second.status, 400);
		assert.strictEqual(second.body.error.code, 'ALREADY_HOSTING');

		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('フォロワー限定の部屋は、フォロワー以外は見られない', async () => {
		const room = await createRoom(alice, { visibility: 'followers' });

		assert.strictEqual((await call('draw-rooms/show', { roomId: room.id }, bob)).status, 200);
		const denied = await call('draw-rooms/show', { roomId: room.id }, carol);
		assert.strictEqual(denied.status, 400);
		assert.strictEqual(denied.body.error.code, 'FORBIDDEN');
		assert.strictEqual((await call('draw-rooms/join', { roomId: room.id }, carol)).body.error.code, 'FORBIDDEN');

		const listForCarol = (await call('draw-rooms/list', {}, carol)).body as DrawRoom[];
		assert.strictEqual(listForCarol.some(r => r.id === room.id), false);
		const listForBob = (await call('draw-rooms/list', {}, bob)).body as DrawRoom[];
		assert.strictEqual(listForBob.some(r => r.id === room.id), true);

		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('人数上限までしか参加できず、同時に参加しても上限を超えない', async () => {
		const room = await createRoom(alice, { maxMembers: 2 });

		// 空きは1人分。3人が同時に参加しても、成功するのは1人だけ
		const results = await Promise.all([bob, carol, dave].map(u => call('draw-rooms/join', { roomId: room.id }, u)));
		assert.strictEqual(results.filter(r => r.status === 204).length, 1);
		assert.strictEqual(results.filter(r => r.status === 400 && r.body.error.code === 'ROOM_FULL').length, 2);

		const shown = (await call('draw-rooms/show', { roomId: room.id }, alice)).body as DrawRoom;
		assert.strictEqual(shown.members.length, 2);

		// 部屋主が上限を上げれば、見学者だった人も参加できる
		// 上限は512人まで
		assert.strictEqual((await call('draw-rooms/update', { roomId: room.id, maxMembers: 513 }, alice)).status, 400);
		assert.strictEqual((await call('draw-rooms/update', { roomId: room.id, maxMembers: 512 }, alice)).status, 200);
		await call('draw-rooms/update', { roomId: room.id, maxMembers: 4 }, alice);
		const loser = [bob, carol, dave].find(u => !shown.members.some(m => m.id === u.id))!;
		assert.strictEqual((await call('draw-rooms/join', { roomId: room.id }, loser)).status, 204);

		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('部屋主以外は、設定の変更・メンバーのキック・終了ができない', async () => {
		const room = await createRoom(alice);
		await call('draw-rooms/join', { roomId: room.id }, bob);

		assert.strictEqual((await call('draw-rooms/update', { roomId: room.id, title: 'x' }, bob)).body.error.code, 'NOT_OWNER');
		assert.strictEqual((await call('draw-rooms/kick', { roomId: room.id, userId: alice.id }, bob)).body.error.code, 'NOT_OWNER');
		assert.strictEqual((await call('draw-rooms/end', { roomId: room.id }, bob)).body.error.code, 'NOT_OWNER');
		// 部屋主も描く人から抜けて観戦でき、また参加し直せる(部屋主のまま)
		assert.strictEqual((await call('draw-rooms/leave', { roomId: room.id }, alice)).status, 204);
		assert.strictEqual(((await call('draw-rooms/show', { roomId: room.id }, alice)).body as DrawRoom).isMember, false);
		assert.strictEqual((await call('draw-rooms/join', { roomId: room.id }, alice)).status, 204);

		assert.strictEqual((await call('draw-rooms/kick', { roomId: room.id, userId: bob.id }, alice)).status, 204);
		const shown = (await call('draw-rooms/show', { roomId: room.id }, bob)).body as DrawRoom;
		assert.strictEqual(shown.isMember, false);
		// 外された人は、その部屋に参加し直せない
		assert.strictEqual((await call('draw-rooms/join', { roomId: room.id }, bob)).body.error.code, 'KICKED');

		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('線は自分のレイヤーにだけ入り、見学者は描けない。取り消しは自分の線だけ', async () => {
		const room = await createRoom(alice);
		await call('draw-rooms/join', { roomId: room.id }, bob);

		const aliceWs = await connectStream(alice, 'drawRoom', () => {}, { roomId: room.id });
		const bobWs = await connectStream(bob, 'drawRoom', () => {}, { roomId: room.id });
		const carolWs = await connectStream(carol, 'drawRoom', () => {}, { roomId: room.id });
		try {
			sendToChannel(aliceWs, 'stroke', stroke('alice1'));
			sendToChannel(bobWs, 'stroke', stroke('bob1'));
			sendToChannel(bobWs, 'stroke', stroke('bob2'));
			// carolはメンバーではない(見学者)ので無視される
			sendToChannel(carolWs, 'stroke', stroke('carol1'));

			await vi.waitFor(async () => {
				const layers = await layersOf(room, alice);
				assert.deepStrictEqual(layers.find(l => l.userId === alice.id)?.strokes.map(s => s.id), ['alice1']);
				assert.deepStrictEqual(layers.find(l => l.userId === bob.id)?.strokes.map(s => s.id), ['bob1', 'bob2']);
			}, { timeout: 5000, interval: 200 });
			assert.strictEqual((await layersOf(room, alice)).some(l => l.userId === carol.id), false);

			// aliceの取り消しはaliceのレイヤーにしか効かない
			sendToChannel(aliceWs, 'undo', {});
			await vi.waitFor(async () => {
				const layers = await layersOf(room, alice);
				assert.deepStrictEqual(layers.find(l => l.userId === alice.id)?.strokes ?? [], []);
				assert.deepStrictEqual(layers.find(l => l.userId === bob.id)?.strokes.map(s => s.id), ['bob1', 'bob2']);
			}, { timeout: 5000, interval: 200 });

			// 不正な線(キャンバスの外・点のバイト数が合わない・数値の配列・不透明度が範囲外)は受け付けない
			sendToChannel(bobWs, 'stroke', { ...stroke('bad1'), points: encodePoints([[4000, 4000, 1]]) });
			sendToChannel(bobWs, 'stroke', { ...stroke('bad2'), points: Buffer.alloc(4).toString('base64') });
			sendToChannel(bobWs, 'stroke', { ...stroke('bad3'), points: [10, 10, 1] });
			sendToChannel(bobWs, 'stroke', { ...stroke('bad4'), opacity: 0 });
			sendToChannel(bobWs, 'stroke', { ...stroke('bob3'), opacity: 0.5 });
			await vi.waitFor(async () => {
				const layers = await layersOf(room, alice);
				assert.deepStrictEqual(layers.find(l => l.userId === bob.id)?.strokes.map(s => s.id), ['bob1', 'bob2', 'bob3']);
			}, { timeout: 5000, interval: 200 });
			// 点の列と不透明度は送ったとおりに保存される
			const bob3 = (await layersOf(room, alice)).find(l => l.userId === bob.id)?.strokes.at(-1) as { points: string; opacity?: number } | undefined;
			assert.strictEqual(bob3?.points, stroke('bob3').points);
			assert.strictEqual(bob3?.opacity, 0.5);
		} finally {
			aliceWs.close();
			bobWs.close();
			carolWs.close();
		}

		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('カーソルは一定間隔でまとめて配られ、各ユーザーの最新の位置だけが届く', async () => {
		const room = await createRoom(alice);
		const received: { userId: string; x: number | null; y: number | null }[][] = [];
		const bobWs = await connectStream(bob, 'drawRoom', (msg) => {
			if (msg.type === 'cursors') received.push(msg.body.cursors);
		}, { roomId: room.id });
		const aliceWs = await connectStream(alice, 'drawRoom', () => {}, { roomId: room.id });
		// carolはメンバーではない(見学者)が、カーソルは送れる
		const carolWs = await connectStream(carol, 'drawRoom', () => {}, { roomId: room.id });
		try {
			for (let i = 1; i <= 5; i++) sendToChannel(aliceWs, 'cursor', { x: i * 10, y: i * 20 });
			sendToChannel(carolWs, 'cursor', { x: 7, y: 8 });
			await vi.waitFor(() => {
				const latest = new Map(received.flat().map(c => [c.userId, c]));
				assert.deepStrictEqual(latest.get(alice.id), { userId: alice.id, x: 50, y: 100 });
				assert.deepStrictEqual(latest.get(carol.id), { userId: carol.id, x: 7, y: 8 });
			}, { timeout: 5000, interval: 100 });
			// 1件ずつではなく、まとめて届いている
			assert.ok(received.length < 6, `received ${received.length} messages`);

			// キャンバスの外に出たことも届く
			sendToChannel(aliceWs, 'cursor', { x: null, y: null });
			await vi.waitFor(() => {
				assert.deepStrictEqual(received.at(-1)?.find(c => c.userId === alice.id), { userId: alice.id, x: null, y: null });
			}, { timeout: 5000, interval: 100 });
		} finally {
			aliceWs.close();
			bobWs.close();
			carolWs.close();
		}
		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('部屋を開いている人(オンライン)の一覧が配られ、画面を離れる・閉じるとオフラインになる', async () => {
		const room = await createRoom(alice);
		const presence: string[][] = [];
		const aliceWs = await connectStream(alice, 'drawRoom', (msg) => {
			if (msg.type === 'presence') presence.push(msg.body.userIds);
		}, { roomId: room.id });
		try {
			await vi.waitFor(() => {
				assert.deepStrictEqual(presence.at(-1), [alice.id]);
			}, { timeout: 5000, interval: 100 });

			// 見学者(メンバーでない人)も、開いている間はオンライン
			const carolWs = await connectStream(carol, 'drawRoom', () => {}, { roomId: room.id });
			await vi.waitFor(() => {
				assert.deepStrictEqual([...(presence.at(-1) ?? [])].sort(), [alice.id, carol.id].sort());
			}, { timeout: 5000, interval: 100 });

			// 画面を離れた(本人から知らせがあった)ときはすぐオフライン、戻るとオンライン
			sendToChannel(carolWs, 'visibility', { visible: false });
			await vi.waitFor(() => {
				assert.deepStrictEqual(presence.at(-1), [alice.id]);
			}, { timeout: 2000, interval: 100 });
			sendToChannel(carolWs, 'visibility', { visible: true });
			await vi.waitFor(() => {
				assert.deepStrictEqual([...(presence.at(-1) ?? [])].sort(), [alice.id, carol.id].sort());
			}, { timeout: 5000, interval: 100 });

			// 知らせなしに接続が切れたときは、少し待ってからオフラインになる
			carolWs.close();
			await vi.waitFor(() => {
				assert.deepStrictEqual(presence.at(-1), [alice.id]);
			}, { timeout: 8000, interval: 100 });
		} finally {
			aliceWs.close();
		}
		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('キャンバスの大きさを自由に指定でき、部屋主は途中で変えられる', async () => {
		// 範囲外の大きさは作れない
		assert.strictEqual((await call('draw-rooms/create', { title: 'x', visibility: 'local', maxMembers: 2, canvasWidth: 5000, canvasHeight: 500 }, alice)).status, 400);

		const created = await call('draw-rooms/create', { title: 'custom', visibility: 'local', maxMembers: 4, canvasWidth: 640, canvasHeight: 480 }, alice);
		assert.strictEqual(created.status, 200);
		const room = created.body as DrawRoom & { canvasWidth: number; canvasHeight: number };
		assert.strictEqual(room.canvasWidth, 640);
		assert.strictEqual(room.canvasHeight, 480);

		await call('draw-rooms/join', { roomId: room.id }, bob);
		assert.strictEqual((await call('draw-rooms/update', { roomId: room.id, canvasWidth: 1000 }, bob)).body.error.code, 'NOT_OWNER');

		const aliceWs = await connectStream(alice, 'drawRoom', () => {}, { roomId: room.id });
		try {
			// 今の大きさ(640)の外すぎる線は受け付けない
			sendToChannel(aliceWs, 'stroke', { ...stroke('before'), points: encodePoints([[950, 100, 1]]) });
			const updated = await call('draw-rooms/update', { roomId: room.id, canvasWidth: 1000 }, alice);
			assert.strictEqual(updated.status, 200);
			assert.strictEqual(updated.body.canvasWidth, 1000);
			// 大きくした後は、広がった所にも描ける(ストリームも新しい大きさで確認する)
			await vi.waitFor(async () => {
				sendToChannel(aliceWs, 'stroke', { ...stroke(`after${Date.now()}`), points: encodePoints([[950, 100, 1]]) });
				const layers = await layersOf(room, alice);
				assert.ok(layers.find(l => l.userId === alice.id)?.strokes.some(s => s.id.startsWith('after')));
			}, { timeout: 5000, interval: 300 });
			const ids = (await layersOf(room, alice)).find(l => l.userId === alice.id)?.strokes.map(s => s.id) ?? [];
			assert.strictEqual(ids.includes('before'), false);
		} finally {
			aliceWs.close();
		}
		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('ロールのcanCreateDrawRoomがオフの人は部屋を作れないが、ほかの人の部屋には参加できる', async () => {
		const noCreate = await role(alice, { isModerator: false, name: 'Draw Room No Create' }, {
			canCreateDrawRoom: { priority: 0, useDefault: false, value: false },
		});
		await call('admin/roles/assign', { userId: carol.id, roleId: noCreate.id }, alice);

		const denied = await call('draw-rooms/create', { title: 'nope', visibility: 'local', maxMembers: 2, canvasPreset: 'square' }, carol);
		assert.strictEqual(denied.status, 400);
		assert.strictEqual(denied.body.error.code, 'CANNOT_CREATE_DRAW_ROOM');

		const room = await createRoom(alice);
		assert.strictEqual((await call('draw-rooms/join', { roomId: room.id }, carol)).status, 204);

		await call('draw-rooms/end', { roomId: room.id }, alice);
		await call('admin/roles/unassign', { userId: carol.id, roleId: noCreate.id }, alice);
	});

	test('ロールのdrawRoomMaxCanvasSizeを超える大きさでは作れず、途中でも超えるようには変えられない', async () => {
		// aliceは最初に登録したユーザー(管理者)なので、ロールを作ってdaveに付ける
		const limited = await role(alice, { isModerator: false, name: 'Draw Room Small Canvas' }, {
			drawRoomMaxCanvasSize: { priority: 0, useDefault: false, value: 800 },
		});
		await call('admin/roles/assign', { userId: dave.id, roleId: limited.id }, alice);

		const tooLarge = await call('draw-rooms/create', { title: 'big', visibility: 'local', maxMembers: 2, canvasPreset: 'landscape' }, dave);
		assert.strictEqual(tooLarge.status, 400);
		assert.strictEqual(tooLarge.body.error.code, 'CANVAS_TOO_LARGE');

		const ok = await call('draw-rooms/create', { title: 'small', visibility: 'local', maxMembers: 2, canvasWidth: 800, canvasHeight: 600 }, dave);
		assert.strictEqual(ok.status, 200);
		assert.strictEqual((await call('draw-rooms/update', { roomId: ok.body.id, canvasWidth: 801 }, dave)).body.error.code, 'CANVAS_TOO_LARGE');
		assert.strictEqual((await call('draw-rooms/update', { roomId: ok.body.id, canvasWidth: 500 }, dave)).status, 200);

		await call('draw-rooms/end', { roomId: ok.body.id }, dave);
		await call('admin/roles/unassign', { userId: dave.id, roleId: limited.id }, alice);
	});

	test('部屋主は自分を外せず、終了した部屋ではメンバーを外せない。幅・高さの片方だけの指定はエラー', async () => {
		const onlyWidth = await call('draw-rooms/create', { title: 'x', visibility: 'local', maxMembers: 2, canvasWidth: 800 }, alice);
		assert.strictEqual(onlyWidth.body.error.code, 'INVALID_CANVAS_SIZE');

		const room = await createRoom(alice, { keepAfterEnd: true });
		await call('draw-rooms/join', { roomId: room.id }, bob);
		assert.strictEqual((await call('draw-rooms/kick', { roomId: room.id, userId: alice.id }, alice)).body.error.code, 'CANNOT_KICK_OWNER');
		await call('draw-rooms/end', { roomId: room.id }, alice);
		assert.strictEqual((await call('draw-rooms/kick', { roomId: room.id, userId: bob.id }, alice)).body.error.code, 'ROOM_ENDED');
		await call('draw-rooms/delete', { roomId: room.id }, alice);
	});

	test('凍結された人の部屋は、ほかの人の一覧に出ず開けない(モデレーターは開ける)', async () => {
		// 凍結するとほかのテストに影響するので、このテスト専用のユーザーを使う
		const frozen = await signup();
		const room = await createRoom(frozen);
		assert.strictEqual((await call('draw-rooms/show', { roomId: room.id }, carol)).status, 200);
		await call('admin/suspend-user', { userId: frozen.id }, alice);
		await vi.waitFor(async () => {
			const list = (await call('draw-rooms/list', {}, carol)).body as DrawRoom[];
			assert.strictEqual(list.some(r => r.id === room.id), false);
		}, { timeout: 5000, interval: 300 });
		assert.strictEqual((await call('draw-rooms/show', { roomId: room.id }, carol)).body.error.code, 'FORBIDDEN');
		// aliceは管理者(モデレーター)なので、確かめるために開ける
		assert.strictEqual((await call('draw-rooms/show', { roomId: room.id }, alice)).status, 200);
	});

	test('モデレーターは開催中の部屋を削除でき、部屋を開いている人に知らされ、モデレーションログに残る', async () => {
		const room = await createRoom(bob);
		const events: { type: string; body: { byModerator?: boolean } }[] = [];
		const carolWs = await connectStream(carol, 'drawRoom', (msg) => events.push(msg as never), { roomId: room.id });
		try {
			// モデレーターでない人(部屋主以外)は削除できない
			assert.strictEqual((await call('draw-rooms/delete', { roomId: room.id }, carol)).body.error.code, 'NOT_OWNER');
			assert.strictEqual((await call('draw-rooms/delete', { roomId: room.id }, alice)).status, 204);
			await vi.waitFor(() => {
				assert.deepStrictEqual(events.find(e => e.type === 'deleted')?.body, { byModerator: true });
			}, { timeout: 5000, interval: 100 });
		} finally {
			carolWs.close();
		}
		assert.strictEqual((await call('draw-rooms/show', { roomId: room.id }, bob)).body.error.code, 'NO_SUCH_ROOM');
		const logs = (await call('admin/show-moderation-logs', { type: 'deleteDrawRoom' }, alice)).body as { type: string; info: { roomId: string } }[];
		assert.ok(logs.some(log => log.type === 'deleteDrawRoom' && log.info.roomId === room.id));
	});

	test('部屋(部屋主)と、部屋のチャットの発言(発言した人)を通報でき、通報した時点の内容が残る', async () => {
		const room = await createRoom(bob);
		const bobWs = await connectStream(bob, 'drawRoom', () => {}, { roomId: room.id });
		let chatId: string;
		try {
			sendToChannel(bobWs, 'chat', { text: 'bad words' });
			chatId = await vi.waitFor(async () => {
				const chat = (await call('draw-rooms/chat-history', { roomId: room.id }, carol)).body as { message: { id: string; text: string } }[];
				const found = chat.find(c => c.message.text === 'bad words');
				assert.ok(found);
				return found.message.id;
			}, { timeout: 5000, interval: 300 });
		} finally {
			bobWs.close();
		}

		// 部屋主でない人を部屋の通報先にはできない
		assert.strictEqual((await call('users/report-abuse', { userId: dave.id, comment: 'x', drawRoomId: room.id }, carol)).body.error.code, 'INVALID_TARGET_DRAW_ROOM');
		assert.strictEqual((await call('users/report-abuse', { userId: bob.id, comment: 'room', drawRoomId: room.id }, carol)).status, 204);
		// 発言した人でない人をチャットの通報先にはできない
		assert.strictEqual((await call('users/report-abuse', { userId: dave.id, comment: 'x', drawRoomId: room.id, drawRoomChatMessageId: chatId }, carol)).body.error.code, 'INVALID_TARGET_DRAW_ROOM_CHAT');
		assert.strictEqual((await call('users/report-abuse', { userId: bob.id, comment: 'chat', drawRoomId: room.id, drawRoomChatMessageId: chatId }, carol)).status, 204);

		// 部屋が消えても、通報した時点の内容は残る
		await call('draw-rooms/end', { roomId: room.id }, bob);
		const reports = (await call('admin/abuse-user-reports', { limit: 100 }, alice)).body as { comment: string; targetType: string | null; targetDrawRoom: { id: string; title: string; message: { text: string } | null } | null }[];
		const roomReport = reports.find(r => r.comment === 'room');
		const chatReport = reports.find(r => r.comment === 'chat');
		assert.strictEqual(roomReport?.targetType, 'drawRoom');
		assert.strictEqual(roomReport?.targetDrawRoom?.id, room.id);
		assert.strictEqual(chatReport?.targetType, 'drawRoomChat');
		assert.strictEqual(chatReport?.targetDrawRoom?.message?.text, 'bad words');
	});

	test('公開範囲の外のモデレーターは、見るだけで参加できない。見られない部屋や、対象の指定がおかしい通報は弾く', async () => {
		// daveのフォロワー限定の部屋。alice(管理者)もcarolもdaveをフォローしていない
		const room = await createRoom(dave, { visibility: 'followers' });

		const shown = await call('draw-rooms/show', { roomId: room.id }, alice);
		assert.strictEqual(shown.status, 200);
		assert.strictEqual(shown.body.viewOnly, true);
		assert.strictEqual((await call('draw-rooms/show', { roomId: room.id }, dave)).body.viewOnly, false);
		assert.strictEqual((await call('draw-rooms/join', { roomId: room.id }, alice)).body.error.code, 'FORBIDDEN');

		// 見られない部屋は通報できない
		assert.strictEqual((await call('users/report-abuse', { userId: dave.id, comment: 'x', drawRoomId: room.id }, carol)).body.error.code, 'INVALID_TARGET_DRAW_ROOM');
		// 対象の指定がおかしい
		const other = await createRoom(bob);
		assert.strictEqual((await call('users/report-abuse', { userId: bob.id, comment: 'x', drawRoomChatMessageId: other.id }, carol)).body.error.code, 'INVALID_TARGET_DRAW_ROOM_CHAT');
		assert.strictEqual((await call('users/report-abuse', { userId: bob.id, comment: 'x', drawRoomId: other.id, noteId: other.id }, carol)).body.error.code, 'CANNOT_SPECIFY_MULTIPLE_TARGETS');

		await call('draw-rooms/end', { roomId: room.id }, dave);
		await call('draw-rooms/end', { roomId: other.id }, bob);
	});

	// JUICE: レイヤーの合成モードと、透明度ロックの線
	test('レイヤーの合成モードと、透明度ロックの線を保存できる', async () => {
		const room = await createRoom(alice);
		const aliceWs = await connectStream(alice, 'drawRoom', () => {}, { roomId: room.id });
		const mine = async () => (await layersOf(room, alice)).find(l => l.userId === alice.id) as unknown as { strokes: { id: string; lock?: boolean }[]; layers: { id: string; blend?: string }[] } | undefined;
		try {
			sendToChannel(aliceWs, 'setLayers', { layers: [
				{ id: '0', name: '', visible: true, opacity: 1 },
				{ id: 'mul', name: '影', visible: true, opacity: 1, blend: 'color-burn' },
			] });
			await vi.waitFor(async () => assert.deepStrictEqual((await mine())?.layers.map(l => [l.id, l.blend ?? 'normal']), [['0', 'normal'], ['mul', 'color-burn']]), { timeout: 5000, interval: 200 });
			// 知らない合成モードは断られる(一覧は変わらない)
			await new Promise(resolve => setTimeout(resolve, 250));
			sendToChannel(aliceWs, 'setLayers', { layers: [{ id: '0', name: '', visible: true, opacity: 1, blend: 'source-over' }] });
			// 透明度ロックはペン・塗りつぶしの線にだけ付く(消しゴムでは外す)
			sendToChannel(aliceWs, 'stroke', { ...stroke('l1'), lock: true });
			sendToChannel(aliceWs, 'stroke', { ...stroke('l2'), tool: 'eraser', lock: true });
			await vi.waitFor(async () => assert.deepStrictEqual((await mine())?.strokes.map(s => [s.id, s.lock ?? false]), [['l1', true], ['l2', false]]), { timeout: 5000, interval: 200 });
			assert.deepStrictEqual((await mine())?.layers.map(l => l.id), ['0', 'mul']);
		} finally {
			aliceWs.close();
		}

		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	// JUICE: 取り消し・やり直し(線を描く・動かす・切って置き換える・消す、下描きのレイヤーの削除)
	test('取り消し・やり直しで、描いた線・移動・削除・下描きのレイヤーの削除を戻せる', async () => {
		const room = await createRoom(alice);
		const aliceWs = await connectStream(alice, 'drawRoom', () => {}, { roomId: room.id });
		type Stroke = { id: string; dx?: number; dy?: number; layer?: string };
		type Layer = { id: string; private?: boolean };
		const mine = async () => (await layersOf(room, alice)).find(l => l.userId === alice.id) as unknown as { strokes: Stroke[]; layers: Layer[] } | undefined;
		const state = async () => ((await mine())?.strokes ?? []).map(s => [s.id, s.dx ?? 0, s.dy ?? 0]);
		// 回数制限(1秒あたり5回)にかからないよう、操作の間を少し空ける
		const send = async (type: string, body: unknown) => {
			sendToChannel(aliceWs, type, body);
			await new Promise(resolve => setTimeout(resolve, 250));
		};
		const expect = async (value: unknown) => await vi.waitFor(async () => assert.deepStrictEqual(await state(), value), { timeout: 5000, interval: 200 });
		try {
			for (const id of ['u1', 'u2', 'u3']) sendToChannel(aliceWs, 'stroke', stroke(id));
			await expect([['u1', 0, 0], ['u2', 0, 0], ['u3', 0, 0]]);

			// 描いた線の取り消し・やり直し
			await send('undo', {});
			await expect([['u1', 0, 0], ['u2', 0, 0]]);
			await send('redo', {});
			await expect([['u1', 0, 0], ['u2', 0, 0], ['u3', 0, 0]]);

			// 移動の取り消し(ずらしたのが戻り、その前に描いた線は消えない)・やり直し
			await send('moveStrokes', { strokeIds: ['u1'], dx: 10, dy: 5 });
			await expect([['u1', 10, 5], ['u2', 0, 0], ['u3', 0, 0]]);
			await send('undo', {});
			await expect([['u1', 0, 0], ['u2', 0, 0], ['u3', 0, 0]]);
			await send('redo', {});
			await expect([['u1', 10, 5], ['u2', 0, 0], ['u3', 0, 0]]);

			// 選んだ線の削除の取り消し(元の重なり順に戻る)
			await send('deleteStrokes', { strokeIds: ['u2'] });
			await expect([['u1', 10, 5], ['u3', 0, 0]]);
			await send('undo', {});
			await expect([['u1', 10, 5], ['u2', 0, 0], ['u3', 0, 0]]);

			// 境目で切ってから動かした操作は、1回の取り消しで切る前に戻る
			const piece = (id: string) => ({ ...stroke(id), points: encodePoints([[10, 10, 1], [15, 15, 1]]) });
			await send('moveStrokes', { strokeIds: ['u2a'], dx: 3, dy: 3, splits: [{ id: 'u2', pieces: [piece('u2a'), piece('u2b')] }] });
			await expect([['u1', 10, 5], ['u2a', 3, 3], ['u2b', 0, 0], ['u3', 0, 0]]);
			await send('undo', {});
			await expect([['u1', 10, 5], ['u2', 0, 0], ['u3', 0, 0]]);

			// 新しい操作をしたら、やり直しはできなくなる
			await send('undo', {});
			await expect([['u1', 0, 0], ['u2', 0, 0], ['u3', 0, 0]]);
			sendToChannel(aliceWs, 'stroke', stroke('u4'));
			await expect([['u1', 0, 0], ['u2', 0, 0], ['u3', 0, 0], ['u4', 0, 0]]);
			await send('redo', {});
			await send('chat', { text: 'barrier-1' });
			await vi.waitFor(async () => {
				const chat = (await call('draw-rooms/chat-history', { roomId: room.id }, alice)).body as { message: { text: string } }[];
				assert.ok(chat.some(item => item.message.text === 'barrier-1'));
			}, { timeout: 5000, interval: 200 });
			await expect([['u1', 0, 0], ['u2', 0, 0], ['u3', 0, 0], ['u4', 0, 0]]);

			// 下描きのレイヤーの削除は、レイヤーごと戻せる(皆に見えるレイヤーの削除は戻せない)
			await send('setLayers', { layers: [
				{ id: '0', name: '', visible: true, opacity: 1 },
				{ id: 'draft', name: '下描き', visible: true, opacity: 0.5, private: true },
			] });
			sendToChannel(aliceWs, 'stroke', { ...stroke('d1'), layer: 'draft' });
			await expect([['u1', 0, 0], ['u2', 0, 0], ['u3', 0, 0], ['u4', 0, 0], ['d1', 0, 0]]);
			await send('setLayers', { layers: [{ id: '0', name: '', visible: true, opacity: 1 }] });
			await expect([['u1', 0, 0], ['u2', 0, 0], ['u3', 0, 0], ['u4', 0, 0]]);
			await send('undo', {});
			await expect([['u1', 0, 0], ['u2', 0, 0], ['u3', 0, 0], ['u4', 0, 0], ['d1', 0, 0]]);
			assert.deepStrictEqual((await mine())?.layers.map(l => [l.id, l.private ?? false]), [['0', false], ['draft', true]]);

			// 下描きのレイヤーの消去も戻せる
			await send('clearLayer', { layer: 'draft' });
			await expect([['u1', 0, 0], ['u2', 0, 0], ['u3', 0, 0], ['u4', 0, 0]]);
			await send('undo', {});
			await expect([['u1', 0, 0], ['u2', 0, 0], ['u3', 0, 0], ['u4', 0, 0], ['d1', 0, 0]]);
		} finally {
			aliceWs.close();
		}

		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('移動ツールで線をずらし、選んだ線だけを消せる。部屋主はほかの人のレイヤーを消去できる', async () => {
		const room = await createRoom(alice);
		await call('draw-rooms/join', { roomId: room.id }, bob);
		const aliceWs = await connectStream(alice, 'drawRoom', () => {}, { roomId: room.id });
		const bobWs = await connectStream(bob, 'drawRoom', () => {}, { roomId: room.id });
		const carolWs = await connectStream(carol, 'drawRoom', () => {}, { roomId: room.id });
		type Stroke = { id: string; dx?: number; dy?: number };
		const layer = async (userId: string) => ((await layersOf(room, alice)).find(l => l.userId === userId)?.strokes ?? []) as Stroke[];
		try {
			for (const id of ['m1', 'm2', 'm3']) sendToChannel(bobWs, 'stroke', stroke(id));
			await vi.waitFor(async () => assert.strictEqual((await layer(bob.id)).length, 3), { timeout: 5000, interval: 200 });

			// 選んだ線だけをずらす(1/8px単位にそろう)
			sendToChannel(bobWs, 'moveStrokes', { strokeIds: ['m1', 'm2'], dx: 10.06, dy: -5 });
			await vi.waitFor(async () => {
				const strokes = await layer(bob.id);
				assert.deepStrictEqual(strokes.map(s => [s.id, s.dx ?? 0, s.dy ?? 0]), [['m1', 10, -5], ['m2', 10, -5], ['m3', 0, 0]]);
			}, { timeout: 5000, interval: 200 });
			// レイヤー全体をずらす
			sendToChannel(bobWs, 'moveStrokes', { strokeIds: null, dx: 1, dy: 1 });
			await vi.waitFor(async () => {
				const strokes = await layer(bob.id);
				assert.deepStrictEqual(strokes.map(s => [s.id, s.dx ?? 0, s.dy ?? 0]), [['m1', 11, -4], ['m2', 11, -4], ['m3', 1, 1]]);
			}, { timeout: 5000, interval: 200 });

			// 選んだ線だけを消す
			sendToChannel(bobWs, 'deleteStrokes', { strokeIds: ['m2'] });
			await vi.waitFor(async () => assert.deepStrictEqual((await layer(bob.id)).map(s => s.id), ['m1', 'm3']), { timeout: 5000, interval: 200 });

			// 見学者(carol)はずらせない。同じ接続のメッセージは順に処理されるので、後から送ったチャットが
			// 届いた時点で、先に送った移動は処理済み(で断られている)
			sendToChannel(carolWs, 'moveStrokes', { strokeIds: null, dx: 100, dy: 100 });
			sendToChannel(carolWs, 'chat', { text: 'carol-barrier' });
			await vi.waitFor(async () => {
				const chat = (await call('draw-rooms/chat-history', { roomId: room.id }, alice)).body as { message: { text: string } }[];
				assert.ok(chat.some(item => item.message.text === 'carol-barrier'));
			}, { timeout: 5000, interval: 200 });
			assert.deepStrictEqual((await layer(bob.id)).map(s => [s.id, s.dx ?? 0, s.dy ?? 0]), [['m1', 11, -4], ['m3', 1, 1]]);

			// 部屋主でない人(bob)はほかの人のレイヤーを消去できない(後から送った線が届いた時点で処理済み)
			sendToChannel(aliceWs, 'stroke', stroke('a1'));
			await vi.waitFor(async () => assert.strictEqual((await layer(alice.id)).length, 1), { timeout: 5000, interval: 200 });
			sendToChannel(bobWs, 'clearLayerOf', { userId: alice.id });
			sendToChannel(bobWs, 'stroke', stroke('m4'));
			await vi.waitFor(async () => assert.deepStrictEqual((await layer(bob.id)).map(s => s.id), ['m1', 'm3', 'm4']), { timeout: 5000, interval: 200 });
			assert.deepStrictEqual((await layer(alice.id)).map(s => s.id), ['a1']);
			// 部屋主(alice)は、bobのレイヤーを消去できる
			sendToChannel(aliceWs, 'clearLayerOf', { userId: bob.id });
			await vi.waitFor(async () => assert.deepStrictEqual(await layer(bob.id), []), { timeout: 5000, interval: 200 });
			assert.deepStrictEqual((await layer(alice.id)).map(s => s.id), ['a1']);
		} finally {
			aliceWs.close();
			bobWs.close();
			carolWs.close();
		}
		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('選択範囲の境目で切った線は同じ位置に置き換わり、選んだ部分だけを動かす・消せる', async () => {
		const room = await createRoom(alice);
		const aliceWs = await connectStream(alice, 'drawRoom', () => {}, { roomId: room.id });
		type Stroke = { id: string; dx?: number; dy?: number };
		const mine = async () => ((await layersOf(room, alice)).find(l => l.userId === alice.id)?.strokes ?? []) as Stroke[];
		const piece = (id: string, points: [number, number, number][]) => ({ id, tool: 'pen', color: '#112233', size: 4, points: encodePoints(points) });
		try {
			for (const id of ['s0', 's1', 's2']) sendToChannel(aliceWs, 'stroke', stroke(id));
			await vi.waitFor(async () => assert.strictEqual((await mine()).length, 3), { timeout: 5000, interval: 200 });

			// s1を2つに切り、後ろの部分(s1b)だけを動かす。切った線は元の線と同じ位置(重なり順)に入る
			sendToChannel(aliceWs, 'moveStrokes', {
				strokeIds: ['s1b'], dx: 5, dy: 5,
				splits: [{ id: 's1', pieces: [piece('s1a', [[10, 10, 0.5], [15, 15, 0.6]]), piece('s1b', [[15, 15, 0.6], [20, 20, 0.8], [30, 25, 1]])] }],
			});
			await vi.waitFor(async () => {
				assert.deepStrictEqual((await mine()).map(s => [s.id, s.dx ?? 0]), [['s0', 0], ['s1a', 0], ['s1b', 5], ['s2', 0]]);
			}, { timeout: 5000, interval: 200 });

			// s2を切って、前の部分(s2a)だけを消す
			sendToChannel(aliceWs, 'deleteStrokes', {
				strokeIds: ['s2a'],
				splits: [{ id: 's2', pieces: [piece('s2a', [[10, 10, 0.5], [15, 15, 0.6]]), piece('s2b', [[15, 15, 0.6], [30, 25, 1]])] }],
			});
			await vi.waitFor(async () => {
				assert.deepStrictEqual((await mine()).map(s => s.id), ['s0', 's1a', 's1b', 's2b']);
			}, { timeout: 5000, interval: 200 });

			// 回転などで、線を1本の別の線に置き換える(同じ位置に入る)
			sendToChannel(aliceWs, 'replaceStrokes', { replacements: [{ id: 's0', pieces: [piece('s0r', [[20, 10, 1], [10, 20, 1]])] }] });
			await vi.waitFor(async () => {
				assert.deepStrictEqual((await mine()).map(s => s.id), ['s0r', 's1a', 's1b', 's2b']);
			}, { timeout: 5000, interval: 200 });

			// 塗りつぶし(fill)の線も描ける。置き換える線が空の置き換えは受け付けない
			sendToChannel(aliceWs, 'stroke', { id: 'f1', tool: 'fill', color: '#ff0000', size: 1, points: encodePoints([[10, 10, 1], [60, 10, 1], [60, 60, 1], [10, 60, 1]]) });
			sendToChannel(aliceWs, 'replaceStrokes', { replacements: [{ id: 's1a', pieces: [] }] });
			await vi.waitFor(async () => {
				assert.deepStrictEqual((await mine()).map(s => s.id), ['s0r', 's1a', 's1b', 's2b', 'f1']);
			}, { timeout: 5000, interval: 200 });

			// 筆の種類(にじみ・ドット)と、線の中だけ塗る範囲も保存される。知らない筆の種類は受け付けない
			const clip = encodePoints([[0, 0, 0], [100, 0, 1], [100, 100, 1], [0, 100, 1]]);
			sendToChannel(aliceWs, 'stroke', { ...stroke('b1'), brush: 'soft' });
			sendToChannel(aliceWs, 'stroke', { ...stroke('b2'), brush: 'dot', clip });
			sendToChannel(aliceWs, 'stroke', { ...stroke('b3'), brush: 'unknown' });
			await vi.waitFor(async () => {
				const strokes = (await mine()) as (Stroke & { brush?: string; clip?: string })[];
				assert.deepStrictEqual(strokes.slice(-2).map(s => [s.id, s.brush, s.clip ?? null]), [['b1', 'soft', null], ['b2', 'dot', clip]]);
			}, { timeout: 5000, interval: 200 });
		} finally {
			aliceWs.close();
		}
		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('線の置き換えが断られたら、送った本人にだけ知らされ、レイヤーは変わらない', async () => {
		const room = await createRoom(alice);
		const rejected: string[] = [];
		const aliceWs = await connectStream(alice, 'drawRoom', (msg) => {
			if (msg.type === 'operationRejected') rejected.push('alice');
		}, { roomId: room.id });
		const carolWs = await connectStream(carol, 'drawRoom', (msg) => {
			if (msg.type === 'operationRejected') rejected.push('carol');
		}, { roomId: room.id });
		type Stroke = { id: string; dx?: number };
		const mine = async () => ((await layersOf(room, alice)).find(l => l.userId === alice.id)?.strokes ?? []) as Stroke[];
		const piece = (id: string) => ({ id, tool: 'pen', color: '#112233', size: 4, points: encodePoints([[10, 10, 0.5], [20, 20, 0.8]]) });
		try {
			for (const id of ['r0', 'r1']) sendToChannel(aliceWs, 'stroke', stroke(id));
			await vi.waitFor(async () => assert.strictEqual((await mine()).length, 2), { timeout: 5000, interval: 200 });

			// 置き換えた後の線のidが、置き換えない線(r0)と重なるので断られる。後の移動もしない
			sendToChannel(aliceWs, 'moveStrokes', { strokeIds: ['r0'], dx: 5, dy: 5, splits: [{ id: 'r1', pieces: [piece('r0'), piece('r1b')] }] });
			await vi.waitFor(() => assert.deepStrictEqual(rejected, ['alice']), { timeout: 5000, interval: 200 });
			// 置き換える線のid同士が重なるものは、受け取った時点で断られる
			sendToChannel(aliceWs, 'replaceStrokes', { replacements: [{ id: 'r1', pieces: [piece('x1'), piece('x1')] }] });
			await vi.waitFor(() => assert.deepStrictEqual(rejected, ['alice', 'alice']), { timeout: 5000, interval: 200 });
			assert.deepStrictEqual((await mine()).map(s => [s.id, s.dx ?? 0]), [['r0', 0], ['r1', 0]]);
		} finally {
			aliceWs.close();
			carolWs.close();
		}
		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('1人が複数のレイヤーを持て、レイヤーを消すとその線も消える。レイヤーだけを消去できる', async () => {
		const room = await createRoom(alice, { keepAfterEnd: true });
		const aliceWs = await connectStream(alice, 'drawRoom', () => {}, { roomId: room.id });
		type Stroke = { id: string; layer?: string; tool: string; brush?: string };
		type Layer = { id: string; name: string; visible: boolean; opacity: number };
		const mine = async () => (await layersOf(room, alice)).find(l => l.userId === alice.id) as unknown as { strokes: Stroke[]; layers: Layer[] } | undefined;
		try {
			// 最初はレイヤー1枚だけ(レイヤーの一覧を送っていなくても、描いた人には最初のレイヤーがある)
			sendToChannel(aliceWs, 'stroke', stroke('b0'));
			await vi.waitFor(async () => assert.deepStrictEqual((await mine())?.layers.map(l => l.id), ['0']), { timeout: 5000, interval: 200 });

			// レイヤーを足して(上に)、そのレイヤーに描く
			sendToChannel(aliceWs, 'setLayers', { layers: [
				{ id: '0', name: '', visible: true, opacity: 1 },
				{ id: 'top', name: '色', visible: false, opacity: 0.5 },
			] });
			await vi.waitFor(async () => assert.deepStrictEqual((await mine())?.layers, [
				{ id: '0', name: '', visible: true, opacity: 1 },
				{ id: 'top', name: '色', visible: false, opacity: 0.5 },
			]), { timeout: 5000, interval: 200 });
			sendToChannel(aliceWs, 'stroke', { ...stroke('t1'), layer: 'top' });
			sendToChannel(aliceWs, 'stroke', { ...stroke('t2'), layer: 'top' });
			await vi.waitFor(async () => assert.deepStrictEqual((await mine())?.strokes.map(s => [s.id, s.layer ?? '0']), [['b0', '0'], ['t1', 'top'], ['t2', 'top']]), { timeout: 5000, interval: 200 });

			// そのレイヤーの線だけを消去する
			sendToChannel(aliceWs, 'clearLayer', { layer: 'top' });
			await vi.waitFor(async () => assert.deepStrictEqual((await mine())?.strokes.map(s => s.id), ['b0']), { timeout: 5000, interval: 200 });

			// レイヤーを消すと、そのレイヤーの線も消える
			sendToChannel(aliceWs, 'stroke', { ...stroke('t3'), layer: 'top' });
			await vi.waitFor(async () => assert.strictEqual((await mine())?.strokes.length, 2), { timeout: 5000, interval: 200 });
			sendToChannel(aliceWs, 'setLayers', { layers: [{ id: 'top', name: '色', visible: true, opacity: 1 }] });
			await vi.waitFor(async () => {
				const layer = await mine();
				assert.deepStrictEqual(layer?.layers.map(l => l.id), ['top']);
				assert.deepStrictEqual(layer?.strokes.map(s => s.id), ['t3']);
			}, { timeout: 5000, interval: 200 });

			// 囲った範囲を消すのは消しゴムだけ(ペンでは断られる)
			const area = { tool: 'eraser', brush: 'area', color: '#000000', size: 1, layer: 'top', points: encodePoints([[0, 0, 1], [50, 0, 1], [50, 50, 1]]) };
			sendToChannel(aliceWs, 'stroke', { ...area, id: 'e1' });
			sendToChannel(aliceWs, 'stroke', { ...area, id: 'p1', tool: 'pen' });
			// 一覧に無いレイヤー(消した'0'・一度も無い'ghost')への線は入れない
			sendToChannel(aliceWs, 'stroke', stroke('z1'));
			sendToChannel(aliceWs, 'stroke', { ...stroke('g1'), layer: 'ghost' });
			sendToChannel(aliceWs, 'stroke', { ...stroke('t4'), layer: 'top' });
			await vi.waitFor(async () => assert.deepStrictEqual((await mine())?.strokes.map(s => s.id), ['t3', 'e1', 't4']), { timeout: 5000, interval: 200 });

			// 線を置き換えるときも、一覧に無いレイヤーの線にはできない
			sendToChannel(aliceWs, 'replaceStrokes', { replacements: [{ id: 't4', pieces: [{ ...stroke('g2'), layer: 'ghost' }] }] });

			// 持っていないレイヤーの消去は何もしない
			sendToChannel(aliceWs, 'clearLayer', { layer: 'ghost' });

			// レイヤーの名前は、制御文字を除いて前後の空白を取る
			// (直前の操作と同じ1秒に入ると回数制限にかかるので、少し待つ)
			await new Promise(resolve => setTimeout(resolve, 1100));
			sendToChannel(aliceWs, 'setLayers', { layers: [{ id: 'top', name: ' 色\nいろ ', visible: true, opacity: 1 }] });
			await vi.waitFor(async () => assert.strictEqual((await mine())?.layers[0].name, '色いろ'), { timeout: 5000, interval: 200 });
			assert.deepStrictEqual((await mine())?.strokes.map(s => s.id), ['t3', 'e1', 't4']);

			// レイヤーの一覧が不正(9枚以上・idが重なる・0枚)なら受け付けない
			const many = Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, name: '', visible: true, opacity: 1 }));
			sendToChannel(aliceWs, 'setLayers', { layers: many });
			sendToChannel(aliceWs, 'setLayers', { layers: [{ id: 'x', name: '', visible: true, opacity: 1 }, { id: 'x', name: '', visible: true, opacity: 1 }] });
			sendToChannel(aliceWs, 'setLayers', { layers: [] });
			sendToChannel(aliceWs, 'stroke', { ...stroke('t5'), layer: 'top' });
			await vi.waitFor(async () => assert.strictEqual((await mine())?.strokes.at(-1)?.id, 't5'), { timeout: 5000, interval: 200 });
			assert.deepStrictEqual((await mine())?.layers.map(l => l.id), ['top']);
		} finally {
			aliceWs.close();
		}
		// 保存する部屋は、終了後もレイヤーの一覧が残る
		await call('draw-rooms/end', { roomId: room.id }, alice);
		assert.deepStrictEqual((await mine())?.layers.map(l => l.id), ['top']);
	});

	test('下描きのレイヤーは本人にだけ見え、みんなに見せるようにすると線が届く', async () => {
		const room = await createRoom(alice, { keepAfterEnd: true });
		type Stroke = { id: string; layer?: string };
		type Layer = { id: string; private?: boolean };
		const received: { type: string; body: any }[] = [];
		const bobWs = await connectStream(bob, 'drawRoom', (msg) => received.push(msg), { roomId: room.id });
		const aliceWs = await connectStream(alice, 'drawRoom', () => {}, { roomId: room.id });
		const view = async (viewer: typeof alice) => (await layersOf(room, viewer)).find(l => l.userId === alice.id) as unknown as { strokes: Stroke[]; layers: Layer[] } | undefined;
		try {
			sendToChannel(aliceWs, 'setLayers', { layers: [
				{ id: '0', name: '', visible: true, opacity: 1 },
				{ id: 'draft', name: '下描き', visible: true, opacity: 0.5, private: true },
			] });
			await vi.waitFor(async () => assert.deepStrictEqual((await view(alice))?.layers.map(l => [l.id, l.private ?? false]), [['0', false], ['draft', true]]), { timeout: 5000, interval: 200 });
			sendToChannel(aliceWs, 'strokePart', { strokeId: 'd1', tool: 'pen', color: '#000000', size: 4, layer: 'draft', points: encodePoints([[1, 1, 1]]) });
			sendToChannel(aliceWs, 'stroke', { ...stroke('d1'), layer: 'draft' });
			sendToChannel(aliceWs, 'stroke', stroke('p1'));
			await vi.waitFor(async () => assert.deepStrictEqual((await view(alice))?.strokes.map(s => s.id), ['d1', 'p1']), { timeout: 5000, interval: 200 });

			// ほかの人には、下描きのレイヤーもその線も返らない・流れない
			const bobView = await view(bob);
			assert.deepStrictEqual(bobView?.layers.map(l => l.id), ['0']);
			assert.deepStrictEqual(bobView?.strokes.map(s => s.id), ['p1']);
			await vi.waitFor(() => assert.ok(received.some(m => m.type === 'stroke' && m.body.stroke.id === 'p1')), { timeout: 5000, interval: 100 });
			assert.ok(!received.some(m => (m.type === 'stroke' || m.type === 'strokePart') && (m.body.stroke?.id === 'd1' || m.body.strokeId === 'd1')));
			assert.ok(received.filter(m => m.type === 'layersUpdated').every(m => m.body.layers.every((l: Layer) => !l.private)));

			// みんなに見せるようにすると、その時点の線がまとめて届く
			sendToChannel(aliceWs, 'setLayers', { layers: [
				{ id: '0', name: '', visible: true, opacity: 1 },
				{ id: 'draft', name: '下描き', visible: true, opacity: 0.5 },
			] });
			await vi.waitFor(() => {
				const published = received.find(m => m.type === 'layerPublished');
				assert.strictEqual(published?.body.layer, 'draft');
				assert.deepStrictEqual(published?.body.strokes.map((s: Stroke) => s.id), ['d1']);
			}, { timeout: 5000, interval: 100 });
			assert.deepStrictEqual((await view(bob))?.strokes.map(s => s.id), ['d1', 'p1']);

			// 下描きに戻すと、保存した部屋でもほかの人には見えない
			sendToChannel(aliceWs, 'setLayers', { layers: [
				{ id: '0', name: '', visible: true, opacity: 1 },
				{ id: 'draft', name: '下描き', visible: true, opacity: 0.5, private: true },
			] });
			await vi.waitFor(async () => assert.deepStrictEqual((await view(bob))?.strokes.map(s => s.id), ['p1']), { timeout: 5000, interval: 200 });
		} finally {
			aliceWs.close();
			bobWs.close();
		}
		await call('draw-rooms/end', { roomId: room.id }, alice);
		assert.deepStrictEqual((await view(bob))?.strokes.map(s => s.id), ['p1']);
		assert.deepStrictEqual((await view(alice))?.strokes.map(s => s.id), ['d1', 'p1']);
	});

	test('描いている途中で下描きに変えた線は、ほかの人の画面から取り消される。線を切ったときは下描きの線だけを除いて届く', async () => {
		const room = await createRoom(alice);
		const received: { type: string; body: any }[] = [];
		const bobWs = await connectStream(bob, 'drawRoom', (msg) => received.push(msg), { roomId: room.id });
		const aliceWs = await connectStream(alice, 'drawRoom', () => {}, { roomId: room.id });
		const publicLayers = [{ id: '0', name: '', visible: true, opacity: 1 }, { id: 'd', name: '', visible: true, opacity: 1 }];
		try {
			sendToChannel(aliceWs, 'setLayers', { layers: publicLayers });
			await vi.waitFor(() => assert.ok(received.some(m => m.type === 'layersUpdated')), { timeout: 5000, interval: 100 });
			sendToChannel(aliceWs, 'strokePart', { strokeId: 'x1', tool: 'pen', color: '#000000', size: 4, layer: 'd', points: encodePoints([[1, 1, 1]]) });
			await vi.waitFor(() => assert.ok(received.some(m => m.type === 'strokePart' && m.body.strokeId === 'x1')), { timeout: 5000, interval: 100 });

			// 途中で下描きにする → 確定した線は届かず、途中まで届いた分は取り消される
			sendToChannel(aliceWs, 'setLayers', { layers: [publicLayers[0], { ...publicLayers[1], private: true }] });
			await vi.waitFor(() => assert.ok(received.some(m => m.type === 'layersUpdated' && m.body.layers.length === 1)), { timeout: 5000, interval: 100 });
			sendToChannel(aliceWs, 'stroke', { ...stroke('x1'), layer: 'd' });
			await vi.waitFor(() => assert.ok(received.some(m => m.type === 'strokeCancel' && m.body.strokeId === 'x1')), { timeout: 5000, interval: 100 });
			assert.ok(!received.some(m => m.type === 'stroke' && m.body.stroke.id === 'x1'));

			// 線を切って、公開のレイヤーと下描きのレイヤーの線に置き換えると、ほかの人には公開の分だけが届く
			sendToChannel(aliceWs, 'stroke', stroke('p1'));
			await vi.waitFor(() => assert.ok(received.some(m => m.type === 'stroke' && m.body.stroke.id === 'p1')), { timeout: 5000, interval: 100 });
			await new Promise(resolve => setTimeout(resolve, 1100));
			sendToChannel(aliceWs, 'replaceStrokes', { replacements: [{ id: 'p1', pieces: [stroke('p1a'), { ...stroke('p1b'), layer: 'd' }] }] });
			await vi.waitFor(() => {
				const split = received.find(m => m.type === 'strokesSplit');
				assert.deepStrictEqual(split?.body.splits.map((s: { id: string; pieces: { id: string }[] }) => [s.id, s.pieces.map(p => p.id)]), [['p1', ['p1a']]]);
				assert.strictEqual(split?.body.privateLayers, undefined);
			}, { timeout: 5000, interval: 100 });
		} finally {
			aliceWs.close();
			bobWs.close();
		}
		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('大きいキャンバス(3840×3840)でも、端まで描いた線を受け付ける', async () => {
		const room = await createRoom(alice, { canvasPreset: 'square3840' });
		const aliceWs = await connectStream(alice, 'drawRoom', () => {}, { roomId: room.id });
		try {
			sendToChannel(aliceWs, 'stroke', { ...stroke('outside'), points: encodePoints([[3840 + 250, 10, 1]]) });
			sendToChannel(aliceWs, 'stroke', { ...stroke('corner'), points: encodePoints([[3839.875, 3839.875, 1], [3900, 3900, 0.5]]) });
			await vi.waitFor(async () => {
				const layers = await layersOf(room, alice);
				assert.deepStrictEqual(layers.find(l => l.userId === alice.id)?.strokes.map(s => s.id), ['corner']);
			}, { timeout: 5000, interval: 200 });
		} finally {
			aliceWs.close();
		}
		await call('draw-rooms/end', { roomId: room.id }, alice);
	});

	test('「保存する」部屋は終了後も線とチャットを見られ、描けない。部屋主は後から削除できる', async () => {
		const room = await createRoom(alice, { keepAfterEnd: true });
		const aliceWs = await connectStream(alice, 'drawRoom', () => {}, { roomId: room.id });
		try {
			sendToChannel(aliceWs, 'stroke', stroke('kept1'));
			sendToChannel(aliceWs, 'chat', { text: 'hello' });
			await vi.waitFor(async () => {
				const layers = await layersOf(room, alice);
				assert.deepStrictEqual(layers.find(l => l.userId === alice.id)?.strokes.map(s => s.id), ['kept1']);
			}, { timeout: 5000, interval: 200 });
		} finally {
			aliceWs.close();
		}

		const ended = (await call('draw-rooms/end', { roomId: room.id }, alice)).body as DrawRoom;
		assert.strictEqual(ended.isEnded, true);

		const layers = await layersOf(room, bob);
		assert.deepStrictEqual(layers.find(l => l.userId === alice.id)?.strokes.map(s => s.id), ['kept1']);
		const chat = (await call('draw-rooms/chat-history', { roomId: room.id }, bob)).body as { message: { text: string } }[];
		assert.deepStrictEqual(chat.map(c => c.message.text), ['hello']);

		assert.strictEqual((await call('draw-rooms/join', { roomId: room.id }, bob)).body.error.code, 'ROOM_ENDED');
		const aliceRooms = (await call('draw-rooms/list', { userId: alice.id }, bob)).body as DrawRoom[];
		assert.strictEqual(aliceRooms.some(r => r.id === room.id), true);

		assert.strictEqual((await call('draw-rooms/delete', { roomId: room.id }, bob)).body.error.code, 'NOT_OWNER');
		assert.strictEqual((await call('draw-rooms/delete', { roomId: room.id }, alice)).status, 204);
		assert.strictEqual((await call('draw-rooms/show', { roomId: room.id }, alice)).body.error.code, 'NO_SUCH_ROOM');
	});

	test('「保存しない」部屋は、保存した部屋の一覧には出ず、削除されるまでは部屋の一覧に削除の予定と一緒に出る。部屋主はすぐ削除できる', async () => {
		const room = await createRoom(alice, { keepAfterEnd: false });
		await call('draw-rooms/end', { roomId: room.id }, alice);
		const aliceRooms = (await call('draw-rooms/list', { userId: alice.id }, alice)).body as DrawRoom[];
		assert.strictEqual(aliceRooms.some(r => r.id === room.id), false);

		// 削除されるまでの間は、見られる人の部屋の一覧に出る(終了から1時間後に削除される予定)
		const listed = ((await call('draw-rooms/list', {}, bob)).body as DrawRoom[]).find(r => r.id === room.id);
		assert.ok(listed != null);
		assert.strictEqual(listed.isEnded, true);
		assert.ok(listed.endedAt != null && listed.deletesAt != null);
		assert.strictEqual(new Date(listed.deletesAt).getTime() - new Date(listed.endedAt).getTime(), 1000 * 60 * 60);

		// 部屋主以外は削除できず、部屋主は時間を待たずに削除できる
		assert.strictEqual((await call('draw-rooms/delete', { roomId: room.id }, bob)).body.error.code, 'NOT_OWNER');
		assert.strictEqual((await call('draw-rooms/delete', { roomId: room.id }, alice)).status, 204);
		assert.strictEqual(((await call('draw-rooms/list', {}, bob)).body as DrawRoom[]).some(r => r.id === room.id), false);
		// 終了していない部屋は削除できない(先に終了する)
		const active = await createRoom(alice);
		assert.strictEqual((await call('draw-rooms/delete', { roomId: active.id }, alice)).body.error.code, 'ROOM_NOT_ENDED');
		await call('draw-rooms/end', { roomId: active.id }, alice);
	});
});
