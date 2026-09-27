<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<MkColorInput v-model="textColor">
		<template #label>{{ i18n.ts._juice.novelViewerCustomTextColor }}</template>
	</MkColorInput>
	<MkColorInput v-model="bgColor">
		<template #label>{{ i18n.ts._juice.novelViewerCustomBgColor }}</template>
	</MkColorInput>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import MkColorInput from '@/components/MkColorInput.vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';

// JUICE: 小説ビューワーの表示設定メニューに埋め込む、カスタムテーマの色選択部品。
// 色を選んだ時点でnovelViewerThemeも'custom'に切り替え、即座に反映されるようにする
const textColor = computed({
	get: () => prefer.r.novelViewerCustomTextColor.value,
	set: (v: string) => {
		prefer.commit('novelViewerCustomTextColor', v);
		prefer.commit('novelViewerTheme', 'custom');
	},
});
const bgColor = computed({
	get: () => prefer.r.novelViewerCustomBgColor.value,
	set: (v: string) => {
		prefer.commit('novelViewerCustomBgColor', v);
		prefer.commit('novelViewerTheme', 'custom');
	},
});
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 8px 16px 16px;
}
</style>
