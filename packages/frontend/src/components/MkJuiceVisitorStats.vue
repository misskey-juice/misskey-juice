<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: ログインしていない人に見せる、サーバーの数(登録しているユーザー・オンライン・つながっているサーバー・ノート)。
JUICEのエントランスと、ログインしていないときの画面の横に出す。訪問者にアクティビティを見せない設定では何も出さない -->
<template>
<div v-if="showActivities" :class="$style.root">
	<div :class="[$style.stat, { [$style.translucent]: translucent }]">
		<div :class="$style.icon"><i class="ti ti-users"></i></div>
		<div :class="$style.label">{{ i18n.ts._juiceEntrance.registeredUsers }}</div>
		<div :class="$style.value"><MkNumber v-if="stats" :value="stats.originalUsersCount"/><span v-else>-</span></div>
	</div>
	<div :class="[$style.stat, { [$style.translucent]: translucent }]">
		<div :class="$style.icon"><i class="ti ti-access-point"></i></div>
		<div :class="$style.label"><span :class="$style.onlineDot"></span>{{ i18n.ts._juiceEntrance.onlineUsers }}</div>
		<div :class="$style.value"><MkNumber v-if="onlineUsersCount != null" :value="onlineUsersCount"/><span v-else>-</span></div>
	</div>
	<div v-if="instance.federation !== 'none'" :class="[$style.stat, { [$style.translucent]: translucent }]">
		<div :class="$style.icon"><i class="ti ti-world"></i></div>
		<div :class="$style.label">{{ i18n.ts._juiceEntrance.connectedServers }}</div>
		<div :class="$style.value"><MkNumber v-if="stats" :value="stats.instances"/><span v-else>-</span></div>
	</div>
	<div :class="[$style.stat, { [$style.translucent]: translucent }]">
		<div :class="$style.icon"><i class="ti ti-pencil"></i></div>
		<div :class="$style.label">{{ i18n.ts._juiceEntrance.notes }}</div>
		<div :class="$style.value"><MkNumber v-if="stats" :value="stats.originalNotesCount"/><span v-else>-</span></div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import * as Misskey from 'misskey-js';
import { useInterval } from '@@/js/use-interval.js';
import MkNumber from '@/components/MkNumber.vue';
import { misskeyApi, misskeyApiGet } from '@/utility/misskey-api.js';
import { instance } from '@/instance.js';
import { i18n } from '@/i18n.js';

defineProps<{
	// 背景画像の上に置くとき、半透明にして背景画像が透けて見えるようにする
	translucent?: boolean;
}>();

const showActivities = instance.clientOptions.showActivitiesForVisitor !== false;

const stats = ref<Misskey.entities.StatsResponse | null>(null);
const onlineUsersCount = ref<number | null>(null);

if (showActivities) {
	misskeyApi('stats', {}).then(res => {
		stats.value = res;
	});

	// オンラインの人数は、ウィジェット(WidgetOnlineUsers)と同じように時々読み直す
	useInterval(() => {
		misskeyApiGet('get-online-users-count').then(res => {
			onlineUsersCount.value = res.count;
		});
	}, 1000 * 60, {
		immediate: true,
		afterMounted: true,
	});
}
</script>

<style lang="scss" module>
.root {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	gap: 16px;

	@media (max-width: 500px) {
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
}

.stat {
	position: relative;
	overflow: clip;
	padding: 16px 20px;
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
	box-shadow: 0 4px 16px rgb(0 0 0 / 8%);
}

.translucent {
	background: color(from var(--MI_THEME-panel) srgb r g b / 0.8);
	-webkit-backdrop-filter: var(--MI-blur, blur(15px));
	backdrop-filter: var(--MI-blur, blur(15px));
}

.icon {
	position: absolute;
	top: 12px;
	right: 14px;
	font-size: 1.6em;
	color: var(--MI_THEME-accent);
	opacity: 0.25;
}

.label {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 0.9em;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
}

.value {
	margin-top: 4px;
	font-size: 1.8em;
	font-weight: bold;
	color: var(--MI_THEME-accent);

	@media (max-width: 500px) {
		font-size: 1.4em;
	}
}

.onlineDot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 999px;
	background: var(--MI_THEME-success);
	box-shadow: 0 0 0 3px color(from var(--MI_THEME-success) srgb r g b / 0.25);
}
</style>
