<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="src" :actions="headerActions" :tabs="$i ? headerTabs : headerTabsWhenNotLogin" :swipable="true" :displayMyAvatar="true" :canOmitTitle="true">
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<MkTip v-if="isBasicTimeline(src)" :k="`tl.${src}`" style="margin-bottom: var(--MI-margin);">
			{{ i18n.ts._timelineDescription[src] }}
		</MkTip>
		<MkPostForm v-if="prefer.r.showFixedPostForm.value" :class="$style.postForm" class="_panel" fixed style="margin-bottom: var(--MI-margin);"/>
		<MkStreamingNotesTimeline
			ref="tlComponent"
			:key="src + withRenotes + effectiveWithReplies + effectiveOnlyFiles + withSensitive + localOnly + onlyNovel + relayTimelineFilter.join(',') + mediaTimelineSrc + ($i ? $i.filteredLanguages.join(',') + $i.excludeOwnNotesFromLanguageFilter : '')"
			:class="$style.tl"
			:src="(src === 'media' ? mediaTimelineSrc : src.split(':')[0]) as (BasicTimelineType | 'list' | 'relay')"
			:list="src.split(':')[1]"
			:relays="src === 'relay' ? relayTimelineFilter : undefined"
			:withRenotes="withRenotes"
			:withReplies="effectiveWithReplies"
			:withSensitive="withSensitive"
			:onlyFiles="effectiveOnlyFiles"
			:localOnly="localOnly"
			:onlyNovel="onlyNovel"
			:pixelfedMode="src === 'media'"
			:sound="true"
		/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, watch, provide, useTemplateRef, ref, onMounted, onActivated } from 'vue';
import * as Misskey from 'misskey-js';
import type { Tab } from '@/components/global/MkPageHeader.tabs.vue';
import type { MenuItem } from '@/types/menu.js';
import type { BasicTimelineType } from '@/timelines.js';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import MkPostForm from '@/components/MkPostForm.vue';
import * as os from '@/os.js';
import { store } from '@/store.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { instance } from '@/instance.js';
import { definePage } from '@/page.js';
import { antennasCache, userListsCache, favoritedChannelsCache, juicePublicSettingsCache, juiceRelaysCache } from '@/cache.js';
import { deviceKind } from '@/utility/device-kind.js';
import { deepMerge } from '@/utility/merge.js';
import { pruneRelayTimelineFilter } from '@/utility/juice-relay-timeline-filter.js';
import { miLocalStorage } from '@/local-storage.js';
import { availableBasicTimelines, hasWithReplies, isAvailableBasicTimeline, isBasicTimeline, basicTimelineIconClass } from '@/timelines.js';
import { prefer } from '@/preferences.js';
import { langs } from '@@/js/config.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const tlComponent = useTemplateRef('tlComponent');

// JUICE: リレーTLが有効なインスタンスでのみタブに出す
const relayTimelineEnabled = ref(false);
// 表示可否はGTLと共通のgtlAvailableポリシーにも従う
const relayTimelineAvailable = computed(() => relayTimelineEnabled.value && ($i != null ? $i.policies.gtlAvailable : instance.policies.gtlAvailable));

// JUICE: メディアタイムライン(添付ファイル付きノートのグリッド表示)が有効なインスタンスでのみタブに出す
const mediaTimelineEnabled = ref(false);
const mediaTimelineAvailable = computed(() => mediaTimelineEnabled.value);

// JUICE: relayTimelineEnabled/mediaTimelineEnabledはjuicePublicSettingsCacheの取得が終わるまで
// 既定でfalseになる。取得前にswitchTlIfNeeded()がリレー/メディアタブを「無効」と誤判定して
// ホームへ強制的に切り替え・永続化してしまう(リロード直後にリレー/メディアタブへ戻れなくなる)のを防ぐため、
// 取得完了までリレー/メディアタブに関する判定を保留する
const juicePublicSettingsLoaded = ref(false);
// JUICE: メディアタイムラインが対象とするタイムライン範囲(ホーム/ローカル/ソーシャル/グローバル)。閲覧者側で選択可能で、選択状態はJUICE設定に永続化する
const mediaTimelineSrc = computed<BasicTimelineType>({
	get: () => isAvailableBasicTimeline(prefer.r.mediaTimelineSrc.value) ? prefer.r.mediaTimelineSrc.value : availableBasicTimelines()[0],
	set: (x) => prefer.commit('mediaTimelineSrc', x),
});

// JUICE: タブバーに出すベーシックタイムライン(ホーム/ローカル/ソーシャル/グローバル)・リレー・メディアタイムライン・
// リスト/アンテナ/チャンネルの切り替えショートカットのうち、閲覧者側の好みで個別に非表示にしたものの一覧
// (設定の「JUICE」ページで変更する)。サーバー側で無効化されているタブには影響しない
const hiddenTimelineTabs = computed(() => prefer.r.hiddenTimelineTabs.value);

function isTimelineTabHidden(key: string): boolean {
	return hiddenTimelineTabs.value.includes(key);
}

// JUICE: リレーTLを特定のリレーだけに絞り込むための一覧。選択状態はJUICE設定(prefer.s.relayTimelineFilter)に永続化する
const relays = ref<Misskey.entities.JuiceRelaysResponse>([]);
const relayTimelineFilter = computed(() => prefer.r.relayTimelineFilter.value);

function relaySelectedRef(id: string) {
	return computed<boolean>({
		get: () => prefer.r.relayTimelineFilter.value.includes(id),
		set: (checked) => prefer.commit('relayTimelineFilter', checked
			? [...prefer.s.relayTimelineFilter, id]
			: prefer.s.relayTimelineFilter.filter(x => x !== id)),
	});
}

// JUICE: タイムラインに表示する言語の絞り込み。リレーフィルタと異なりサーバー側(アカウント)の
// 設定なので、i/updateへ保存する(反映は他のi/update系設定と同様、meUpdatedストリームイベント経由)。
// langsは40言語超あり、「…」メニューを開くたびにcomputedを作り直すと体感できる遅さになるため、
// コンポーネント初期化時に1回だけ生成してMapに保持し、メニュー表示時は参照するだけにする
function filteredLanguageSelectedRef(code: string) {
	return computed<boolean>({
		get: () => $i != null && $i.filteredLanguages.includes(code),
		set: (checked) => {
			if ($i == null) return;
			misskeyApi('i/update', {
				filteredLanguages: checked
					? [...$i.filteredLanguages, code]
					: $i.filteredLanguages.filter(x => x !== code),
			});
		},
	});
}

const filteredLanguageRefs = new Map(langs.map(([code]) => [code, filteredLanguageSelectedRef(code)]));

// JUICE: 表示言語の絞り込みが有効な場合でも、自分自身の投稿を常に表示するか
const excludeOwnNotesFromLanguageFilterRef = computed<boolean>({
	get: () => $i != null && $i.excludeOwnNotesFromLanguageFilter,
	set: (checked) => {
		if ($i == null) return;
		misskeyApi('i/update', {
			excludeOwnNotesFromLanguageFilter: checked,
		});
	},
});

juicePublicSettingsCache.fetch().then(res => {
	relayTimelineEnabled.value = res.relayTimelineEnabled;
	mediaTimelineEnabled.value = res.mediaTimelineEnabled;
	juicePublicSettingsLoaded.value = true;
	// 取得前に選択されていた場合や、無効化された後に古い選択が残っていた場合に備えて再チェックする
	switchTlIfNeeded();

	if (relayTimelineAvailable.value) {
		juiceRelaysCache.fetch().then(res => {
			relays.value = res;
			pruneRelayTimelineFilter(res.map(relay => relay.id));
		});
	}
});

type TimelinePageSrc = BasicTimelineType | 'relay' | 'media' | `list:${string}`;

const srcWhenNotSignin = ref<'local' | 'global'>(isAvailableBasicTimeline('local') ? 'local' : 'global');
const src = computed<TimelinePageSrc>({
	get: () => ($i ? store.r.tl.value.src : srcWhenNotSignin.value),
	set: (x) => saveSrc(x),
});

const withRenotes = computed<boolean>({
	get: () => store.r.tl.value.filter.withRenotes,
	set: (x) => saveTlFilter('withRenotes', x),
});

// computed内での無限ループを防ぐためのフラグ
const localSocialTLFilterSwitchStore = ref<'withReplies' | 'onlyFiles' | false>(
	store.r.tl.value.filter.withReplies ? 'withReplies' :
	store.r.tl.value.filter.onlyFiles ? 'onlyFiles' :
	false,
);

const withReplies = computed<boolean>({
	get: () => {
		if (!$i) return false;
		if (['local', 'social'].includes(src.value) && localSocialTLFilterSwitchStore.value === 'onlyFiles') {
			return false;
		} else {
			return store.r.tl.value.filter.withReplies;
		}
	},
	set: (x) => saveTlFilter('withReplies', x),
});
const onlyFiles = computed<boolean>({
	get: () => {
		if (['local', 'social'].includes(src.value) && localSocialTLFilterSwitchStore.value === 'withReplies') {
			return false;
		} else {
			return store.r.tl.value.filter.onlyFiles;
		}
	},
	set: (x) => saveTlFilter('onlyFiles', x),
});

// JUICE: メディアタイムライン表示中は、通常の「ファイル付きのみ」トグルの状態に関わらず常にファイル付きのみに絞り込む。
// withRepliesと同時指定するとlocal-timeline/hybrid-timelineがBOTH_WITH_REPLIES_AND_WITH_FILESエラーを返すため、
// withReplies側も強制的にfalseにする(通常返信を含めるかの設定自体は、メディアタブ切り替え後も保持されたままにする)
const effectiveOnlyFiles = computed(() => src.value === 'media' ? true : onlyFiles.value);
const effectiveWithReplies = computed(() => src.value === 'media' ? false : withReplies.value);

watch([withReplies, onlyFiles], ([withRepliesTo, onlyFilesTo]) => {
	if (withRepliesTo) {
		localSocialTLFilterSwitchStore.value = 'withReplies';
	} else if (onlyFilesTo) {
		localSocialTLFilterSwitchStore.value = 'onlyFiles';
	} else {
		localSocialTLFilterSwitchStore.value = false;
	}
});

const withSensitive = computed<boolean>({
	get: () => store.r.tl.value.filter.withSensitive,
	set: (x) => saveTlFilter('withSensitive', x),
});

// JUICE: ホームタイムラインをローカルユーザーの投稿だけに絞り込む
const localOnly = computed<boolean>({
	get: () => store.r.tl.value.filter.localOnly,
	set: (x) => saveTlFilter('localOnly', x),
});

// JUICE: 「小説」フラグが付いた投稿だけに絞り込む
const onlyNovel = computed<boolean>({
	get: () => store.r.tl.value.filter.onlyNovel,
	set: (x) => saveTlFilter('onlyNovel', x),
});

const showFixedPostForm = prefer.model('showFixedPostForm');

async function chooseList(ev: PointerEvent): Promise<void> {
	const lists = await userListsCache.fetch();
	const items: (MenuItem | undefined)[] = [
		...lists.map(list => ({
			type: 'link' as const,
			text: list.name,
			to: `/timeline/list/${list.id}`,
		})),
		(lists.length === 0 ? undefined : { type: 'divider' }),
		{
			type: 'link' as const,
			icon: 'ti ti-plus',
			text: i18n.ts.createNew,
			to: '/my/lists',
		},
	];
	os.popupMenu(items.filter(i => i != null), ev.currentTarget ?? ev.target);
}

async function chooseAntenna(ev: PointerEvent): Promise<void> {
	const antennas = await antennasCache.fetch();
	const items: (MenuItem | undefined)[] = [
		...antennas.map(antenna => ({
			type: 'link' as const,
			text: antenna.name,
			indicate: antenna.hasUnreadNote,
			to: `/timeline/antenna/${antenna.id}`,
		})),
		(antennas.length === 0 ? undefined : { type: 'divider' }),
		{
			type: 'link' as const,
			icon: 'ti ti-plus',
			text: i18n.ts.createNew,
			to: '/my/antennas',
		},
	];
	os.popupMenu(items.filter(i => i != null), ev.currentTarget ?? ev.target);
}

async function chooseChannel(ev: PointerEvent): Promise<void> {
	const channels = await favoritedChannelsCache.fetch();
	const items: (MenuItem | undefined)[] = [
		...channels.map(channel => {
			const lastReadedAt = miLocalStorage.getItemAsJson(`channelLastReadedAt:${channel.id}`) ?? null;
			const hasUnreadNote = (lastReadedAt && channel.lastNotedAt) ? Date.parse(channel.lastNotedAt) > lastReadedAt : !!(!lastReadedAt && channel.lastNotedAt);

			return {
				type: 'link' as const,
				text: channel.name,
				indicate: hasUnreadNote,
				to: `/channels/${channel.id}`,
			};
		}),
		(channels.length === 0 ? undefined : { type: 'divider' }),
		{
			type: 'link',
			icon: 'ti ti-plus',
			text: i18n.ts.createNew,
			to: '/channels/new',
		},
	];
	os.popupMenu(items.filter(i => i != null), ev.currentTarget ?? ev.target);
}

function saveSrc(newSrc: TimelinePageSrc): void {
	const out = deepMerge({ src: newSrc }, store.s.tl);

	if (newSrc.startsWith('userList:')) {
		const id = newSrc.substring('userList:'.length);
		out.userList = prefer.r.pinnedUserLists.value.find(l => l.id === id) ?? null;
	}

	store.set('tl', out);
	if (['local', 'global'].includes(newSrc)) {
		srcWhenNotSignin.value = newSrc as 'local' | 'global';
	}
}

function saveTlFilter(key: keyof typeof store.s.tl.filter, newValue: boolean) {
	if (key !== 'withReplies' || $i) {
		const out = deepMerge({ filter: { [key]: newValue } }, store.s.tl);
		store.set('tl', out);
	}
}

// JUICE: 非表示にしたタブが一つも残っていない極端な場合のフォールバックとして、
// 全滅していればhiddenTimelineTabsを無視してでも先頭のタイムラインを返す
function firstVisibleBasicTimeline(): BasicTimelineType {
	const list = availableBasicTimelines();
	return list.find(tl => !isTimelineTabHidden(tl)) ?? list[0];
}

function switchTlIfNeeded() {
	if (isBasicTimeline(src.value) && (!isAvailableBasicTimeline(src.value) || isTimelineTabHidden(src.value))) {
		src.value = firstVisibleBasicTimeline();
	} else if (src.value === 'relay' && juicePublicSettingsLoaded.value && (!relayTimelineAvailable.value || isTimelineTabHidden('relay'))) {
		src.value = firstVisibleBasicTimeline();
	} else if (src.value === 'media' && juicePublicSettingsLoaded.value && (!mediaTimelineAvailable.value || isTimelineTabHidden('media'))) {
		src.value = firstVisibleBasicTimeline();
	}
}

onMounted(() => {
	switchTlIfNeeded();
});
onActivated(() => {
	switchTlIfNeeded();
});
// JUICE: 表示中のタブをその場で非表示にした場合に備えて、切り替え直後にも再チェックする
watch(hiddenTimelineTabs, switchTlIfNeeded);

const headerActions = computed<PageHeaderItem[]>(() => {
	const items: PageHeaderItem[] = [{
		icon: 'ti ti-dots',
		text: i18n.ts.options,
		handler: (ev) => {
			const menuItems: MenuItem[] = [];

			menuItems.push({
				type: 'switch',
				icon: 'ti ti-repeat',
				text: i18n.ts.showRenotes,
				ref: withRenotes,
			});

			if (isBasicTimeline(src.value) && hasWithReplies(src.value)) {
				menuItems.push({
					type: 'switch',
					icon: 'ti ti-messages',
					text: i18n.ts.showRepliesToOthersInTimeline,
					ref: withReplies,
					disabled: onlyFiles,
				});
			}

			// JUICE: ホームタイムラインをローカルユーザーの投稿だけに絞り込む(すでに全ローカルを見せるlocal/socialでは意味が無いためhomeのみ)
			if (src.value === 'home') {
				menuItems.push({
					type: 'switch',
					icon: 'ti ti-planet',
					text: i18n.ts._juice.localOnlyInHomeTimeline,
					ref: localOnly,
					badge: true,
				});
			}

			// JUICE: 「小説」フラグが付いた投稿だけに絞り込む(メディアタイムラインでも)
			if (isBasicTimeline(src.value) || src.value === 'media') {
				menuItems.push({
					type: 'switch',
					icon: 'ti ti-book',
					text: i18n.ts._juice.novelOnly,
					ref: onlyNovel,
					badge: true,
				});
			}

			// JUICE: リレーTL表示中のみ、絞り込み先リレーを選べるようにする(複数選択可、未選択=すべてのリレーを表示)
			if (src.value === 'relay' && relays.value.length > 0) {
				menuItems.push({
					type: 'parent',
					icon: 'ti ti-broadcast',
					text: i18n.ts._juice.relayTimelineFilter,
					badge: true,
					children: () => relays.value.map(relay => ({
						type: 'switch',
						text: relay.host,
						ref: relaySelectedRef(relay.id),
					})),
				});
			}

			// JUICE: メディアタイムライン表示中のみ、対象とするタイムライン範囲(ホーム/ローカル/ソーシャル/グローバル)を選べるようにする
			if (src.value === 'media') {
				menuItems.push({
					type: 'radio',
					icon: 'ti ti-list-search',
					text: i18n.ts._juice.mediaTimelineSrc,
					ref: mediaTimelineSrc,
					options: availableBasicTimelines().map(tl => ({
						label: i18n.ts._timelines[tl],
						value: tl,
					})),
				});
			}

			// JUICE: 表示する投稿を言語で絞り込む(未選択=すべての言語を表示、言語未指定の投稿は常に表示)
			if ($i) {
				menuItems.push({
					type: 'parent',
					icon: 'ti ti-language',
					text: i18n.ts._juice.filteredLanguages,
					badge: true,
					children: () => [{
						type: 'switch',
						text: i18n.ts._juice.excludeOwnNotesFromLanguageFilter,
						ref: excludeOwnNotesFromLanguageFilterRef,
					}, ...langs.map(([code, label]) => ({
						type: 'switch' as const,
						text: label,
						ref: filteredLanguageRefs.get(code)!,
					}))],
				});
			}

			menuItems.push({
				type: 'switch',
				icon: 'ti ti-eye-exclamation',
				text: i18n.ts.withSensitive,
				ref: withSensitive,
			});

			// JUICE: メディアタイムライン表示中は常にファイル付きのみへ強制しているため、このトグル自体を隠す
			if (src.value !== 'media') {
				menuItems.push({
					type: 'switch',
					icon: 'ti ti-photo',
					text: i18n.ts.fileAttachedOnly,
					ref: onlyFiles,
					disabled: isBasicTimeline(src.value) && hasWithReplies(src.value) ? withReplies : false,
				});
			}

			menuItems.push({
				type: 'divider',
			}, {
				type: 'switch',
				text: i18n.ts.showFixedPostForm,
				ref: showFixedPostForm,
			});

			os.popupMenu(menuItems, ev.currentTarget ?? ev.target);
		},
	}];

	if (deviceKind === 'desktop') {
		items.unshift({
			icon: 'ti ti-refresh',
			text: i18n.ts.reload,
			handler: () => {
				tlComponent.value?.reloadTimeline();
			},
		});
	}

	return items;
});

// JUICE: ショートカットタブ(ベーシックタイムライン・リレー・メディアタイムライン・
// リスト/アンテナ/チャンネル)を、設定の「JUICE」ページで保存した並び順(timelineTabOrder)に
// 沿って並べ替える。並び順未設定/新しく増えたタブは既定の並びのまま末尾に追加される。
// ピン留めリストは並び替え対象外で常に先頭に固定する(settings/juice.vue側の並び替えUIの対象外のため)
function buildOrderedShortcutTabs(includeLoginOnly: boolean): Tab[] {
	// JUICE: list/antenna/channelはタブ切り替えではなくメニューを開くだけのショートカットのため、
	// (Tab.key指定するとMkPageHeader.tabs.vue側でtabのv-modelがそのキーに書き換わってしまう)
	// 意図的にkeyを持たない。並び替え用のsortKeyとは別物
	const entries: { sortKey: string; tab: Omit<Tab, 'key'> & { key?: string } }[] = [];

	for (const tl of availableBasicTimelines()) {
		if (isTimelineTabHidden(tl)) continue;
		entries.push({
			sortKey: tl,
			tab: { key: tl, title: i18n.ts._timelines[tl], icon: basicTimelineIconClass(tl), iconOnly: true },
		});
	}

	if (relayTimelineAvailable.value && !isTimelineTabHidden('relay')) {
		entries.push({
			sortKey: 'relay',
			tab: { key: 'relay', title: i18n.ts._juice.relayTimelineTab, icon: 'ti ti-broadcast', iconOnly: true, badge: true },
		});
	}

	if (mediaTimelineAvailable.value && !isTimelineTabHidden('media')) {
		entries.push({
			sortKey: 'media',
			tab: { key: 'media', title: i18n.ts._juice.mediaTimelineTab, icon: 'ti ti-photo', iconOnly: true, badge: true },
		});
	}

	if (includeLoginOnly) {
		if (!isTimelineTabHidden('list')) {
			entries.push({ sortKey: 'list', tab: { icon: 'ti ti-list', title: i18n.ts.lists, iconOnly: true, onClick: chooseList } });
		}
		if (!isTimelineTabHidden('antenna')) {
			entries.push({ sortKey: 'antenna', tab: { icon: 'ti ti-antenna', title: i18n.ts.antennas, iconOnly: true, onClick: chooseAntenna } });
		}
		if (!isTimelineTabHidden('channel')) {
			entries.push({ sortKey: 'channel', tab: { icon: 'ti ti-device-tv', title: i18n.ts.channel, iconOnly: true, onClick: chooseChannel } });
		}
	}

	const order = prefer.r.timelineTabOrder.value;
	const known = entries.filter(e => order.includes(e.sortKey));
	const unknown = entries.filter(e => !order.includes(e.sortKey));
	known.sort((a, b) => order.indexOf(a.sortKey) - order.indexOf(b.sortKey));
	return [...known, ...unknown].map(e => e.tab) as Tab[];
}

const headerTabs = computed(() => [
	...prefer.r.pinnedUserLists.value.map(l => ({
		key: 'list:' + l.id,
		title: l.name,
		icon: 'ti ti-star',
		iconOnly: true,
	})),
	...buildOrderedShortcutTabs(true),
] as Tab[]);

const headerTabsWhenNotLogin = computed(() => buildOrderedShortcutTabs(false) as Tab[]);

definePage(() => ({
	title: i18n.ts.timeline,
	icon: isBasicTimeline(src.value) ? basicTimelineIconClass(src.value) : 'ti ti-home',
}));
</script>

<style lang="scss" module>
.new {
	position: sticky;
	top: calc(var(--MI-stickyTop, 0px) + 16px);
	z-index: 1000;
	width: 100%;
	margin: calc(-0.675em - 8px) 0;

	&:first-child {
		margin-top: calc(-0.675em - 8px - var(--MI-margin));
	}
}

.newButton {
	display: block;
	margin: var(--MI-margin) auto 0 auto;
	padding: 8px 16px;
	border-radius: 32px;
}

.postForm {
	border-radius: var(--MI-radius);
}

.tl {
	background: var(--MI_THEME-bg);
	border-radius: var(--MI-radius);
	overflow: clip;
}
</style>
