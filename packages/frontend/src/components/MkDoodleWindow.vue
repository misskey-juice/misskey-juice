<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: 投稿フォームから開く落書き。描いた絵を添付したら閉じる -->
<template>
<MkWindow
	ref="windowEl"
	:initialWidth="initialWidth"
	:initialHeight="initialHeight"
	:canResize="true"
	:closeButton="true"
	@closed="emit('closed')"
>
	<template #header>
		<i v-if="pageMetadata?.icon" :class="pageMetadata.icon" style="margin-right: 0.5em;"></i>
		<span>{{ pageMetadata?.title ?? i18n.ts._juice.doodle }}</span>
	</template>

	<div :class="$style.root">
		<XRoom :doodleId="doodleId" attachable @attach="onAttach"/>
	</div>
</MkWindow>
</template>

<script lang="ts" setup>
import { defineAsyncComponent, provide, ref, useTemplateRef } from 'vue';
import type * as Misskey from 'misskey-js';
import type { PageMetadata } from '@/page.js';
import MkWindow from '@/components/MkWindow.vue';
import { provideMetadataReceiver, provideReactiveMetadata } from '@/page.js';
import { i18n } from '@/i18n.js';

const XRoom = defineAsyncComponent(() => import('@/pages/draw-room/room.vue'));

defineProps<{
	doodleId: string;
}>();

const emit = defineEmits<{
	(ev: 'attach', file: Misskey.entities.DriveFile): void;
	(ev: 'closed'): void;
}>();

const windowEl = useTemplateRef('windowEl');
// キャンバスを広く使えるよう、画面に収まる範囲で大きめに開く
const initialWidth = Math.min(1200, window.innerWidth - 32);
const initialHeight = Math.min(820, window.innerHeight - 32);

// 落書きの名前を、ウインドウの見出しに出す
const pageMetadata = ref<PageMetadata | null>(null);
provideMetadataReceiver((getter) => {
	pageMetadata.value = getter();
});
provideReactiveMetadata(pageMetadata);
provide('shouldOmitHeaderTitle', true);
provide('shouldHeaderThin', true);

function onAttach(file: Misskey.entities.DriveFile): void {
	emit('attach', file);
	windowEl.value?.close();
}
</script>

<style lang="scss" module>
.root {
	height: 100%;
	background: var(--MI_THEME-bg);
}
</style>
