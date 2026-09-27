<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<header :class="$style.root">
	<div v-if="mock" :class="$style.name">
		<MkUserName :user="note.user"/>
	</div>
	<MkA v-else v-user-preview="note.user.id" :class="$style.name" :to="userPage(note.user)">
		<MkUserName :user="note.user"/>
	</MkA>
	<div v-if="note.user.isBot" :class="$style.isBot">bot</div>
	<!-- JUICE: 投稿1件ごとに出る要素のため、他のJUICEバッジ(設定画面・メニュー等、1画面に数回しか出ない箇所)とは異なり
	     意図的にJUICEバッジを付けていない(タイムライン上で常時大量に表示されると視認性を損なうため) -->
	<div v-if="isAIGenerated" v-tooltip="i18n.ts.aiGenerated" :class="$style.aiGenerated" :aria-label="i18n.ts.aiGenerated" role="img"><i class="ti ti-ai"></i></div>
	<!-- JUICE: 「小説」フラグ付きの投稿であることを示すバッジ。押すと小説ビューワーで開く -->
	<template v-if="isNovel">
		<div v-if="mock" :class="$style.novel" :aria-label="i18n.ts._juice.readAsNovel" role="img"><i class="ti ti-book"></i></div>
		<MkA v-else v-tooltip="i18n.ts._juice.readAsNovel" :class="$style.novel" :to="`/notes/${note.id}/novel-viewer`" :aria-label="i18n.ts._juice.readAsNovel"><i class="ti ti-book"></i></MkA>
	</template>
	<div :class="$style.username"><MkAcct :user="note.user"/></div>
	<div v-if="note.user.badgeRoles" :class="$style.badgeRoles">
		<img v-for="(role, i) in note.user.badgeRoles" :key="i" v-tooltip="role.name" :class="$style.badgeRole" :src="role.iconUrl!"/>
	</div>
	<div :class="$style.info">
		<div v-if="mock">
			<MkTime :time="note.createdAt" colored/>
		</div>
		<MkA v-else :to="notePage(note)">
			<MkTime :time="note.createdAt" colored/>
		</MkA>
		<!-- JUICE: リモートで編集された投稿 -->
		<span v-if="editedAt != null" v-tooltip="`${i18n.ts.edited}: ${dateString(editedAt)}`" style="margin-left: 0.5em;" :aria-label="i18n.ts.edited" role="img"><i class="ti ti-pencil"></i></span>
		<span v-if="note.visibility !== 'public'" style="margin-left: 0.5em;" :title="i18n.ts._visibility[note.visibility]">
			<i v-if="note.visibility === 'home'" class="ti ti-home"></i>
			<i v-else-if="note.visibility === 'followers'" class="ti ti-lock"></i>
			<i v-else-if="note.visibility === 'specified'" ref="specified" class="ti ti-mail"></i>
		</span>
		<span v-if="note.localOnly" style="margin-left: 0.5em;" :title="i18n.ts._visibility['disableFederation']"><i class="ti ti-rocket-off"></i></span>
		<span v-if="note.channel" style="margin-left: 0.5em;" :title="note.channel.name"><i class="ti ti-device-tv"></i></span>
	</div>
</header>
</template>

<script lang="ts" setup>
import { inject, computed } from 'vue';
import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import { notePage } from '@/filters/note.js';
import { userPage } from '@/filters/user.js';
import { dateString } from '@/filters/date.js';
import { DI } from '@/di.js';

const props = defineProps<{
	note: Misskey.entities.Note;
	// JUICE: リアクション等と同様、ストリーム経由でリアクティブに上書きしたい場合に渡す(未指定ならnoteの値をそのまま使う)
	isAIGenerated?: boolean;
	isNovel?: boolean;
	// JUICE: 最後に編集された日時(ストリームで編集を受け取ったときに差し替えるため、親から渡す)
	updatedAt?: string | null;
}>();

const mock = inject(DI.mock, false);

const isAIGenerated = computed(() => props.isAIGenerated ?? props.note.isAIGenerated);
const isNovel = computed(() => props.isNovel ?? props.note.isNovel);
const editedAt = computed(() => props.updatedAt ?? props.note.updatedAt ?? null);
</script>

<style lang="scss" module>
.root {
	display: flex;
	align-items: baseline;
	white-space: nowrap;
}

.name {
	flex-shrink: 1;
	display: block;
	margin: 0 .5em 0 0;
	padding: 0;
	overflow: hidden;
	font-size: 1em;
	font-weight: bold;
	text-decoration: none;
	text-overflow: ellipsis;

	&:hover {
		text-decoration: underline;
	}
}

.isBot {
	flex-shrink: 0;
	align-self: center;
	margin: 0 .5em 0 0;
	padding: 1px 6px;
	font-size: 80%;
	border: solid 0.5px var(--MI_THEME-divider);
	border-radius: 3px;
}

.aiGenerated,
.novel {
	flex-shrink: 0;
	align-self: center;
	margin: 0 .5em 0 0;
	padding: 1px 6px;
	font-size: 95%;
	border: solid 0.5px var(--MI_THEME-divider);
	border-radius: 3px;
}

.novel {
	color: inherit;

	&:hover {
		text-decoration: none;
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.username {
	flex-shrink: 9999999;
	margin: 0 .5em 0 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.info {
	flex-shrink: 0;
	margin-left: auto;
	font-size: 0.9em;
}

.badgeRoles {
	margin: 0 .5em 0 0;
}

.badgeRole {
	height: 1.3em;
	vertical-align: -20%;

	& + .badgeRole {
		margin-left: 0.2em;
	}
}
</style>
