<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 900px;">
		<div :class="$style.root" class="_gaps">
			<MkTip k="contactForms">
				{{ i18n.ts._contactForm._adminList.list }}
			</MkTip>

			<div :class="$style.inputs" class="_gaps">
				<MkSelect v-model="status" style="margin: 0; flex: 1;" :items="statusOptions">
					<template #label>{{ i18n.ts.state }}</template>
				</MkSelect>
				<MkSelect v-model="category" style="margin: 0; flex: 1;" :items="categoryFilterOptions">
					<template #label>{{ i18n.ts._contactForm._userForm.category }}</template>
				</MkSelect>
				<div :class="$style.assigneeFilter">
					<span :class="$style.assigneeFilterLabel">{{ i18n.ts._contactForm._adminDetail.assignedUser }}</span>
					<div class="_buttons">
						<MkButton v-if="assignedUser" rounded @click="assignedUser = null">
							<Mfm :text="`@${assignedUser.username}${assignedUser.host ? '@' + assignedUser.host : ''}`" :plain="true"/>
							<i class="ti ti-x" style="margin-left: 6px;"></i>
						</MkButton>
						<MkButton v-else rounded @click="pickAssignedUser">{{ i18n.ts.selectUser }}</MkButton>
					</div>
				</div>
			</div>

			<MkInfo v-if="paginator.items.value.length === 0 && !paginator.fetching.value">{{ i18n.ts._contactForm._adminList.noContacts }}</MkInfo>
			<MkPagination v-slot="{items}" :paginator="paginator">
				<div class="_gaps">
					<MkContactFormTicket v-for="contactForm in items" :key="contactForm.id" :contactForm="contactForm" @updated="onContactFormUpdated" @deleted="onContactFormDeleted"/>
				</div>
			</MkPagination>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkPagination from '@/components/MkPagination.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import * as os from '@/os.js';
import MkContactFormTicket from '@/components/MkContactFormTicket.vue';
import { useContactFormCategories } from '@/composables/useContactFormCategories.js';
import { Paginator } from '@/utility/paginator.js';

// JUICE: misskey-tempuraのコンタクトフォームを参考に追加
const { fetchCategories, categoryOptions } = useContactFormCategories();
fetchCategories({ includeDisabled: true });

const status = ref('all');
const category = ref('all');
const assignedUser = ref<Misskey.entities.UserLite | null>(null);

const statusOptions = [
	{ value: 'all', label: i18n.ts.all },
	{ value: 'pending', label: i18n.ts._contactForm._adminStatus.pending },
	{ value: 'in_progress', label: i18n.ts._contactForm._adminStatus.inProgress },
	{ value: 'resolved', label: i18n.ts._contactForm._adminStatus.resolved },
	{ value: 'closed', label: i18n.ts._contactForm._adminStatus.closed },
];

const categoryFilterOptions = computed(() => [
	{ value: 'all', label: i18n.ts.all },
	...categoryOptions.value,
]);

async function pickAssignedUser() {
	const user = await os.selectUser({ includeSelf: true }).catch(() => null);
	if (user) assignedUser.value = user;
}

const paginator = markRaw(new Paginator('admin/contact-form/list', {
	limit: 10,
	computedParams: computed(() => ({
		status: status.value === 'all' ? undefined : status.value as Misskey.entities.ContactForm['status'],
		category: category.value === 'all' ? undefined : category.value,
		assignedUserId: assignedUser.value?.id,
	})),
}));

function onContactFormUpdated(contactForm: Misskey.entities.ContactForm) {
	paginator.updateItem(contactForm.id, () => contactForm);
}

function onContactFormDeleted(contactFormId: string) {
	paginator.removeItem(contactFormId);
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._contactForm._adminList.list,
	icon: 'ti ti-mail',
}));
</script>

<style module lang="scss">
.root {
	display: flex;
	flex-direction: column;
	justify-content: center;
	align-items: stretch;
}

.inputs {
	display: flex;
	flex-direction: row;
	justify-content: space-between;
	align-items: center;
}

.assigneeFilter {
	flex: 1;
}

.assigneeFilterLabel {
	display: block;
	font-size: 0.85em;
	padding: 0 0 8px 0;
}
</style>
