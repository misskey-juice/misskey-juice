<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<MkPagination :paginator="paginator">
			<template #empty><MkResult type="empty" :text="i18n.ts.noNotes"/></template>

			<template #default="{ items }">
				<MkNote v-for="item in items" :key="item.id" :note="item.note" :class="$style.note"/>
			</template>
		</MkPagination>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { markRaw, watch } from 'vue';
import MkPagination from '@/components/MkPagination.vue';
import MkNote from '@/components/MkNote.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { Paginator } from '@/utility/paginator.js';
import { markFavorited } from '@/utility/juice-favorite-state.js';

const paginator = markRaw(new Paginator('i/favorites', {
	limit: 10,
}));

// JUICE: 一覧に出したノートはお気に入り済み(ノートの画面のお気に入りボタンを塗りつぶしの星にする)。
// 再読み込みで件数が同じまま中身が入れ替わっても拾えるよう、並んでいるidで見る
watch(() => paginator.items.value.map(item => item.id).join(), () => markFavorited(paginator.items.value), { immediate: true });

definePage(() => ({
	title: i18n.ts.favorites,
	icon: 'ti ti-star',
}));
</script>

<style lang="scss" module>
.note {
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
}
</style>
