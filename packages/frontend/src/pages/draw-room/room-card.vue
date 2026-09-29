<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: 絵チャの部屋一覧の1件 -->
<template>
<MkA :to="`/draw/${room.id}`" class="_panel" :class="$style.root">
	<MkAvatar :class="$style.avatar" :user="room.owner"/>
	<div :class="$style.body">
		<div :class="$style.title">{{ room.title }}</div>
		<!-- JUICE: 注意書き(CW)・センシティブ(NSFW) -->
		<div v-if="room.cw != null || room.isSensitive" :class="$style.warning">
			<span v-if="room.isSensitive" :class="$style.sensitive">{{ i18n.ts._drawRoom.roomSensitiveBadge }}</span>
			<span v-if="room.cw != null" :class="$style.cw"><i class="ti ti-eye-exclamation"></i> {{ room.cw }}</span>
		</div>
		<div :class="$style.meta">
			<MkUserName :user="room.owner"/>
			<span><i :class="room.visibility === 'local' ? 'ti ti-world' : 'ti ti-lock'"></i> {{ room.visibility === 'local' ? i18n.ts._drawRoom.visibilityLocal : i18n.ts._drawRoom.visibilityFollowers }}</span>
			<span v-if="!room.isEnded"><i class="ti ti-users"></i> {{ i18n.tsx._drawRoom.membersCount({ n: room.members.length, max: room.maxMembers }) }}</span>
			<!-- JUICE: 保存しないで終了した部屋は、削除されるまでの残り時間を出す -->
			<span v-else-if="room.deletesAt != null" :class="$style.deletes"><i class="ti ti-clock-x"></i> {{ remainingMinutes > 0 ? i18n.tsx._drawRoom.deletesInMinutes({ n: remainingMinutes }) : i18n.ts._drawRoom.deletesSoon }}</span>
			<span v-else><i class="ti ti-archive"></i> <MkTime :time="room.endedAt ?? room.createdAt"/></span>
		</div>
	</div>
</MkA>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import type * as Misskey from 'misskey-js';
import { useInterval } from '@@/js/use-interval.js';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	room: Misskey.entities.DrawRoom;
}>();

// JUICE: 削除されるまでの残り時間(分、切り上げ)。30秒ごとに更新する
const now = ref(Date.now());
useInterval(() => { now.value = Date.now(); }, 1000 * 30, { immediate: false, afterMounted: true });
const remainingMinutes = computed(() => (props.room.deletesAt == null ? 0 : Math.ceil((new Date(props.room.deletesAt).getTime() - now.value) / (1000 * 60))));
</script>

<style lang="scss" module>
.root {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px 16px;

	&:hover {
		text-decoration: none;
		background: var(--MI_THEME-panelHighlight);
	}
}

.warning {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
	font-size: 0.85em;
}

.sensitive {
	flex-shrink: 0;
	padding: 0 6px;
	border-radius: 999px;
	// テーマによって警告の色の上の白文字が読みにくいので、薄い背景に警告の色の文字にする
	background: color-mix(in srgb, var(--MI_THEME-warn), transparent 80%);
	color: var(--MI_THEME-warn);
	font-weight: bold;
}

.cw {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.deletes {
	color: var(--MI_THEME-warn);
}

.avatar {
	flex-shrink: 0;
	width: 42px;
	height: 42px;
}

.body {
	min-width: 0;
}

.title {
	font-weight: bold;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.meta {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 12px;
	font-size: 0.85em;
	opacity: 0.8;
}
</style>
