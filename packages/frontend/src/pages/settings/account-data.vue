<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/account-data" :label="i18n.ts._settings.accountData" :keywords="['import', 'export', 'data', 'archive']" icon="ti ti-package">
	<div class="_gaps_m">
		<MkFeatureBanner icon="/fluent-emoji/1f4e6.png" color="#ff9100">
			<SearchText>{{ i18n.ts._settings.accountDataBanner }}</SearchText>
		</MkFeatureBanner>

		<!-- JUICE: 運営の承認が要るインポートの申請(審査待ち・最近の結果)。審査待ちは取り下げられる -->
		<MkFolder v-if="importRequests.length > 0" :defaultOpen="importRequests.some(r => r.status === 'pending')">
			<template #icon><i class="ti ti-file-import"></i></template>
			<template #label>{{ i18n.ts._importRequest.myRequests }}<span class="_juice">JUICE</span></template>
			<div class="_gaps_s">
				<div v-for="request in importRequests" :key="request.id" :class="$style.importRequest">
					<div :class="$style.importRequestMain">
						<div><b>{{ i18n.ts._importRequest._types[request.type] }}</b> <span :class="[$style.importRequestStatus, $style[`status_${request.status}`]]">{{ i18n.ts._importRequest._statuses[request.status] }}</span></div>
						<div :class="$style.importRequestSub">{{ request.fileName }} · <MkTime :time="request.createdAt"/></div>
						<div v-if="request.status === 'rejected' && request.rejectReason" :class="$style.importRequestSub">{{ i18n.ts._importRequest.rejectReason }}: {{ request.rejectReason }}</div>
					</div>
					<MkButton v-if="request.status === 'pending'" small rounded @click="cancelImportRequest(request.id)">{{ i18n.ts._importRequest.cancel }}</MkButton>
				</div>
			</div>
		</MkFolder>

		<div class="_gaps_s">
			<SearchMarker :keywords="['notes']">
				<MkFolder>
					<template #icon><i class="ti ti-pencil"></i></template>
					<template #label><SearchLabel>{{ i18n.ts._exportOrImport.allNotes }}</SearchLabel></template>
					<MkFolder :defaultOpen="true">
						<template #label>{{ i18n.ts.export }}</template>
						<template #icon><i class="ti ti-download"></i></template>
						<MkButton primary :class="$style.button" inline @click="exportNotes()"><i class="ti ti-download"></i> {{ i18n.ts.export }}</MkButton>
					</MkFolder>
				</MkFolder>
			</SearchMarker>

			<SearchMarker :keywords="['favorite', 'notes']">
				<MkFolder>
					<template #icon><i class="ti ti-star"></i></template>
					<template #label><SearchLabel>{{ i18n.ts._exportOrImport.favoritedNotes }}</SearchLabel></template>
					<MkFolder :defaultOpen="true">
						<template #label>{{ i18n.ts.export }}</template>
						<template #icon><i class="ti ti-download"></i></template>
						<MkButton primary :class="$style.button" inline @click="exportFavorites()"><i class="ti ti-download"></i> {{ i18n.ts.export }}</MkButton>
					</MkFolder>
				</MkFolder>
			</SearchMarker>

			<SearchMarker :keywords="['clip', 'notes']">
				<MkFolder>
					<template #icon><i class="ti ti-star"></i></template>
					<template #label><SearchLabel>{{ i18n.ts._exportOrImport.clips }}</SearchLabel></template>
					<MkFolder :defaultOpen="true">
						<template #label>{{ i18n.ts.export }}</template>
						<template #icon><i class="ti ti-download"></i></template>
						<MkButton primary :class="$style.button" inline @click="exportClips()"><i class="ti ti-download"></i> {{ i18n.ts.export }}</MkButton>
					</MkFolder>
				</MkFolder>
			</SearchMarker>

			<SearchMarker :keywords="['following', 'users']">
				<MkFolder>
					<template #icon><i class="ti ti-users"></i></template>
					<template #label><SearchLabel>{{ i18n.ts._exportOrImport.followingList }}</SearchLabel></template>
					<div class="_gaps_s">
						<MkFolder :defaultOpen="true">
							<template #label>{{ i18n.ts.export }}</template>
							<template #icon><i class="ti ti-download"></i></template>
							<div class="_gaps_s">
								<MkSwitch v-model="excludeMutingUsers">
									{{ i18n.ts._exportOrImport.excludeMutingUsers }}
								</MkSwitch>
								<MkSwitch v-model="excludeInactiveUsers">
									{{ i18n.ts._exportOrImport.excludeInactiveUsers }}
								</MkSwitch>
								<MkButton primary :class="$style.button" inline @click="exportFollowing()"><i class="ti ti-download"></i> {{ i18n.ts.export }}</MkButton>
							</div>
						</MkFolder>
						<MkFolder v-if="$i && !$i.movedTo && $i.policies.canImportFollowing" :defaultOpen="true">
							<template #label>{{ i18n.ts.import }}</template>
							<template #icon><i class="ti ti-upload"></i></template>
							<MkSwitch v-model="withReplies">
								{{ i18n.ts._exportOrImport.withReplies }}
							</MkSwitch>
							<MkButton primary :class="$style.button" inline @click="importFollowing($event)"><i class="ti ti-upload"></i> <template v-if="importNeedsApproval('following')">{{ i18n.ts._importRequest.importWithApproval }}<span class="_juice" :class="$style.juiceOnPrimary">JUICE</span></template><template v-else>{{ i18n.ts.import }}</template></MkButton>
						</MkFolder>
					</div>
				</MkFolder>
			</SearchMarker>

			<SearchMarker :keywords="['user', 'lists']">
				<MkFolder>
					<template #icon><i class="ti ti-users"></i></template>
					<template #label><SearchLabel>{{ i18n.ts._exportOrImport.userLists }}</SearchLabel></template>
					<div class="_gaps_s">
						<MkFolder :defaultOpen="true">
							<template #label>{{ i18n.ts.export }}</template>
							<template #icon><i class="ti ti-download"></i></template>
							<MkButton primary :class="$style.button" inline @click="exportUserLists()"><i class="ti ti-download"></i> {{ i18n.ts.export }}</MkButton>
						</MkFolder>
						<MkFolder v-if="$i && !$i.movedTo && $i.policies.canImportUserLists" :defaultOpen="true">
							<template #label>{{ i18n.ts.import }}</template>
							<template #icon><i class="ti ti-upload"></i></template>
							<MkButton primary :class="$style.button" inline @click="importUserLists($event)"><i class="ti ti-upload"></i> <template v-if="importNeedsApproval('userLists')">{{ i18n.ts._importRequest.importWithApproval }}<span class="_juice" :class="$style.juiceOnPrimary">JUICE</span></template><template v-else>{{ i18n.ts.import }}</template></MkButton>
						</MkFolder>
					</div>
				</MkFolder>
			</SearchMarker>

			<SearchMarker :keywords="['mute', 'users']">
				<MkFolder>
					<template #icon><i class="ti ti-user-off"></i></template>
					<template #label><SearchLabel>{{ i18n.ts._exportOrImport.muteList }}</SearchLabel></template>
					<div class="_gaps_s">
						<MkFolder :defaultOpen="true">
							<template #label>{{ i18n.ts.export }}</template>
							<template #icon><i class="ti ti-download"></i></template>
							<MkButton primary :class="$style.button" inline @click="exportMuting()"><i class="ti ti-download"></i> {{ i18n.ts.export }}</MkButton>
						</MkFolder>
						<MkFolder v-if="$i && !$i.movedTo && $i.policies.canImportMuting" :defaultOpen="true">
							<template #label>{{ i18n.ts.import }}</template>
							<template #icon><i class="ti ti-upload"></i></template>
							<MkButton primary :class="$style.button" inline @click="importMuting($event)"><i class="ti ti-upload"></i> <template v-if="importNeedsApproval('muting')">{{ i18n.ts._importRequest.importWithApproval }}<span class="_juice" :class="$style.juiceOnPrimary">JUICE</span></template><template v-else>{{ i18n.ts.import }}</template></MkButton>
						</MkFolder>
					</div>
				</MkFolder>
			</SearchMarker>

			<SearchMarker :keywords="['block', 'users']">
				<MkFolder>
					<template #icon><i class="ti ti-user-off"></i></template>
					<template #label><SearchLabel>{{ i18n.ts._exportOrImport.blockingList }}</SearchLabel></template>
					<div class="_gaps_s">
						<MkFolder :defaultOpen="true">
							<template #label>{{ i18n.ts.export }}</template>
							<template #icon><i class="ti ti-download"></i></template>
							<MkButton primary :class="$style.button" inline @click="exportBlocking()"><i class="ti ti-download"></i> {{ i18n.ts.export }}</MkButton>
						</MkFolder>
						<MkFolder v-if="$i && !$i.movedTo && $i.policies.canImportBlocking" :defaultOpen="true">
							<template #label>{{ i18n.ts.import }}</template>
							<template #icon><i class="ti ti-upload"></i></template>
							<MkButton primary :class="$style.button" inline @click="importBlocking($event)"><i class="ti ti-upload"></i> <template v-if="importNeedsApproval('blocking')">{{ i18n.ts._importRequest.importWithApproval }}<span class="_juice" :class="$style.juiceOnPrimary">JUICE</span></template><template v-else>{{ i18n.ts.import }}</template></MkButton>
						</MkFolder>
					</div>
				</MkFolder>
			</SearchMarker>

			<SearchMarker :keywords="['antennas']">
				<MkFolder>
					<template #icon><i class="ti ti-antenna"></i></template>
					<template #label><SearchLabel>{{ i18n.ts.antennas }}</SearchLabel></template>
					<div class="_gaps_s">
						<MkFolder :defaultOpen="true">
							<template #label>{{ i18n.ts.export }}</template>
							<template #icon><i class="ti ti-download"></i></template>
							<MkButton primary :class="$style.button" inline @click="exportAntennas()"><i class="ti ti-download"></i> {{ i18n.ts.export }}</MkButton>
						</MkFolder>
						<MkFolder v-if="$i && !$i.movedTo && $i.policies.canImportAntennas" :defaultOpen="true">
							<template #label>{{ i18n.ts.import }}</template>
							<template #icon><i class="ti ti-upload"></i></template>
							<MkButton primary :class="$style.button" inline @click="importAntennas($event)"><i class="ti ti-upload"></i> <template v-if="importNeedsApproval('antennas')">{{ i18n.ts._importRequest.importWithApproval }}<span class="_juice" :class="$style.juiceOnPrimary">JUICE</span></template><template v-else>{{ i18n.ts.import }}</template></MkButton>
						</MkFolder>
					</div>
				</MkFolder>
			</SearchMarker>
		</div>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import type * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { selectFile } from '@/utility/drive.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { $i } from '@/i.js';
import MkFeatureBanner from '@/components/MkFeatureBanner.vue';
import { prefer } from '@/preferences.js';
import { juicePublicSettingsCache } from '@/cache.js';

const excludeMutingUsers = ref(false);
const excludeInactiveUsers = ref(false);
const withReplies = ref(prefer.s.defaultFollowWithReplies);

const onExportSuccess = () => {
	os.alert({
		type: 'info',
		text: i18n.ts.exportRequested,
	});
};

// JUICE: 運営の承認が要るインポートなら、申請を受け付けたことを伝える(承認されたらインポートする)
const onImportSuccess = (res?: { requiresApproval: boolean }) => {
	os.alert({
		type: 'info',
		text: res?.requiresApproval ? i18n.ts._importRequest.requested : i18n.ts.importRequested,
	});
	if (res?.requiresApproval) fetchImportRequests();
};

// JUICE: この種類のインポートに、運営の承認が要るか(審査できる人は、自分のインポートを承認なしで行える)
const importApprovalRequiredTypes = computed(() => juicePublicSettingsCache.value.value?.importApprovalRequiredTypes ?? []);

function importNeedsApproval(type: Misskey.entities.ImportRequest['type']): boolean {
	if ($i == null || $i.isModerator || $i.isAdmin || $i.policies.canApproveImportRequests) return false;
	return importApprovalRequiredTypes.value.includes(type);
}

juicePublicSettingsCache.fetch().catch(() => { /* empty */ });

// JUICE: 自分のインポートの申請(新しい順に、最近のものだけ)
const importRequests = ref<Misskey.entities.ImportRequest[]>([]);

function fetchImportRequests() {
	if ($i == null) return;
	misskeyApi('import-requests/list', { limit: 10 }).then(requests => {
		importRequests.value = requests;
	}).catch(() => {});
}

async function cancelImportRequest(requestId: string) {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.ts._importRequest.cancelConfirm,
	});
	if (canceled) return;
	await os.apiWithDialog('import-requests/cancel', { requestId });
	fetchImportRequests();
}

fetchImportRequests();

const onError = (ev: Error) => {
	os.alert({
		type: 'error',
		text: ev.message,
	});
};

const exportNotes = () => {
	misskeyApi('i/export-notes', {}).then(onExportSuccess).catch(onError);
};

const exportFavorites = () => {
	misskeyApi('i/export-favorites', {}).then(onExportSuccess).catch(onError);
};

const exportClips = () => {
	misskeyApi('i/export-clips', {}).then(onExportSuccess).catch(onError);
};

const exportFollowing = () => {
	misskeyApi('i/export-following', {
		excludeMuting: excludeMutingUsers.value,
		excludeInactive: excludeInactiveUsers.value,
	})
		.then(onExportSuccess).catch(onError);
};

const exportBlocking = () => {
	misskeyApi('i/export-blocking', {}).then(onExportSuccess).catch(onError);
};

const exportUserLists = () => {
	misskeyApi('i/export-user-lists', {}).then(onExportSuccess).catch(onError);
};

const exportMuting = () => {
	misskeyApi('i/export-mute', {}).then(onExportSuccess).catch(onError);
};

const exportAntennas = () => {
	misskeyApi('i/export-antennas', {}).then(onExportSuccess).catch(onError);
};

const importFollowing = async (ev: PointerEvent) => {
	const file = await selectFile({
		anchorElement: ev.currentTarget ?? ev.target,
		multiple: false,
	});
	misskeyApi('i/import-following', {
		fileId: file.id,
		withReplies: withReplies.value,
	}).then(onImportSuccess).catch(onError);
};

const importUserLists = async (ev: PointerEvent) => {
	const file = await selectFile({
		anchorElement: ev.currentTarget ?? ev.target,
		multiple: false,
	});
	misskeyApi('i/import-user-lists', { fileId: file.id }).then(onImportSuccess).catch(onError);
};

const importMuting = async (ev: PointerEvent) => {
	const file = await selectFile({
		anchorElement: ev.currentTarget ?? ev.target,
		multiple: false,
	});
	misskeyApi('i/import-muting', { fileId: file.id }).then(onImportSuccess).catch(onError);
};

const importBlocking = async (ev: PointerEvent) => {
	const file = await selectFile({
		anchorElement: ev.currentTarget ?? ev.target,
		multiple: false,
	});
	misskeyApi('i/import-blocking', { fileId: file.id }).then(onImportSuccess).catch(onError);
};

const importAntennas = async (ev: PointerEvent) => {
	const file = await selectFile({
		anchorElement: ev.currentTarget ?? ev.target,
		multiple: false,
	});
	misskeyApi('i/import-antennas', { fileId: file.id }).then(onImportSuccess).catch(onError);
};

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._settings.accountData,
	icon: 'ti ti-package',
}));
</script>

<style module>
.button {
	margin-right: 16px;
}

/* JUICE: 色の付いたボタンの上のJUICEバッジは、ボタンの文字の色で塗りつぶして、ボタンの色の字にする(橙の上に橙の枠だと見えないため) */
.juiceOnPrimary.juiceOnPrimary {
	color: var(--MI_THEME-accent);
	background: var(--MI_THEME-fgOnAccent);
	border-color: var(--MI_THEME-fgOnAccent);
	font-weight: bold;
}

.importRequest {
	display: flex;
	align-items: center;
	gap: 12px;
}

.importRequestMain {
	flex: 1;
	min-width: 0;
}

.importRequestSub {
	font-size: 0.85em;
	opacity: 0.7;
	overflow-wrap: anywhere;
}

.importRequestStatus {
	margin-left: 4px;
	padding: 1px 8px;
	border-radius: 999px;
	font-size: 0.8em;
	background: var(--MI_THEME-buttonBg);
}

.status_pending {
	color: var(--MI_THEME-warn);
}

.status_approved {
	color: var(--MI_THEME-success);
}

.status_rejected {
	color: var(--MI_THEME-error);
}
</style>
