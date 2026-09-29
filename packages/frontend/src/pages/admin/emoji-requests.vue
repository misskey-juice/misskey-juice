<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<MkSelect v-model="state" :items="stateDef">
				<template #label>{{ i18n.ts.state }}</template>
			</MkSelect>
			<MkInfo v-if="paginator.items.value.length === 0 && !paginator.fetching.value">{{ state === 'pending' ? i18n.ts._emojiRequestApprovals.noPendingRequests : i18n.ts._emojiRequestApprovals.noRequests }}</MkInfo>
			<!-- JUICE: 審査待ちの申請を選んで、まとめて承認・却下する -->
			<div v-if="state === 'pending' && bulk.pendingItems.value.length > 0" class="_buttons">
				<MkButton rounded :primary="bulk.selecting.value" :aria-pressed="bulk.selecting.value" @click="bulk.toggleSelecting"><i class="ti ti-checkbox"></i> {{ i18n.ts._juice.bulkReviewSelect }}<span class="_juice">JUICE</span></MkButton>
				<template v-if="bulk.selecting.value">
					<MkButton rounded @click="bulk.toggleAll">{{ bulk.allSelected.value ? i18n.ts._juice.bulkReviewDeselectAll : i18n.ts._juice.bulkReviewSelectAll }}</MkButton>
					<MkButton rounded primary :disabled="bulk.selectedItems.value.length === 0" @click="bulk.bulkApprove"><i class="ti ti-check"></i> {{ i18n.tsx._juice.bulkApprove({ n: bulk.selectedItems.value.length }) }}</MkButton>
					<MkButton rounded danger :disabled="bulk.selectedItems.value.length === 0" @click="bulk.bulkReject"><i class="ti ti-x"></i> {{ i18n.tsx._juice.bulkReject({ n: bulk.selectedItems.value.length }) }}</MkButton>
				</template>
			</div>
			<MkPagination v-slot="{items}" :paginator="paginator">
				<div class="_gaps">
					<div v-for="request in items" :key="request.id" :class="$style.item">
						<label v-if="bulk.selecting.value && request.status === 'pending'" :class="$style.check">
							<input v-model="bulk.selected.value" type="checkbox" :value="request.id" :aria-label="request.name"/>
						</label>
						<MkEmojiRequestApproval :class="$style.itemBody" :request="request" @resolved="resolved"/>
					</div>
				</div>
			</MkPagination>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, markRaw } from 'vue';
import MkInfo from '@/components/MkInfo.vue';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkPagination from '@/components/MkPagination.vue';
import MkEmojiRequestApproval from '@/components/MkEmojiRequestApproval.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useMkSelect } from '@/composables/use-mkselect.js';
import { Paginator } from '@/utility/paginator.js';
import { useJuiceBulkReview } from '@/composables/use-juice-bulk-review.js';

const {
	model: state,
	def: stateDef,
} = useMkSelect({
	items: [
		{ label: i18n.ts._emojiRequestPage.statusPending, value: 'pending' },
		{ label: i18n.ts._emojiRequestPage.statusApproved, value: 'approved' },
		{ label: i18n.ts._emojiRequestPage.statusRejected, value: 'rejected' },
	],
	initialValue: 'pending',
});

const paginator = markRaw(new Paginator('admin/emoji-requests/list', {
	limit: 10,
	computedParams: computed(() => ({
		state: state.value,
	})),
}));

// JUICE: 選んでまとめて承認・却下する
const bulk = useJuiceBulkReview('emoji', paginator.items, state, id => paginator.removeItem(id));

function resolved(requestId: string) {
	paginator.removeItem(requestId);
	bulk.forget(requestId);
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._emojiRequestApprovals.title,
	icon: 'ti ti-mood-plus',
}));
</script>

<style lang="scss" module>
.item {
	display: flex;
	align-items: flex-start;
	gap: 8px;
}

.check {
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	width: 32px;
	height: 44px;
	cursor: pointer;

	> input {
		width: 18px;
		height: 18px;
		cursor: pointer;
	}
}

.itemBody {
	flex: 1;
	min-width: 0;
}
</style>
