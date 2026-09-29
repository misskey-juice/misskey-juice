<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<XColumn :column="column" :isStacked="isStacked" :refresher="() => reloadTimeline()">
	<template #header><i class="ti ti-star" style="margin-right: 8px;"></i>{{ column.name || i18n.ts._deck._columns.favorites }}<span class="_juice">JUICE</span></template>

	<MkPagination :paginator="paginator">
		<template #empty><MkResult type="empty" :text="i18n.ts.noNotes"/></template>

		<template #default="{ items }">
			<div class="_gaps">
				<MkNote v-for="item in items" :key="item.id" :note="item.note" :class="$style.note"/>
			</div>
		</template>
	</MkPagination>
</XColumn>
</template>

<script lang="ts" setup>
import { markRaw, watch } from 'vue';
import XColumn from './column.vue';
import type { Column } from '@/deck.js';
import MkPagination from '@/components/MkPagination.vue';
import MkNote from '@/components/MkNote.vue';
import { i18n } from '@/i18n.js';
import { Paginator } from '@/utility/paginator.js';
import { markFavorited } from '@/utility/juice-favorite-state.js';
import { useGlobalEvent } from '@/events.js';

defineProps<{
	column: Column;
	isStacked: boolean;
}>();

// JUICE: デッキのカラムとしてお気に入り一覧を表示できるように追加
const paginator = markRaw(new Paginator('i/favorites', {
	limit: 10,
}));

// JUICE: 一覧に出したノートはお気に入り済み(ノートの画面のお気に入りボタンを塗りつぶしの星にする)。
// 再読み込みで件数が同じまま中身が入れ替わっても拾えるよう、並んでいるidで見る
watch(() => paginator.items.value.map(item => item.id).join(), () => markFavorited(paginator.items.value), { immediate: true });

function reloadTimeline() {
	return new Promise<void>((res) => {
		paginator.reload().then(() => {
			res();
		});
	});
}

// JUICE: このカラムを表示中に同一クライアント内でノートをお気に入りに追加/解除した場合、
// サーバーからのプッシュが無い(i/favoritesはストリーミング非対応)ためリアルタイムに反映されない
// 問題を修正。ローカルのイベントバス経由で変更を検知し、一覧を再取得する
useGlobalEvent('noteFavorited', () => {
	paginator.reload();
});
useGlobalEvent('noteUnfavorited', () => {
	paginator.reload();
});
</script>

<style lang="scss" module>
.note {
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
}
</style>
