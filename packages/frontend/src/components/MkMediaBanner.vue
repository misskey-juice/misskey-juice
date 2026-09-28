<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div v-if="hide" :class="$style.sensitive" @click="reveal">
		<span style="font-size: 1.6em;"><i class="ti ti-alert-triangle"></i></span>
		<b>{{ i18n.ts.sensitive }}</b>
		<span>{{ i18n.ts.clickToShow }}</span>
	</div>
	<!-- JUICE: 小説の投稿に添付されたテキストファイルは、保存ではなく小説ビューワーで開く -->
	<MkA
		v-else-if="novelNoteId != null && isTextFile"
		:class="$style.download"
		:to="`/notes/${novelNoteId}/novel-viewer`"
		:title="media.name"
	>
		<i :class="[fileTypeIcon(media.type), $style.typeIcon]" aria-hidden="true"></i>
		<b :class="$style.name">{{ media.name }}</b>
		<span :class="$style.novelLabel"><i class="ti ti-book"></i> {{ i18n.ts._juice.readAsNovel }}</span>
	</MkA>
	<a
		v-else :class="$style.download"
		:href="media.url"
		:title="media.name"
		:download="media.name"
	>
		<!-- JUICE: ファイル名の横に、ファイルの種類のアイコンを出す(テキストファイルなど、何のファイルか分かるように) -->
		<i :class="[fileTypeIcon(media.type), $style.typeIcon]" aria-hidden="true"></i>
		<b :class="$style.name">{{ media.name }}</b>
		<span :class="$style.downloadIcon"><i class="ti ti-download"></i></span>
	</a>
</div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import * as Misskey from 'misskey-js';
import { i18n } from '@/i18n.js';
import { shouldHideFileByDefault, canRevealFile } from '@/utility/sensitive-file.js';
import { fileTypeIcon } from '@/utility/file-type-icon.js';

const props = defineProps<{
	media: Misskey.entities.DriveFile;
	// JUICE: 小説の投稿なら、その投稿のid
	novelNoteId?: string | null;
}>();

// JUICE: テキストファイルか(拡張子が.txtのものも含める。MIMEタイプが付いていないことがあるため)
const isTextFile = computed(() => props.media.type.startsWith('text/') || /\.txt$/i.test(props.media.name));

const hide = ref(shouldHideFileByDefault(props.media));

async function reveal() {
	if (!(await canRevealFile(props.media))) {
		return;
	}

	hide.value = false;
}
</script>

<style lang="scss" module>
.root {
	width: 100%;
	border-radius: 4px;
	margin-top: 4px;
	overflow: clip;
}

.download,
.sensitive {
	display: flex;
	align-items: center;
	font-size: 12px;
	padding: 8px 12px;
	white-space: nowrap;
}

.download {
	gap: 6px;
}

// JUICE: ファイルの種類のアイコン・ファイル名(長ければ省略)・保存のアイコン
.typeIcon {
	flex-shrink: 0;
	font-size: 1.6em;
	opacity: 0.8;
}

.name {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.novelLabel {
	flex-shrink: 0;
	margin-left: auto;
	color: var(--MI_THEME-accent);
	font-weight: bold;
}

.downloadIcon {
	flex-shrink: 0;
	margin-left: auto;
	font-size: 1.4em;
	opacity: 0.7;
}

.sensitive {
	background: #111;
	color: #fff;
}

.audio {
	border-radius: 8px;
	overflow: clip;
}
</style>
