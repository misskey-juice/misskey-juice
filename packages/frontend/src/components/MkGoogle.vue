<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<input v-model="query" :class="$style.input" type="search" :placeholder="q" :aria-label="i18n.ts.search">
	<!-- JUICE: 検索エンジンはユーザーの設定で選べる(ボタンにその名前を出す) -->
	<button :class="$style.button" @click="search"><i class="ti ti-search"></i> {{ i18n.tsx._juice.searchWithEngine({ engine: engineName }) }}</button>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { buildSearchUrl, searchEngineName } from '@/utility/juice-search-engines.js';

const props = defineProps<{
	q: string;
}>();

const query = ref(props.q);

const engineName = computed(() => searchEngineName(prefer.r.mfmSearchEngine.value, prefer.r.mfmSearchEngineCustomUrl.value));
watch(() => props.q, (v) => {
	query.value = v;
});

const search = () => {
	window.open(buildSearchUrl(prefer.s.mfmSearchEngine, prefer.s.mfmSearchEngineCustomUrl, query.value), '_blank', 'noopener');
};
</script>

<style lang="scss" module>
.root {
	display: flex;
	margin: 8px 0;
}

.input {
	flex-shrink: 1;
	padding: 10px;
	width: 100%;
	height: 40px;
	font-size: 16px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: 4px 0 0 4px;
	-webkit-appearance: textfield;
}

.button {
	flex-shrink: 0;
	margin: 0;
	padding: 0 16px;
	border: solid 1px var(--MI_THEME-divider);
	border-left: none;
	border-radius: 0 4px 4px 0;

	&:active {
		box-shadow: 0 2px 4px rgba(#000, 0.15) inset;
	}
}
</style>
