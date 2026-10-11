<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkFolder>
	<!-- JUICE: サムネイルで申請中の画像そのものを表示する。承認/却下後にファイルが削除されている場合はアイコンにフォールバック -->
	<template #icon>
		<img v-if="fileUrl" :src="fileUrl" :class="$style.thumbnail" alt=""/>
		<i v-else-if="fileId" class="ti ti-sparkles"></i>
	</template>
	<template #label>{{ request.name }}</template>
	<template #suffix>
		<span :class="[$style.status, $style[statusClass]]">{{ statusLabel }}</span>
	</template>
	<!-- JUICE: 審査待ちの間だけ、申請者自身の意思で取り下げられるようにする(モデレーターの却下とは別) -->
	<template v-if="cancelable && request.status === 'pending'" #footer>
		<div class="_buttons">
			<!-- JUICE: 審査待ちの間は、申請し直さずに画像だけを差し替えられる -->
			<MkButton @click="replaceFile"><i class="ti ti-replace"></i> {{ i18n.ts._avatarDecorationRequestPage.replaceImage }}</MkButton>
			<MkButton danger @click="cancel"><i class="ti ti-x" style="color: var(--MI_THEME-error)"></i> {{ i18n.ts._avatarDecorationRequestPage.cancelRequest }}</MkButton>
		</div>
	</template>

	<div class="_gaps_s">
		<!-- JUICE: 差し替え申請(既存のデコレーションの画像だけを差し替える) -->
		<div v-if="request.targetAvatarDecorationId != null"><span class="_juice">JUICE</span> {{ i18n.ts._avatarDecorationRequestPage.replacementRequestBadge }}</div>
		<div>{{ i18n.ts._avatarDecorationRequestPage.description }}: {{ request.description || i18n.ts.none }}</div>
		<div>{{ i18n.ts._avatarDecorationRequestPage.category }}: {{ request.category || i18n.ts.none }}</div>
		<div v-if="request.status === 'rejected'" class="_selectable">
			{{ i18n.ts._avatarDecorationRequestPage.rejectReason }}: {{ request.rejectReason }}
		</div>
	</div>
</MkFolder>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkFolder from '@/components/MkFolder.vue';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { selectFileDeferred, uploadFile } from '@/utility/drive.js';

const props = defineProps<{
	request: Misskey.entities.AvatarDecorationRequestsListResponse[number];
	// JUICE: 自分の申請一覧(/avatar-decoration-requestの審査待ちタブ)でのみキャンセルボタンを出す。
	// 管理画面(admin/avatar-decoration-requests.vue)では他人の申請を扱うため渡さない
	cancelable?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'cancelled', requestId: string): void;
}>();

// JUICE: 画像を差し替えたら、一覧を読み直さずにサムネイルだけ新しい画像にする
const fileId = ref(props.request.fileId);
const fileUrl = ref(props.request.fileUrl);
watch(() => props.request, request => {
	fileId.value = request.fileId;
	fileUrl.value = request.fileUrl;
});

const statusLabel = computed(() => {
	switch (props.request.status) {
		case 'pending': return i18n.ts._avatarDecorationRequestPage.statusPending;
		case 'approved': return i18n.ts._avatarDecorationRequestPage.statusApproved;
		case 'rejected': return i18n.ts._avatarDecorationRequestPage.statusRejected;
		case 'cancelled': return i18n.ts._avatarDecorationRequestPage.statusCancelled;
	}
});

const statusClass = computed(() => {
	switch (props.request.status) {
		case 'pending': return 'statusPending';
		case 'approved': return 'statusApproved';
		case 'rejected': return 'statusRejected';
		case 'cancelled': return 'statusCancelled';
	}
});

async function replaceFile(ev: PointerEvent) {
	// 「PCからアップロード」のときは、画像かどうかを確かめてからアップロードする(使わないファイルをドライブに残さない)
	const [picked] = await selectFileDeferred({
		anchorElement: ev.currentTarget ?? ev.target,
		label: i18n.ts._avatarDecorationRequestPage.replaceImage,
	});
	if (picked == null) return;
	if (!picked.type.startsWith('image/')) {
		os.alert({
			type: 'warning',
			title: i18n.ts._watermarkEditor.driveFileTypeWarn,
			text: i18n.ts._watermarkEditor.driveFileTypeWarnDescription,
		});
		return;
	}
	const file = picked instanceof File ? await os.promiseDialog(uploadFile(picked, { name: picked.name }).filePromise) : picked;
	if (file == null) return;
	const res = await os.apiWithDialog('avatar-decoration-requests/update-file', {
		requestId: props.request.id,
		fileId: file.id,
	});
	fileId.value = res.fileId;
	fileUrl.value = res.fileUrl;
}

async function cancel() {
	const confirm = await os.confirm({
		type: 'warning',
		text: i18n.tsx._avatarDecorationRequestPage.cancelRequestConfirm({ name: props.request.name }),
	});
	if (confirm.canceled) return;

	os.apiWithDialog('avatar-decoration-requests/cancel', {
		requestId: props.request.id,
	}).then(() => {
		emit('cancelled', props.request.id);
	});
}
</script>

<style lang="scss" module>
.thumbnail {
	display: block;
	width: 28px;
	height: 28px;
	object-fit: contain;
	border-radius: 4px;
	background: var(--MI_THEME-panel);
}

.status {
	display: inline-block;
	padding: 2px 8px;
	border-radius: 999px;
	font-size: 85%;
}

.statusPending {
	background: var(--MI_THEME-buttonBg);
}

.statusApproved {
	background: var(--MI_THEME-success);
	color: var(--MI_THEME-fgOnAccent);
}

.statusRejected {
	background: var(--MI_THEME-error);
	color: var(--MI_THEME-fgOnAccent);
}

.statusCancelled {
	background: var(--MI_THEME-buttonBg);
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.75);
}
</style>
