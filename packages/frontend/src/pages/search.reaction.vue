<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<!-- JUICE: 付けたリアクションでノートを検索する専用タブ。プライバシー上、自分自身のリアクションのみ対象 -->
	<div class="_gaps">
		<MkInfo>{{ i18n.ts._search.myReactionPageHint }}</MkInfo>

		<MkRadios v-model="myReactionMode" :options="myReactionModeOptions">
			<template #label>{{ i18n.ts._search.myReactionLabel }}<span class="_juice">JUICE</span></template>
		</MkRadios>

		<div v-if="myReactionMode === 'specific'">
			<button
				ref="myReactionPickerButtonEl"
				class="_button"
				:class="$style.myReactionPickerButton"
				@click="pickMyReaction"
			>
				<MkReactionIcon v-if="myReactionValue" :reaction="myReactionValue" :class="$style.myReactionPickerIcon"/>
				<span>{{ i18n.ts._search.selectReaction }}</span>
			</button>
		</div>

		<MkInput v-model="searchQuery" type="search" :placeholder="i18n.ts._search.narrowByKeywordPlaceholder" @enter.prevent="search">
			<template #prefix><i class="ti ti-search"></i></template>
		</MkInput>

		<!-- JUICE: ノート検索タブと同じ「高度な検索オプション」(misskey-tempuraからチェリーピック、OR検索・除外ワード・各種フィルタ) -->
		<MkFolder>
			<template #icon><i class="ti ti-adjustments"></i></template>
			<template #label>{{ i18n.ts._search.advancedSearch }}<span class="_juice">JUICE</span></template>

			<div class="_gaps_s">
				<MkRadios v-model="searchOperator" :options="searchOperatorOptions">
					<template #label>{{ i18n.ts._search.searchOperatorLabel }}</template>
				</MkRadios>

				<MkInput v-model="excludeWordsInput">
					<template #label>{{ i18n.ts._search.excludeWords }}</template>
					<template #caption>{{ i18n.ts._search.excludeWordsCaption }}</template>
				</MkInput>

				<MkRadios v-model="visibilitySelect" :options="visibilityOptions">
					<template #label>{{ i18n.ts.visibility }}</template>
				</MkRadios>
				<MkRadios v-model="hasFiles" :options="triStateOptions">
					<template #label>{{ i18n.ts._search.hasFilesLabel }}</template>
				</MkRadios>
				<MkRadios v-model="hasCw" :options="triStateOptions">
					<template #label>{{ i18n.ts._search.hasCwLabel }}</template>
				</MkRadios>
				<MkRadios v-model="hasReply" :options="triStateOptions">
					<template #label>{{ i18n.ts._search.hasReplyLabel }}</template>
				</MkRadios>
				<MkRadios v-model="hasPoll" :options="triStateOptions">
					<template #label>{{ i18n.ts._search.hasPollLabel }}</template>
				</MkRadios>
				<MkSelect v-model="lang" :items="langOptions">
					<template #label>{{ i18n.ts._search.langLabel }}</template>
				</MkSelect>
			</div>
		</MkFolder>

		<!-- JUICE: ノート検索タブと同じ「オプション」(日時範囲・検索範囲) -->
		<MkFoldableSection expanded>
			<template #header>{{ i18n.ts.options }}</template>

			<div class="_gaps_m">
				<div style="display: flex; gap: 8px;">
					<MkInput v-model="rangeStartAt" type="datetime-local">
						<template #label>{{ i18n.ts._search.postFrom }}</template>
					</MkInput>
					<MkInput v-model="rangeEndAt" type="datetime-local">
						<template #label>{{ i18n.ts._search.postTo }}</template>
					</MkInput>
				</div>

				<MkRadios
					v-model="searchScope"
					:options="searchScopeDef"
				>
				</MkRadios>

				<div v-if="instance.federation !== 'none' && searchScope === 'server'" :class="$style.subOptionRoot">
					<MkInput
						v-model="hostInput"
						:placeholder="i18n.ts._search.serverHostPlaceholder"
						@enter.prevent="search"
					>
						<template #label>{{ i18n.ts._search.pleaseEnterServerHost }}</template>
						<template #prefix><i class="ti ti-server"></i></template>
					</MkInput>
				</div>

				<div v-if="searchScope === 'user'" :class="$style.subOptionRoot">
					<div :class="$style.userSelectLabel">{{ i18n.ts._search.pleaseSelectUser }}</div>
					<div class="_gaps">
						<div v-if="user == null" :class="$style.userSelectButtons">
							<div>
								<MkButton
									transparent
									:class="$style.userSelectButton"
									@click="selectSelf"
								>
									<div :class="$style.userSelectButtonInner">
										<span><i class="ti ti-plus"></i><i class="ti ti-user"></i></span>
										<span>{{ i18n.ts.selectSelf }}</span>
									</div>
								</MkButton>
							</div>
							<div>
								<MkButton
									transparent
									:class="$style.userSelectButton"
									@click="selectUser"
								>
									<div :class="$style.userSelectButtonInner">
										<span><i class="ti ti-plus"></i></span>
										<span>{{ i18n.ts.selectUser }}</span>
									</div>
								</MkButton>
							</div>
						</div>
						<div v-else :class="$style.userSelectedButtons">
							<div style="overflow: hidden;">
								<MkUserCardMini
									:user="user"
									:withChart="false"
								/>
							</div>
							<div>
								<button
									class="_button"
									:class="$style.userSelectedRemoveButton"
									@click="removeUser"
								>
									<i class="ti ti-x"></i>
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</MkFoldableSection>

		<div>
			<MkButton
				large
				primary
				gradate
				rounded
				:disabled="!canSearch"
				style="margin: 0 auto;"
				@click="search"
			>
				{{ i18n.ts.search }}
			</MkButton>
		</div>
	</div>

	<MkFoldableSection v-if="paginator">
		<template #header>{{ i18n.ts.searchResult }}</template>
		<MkNotesTimeline :key="`searchReactionNotes:${key}`" :paginator="paginator"/>
	</MkFoldableSection>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref, shallowRef, useTemplateRef } from 'vue';
import { host as localHost, langs } from '@@/js/config.js';
import type * as Misskey from 'misskey-js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import * as os from '@/os.js';
import { apLookup } from '@/utility/lookup.js';
import { reactionPicker } from '@/utility/reaction-picker.js';
import { useRouter } from '@/router.js';
import MkButton from '@/components/MkButton.vue';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkUserCardMini from '@/components/MkUserCardMini.vue';
import { Paginator } from '@/utility/paginator.js';
import type { MkRadiosOption } from '@/components/MkRadios.vue';

// JUICE: search.note.vueの「高度な検索オプション」と同じ定義
const searchOperatorOptions = computed<MkRadiosOption[]>(() => [
	{ value: 'and', label: i18n.ts._search.searchOperatorAnd },
	{ value: 'or', label: i18n.ts._search.searchOperatorOr },
]);

const visibilityOptions = computed<MkRadiosOption[]>(() => [
	{ value: 'all', label: i18n.ts.all },
	{ value: 'public', label: i18n.ts._visibility.public },
	{ value: 'home', label: i18n.ts._visibility.home },
	{ value: 'followers', label: i18n.ts._visibility.followers },
	{ value: 'specified', label: i18n.ts._visibility.specified },
]);

const triStateOptions = computed<MkRadiosOption[]>(() => [
	{ value: 'all', label: i18n.ts.all },
	{ value: 'with', label: i18n.ts._search.optionWith },
	{ value: 'without', label: i18n.ts._search.optionWithout },
]);

// JUICE: ノートの言語(BCP 47言語タグ)での絞り込み。「all」は絞り込み無し
const langOptions = computed(() => [
	{ value: 'all', label: i18n.ts.all },
	...langs.map(([code, label]) => ({ value: code, label })),
]);

const router = useRouter();

const key = ref(0);
const paginator = shallowRef<Paginator<'notes/search'> | null>(null);

const searchQuery = ref('');
const hostInput = ref('');
const rangeStartAt = ref<string | null>(null);
const rangeEndAt = ref<string | null>(null);

const myReactionMode = ref<'any' | 'specific'>('any');
const myReactionValue = ref<string | null>(null);
const myReactionPickerButtonEl = useTemplateRef('myReactionPickerButtonEl');

const myReactionModeOptions = computed<MkRadiosOption[]>(() => [
	{ value: 'any', label: i18n.ts._search.myReactionAny, caption: i18n.ts._search.myReactionAnyCaption },
	{ value: 'specific', label: i18n.ts._search.myReactionSpecific, caption: i18n.ts._search.myReactionSpecificCaption },
]);

function pickMyReaction() {
	reactionPicker.show(myReactionPickerButtonEl.value ?? null, null, (reaction) => {
		myReactionValue.value = reaction;
	});
}

// JUICE: search.note.vueの「高度な検索オプション」と同じ定義
const searchOperator = ref<'and' | 'or'>('and');
const excludeWordsInput = ref('');
const visibilitySelect = ref<'all' | 'public' | 'home' | 'followers' | 'specified'>('all');
const hasFiles = ref<'all' | 'with' | 'without'>('all');
const hasCw = ref<'all' | 'with' | 'without'>('all');
const hasReply = ref<'all' | 'with' | 'without'>('all');
const hasPoll = ref<'all' | 'with' | 'without'>('all');
const lang = ref<string>('all');

const user = shallowRef<Misskey.entities.UserLite | null>(null);

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
const noteSearchableScope = instance.noteSearchableScope ?? 'local';

const searchScope = ref<'all' | 'local' | 'server' | 'user'>(noteSearchableScope === 'local' ? 'local' : 'all');

const searchScopeDef = computed<MkRadiosOption[]>(() => {
	const options: MkRadiosOption[] = [];

	if (instance.federation !== 'none' && noteSearchableScope === 'global') {
		options.push({ value: 'all', label: i18n.ts._search.searchScopeAll });
	}

	options.push({ value: 'local', label: instance.federation === 'none' ? i18n.ts._search.searchScopeAll : i18n.ts._search.searchScopeLocal });

	if (instance.federation !== 'none' && noteSearchableScope === 'global') {
		options.push({ value: 'server', label: i18n.ts._search.searchScopeServer });
	}

	options.push({ value: 'user', label: i18n.ts._search.searchScopeUser });

	return options;
});

const fixHostIfLocal = (target: string | null | undefined) => {
	if (!target || target === localHost) return '.';
	return target;
};

// JUICE: search.note.vueの「高度な検索オプション」と同じ定義
const advancedSearchParams = computed(() => ({
	visibility: visibilitySelect.value,
	hasFiles: hasFiles.value,
	hasCw: hasCw.value,
	hasReply: hasReply.value,
	hasPoll: hasPoll.value,
	searchOperator: searchOperator.value,
	excludeWords: excludeWordsInput.value.split(',').map(word => word.trim()).filter(word => word !== ''),
	lang: lang.value === 'all' ? null : lang.value,
}));

const searchRange = () => {
	return {
		rangeStartAt: rangeStartAt.value ? new Date(rangeStartAt.value).getTime() : null,
		rangeEndAt: rangeEndAt.value ? new Date(rangeEndAt.value).getTime() : null,
	};
};

// JUICE: リアクションが選べていること、かつ(scopeがuser/serverなら)その選択も済んでいることを要求する。
// search.note.vueと違い、キーワードは省略可能なので必須条件には含めない
const canSearch = computed(() => {
	if (myReactionMode.value === 'specific' && myReactionValue.value == null) return false;
	if (searchScope.value === 'user') return user.value != null;
	if (instance.federation !== 'none' && searchScope.value === 'server') return !!hostInput.value?.trim();
	return true;
});

function selectUser() {
	os.selectUser({
		includeSelf: true,
		localOnly: instance.noteSearchableScope === 'local',
	}).then(_user => {
		user.value = _user;
	});
}

function selectSelf() {
	user.value = $i;
}

function removeUser() {
	user.value = null;
}

async function search() {
	if (!canSearch.value) return;

	const trimmedQuery = searchQuery.value.trim();

	//#region AP lookup
	if (trimmedQuery.startsWith('https://') && !trimmedQuery.includes(' ')) {
		const confirm = await os.confirm({
			type: 'info',
			text: i18n.ts.lookupConfirm,
		});
		if (!confirm.canceled) {
			const res = await apLookup(trimmedQuery);

			if (res.type === 'User') {
				router.push('/@:acct/:page?', {
					params: {
						acct: `${res.object.username}@${res.object.host}`,
					},
				});
			// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
			} else if (res.type === 'Note') {
				router.push('/notes/:noteId/:initialTab?', {
					params: {
						noteId: res.object.id,
					},
				});
			}

			return;
		}
	}
	//#endregion

	if (trimmedQuery.length > 1 && !trimmedQuery.includes(' ')) {
		if (trimmedQuery.startsWith('@')) {
			const confirm = await os.confirm({
				type: 'info',
				text: i18n.ts.lookupConfirm,
			});
			if (!confirm.canceled) {
				router.pushByPath(`/${trimmedQuery}`);
				return;
			}
		}

		if (trimmedQuery.startsWith('#')) {
			const confirm = await os.confirm({
				type: 'info',
				text: i18n.ts.openTagPageConfirm,
			});
			if (!confirm.canceled) {
				router.push('/tags/:tag', {
					params: {
						tag: trimmedQuery.substring(1),
					},
				});
				return;
			}
		}
	}

	let scopeParams: { host?: string; userId?: string } = {};
	if (searchScope.value === 'user' && user.value != null) {
		scopeParams = { host: fixHostIfLocal(user.value.host), userId: user.value.id };
	} else if (instance.federation !== 'none' && searchScope.value === 'server') {
		let trimmedHost = hostInput.value?.trim();
		if (trimmedHost) {
			if (trimmedHost.startsWith('https://') || trimmedHost.startsWith('http://')) {
				try {
					trimmedHost = new URL(trimmedHost).host;
				} catch (err) { /* empty */ }
			}
			scopeParams = { host: fixHostIfLocal(trimmedHost) };
		}
	} else if (instance.federation === 'none' || searchScope.value === 'local') {
		scopeParams = { host: '.' };
	}

	paginator.value = markRaw(new Paginator('notes/search', {
		limit: 10,
		params: {
			query: trimmedQuery,
			myReaction: myReactionMode.value === 'any' ? 'any' : myReactionValue.value,
			...scopeParams,
			...searchRange(),
			...advancedSearchParams.value,
		},
	}));

	key.value++;
}
</script>
<style lang="scss" module>
.myReactionPickerButton {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	height: 32px;
	padding: 0 12px;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-buttonBg);
}

.myReactionPickerIcon {
	width: 20px;
	height: 20px;
}

.subOptionRoot {
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
	padding: var(--MI-margin);
}

.userSelectLabel {
	font-size: 0.85em;
	padding: 0 0 8px;
	user-select: none;
}

.userSelectButtons {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 16px;
}

.userSelectButton {
	width: 100%;
	height: 100%;
	padding: 12px;
	border: 2px dashed color(from var(--MI_THEME-fg) srgb r g b / 0.5);
}

.userSelectButtonInner {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: space-between;
	min-height: 38px;
}

.userSelectedButtons {
	display: grid;
	grid-template-columns: 1fr auto;
	align-items: center;
}

.userSelectedRemoveButton {
	width: 32px;
	height: 32px;
	color: #ff2a2a;
}
</style>
