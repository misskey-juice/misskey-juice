/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type * as Misskey from 'misskey-js';
import { describe, test, expect } from 'vitest';
import { LocalDrawRoomConnection } from '@/utility/draw-room-local.js';
import type { LocalDrawRoomState } from '@/utility/draw-room-local.js';

const stroke = (id: string, layer?: string): Misskey.entities.DrawStroke => ({
	id, tool: 'pen', color: '#000000', size: 4, points: 'AAAA', ...(layer != null ? { layer } : {}),
});

// 出来事は少し後に届くので、届くのを待つ
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

function setup(initial?: Partial<LocalDrawRoomState>) {
	const saved: LocalDrawRoomState[] = [];
	const events: { type: string; payload: any }[] = [];
	const c = new LocalDrawRoomConnection('me', { strokes: initial?.strokes ?? [], layers: initial?.layers ?? [] }, state => saved.push(state), 100);
	for (const type of ['stroke', 'strokeCancel', 'strokesPatched', 'clearLayer', 'layersUpdated', 'layerMerged', 'strokesMoved', 'strokesSplit', 'strokesDeleted', 'operationRejected', 'strokeLimitReached']) {
		c.on(type, payload => events.push({ type, payload }));
	}
	return { c, saved, events };
}

const ids = (c: LocalDrawRoomConnection) => c.strokes.map(s => s.id);

describe('LocalDrawRoomConnection', () => {
	test('描いた線を取り消し・やり直しできる', async () => {
		const { c, events } = setup();
		c.send('stroke', stroke('a'));
		c.send('stroke', stroke('b'));
		expect(ids(c)).toEqual(['a', 'b']);
		c.send('undo', {});
		expect(ids(c)).toEqual(['a']);
		c.send('redo', {});
		expect(ids(c)).toEqual(['a', 'b']);
		await flush();
		const patched = events.filter(e => e.type === 'strokesPatched');
		expect(patched[0].payload.steps).toEqual([{ t: 'del', ids: ['b'] }]);
		expect(patched[1].payload.steps[0].items[0].stroke.id).toBe('b');
	});

	test('新しく描いたら、やり直しの履歴は消える', () => {
		const { c } = setup();
		c.send('stroke', stroke('a'));
		c.send('undo', {});
		c.send('stroke', stroke('b'));
		c.send('redo', {});
		expect(ids(c)).toEqual(['b']);
	});

	test('消した線は元の位置に戻る', () => {
		const { c } = setup({ strokes: [stroke('a'), stroke('b'), stroke('c')] });
		c.send('deleteStrokes', { strokeIds: ['b'] });
		expect(ids(c)).toEqual(['a', 'c']);
		c.send('undo', {});
		expect(ids(c)).toEqual(['a', 'b', 'c']);
	});

	test('移動を取り消すと元の位置に戻る', () => {
		const { c } = setup({ strokes: [stroke('a')] });
		c.send('moveStrokes', { strokeIds: ['a'], dx: 10, dy: -5 });
		expect(c.strokes[0]).toMatchObject({ dx: 10, dy: -5 });
		c.send('undo', {});
		expect(c.strokes[0]).toMatchObject({ dx: 0, dy: 0 });
	});

	test('境目で切ってから動かした操作は、1回の取り消しで戻る', () => {
		const { c } = setup({ strokes: [stroke('a')] });
		c.send('moveStrokes', { strokeIds: ['a1'], dx: 4, dy: 0, splits: [{ id: 'a', pieces: [stroke('a1'), stroke('a2')] }] });
		expect(ids(c)).toEqual(['a1', 'a2']);
		expect(c.strokes[0].dx).toBe(4);
		c.send('undo', {});
		expect(ids(c)).toEqual(['a']);
		expect(c.strokes[0].dx).toBeUndefined();
	});

	test('レイヤーを消しても、取り消しでレイヤーと線が戻る', async () => {
		const layers = [{ id: '0', name: '', visible: true, opacity: 1 }, { id: 'x', name: 'x', visible: true, opacity: 1 }];
		const { c } = setup({ strokes: [stroke('a'), stroke('b', 'x')], layers });
		c.send('setLayers', { layers: [layers[0]] });
		expect(ids(c)).toEqual(['a']);
		expect(c.layers.map(l => l.id)).toEqual(['0']);
		c.send('undo', {});
		expect(c.layers.map(l => l.id)).toEqual(['0', 'x']);
		expect(ids(c)).toEqual(['a', 'b']);
	});

	test('全てのレイヤーを新しい1枚に置き換えても、取り消しで8枚と線が全て戻り、新しいレイヤーは消える', () => {
		const layers = Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, name: `l${i}`, visible: true, opacity: 1 }));
		const { c } = setup({ strokes: layers.map(l => stroke(`s-${l.id}`, l.id)), layers });
		c.send('setLayers', { layers: [{ id: 'new', name: '', visible: true, opacity: 1 }] });
		expect(c.layers.map(l => l.id)).toEqual(['new']);
		expect(ids(c)).toEqual([]);
		c.send('undo', {});
		expect(c.layers.map(l => l.id)).toEqual(layers.map(l => l.id));
		expect(ids(c)).toEqual(layers.map(l => `s-${l.id}`));
		c.send('redo', {});
		expect(c.layers.map(l => l.id)).toEqual(['new']);
		expect(ids(c)).toEqual([]);
	});

	test('レイヤーを消した後に追加したレイヤーは、順に取り消せる', () => {
		const layers = [{ id: '0', name: '', visible: true, opacity: 1 }, { id: 'x', name: 'x', visible: true, opacity: 1 }];
		const { c } = setup({ strokes: [stroke('b', 'x')], layers });
		c.send('setLayers', { layers: [layers[0]] });
		c.send('setLayers', { layers: [layers[0], { id: 'y', name: 'y', visible: true, opacity: 1 }] });
		c.send('stroke', stroke('c', 'y'));
		c.send('undo', {});
		c.send('undo', {});
		expect(c.layers.map(l => l.id)).toEqual(['0']);
		c.send('undo', {});
		expect(c.layers.map(l => l.id)).toEqual(['0', 'x']);
		expect(ids(c)).toEqual(['b']);
	});

	test('無いレイヤーへの線は受け付けない', async () => {
		const { c, events } = setup();
		c.send('stroke', stroke('a', 'nope'));
		expect(ids(c)).toEqual([]);
		await flush();
		expect(events.map(e => e.type)).toEqual(['strokeCancel']);
	});

	test('上限を超えた線は受け付けず、上限を知らせる', async () => {
		const { c, events } = setup({ strokes: Array.from({ length: 100 }, (_, i) => stroke(`s${i}`)) });
		c.send('stroke', stroke('over'));
		expect(c.strokes.length).toBe(100);
		await flush();
		expect(events.map(e => e.type)).toEqual(['strokeCancel', 'strokeLimitReached']);
	});

	test('下へ結合すると、結合先の線の後ろに並び、結合元の濃さを引き継ぐ', async () => {
		const layers = [{ id: '0', name: '', visible: true, opacity: 1 }, { id: 'x', name: 'x', visible: true, opacity: 0.5 }];
		const { c, events } = setup({ strokes: [stroke('b', 'x'), stroke('a')], layers });
		c.send('mergeLayer', { from: 'x', into: '0' });
		expect(c.layers.map(l => l.id)).toEqual(['0']);
		expect(ids(c)).toEqual(['a', 'b']);
		const group = c.layers[0].groups?.find(g => g.id === c.strokes[1].g);
		expect(group?.opacity).toBe(0.5);
		// 結合先の線はそのまま(まとまりを付けない)
		expect(c.strokes[0].g).toBeUndefined();
		await flush();
		expect(events.map(e => e.type)).toEqual(['layersUpdated', 'layerMerged']);
	});

	test('となりでないレイヤーへの結合は断る', async () => {
		const layers = ['0', 'x', 'y'].map(id => ({ id, name: id, visible: true, opacity: 1 }));
		const { c, events } = setup({ layers });
		c.send('mergeLayer', { from: 'y', into: '0' });
		await flush();
		expect(events.map(e => e.type)).toEqual(['operationRejected']);
	});

	test('レイヤーの消去も取り消せる', () => {
		const { c } = setup({ strokes: [stroke('a'), stroke('b')] });
		c.send('clearLayer', { layer: '0' });
		expect(ids(c)).toEqual([]);
		c.send('undo', {});
		expect(ids(c)).toEqual(['a', 'b']);
	});

	test('変わるたびに保存のために知らせる', () => {
		const { c, saved } = setup();
		c.send('stroke', stroke('a'));
		expect(saved.at(-1)?.strokes.map(s => s.id)).toEqual(['a']);
	});

	test('閉じた後は出来事を届けない', async () => {
		const { c, events } = setup();
		c.send('stroke', stroke('a'));
		c.dispose();
		await flush();
		expect(events).toEqual([]);
	});
});
