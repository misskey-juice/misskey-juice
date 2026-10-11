<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkFolder>
	<template #icon><i class="ti ti-mood-plus"></i></template>
	<template #label>{{ request.name }} <MkAcct :user="request.user"/></template>
	<template #suffix><MkTime :time="request.createdAt"/></template>
	<template v-if="request.status === 'pending'" #footer>
		<div class="_buttons">
			<MkButton primary @click="approve"><i class="ti ti-check" style="color: var(--MI_THEME-success)"></i> {{ i18n.ts._emojiRequestApprovals.approve }}</MkButton>
			<MkButton danger @click="reject"><i class="ti ti-x" style="color: var(--MI_THEME-error)"></i> {{ i18n.ts._emojiRequestApprovals.reject }}</MkButton>
		</div>
	</template>

	<div class="_gaps_s">
		<!-- JUICE: 差し替え申請(既存の絵文字の画像だけを差し替える)なら、現在の画像との比較を表示する -->
		<div v-if="request.targetEmojiId != null" :class="$style.replacementNotice">
			<span class="_juice">JUICE</span> {{ i18n.ts._emojiRequestApprovals.replacementRequest }}
			<div :class="$style.comparison">
				<div :class="$style.comparisonItem">
					<div :class="$style.comparisonLabel">{{ i18n.ts._emojiRequestApprovals.currentImage }}</div>
					<img v-if="currentTargetEmoji" :src="currentTargetEmoji.url" :class="$style.img"/>
				</div>
				<i class="ti ti-arrow-right"></i>
				<div :class="$style.comparisonItem">
					<div :class="$style.comparisonLabel">{{ i18n.ts._emojiRequestApprovals.newImage }}</div>
					<img v-if="request.fileUrl" :src="request.fileUrl" :class="$style.img"/>
				</div>
			</div>
		</div>
		<img v-else-if="request.fileUrl" :src="request.fileUrl" :class="$style.img"/>
		<div>{{ i18n.ts._emojiRequestPage.category }}: {{ request.category || i18n.ts.none }}</div>
		<div>{{ i18n.ts.tags }}: {{ request.aliases.length > 0 ? request.aliases.join(' ') : i18n.ts.none }}</div>
		<div class="_selectable">{{ i18n.ts._emojiRequestPage.license }}: {{ request.license || i18n.ts.none }}</div>
		<div v-if="request.isSensitive">{{ i18n.ts.sensitive }}</div>
		<div v-if="request.localOnly">{{ i18n.ts.localOnly }}</div>
		<div v-if="request.status === 'rejected'" class="_selectable">{{ i18n.ts._emojiRequestPage.rejectReason }}: {{ request.rejectReason }}</div>
		<!-- JUICE: 審査済みの申請には「誰がいつ審査したか」を表示する -->
		<div v-if="request.reviewer">{{ i18n.ts._emojiRequestPage.reviewedBy }}: <MkAcct :user="request.reviewer"/><template v-if="request.reviewedAt"> (<MkTime :time="request.reviewedAt"/>)</template></div>

		<!-- JUICE: 承認前にモデレーターが申請内容を編集できるようにする(差し替え申請は対象外) -->
		<template v-if="request.status === 'pending' && request.targetEmojiId == null">
			<MkSwitch v-model="editMode">
				<template #label>{{ i18n.ts._emojiRequestApprovals.editOnApprove }}<span class="_juice">JUICE</span></template>
			</MkSwitch>
			<template v-if="editMode">
				<MkInput v-model="editName" pattern="[a-zA-Z0-9_]+" autocapitalize="off">
					<template #label>{{ i18n.ts.name }}</template>
				</MkInput>
				<MkInput v-model="editCategory" :datalist="customEmojiCategories.filter(x => x != null)">
					<template #label>{{ i18n.ts.category }}</template>
				</MkInput>
				<MkInput v-model="editAliases" autocapitalize="off">
					<template #label>{{ i18n.ts.tags }}</template>
					<template #caption>{{ i18n.ts.setMultipleBySeparatingWithSpace }}</template>
				</MkInput>
				<MkInput v-model="editLicense" :mfmAutocomplete="true">
					<template #label>{{ i18n.ts.license }}</template>
				</MkInput>
				<MkSwitch v-model="editIsSensitive">{{ i18n.ts.sensitive }}</MkSwitch>
				<MkSwitch v-model="editLocalOnly">{{ i18n.ts.localOnly }}</MkSwitch>
				<MkTextarea v-model="editReason">
					<template #label>{{ i18n.ts._emojiRequestApprovals.editReason }}</template>
					<template #caption>{{ i18n.ts._emojiRequestApprovals.editReasonCaption }}</template>
				</MkTextarea>
			</template>
		</template>
	</div>
</MkFolder>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInput from '@/components/MkInput.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { customEmojisMap, customEmojiCategories } from '@/custom-emojis.js';
import { splitEmojiTags } from '@/utility/emoji-tags.js';

const props = defineProps<{
	request: Misskey.entities.AdminEmojiRequestsListResponse[number];
}>();

const emit = defineEmits<{
	(ev: 'resolved', requestId: string): void;
}>();

// JUICE: 差し替え申請の対象絵文字の現在の画像。IDでは引けないため、申請時点の名前(=対象絵文字の
// 名前と一致するはず)で引く。審査までの間に対象絵文字が改名されていた場合は見つからないことがある
const currentTargetEmoji = computed(() => customEmojisMap.get(props.request.name));

// JUICE: 承認前の申請内容編集用。申請時点の値で初期化しておく
const editMode = ref(false);
const editName = ref(props.request.name);
const editCategory = ref(props.request.category ?? '');
const editAliases = ref(props.request.aliases.join(' '));
const editLicense = ref(props.request.license ?? '');
const editIsSensitive = ref(props.request.isSensitive);
const editLocalOnly = ref(props.request.localOnly);
const editReason = ref('');

async function approve() {
	// JUICE: 編集モード中に理由未入力のままサーバーへ送ってeditReasonRequiredで弾かれるのを防ぐ
	if (editMode.value && editReason.value.trim() === '') {
		os.alert({
			type: 'warning',
			text: i18n.ts._emojiRequestApprovals.editReasonRequiredError,
		});
		return;
	}

	const confirm = await os.confirm({
		type: 'question',
		text: props.request.targetEmojiId != null
			? i18n.tsx._emojiRequestApprovals.approveReplacementConfirm({ name: props.request.name })
			: i18n.tsx._emojiRequestApprovals.approveConfirm({ name: editMode.value ? editName.value : props.request.name }),
	});
	if (confirm.canceled) return;

	os.apiWithDialog('admin/emoji-requests/approve', {
		requestId: props.request.id,
		...(editMode.value ? {
			name: editName.value,
			category: editCategory.value || null,
			aliases: splitEmojiTags(editAliases.value),
			license: editLicense.value || null,
			isSensitive: editIsSensitive.value,
			localOnly: editLocalOnly.value,
			editReason: editReason.value,
		} : {}),
	}).then(() => {
		emit('resolved', props.request.id);
	});
}

async function reject() {
	const { canceled, result: reason } = await os.inputText({
		title: i18n.ts._emojiRequestApprovals.rejectReasonTitle,
	});
	if (canceled || !reason) return;

	os.apiWithDialog('admin/emoji-requests/reject', {
		requestId: props.request.id,
		reason,
	}).then(() => {
		emit('resolved', props.request.id);
	});
}
</script>

<style lang="scss" module>
.img {
	max-width: 100%;
	max-height: 128px;
	object-fit: contain;
}

.replacementNotice {
	font-size: 0.9em;
}

.comparison {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 16px;
	margin-top: 8px;
}

.comparisonItem {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
}

.comparisonLabel {
	font-size: 0.85em;
	opacity: 0.7;
}
</style>
