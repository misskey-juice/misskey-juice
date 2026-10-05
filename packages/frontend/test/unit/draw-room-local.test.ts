/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type * as Misskey from 'misskey-js';
import { describe, test, expect } from 'vitest';
import { LocalDrawRoomConnection, applyHistorySteps, shiftStrokeEdits } from '@/utility/draw-room-local.js';
import type { LocalDrawRoomState } from '@/utility/draw-room-local.js';

const stroke = (id: string, layer?: string): Misskey.entities.DrawStroke => ({
	id, tool: 'pen', color: '#000000', size: 4, points: 'AAAA', ...(layer != null ? { layer } : {}),
});

// 出来事は少し後に届くので、届くのを待つ
const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

function setup(initial?: Partial<LocalDrawRoomState>) {
	const saved: LocalDrawRoomState[] = [];
	const events: { type: string; payload: any }[] = [];
	const c = new LocalDrawRoomConnection('me', { strokes: initial?.strokes ?? [], layers: initial?.layers ?? [], layerEvents: initial?.layerEvents, strokeEdits: initial?.strokeEdits }, state => saved.push(state), 100);
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

	test('レイヤーの表示・非表示を変えたら、その時点の線を目印にして記録する', () => {
		const layers = [{ id: '0', name: '', visible: true, opacity: 1 }, { id: 'x', name: 'x', visible: true, opacity: 1 }];
		const { c, saved } = setup({ strokes: [stroke('a'), stroke('b', 'x')], layers });
		c.send('setLayers', { layers: [{ ...layers[0], visible: false }, layers[1]] });
		// 先頭は、記録を始める前の見え方
		expect(c.layerEvents).toEqual([
			{ after: null, index: 0, layers: [{ id: '0', visible: true, opacity: 1 }, { id: 'x', visible: true, opacity: 1 }] },
			{ seq: 1, after: 'b', index: 2, layers: [{ id: '0', visible: false, opacity: 1 }, { id: 'x', visible: true, opacity: 1 }] },
		]);
		expect(saved.at(-1)?.layerEvents).toEqual(c.layerEvents);
		c.send('stroke', stroke('c', 'x'));
		c.send('setLayers', { layers: [{ ...layers[0], visible: true }, layers[1]] });
		expect(c.layerEvents.at(-1)).toMatchObject({ after: 'c', index: 3 });
		expect(c.layerEvents.length).toBe(3);
	});

	test('濃さを変えて戻した分も1回ずつ残し、名前だけの変更は記録しない', () => {
		const layers = [{ id: '0', name: '', visible: true, opacity: 1 }];
		const { c } = setup({ strokes: [stroke('a')], layers });
		c.send('setLayers', { layers: [{ ...layers[0], name: 'renamed' }] });
		expect(c.layerEvents).toEqual([]);
		c.send('setLayers', { layers: [{ ...layers[0], opacity: 0.5 }] });
		c.send('setLayers', { layers: [{ ...layers[0], opacity: 1 }] });
		expect(c.layerEvents.map(event => event.layers[0].opacity)).toEqual([1, 0.5, 1]);
	});

	test('合成モードの変更も記録する', () => {
		const layers = [{ id: '0', name: '', visible: true, opacity: 1 }];
		const { c } = setup({ strokes: [stroke('a')], layers });
		c.send('setLayers', { layers: [{ ...layers[0], blend: 'multiply' }] });
		c.send('setLayers', { layers: [{ ...layers[0] }] });
		expect(c.layerEvents.map(event => event.layers[0].blend ?? 'normal')).toEqual(['normal', 'multiply', 'normal']);
	});

	test('前に保存した記録を引き継ぐ', () => {
		const layers = [{ id: '0', name: '', visible: true, opacity: 1 }];
		const events = [{ after: null, index: 0, layers: [{ id: '0', visible: false, opacity: 1 }] }, { after: 'a', index: 1, layers: [{ id: '0', visible: true, opacity: 1 }] }];
		const { c } = setup({ strokes: [stroke('a')], layers, layerEvents: events });
		c.send('setLayers', { layers: [{ ...layers[0], visible: false }] });
		expect(c.layerEvents.length).toBe(3);
		expect(c.layerEvents[2]).toEqual({ seq: 1, after: 'a', index: 1, layers: [{ id: '0', visible: false, opacity: 1 }] });
	});

	test('線を描かずに隠して、また出したら、どちらも記録に残る', () => {
		const layers = [{ id: '0', name: '', visible: true, opacity: 1 }];
		const { c } = setup({ strokes: [stroke('a')], layers });
		c.send('setLayers', { layers: [{ ...layers[0], visible: false }] });
		c.send('setLayers', { layers: [{ ...layers[0], visible: true }] });
		expect(c.layerEvents.map(event => event.layers[0].visible)).toEqual([true, false, true]);
	});

	test('レイヤーを結合したら、前の記録は結合先にまとめる(どちらかが見えていた間は見えていたことにする)', () => {
		const layers = [{ id: '0', name: '', visible: true, opacity: 1 }, { id: 'x', name: 'x', visible: true, opacity: 1 }];
		const { c } = setup({ strokes: [stroke('a')], layers });
		// 下のレイヤーを隠して、上のレイヤーに描いてから、下へ結合する
		c.send('setLayers', { layers: [{ ...layers[0], visible: false }, layers[1]] });
		c.send('stroke', stroke('b', 'x'));
		c.send('mergeLayer', { from: 'x', into: '0' });
		expect(c.layers.map(l => l.id)).toEqual(['0']);
		for (const event of c.layerEvents) {
			expect(event.layers.map(l => l.id)).toEqual(['0']);
			// 上のレイヤーはずっと見えていたので、結合先も見えていたことになる
			expect(event.layers[0].visible).toBe(true);
		}
	});

	test('レイヤーの並べ替えも記録し、その後の濃さの変更とは混ぜない', () => {
		const layers = [{ id: '0', name: '', visible: true, opacity: 1 }, { id: 'x', name: 'x', visible: true, opacity: 1 }];
		const { c } = setup({ strokes: [stroke('a')], layers });
		c.send('setLayers', { layers: [layers[1], layers[0]] });
		c.send('setLayers', { layers: [layers[1], { ...layers[0], opacity: 0.5 }] });
		c.send('setLayers', { layers: [layers[1], { ...layers[0], opacity: 0.3 }] });
		expect(c.layerEvents.map(event => event.layers.map(l => `${l.id}:${l.opacity}`).join(','))).toEqual(['0:1,x:1', 'x:1,0:1', 'x:1,0:0.5', 'x:1,0:0.3']);
	});

	// 線の操作の記録を新しい順に戻して、各操作の直前の並びを作る(タイムラプスと同じやり方)
	const rewind = (c: LocalDrawRoomConnection) => {
		const states: Misskey.entities.DrawStroke[][] = [];
		let upper = c.strokes;
		for (const edit of [...c.strokeEdits].reverse()) {
			const before = applyHistorySteps(upper.slice(0, edit.after), edit.u);
			expect(before.length).toBe(edit.before);
			states.unshift(before);
			upper = before;
		}
		return states;
	};

	test('線を描くだけでは操作の記録は増えず、動かすと「動かす前」に戻せる記録が残る', () => {
		const { c, saved } = setup();
		c.send('stroke', stroke('a'));
		c.send('stroke', stroke('b'));
		expect(c.strokeEdits).toEqual([]);
		c.send('moveStrokes', { strokeIds: ['a'], dx: 10, dy: 4 });
		c.send('stroke', stroke('c'));
		expect(c.strokeEdits.length).toBe(1);
		expect(c.strokeEdits[0]).toMatchObject({ before: 2, after: 2 });
		expect(saved.at(-1)?.strokeEdits).toEqual(c.strokeEdits);
		const [before] = rewind(c);
		expect(before.map(s => [s.id, s.dx ?? 0, s.dy ?? 0])).toEqual([['a', 0, 0], ['b', 0, 0]]);
	});

	test('境目で切って動かした操作・置き換え(回転など)・消去も、前の並びに戻せる', () => {
		const { c } = setup({ strokes: [stroke('a'), stroke('b')] });
		c.send('moveStrokes', { strokeIds: ['a1'], dx: 4, dy: 0, splits: [{ id: 'a', pieces: [stroke('a1'), stroke('a2')] }] });
		c.send('replaceStrokes', { replacements: [{ id: 'b', pieces: [{ ...stroke('b'), points: 'BBBB' }] }] });
		c.send('stroke', stroke('c'));
		c.send('deleteStrokes', { strokeIds: ['a2'] });
		expect(c.strokeEdits.map(edit => [edit.before, edit.after])).toEqual([[2, 3], [3, 3], [4, 3]]);
		const states = rewind(c);
		expect(states[0].map(s => s.id)).toEqual(['a', 'b']);
		expect(states[1].map(s => `${s.id}:${s.points}`)).toEqual(['a1:AAAA', 'a2:AAAA', 'b:AAAA']);
		expect(states[2].map(s => s.id)).toEqual(['a1', 'a2', 'b', 'c']);
	});

	test('取り消し・やり直しも記録に残る(取り消した線は、取り消す前の並びに戻すと出てくる)', () => {
		const { c } = setup();
		c.send('stroke', stroke('a'));
		c.send('stroke', stroke('b'));
		c.send('undo', {});
		c.send('stroke', stroke('c'));
		expect(ids(c)).toEqual(['a', 'c']);
		const states = rewind(c);
		expect(states[0].map(s => s.id)).toEqual(['a', 'b']);
		c.send('moveStrokes', { strokeIds: null, dx: 3, dy: 0 });
		c.send('undo', {});
		c.send('redo', {});
		expect(rewind(c).map(state => state.map(s => `${s.id}:${s.dx ?? 0}`))).toEqual([['a:0', 'b:0'], ['a:0', 'c:0'], ['a:3', 'c:3'], ['a:0', 'c:0']]);
	});

	test('レイヤーが複数あっても、操作の前の並びを順番どおりに戻せる', () => {
		const layers = [{ id: '0', name: '', visible: true, opacity: 1 }, { id: '1', name: '', visible: true, opacity: 1 }];
		const { c } = setup({ layers });
		c.send('stroke', stroke('a'));
		c.send('stroke', stroke('b'));
		c.send('stroke', stroke('d', '1'));
		c.send('deleteStrokes', { strokeIds: ['a'] });
		c.send('stroke', stroke('e', '1'));
		// bは、そのレイヤーの最後の線(同じレイヤーに次の線が無い)
		c.send('replaceStrokes', { replacements: [{ id: 'b', pieces: [{ ...stroke('b'), points: 'BBBB' }] }] });
		c.send('undo', {});
		c.send('redo', {});
		expect(rewind(c).map(state => state.map(s => `${s.id}:${s.points}`).join(' '))).toEqual([
			'a:AAAA b:AAAA d:AAAA',
			'b:AAAA d:AAAA e:AAAA',
			'b:BBBB d:AAAA e:AAAA',
			// 取り消しで戻した線は、同じレイヤーに次の線が無ければ並びの最後に入る(実際の並びのとおりに戻る)
			'd:AAAA e:AAAA b:AAAA',
		]);
		expect(ids(c)).toEqual(['d', 'e', 'b']);
	});

	test('線の並びが変わらない操作(当てはまる線の無い移動)は記録しない', () => {
		const { c } = setup({ strokes: [stroke('a')] });
		c.send('replaceStrokes', { replacements: [{ id: 'a', pieces: [{ ...stroke('a'), points: 'BBBB' }] }] });
		c.send('moveStrokes', { strokeIds: ['nope'], dx: 5, dy: 5 });
		expect(c.strokeEdits.length).toBe(1);
	});

	test('全て消したら、操作の記録も捨てる', () => {
		const { c } = setup({ strokes: [stroke('a')] });
		c.send('moveStrokes', { strokeIds: null, dx: 3, dy: 0 });
		expect(c.strokeEdits.length).toBe(1);
		c.send('clearLayer', {});
		expect(c.strokeEdits).toEqual([]);
	});

	test('記録の中に持っている前の線も、切り抜きに合わせてずらせる', () => {
		const { c } = setup({ strokes: [stroke('a')] });
		c.send('deleteStrokes', { strokeIds: ['a'] });
		const shifted = shiftStrokeEdits(c.strokeEdits, -10, -20);
		expect(applyHistorySteps([], shifted[0].u)[0]).toMatchObject({ id: 'a', dx: -10, dy: -20 });
	});

	test('閉じた後は出来事を届けない', async () => {
		const { c, events } = setup();
		c.send('stroke', stroke('a'));
		c.dispose();
		await flush();
		expect(events).toEqual([]);
	});
});
