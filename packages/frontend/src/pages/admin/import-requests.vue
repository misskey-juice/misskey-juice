<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: 承認式にしたインポートの申請の審査(モデレーター・canApproveImportRequestsロールポリシーを持つ人向け) -->
<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<MkInfo>{{ i18n.ts._importRequest.approvalsDescription }}</MkInfo>
			<MkSelect v-model="state" :items="stateDef">
				<template #label>{{ i18n.ts.state }}</template>
			</MkSelect>
			<MkInfo v-if="paginator.items.value.length === 0 && !paginator.fetching.value">{{ state === 'pending' ? i18n.ts._importRequest.noPendingRequests : i18n.ts._importRequest.noRequests }}</MkInfo>
			<MkPagination v-slot="{items}" :paginator="paginator">
				<div class="_gaps">
					<MkImportRequestApproval v-for="request in items" :key="request.id" :request="request" @resolved="resolved"/>
				</div>
			</MkPagination>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, markRaw } from 'vue';
import MkInfo from '@/components/MkInfo.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkPagination from '@/components/MkPagination.vue';
import MkImportRequestApproval from '@/components/MkImportRequestApproval.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useMkSelect } from '@/composables/use-mkselect.js';
import { Paginator } from '@/utility/paginator.js';
import { refreshJuiceAdminPendingBanners } from '@/utility/juice-admin-notifications.js';

const {
	model: state,
	def: stateDef,
} = useMkSelect({
	items: [
		{ label: i18n.ts._importRequest._statuses.pending, value: 'pending' },
		{ label: i18n.ts._importRequest._statuses.approved, value: 'approved' },
		{ label: i18n.ts._importRequest._statuses.rejected, value: 'rejected' },
		{ label: i18n.ts._importRequest._statuses.cancelled, value: 'cancelled' },
	],
	initialValue: 'pending',
});

const paginator = markRaw(new Paginator('admin/import-requests/list', {
	limit: 10,
	computedParams: computed(() => ({
		state: state.value,
	})),
}));

function resolved(requestId: string) {
	paginator.removeItem(requestId);
	// 審査待ちが無くなったら、管理画面の「未対応」の知らせも消す
	refreshJuiceAdminPendingBanners();
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._importRequest.approvalsTitle,
	icon: 'ti ti-file-import',
}));
</script>
