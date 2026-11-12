<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<div class="_gaps">
		<MkInput
			v-model="searchQuery"
			large
			autofocus
			type="search"
			@enter.prevent="search"
		>
			<template #prefix><i class="ti ti-search"></i></template>
		</MkInput>
		<!-- JUICE: 検索欄自体はスペース区切りキーワードのAND検索のみ対応(構文としての「OR」「-」等は解釈しない)。
			OR検索・除外ワードは下の「高度な検索オプション」の専用UIで対応する -->
		<MkInfo>{{ i18n.ts._search.queryHint }}</MkInfo>

		<!-- JUICE: misskey-tempuraからチェリーピック(OR検索・除外ワード・各種フィルタ) -->
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
							<div v-if="$i != null">
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
							<div :style="$i == null ? 'grid-column: span 2;' : undefined">
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
				:disabled="searchParams == null"
				style="margin: 0 auto;"
				@click="search"
			>
				{{ i18n.ts.search }}
			</MkButton>
		</div>
	</div>

	<MkFoldableSection v-if="paginator">
		<template #header>{{ i18n.ts.searchResult }}</template>
		<MkNotesTimeline :key="`searchNotes:${key}`" :paginator="paginator"/>
	</MkFoldableSection>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref, shallowRef, toRef } from 'vue';
import { host as localHost, langs } from '@@/js/config.js';
import type * as Misskey from 'misskey-js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { apLookup } from '@/utility/lookup.js';
import { useRouter } from '@/router.js';
import MkButton from '@/components/MkButton.vue';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkUserCardMini from '@/components/MkUserCardMini.vue';
import { Paginator } from '@/utility/paginator.js';
import type { MkRadiosOption } from '@/components/MkRadios.vue';

// JUICE: misskey-tempuraからチェリーピック(OR検索・除外ワード・各種フィルタ)。
// searchScopeDefと同じくcomputedで遅延評価し、i18nロード前の評価による文言の固定化を避ける
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

const props = withDefaults(defineProps<{
	query?: string;
	userId?: string;
	username?: string;
	host?: string | null;
}>(), {
	query: '',
	userId: undefined,
	username: undefined,
	host: '',
});

const router = useRouter();

const key = ref(0);
const paginator = shallowRef<Paginator<'notes/search'> | null>(null);

const searchQuery = ref(toRef(props, 'query').value);
const hostInput = ref(toRef(props, 'host').value);
const rangeStartAt = ref<string | null>(null);
const rangeEndAt = ref<string | null>(null);

// JUICE: misskey-tempuraからチェリーピック(OR検索・除外ワード・各種フィルタ)
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

//#region set user
let fetchedUser: Misskey.entities.UserDetailed | null = null;

if (props.userId) {
	fetchedUser = await misskeyApi('users/show', {
		userId: props.userId,
	}).catch(() => null);
}

if (props.username && fetchedUser == null) {
	fetchedUser = await misskeyApi('users/show', {
		username: props.username,
		...(props.host ? { host: props.host } : {}),
	}).catch(() => null);
}

if (fetchedUser != null) {
	if (!(noteSearchableScope === 'local' && fetchedUser.host != null)) {
		user.value = fetchedUser;
	}
}
//#endregion

const searchScope = ref<'all' | 'local' | 'server' | 'user'>((() => {
	if (user.value != null) return 'user';
	if (noteSearchableScope === 'local') return 'local';
	if (hostInput.value) return 'server';
	return 'all';
})());

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

type SearchParams = {
	readonly query: string;
	readonly host?: string;
	readonly userId?: string;
	readonly rangeStartAt?: number | null;
	readonly rangeEndAt?: number | null;
};

const fixHostIfLocal = (target: string | null | undefined) => {
	if (!target || target === localHost) return '.';
	return target;
};

// JUICE: misskey-tempuraからチェリーピック(OR検索・除外ワード・各種フィルタ)
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

const searchParams = computed<SearchParams | null>(() => {
	const trimmedQuery = searchQuery.value.trim();
	if (!trimmedQuery) return null;

	if (searchScope.value === 'user') {
		if (user.value == null) return null;
		return {
			query: trimmedQuery,
			host: fixHostIfLocal(user.value.host),
			userId: user.value.id,
			...searchRange(),
		};
	}

	if (instance.federation !== 'none' && searchScope.value === 'server') {
		let trimmedHost = hostInput.value?.trim();
		if (!trimmedHost) return null;
		if (trimmedHost.startsWith('https://') || trimmedHost.startsWith('http://')) {
			try {
				trimmedHost = new URL(trimmedHost).host;
			} catch (err) { /* empty */ }
		}
		return {
			query: trimmedQuery,
			host: fixHostIfLocal(trimmedHost),
			...searchRange(),
		};
	}

	if (instance.federation === 'none' || searchScope.value === 'local') {
		return {
			query: trimmedQuery,
			host: '.',
			...searchRange(),
		};
	}

	return {
		query: trimmedQuery,
		...searchRange(),
	};
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
	if (searchParams.value == null) return;

	//#region AP lookup
	if (searchParams.value.query.startsWith('https://') && !searchParams.value.query.includes(' ')) {
		const confirm = await os.confirm({
			type: 'info',
			text: i18n.ts.lookupConfirm,
		});
		if (!confirm.canceled) {
			const res = await apLookup(searchParams.value.query);

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

	if (searchParams.value.query.length > 1 && !searchParams.value.query.includes(' ')) {
		if (searchParams.value.query.startsWith('@')) {
			const confirm = await os.confirm({
				type: 'info',
				text: i18n.ts.lookupConfirm,
			});
			if (!confirm.canceled) {
				router.pushByPath(`/${searchParams.value.query}`);
				return;
			}
		}

		if (searchParams.value.query.startsWith('#')) {
			const confirm = await os.confirm({
				type: 'info',
				text: i18n.ts.openTagPageConfirm,
			});
			if (!confirm.canceled) {
				router.push('/tags/:tag', {
					params: {
						tag: searchParams.value.query.substring(1),
					},
				});
				return;
			}
		}
	}

	paginator.value = markRaw(new Paginator('notes/search', {
		limit: 10,
		params: {
			...searchParams.value,
			...advancedSearchParams.value,
		},
	}));

	key.value++;
}
</script>
<style lang="scss" module>
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
