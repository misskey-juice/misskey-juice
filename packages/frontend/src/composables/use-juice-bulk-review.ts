/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 絵文字申請・アバターデコレーション申請の審査画面で、選んだ申請をまとめて承認・却下する。
// 1件ずつの承認・却下のAPIを順に呼ぶ(1件ごとの排他・モデレーションログ・申請者への通知とメールはそのまま)。
// まとめて承認するときは内容を編集せず、申請のまま承認する
import { computed, ref, watch } from 'vue';
import type { Ref } from 'vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

type Kind = 'emoji' | 'avatarDecoration';
type Item = { id: string; name: string; status: string };

const endpoints = {
	emoji: { approve: 'admin/emoji-requests/approve', reject: 'admin/emoji-requests/reject' },
	avatarDecoration: { approve: 'admin/avatar-decoration-requests/approve', reject: 'admin/avatar-decoration-requests/reject' },
} as const;

export function useJuiceBulkReview(kind: Kind, items: Ref<Item[]>, state: Ref<string>, removeItem: (id: string) => void) {
	const selecting = ref(false);
	const selected = ref<string[]>([]);

	const pendingItems = computed(() => items.value.filter(item => item.status === 'pending'));
	const selectedItems = computed(() => pendingItems.value.filter(item => selected.value.includes(item.id)));
	const allSelected = computed(() => pendingItems.value.length > 0 && selectedItems.value.length === pendingItems.value.length);

	// 表示する状態を変えたら、選んだ物を外す
	watch(state, () => {
		selecting.value = false;
		selected.value = [];
	});

	function toggleSelecting(): void {
		selecting.value = !selecting.value;
		if (!selecting.value) selected.value = [];
	}

	function toggleAll(): void {
		selected.value = allSelected.value ? [] : pendingItems.value.map(item => item.id);
	}

	// 1件ずつ審査したときも、選んだ物から外す
	function forget(id: string): void {
		selected.value = selected.value.filter(x => x !== id);
	}

	async function run(targets: Item[], call: (item: Item) => Promise<unknown>): Promise<void> {
		const done = os.waiting({ text: i18n.ts._juice.bulkReviewProgress });
		const failed: { name: string; message: string }[] = [];
		let succeeded = 0;
		for (const item of targets) {
			try {
				await call(item);
				succeeded++;
				removeItem(item.id);
				forget(item.id);
			} catch (err) {
				failed.push({ name: item.name, message: (err as { message?: string } | null)?.message ?? String(err) });
			}
		}
		done();
		if (selected.value.length === 0) selecting.value = false;
		const lines = [i18n.tsx._juice.bulkReviewDone({ n: succeeded })];
		if (failed.length > 0) {
			lines.push(i18n.tsx._juice.bulkReviewFailed({ n: failed.length }));
			for (const f of failed) lines.push(`・${f.name}: ${f.message}`);
		}
		os.alert({ type: failed.length > 0 ? 'warning' : 'success', text: lines.join('\n') });
	}

	async function bulkApprove(): Promise<void> {
		const targets = selectedItems.value;
		if (targets.length === 0) return;
		const { canceled } = await os.confirm({
			type: 'question',
			text: i18n.tsx._juice.bulkApproveConfirm({ n: targets.length }),
		});
		if (canceled) return;
		await run(targets, item => misskeyApi(endpoints[kind].approve, { requestId: item.id }));
	}

	async function bulkReject(): Promise<void> {
		const targets = selectedItems.value;
		if (targets.length === 0) return;
		const { canceled, result: reason } = await os.inputText({
			title: i18n.ts._emojiRequestApprovals.rejectReasonTitle,
			text: i18n.tsx._juice.bulkRejectText({ n: targets.length }),
		});
		if (canceled || !reason) return;
		await run(targets, item => misskeyApi(endpoints[kind].reject, { requestId: item.id, reason }));
	}

	return { selecting, selected, selectedItems, allSelected, pendingItems, toggleSelecting, toggleAll, forget, bulkApprove, bulkReject };
}
