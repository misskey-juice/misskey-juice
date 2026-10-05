<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: 承認式にしたインポートの申請1件(審査する人向け)。開くとファイルの中身の一部を読み込んで見せる -->
<template>
<MkFolder @opened="loadPreview">
	<template #icon><i class="ti ti-file-import"></i></template>
	<template #label>{{ i18n.ts._importRequest._types[request.type] }} <MkAcct :user="request.user"/></template>
	<template #suffix><MkTime :time="request.createdAt"/></template>
	<template v-if="request.status === 'pending'" #footer>
		<div class="_buttons">
			<MkButton primary :disabled="request.fileId == null" @click="approve"><i class="ti ti-check" style="color: var(--MI_THEME-success)"></i> {{ i18n.ts._importRequest.approve }}</MkButton>
			<MkButton danger @click="reject"><i class="ti ti-x" style="color: var(--MI_THEME-error)"></i> {{ i18n.ts._importRequest.reject }}</MkButton>
		</div>
	</template>

	<div class="_gaps_s">
		<div :class="$style.fields">
			<div>{{ i18n.ts._importRequest.requester }}: <MkA v-user-preview="request.user.id" :to="userPage(request.user)" class="_link"><MkUserName :user="request.user"/></MkA></div>
			<div>{{ i18n.ts._importRequest.file }}: <span class="_selectable">{{ request.fileName }}</span> ({{ bytes(request.fileSize) }})</div>
			<div v-if="request.type === 'following'">{{ i18n.ts._exportOrImport.withReplies }}: {{ request.withReplies ? i18n.ts.yes : i18n.ts.no }}</div>
			<div v-if="request.status === 'rejected' && request.rejectReason">{{ i18n.ts._importRequest.rejectReason }}: <span class="_selectable">{{ request.rejectReason }}</span></div>
			<div v-if="request.reviewer">{{ i18n.ts._importRequest.reviewer }}: <MkA :to="userPage(request.reviewer)" class="_link"><MkUserName :user="request.reviewer"/></MkA></div>
		</div>

		<MkInfo v-if="request.fileId == null" warn>{{ i18n.ts._importRequest.fileDeleted }}</MkInfo>
		<MkLoading v-else-if="loading"/>
		<MkInfo v-else-if="loaded && preview == null" warn>{{ i18n.ts._importRequest.previewUnavailable }}</MkInfo>
		<template v-else-if="preview != null">
			<div :class="$style.summary">{{ i18n.tsx._importRequest.lineCount({ n: preview.totalLines }) }}</div>
			<!-- アカウントのホストごとの件数(同じサーバーのアカウントばかり、などに気付けるように) -->
			<div v-if="preview.hosts.length > 0" :class="$style.hosts">
				<span v-for="item in preview.hosts" :key="item.host" :class="$style.host">{{ item.host === '' ? i18n.ts._importRequest.noHost : item.host }}: {{ item.count }}</span>
			</div>
			<!-- 読み込んだ行(最大100行)は全部出し、長いときは枠の中でスクロールする(ページは長くしない) -->
			<pre :class="$style.lines" class="_selectable" tabindex="0" :aria-label="i18n.ts._importRequest.file">{{ preview.lines.join('\n') }}</pre>
			<div v-if="preview.totalLines > preview.lines.length" :class="$style.summary">{{ i18n.tsx._importRequest.moreLines({ n: preview.totalLines - preview.lines.length }) }}</div>
		</template>
	</div>
</MkFolder>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import type * as Misskey from 'misskey-js';
import MkFolder from '@/components/MkFolder.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { userPage } from '@/filters/user.js';
import bytes from '@/filters/bytes.js';

const props = defineProps<{
	request: Misskey.entities.ImportRequestDetailedAdmin;
}>();

const emit = defineEmits<{
	(ev: 'resolved', requestId: string): void;
}>();

type Preview = Misskey.entities.AdminImportRequestsShowResponse['preview'];
const preview = ref<Preview>(null);
const loading = ref(false);
const loaded = ref(false);

// 開いたときに1回だけ、ファイルの中身を読み込む
async function loadPreview() {
	if (loaded.value || loading.value || props.request.fileId == null) return;
	loading.value = true;
	try {
		const res = await misskeyApi('admin/import-requests/show', { requestId: props.request.id });
		preview.value = res.preview;
	} catch {
		preview.value = null;
	} finally {
		loading.value = false;
		loaded.value = true;
	}
}

async function approve() {
	const { canceled } = await os.confirm({
		type: 'question',
		text: i18n.tsx._importRequest.approveConfirm({ type: i18n.ts._importRequest._types[props.request.type] }),
	});
	if (canceled) return;

	os.apiWithDialog('admin/import-requests/approve', {
		requestId: props.request.id,
	}).then(() => {
		emit('resolved', props.request.id);
	});
}

async function reject() {
	const { canceled, result: reason } = await os.inputText({
		title: i18n.ts._importRequest.rejectReasonTitle,
	});
	if (canceled || !reason) return;

	os.apiWithDialog('admin/import-requests/reject', {
		requestId: props.request.id,
		reason,
	}).then(() => {
		emit('resolved', props.request.id);
	});
}
</script>

<style lang="scss" module>
.fields {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 0.95em;
}

.summary {
	font-size: 0.9em;
	opacity: 0.8;
}

.hosts {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}

.host {
	padding: 2px 8px;
	border-radius: 999px;
	background: var(--MI_THEME-buttonBg);
	font-size: 0.85em;
}

.lines {
	margin: 0;
	padding: 8px 12px;
	// 10行ほどの高さにして、それより長いときは枠の中でスクロールする
	max-height: calc(1.5em * 10 + 16px);
	overflow: auto;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-bg);
	font-size: 0.85em;
	line-height: 1.5;
	white-space: pre;
}
</style>
