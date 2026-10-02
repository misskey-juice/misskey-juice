<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker path="/settings/juice" :label="i18n.ts.juice" :keywords="['juice', 'email', 'language']" icon="ti ti-droplet" :inlining="['oauth-connections']">
	<div class="_gaps_m">
		<MkInfo v-if="!instance.enableEmail">{{ i18n.ts.emailNotSupported }}</MkInfo>

		<!-- JUICE: 設定項目が増えてきたため、カテゴリごとにMkFolderへまとめている -->
		<SearchMarker v-slot="slotProps">
			<MkFolder :defaultOpen="slotProps.isParentOfTarget">
				<template #label><SearchLabel>{{ i18n.ts._juice.settingsGroupAccount }}</SearchLabel></template>

				<div class="_gaps_m">
					<MkDisableSection :disabled="!instance.enableEmail">
						<SearchMarker :keywords="['email', 'language']">
							<FormSection first>
								<template #label><SearchLabel>{{ i18n.ts._juice.emailLanguage }}</SearchLabel></template>
								<MkSelect v-model="emailLang" :items="langs.map(x => ({ label: x[1], value: x[0] }))" @update:modelValue="save">
									<template #caption>{{ i18n.ts._juice.emailLanguageCaption }}</template>
								</MkSelect>
							</FormSection>
						</SearchMarker>
					</MkDisableSection>

					<XOauthConnections/>

					<SearchMarker :keywords="['signup', 'approval', 'check']">
						<FormSection>
							<template #label><SearchLabel>{{ i18n.ts._juice.signupCheck }}</SearchLabel></template>
							<FormLink to="/signup-check">{{ i18n.ts._signupCheck.openPage }}</FormLink>
						</FormSection>
					</SearchMarker>
				</div>
			</MkFolder>
		</SearchMarker>

		<SearchMarker v-slot="slotProps">
			<MkFolder :defaultOpen="slotProps.isParentOfTarget">
				<template #label><SearchLabel>{{ i18n.ts._juice.settingsGroupTimeline }}</SearchLabel></template>

				<div class="_gaps_m">
					<SearchMarker :keywords="['ai', 'generated', 'mute', 'hide']">
						<FormSection first>
							<template #label><SearchLabel>{{ i18n.ts._juice.muteAIGeneratedNotes }}</SearchLabel></template>
							<MkSelect v-model="muteAIGeneratedNotes" :items="muteAIGeneratedNotesItems" @update:modelValue="saveMuteAIGeneratedNotes">
								<template #caption>{{ i18n.ts._juice.muteAIGeneratedNotesDescription }}</template>
							</MkSelect>
						</FormSection>
					</SearchMarker>

					<SearchMarker :keywords="['favorite', 'button', 'note', 'footer', 'star']">
						<MkPreferenceContainer k="showFavoriteButtonInNoteFooter">
							<MkSwitch v-model="showFavoriteButtonInNoteFooter">
								<template #label><SearchLabel>{{ i18n.ts._juice.showFavoriteButtonInNoteFooter }}</SearchLabel></template>
								<template #caption>{{ i18n.ts._juice.showFavoriteButtonInNoteFooterCaption }}</template>
							</MkSwitch>
						</MkPreferenceContainer>
					</SearchMarker>

					<!-- JUICE: ネコのアカウントの投稿の文字を置き換えない(ネコミミだけにする。misskey-tempuraを参考) -->
					<SearchMarker :keywords="['cat', 'nyaize', 'disable', 'ear']">
						<MkPreferenceContainer k="disableNoteNyaize">
							<MkSwitch v-model="disableNoteNyaize">
								<template #label><SearchLabel>{{ i18n.ts._juice.disableNoteNyaize }}</SearchLabel></template>
								<template #caption>{{ i18n.ts._juice.disableNoteNyaizeCaption }}</template>
							</MkSwitch>
						</MkPreferenceContainer>
					</SearchMarker>

					<SearchMarker :keywords="['reaction', 'quick', 'button', 'note', 'footer', 'heart']">
						<div class="_gaps_s">
							<MkPreferenceContainer k="showQuickReactionButton">
								<MkSwitch v-model="showQuickReactionButton">
									<template #label><SearchLabel>{{ i18n.ts._juice.showQuickReactionButton }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.showQuickReactionButtonCaption }}</template>
								</MkSwitch>
							</MkPreferenceContainer>
							<MkPreferenceContainer k="quickReaction">
								<div :class="$style.quickReaction">
									<span>{{ i18n.ts._juice.quickReaction }}</span>
									<button class="_button" :class="$style.quickReactionPreview" :aria-label="i18n.ts._juice.quickReactionChange" @click="pickQuickReaction">
										<MkReactionIcon :reaction="quickReaction"/>
									</button>
									<MkButton inline small :disabled="quickReaction === QUICK_REACTION_DEFAULT" @click="quickReaction = QUICK_REACTION_DEFAULT">{{ i18n.ts.default }}</MkButton>
								</div>
							</MkPreferenceContainer>
						</div>
					</SearchMarker>

					<SearchMarker :keywords="['widget', 'side', 'left', 'right']">
						<FormSection>
							<template #label><SearchLabel>{{ i18n.ts._juice.widgetsSide }}</SearchLabel></template>
							<MkRadios v-model="widgetsSide" :options="[{ value: 'right', label: i18n.ts.right }, { value: 'left', label: i18n.ts.left }]">
								<template #caption>{{ i18n.ts._juice.widgetsSideCaption }}</template>
							</MkRadios>
						</FormSection>
					</SearchMarker>

					<SearchMarker v-if="relayTimelineEnabled" :keywords="['relay', 'timeline', 'filter']">
						<FormSection>
							<template #label><SearchLabel>{{ i18n.ts._juice.relayTimelineFilter }}</SearchLabel></template>
							<div class="_gaps_s">
								<MkInfo v-if="relays.length === 0">{{ i18n.ts._juice.relayTimelineFilterEmpty }}</MkInfo>
								<!-- JUICE: リレー数が多いと一覧が縦に長くなり設定画面を圧迫するため、折りたたみ式にしている -->
								<MkFolder v-else>
									<template #label>{{ relaySelectedCountLabel }}</template>
									<div class="_gaps_s">
										<MkInfo>{{ i18n.ts._juice.relayTimelineFilterCaption }}</MkInfo>
										<MkSwitch
											v-for="relay in relays"
											:key="relay.id"
											:modelValue="isRelaySelected(relay.id)"
											@update:modelValue="(v) => onChangeRelayFilter(relay.id, v)"
										>
											<template #label>{{ relay.host }}</template>
										</MkSwitch>
									</div>
								</MkFolder>
							</div>
						</FormSection>
					</SearchMarker>

					<SearchMarker :keywords="['timeline', 'tab', 'hide', 'show', 'order', 'reorder']">
						<FormSection>
							<template #label><SearchLabel>{{ i18n.ts._juice.hiddenTimelineTabs }}</SearchLabel></template>
							<template #description>{{ i18n.ts._juice.timelineTabOrderCaption }}</template>
							<MkDraggable
								:modelValue="orderedTimelineTabItems"
								direction="vertical"
								withGaps
								manualDragStart
								@update:modelValue="onReorderTimelineTabs"
							>
								<template #default="{ item, dragStart }">
									<div v-panel :class="$style.tabItem">
										<button class="_button" :class="$style.tabItemHandle" tabindex="-1" @pointerdown.stop="dragStart"><i class="ti ti-menu"></i></button>
										<MkSwitch
											:modelValue="isTimelineTabVisible(item.key)"
											@update:modelValue="(v) => onChangeTimelineTabVisible(item.key, v)"
										>
											<template #label>{{ item.label }}</template>
										</MkSwitch>
									</div>
								</template>
							</MkDraggable>
						</FormSection>
					</SearchMarker>

					<SearchMarker :keywords="['language', 'timeline', 'filter']">
						<FormSection>
							<template #label><SearchLabel>{{ i18n.ts._juice.filteredLanguages }}</SearchLabel></template>
							<div class="_gaps_s">
								<MkSwitch :modelValue="$i.excludeOwnNotesFromLanguageFilter" @update:modelValue="onChangeExcludeOwnNotesFromLanguageFilter">
									<template #label>{{ i18n.ts._juice.excludeOwnNotesFromLanguageFilter }}</template>
									<template #caption>{{ i18n.ts._juice.excludeOwnNotesFromLanguageFilterCaption }}</template>
								</MkSwitch>
								<!-- JUICE: 対応言語が40件超あり、全展開すると設定画面が非常に長くなり操作の邪魔になるため、折りたたみ式にしている -->
								<MkFolder>
									<template #label>{{ languageSelectedCountLabel }}</template>
									<div class="_gaps_s">
										<MkInfo>{{ i18n.ts._juice.filteredLanguagesCaption }}</MkInfo>
										<MkSwitch
											v-for="[code, label] in langs"
											:key="code"
											:modelValue="isLanguageFilterSelected(code)"
											@update:modelValue="(v) => onChangeLanguageFilter(code, v)"
										>
											<template #label>{{ label }}</template>
										</MkSwitch>
									</div>
								</MkFolder>
							</div>
						</FormSection>
					</SearchMarker>
				</div>
			</MkFolder>
		</SearchMarker>

		<!-- JUICE: 単体の機能(サブグループを持たない)のため、他のsettingsGroup*のような
		     カテゴリ折りたたみで包まず、トップレベルのMkFolderとして単独で表示する -->
		<SearchMarker :keywords="['midi', 'visualizer', 'piano', 'roll', 'speed', 'polyphony']">
			<MkFolder>
				<template #label><SearchLabel>{{ i18n.ts._juice.midiVisualizer }}</SearchLabel></template>
				<div class="_gaps_s">
					<MkSwitch v-model="midiVisualizerEnabled">
						<template #label>{{ i18n.ts._juice.midiVisualizerEnabled }}</template>
						<template #caption>{{ i18n.ts._juice.midiVisualizerEnabledCaption }}</template>
					</MkSwitch>
					<MkRange
						v-if="midiVisualizerEnabled"
						v-model="midiRollWindowSeconds"
						:min="0.2"
						:max="3"
						:step="0.05"
						:continuousUpdate="true"
						:textConverter="(v) => `${v.toFixed(2)}s`"
					>
						<template #label>{{ i18n.ts._juice.midiRollSpeed }}</template>
						<template #caption>{{ i18n.ts._juice.midiRollSpeedCaption }}</template>
					</MkRange>
					<MkRange
						v-model="midiMaxPolyphony"
						:min="32"
						:max="640"
						:step="32"
						:continuousUpdate="true"
					>
						<template #label>{{ i18n.ts._juice.midiMaxPolyphony }}</template>
						<template #caption>{{ i18n.ts._juice.midiMaxPolyphonyCaption }}</template>
					</MkRange>
				</div>
			</MkFolder>
		</SearchMarker>

		<!-- JUICE: MFMの「○○ 検索」(検索窓)で使う検索エンジン -->
		<SearchMarker :keywords="['mfm', 'search', 'engine', 'google', 'yahoo', 'bing', 'duckduckgo', 'kagi', 'brave', 'startpage', 'ecosia', 'perplexity']">
			<MkFolder>
				<template #label><SearchLabel>{{ i18n.ts._juice.mfmSearchEngine }}</SearchLabel></template>
				<div class="_gaps_s">
					<MkSelect v-model="mfmSearchEngine" :items="searchEngineItems">
						<template #label>{{ i18n.ts._juice.mfmSearchEngine }}</template>
						<template #caption>{{ i18n.ts._juice.mfmSearchEngineCaption }}</template>
					</MkSelect>
					<MkInput v-if="mfmSearchEngine === 'custom'" v-model="mfmSearchEngineCustomUrl" type="url" placeholder="https://example.com/search?q={query}" manualSave>
						<template #label>{{ i18n.ts._juice.mfmSearchEngineCustomUrl }}</template>
						<template #caption>{{ customSearchUrlValid || mfmSearchEngineCustomUrl === '' ? i18n.tsx._juice.mfmSearchEngineCustomUrlCaption({ query: '{query}' }) : i18n.tsx._juice.mfmSearchEngineCustomUrlInvalid({ query: '{query}' }) }}</template>
					</MkInput>
				</div>
			</MkFolder>
		</SearchMarker>

		<!-- JUICE: 単体の機能(サブグループを持たない)のため、他のsettingsGroup*のような
		     カテゴリ折りたたみで包まず、トップレベルのMkFolderとして単独で表示する -->
		<SearchMarker :keywords="['mfm', 'local', 'only', 'markdown', 'bold', 'decoration']">
			<MkFolder>
				<template #label><SearchLabel>{{ i18n.ts._juice.autoLocalOnlyForMfm }}</SearchLabel></template>
				<div class="_gaps_s">
					<MkSwitch v-model="autoLocalOnlyForMarkdownMfm" @update:modelValue="saveAutoLocalOnlyForMfm">
						<template #label>{{ i18n.ts._juice.autoLocalOnlyForMarkdownMfm }}</template>
						<template #caption>{{ i18n.ts._juice.autoLocalOnlyForMarkdownMfmCaption }}</template>
					</MkSwitch>
					<MkSwitch v-model="autoLocalOnlyForFnMfm" @update:modelValue="saveAutoLocalOnlyForMfm">
						<template #label>{{ i18n.ts._juice.autoLocalOnlyForFnMfm }}</template>
						<template #caption>{{ i18n.ts._juice.autoLocalOnlyForFnMfmCaption }}</template>
					</MkSwitch>
				</div>
			</MkFolder>
		</SearchMarker>

		<!-- JUICE: 小説のtxtを添付したとき、初めからダウンロードさせない -->
		<SearchMarker :keywords="['novel', 'text', 'download', 'attach']">
			<MkFolder>
				<template #label><SearchLabel>{{ i18n.ts._juice.novelTextDownloadDisabledByDefault }}</SearchLabel></template>
				<MkPreferenceContainer k="novelTextDownloadDisabledByDefault">
					<MkSwitch v-model="novelTextDownloadDisabledByDefault">
						<template #label>{{ i18n.ts._juice.novelTextDownloadDisabledByDefault }}</template>
						<template #caption>{{ i18n.ts._juice.novelTextDownloadDisabledByDefaultCaption }}</template>
					</MkSwitch>
				</MkPreferenceContainer>
			</MkFolder>
		</SearchMarker>

		<SearchMarker v-slot="slotProps">
			<MkFolder :defaultOpen="slotProps.isParentOfTarget">
				<template #label><SearchLabel>{{ i18n.ts._juice.settingsGroupRequests }}</SearchLabel></template>

				<div class="_gaps_m">
					<SearchMarker :keywords="['emoji', 'request']">
						<FormSection first>
							<template #label><SearchLabel>{{ i18n.ts._juice.emojiRequest }}</SearchLabel></template>
							<div class="_gaps_s">
								<FormLink to="/emoji-request">{{ i18n.ts._emojiRequestPage.newRequest }}</FormLink>
								<SearchMarker :keywords="['emoji', 'request', 'email']">
									<MkSwitch :modelValue="$i.receiveEmojiRequestResultEmail" @update:modelValue="onChangeReceiveEmojiRequestResultEmail">
										<template #label><SearchLabel>{{ i18n.ts._juice.receiveEmojiRequestResultEmail }}</SearchLabel></template>
										<template #caption>{{ i18n.ts._juice.receiveEmojiRequestResultEmailCaption }}</template>
									</MkSwitch>
								</SearchMarker>
							</div>
						</FormSection>
					</SearchMarker>

					<SearchMarker :keywords="['avatar', 'decoration', 'request']">
						<FormSection>
							<template #label><SearchLabel>{{ i18n.ts._juice.avatarDecorationRequest }}</SearchLabel></template>
							<div class="_gaps_s">
								<FormLink to="/avatar-decoration-request">{{ i18n.ts._avatarDecorationRequestPage.newRequest }}</FormLink>
								<SearchMarker :keywords="['avatar', 'decoration', 'request', 'email']">
									<MkSwitch :modelValue="$i.receiveAvatarDecorationRequestResultEmail" @update:modelValue="onChangeReceiveAvatarDecorationRequestResultEmail">
										<template #label><SearchLabel>{{ i18n.ts._juice.receiveAvatarDecorationRequestResultEmail }}</SearchLabel></template>
										<template #caption>{{ i18n.ts._juice.receiveAvatarDecorationRequestResultEmailCaption }}</template>
									</MkSwitch>
								</SearchMarker>
							</div>
						</FormSection>
					</SearchMarker>
				</div>
			</MkFolder>
		</SearchMarker>
	</div>
</SearchMarker>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import * as Misskey from 'misskey-js';
import { langs } from '@@/js/config.js';
import XOauthConnections from './oauth-connections.vue';
import FormSection from '@/components/form/section.vue';
import FormLink from '@/components/form/link.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkPreferenceContainer from '@/components/MkPreferenceContainer.vue';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import MkButton from '@/components/MkButton.vue';
import MkRange from '@/components/MkRange.vue';
import MkDraggable from '@/components/MkDraggable.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkInput from '@/components/MkInput.vue';
import MkDisableSection from '@/components/MkDisableSection.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import * as os from '@/os.js';
import { ensureSignin } from '@/i.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { instance } from '@/instance.js';
import { prefer } from '@/preferences.js';
import { juicePublicSettingsCache, juiceRelaysCache } from '@/cache.js';
import { availableBasicTimelines } from '@/timelines.js';
import { pruneRelayTimelineFilter } from '@/utility/juice-relay-timeline-filter.js';
import { SEARCH_ENGINES, SEARCH_ENGINE_IDS, isValidCustomSearchUrl } from '@/utility/juice-search-engines.js';

const $i = ensureSignin();

const emailLang = ref($i.emailLang ?? 'ja-JP');
const muteAIGeneratedNotes = ref($i.muteAIGeneratedNotes ?? 'none');
const autoLocalOnlyForMarkdownMfm = ref($i.autoLocalOnlyForMarkdownMfm ?? false);
const autoLocalOnlyForFnMfm = ref($i.autoLocalOnlyForFnMfm ?? false);

// JUICE: リレータイムラインの絞り込み設定(機能自体が無効なインスタンスでは項目を出さない)
const relayTimelineEnabled = ref(false);
const relays = ref<Misskey.entities.JuiceRelaysResponse>([]);
// JUICE: メディアタイムラインが有効なインスタンスでのみ、タブの表示切り替え一覧に含める
const mediaTimelineEnabled = ref(false);
juicePublicSettingsCache.fetch().then(res => {
	relayTimelineEnabled.value = res.relayTimelineEnabled;
	mediaTimelineEnabled.value = res.mediaTimelineEnabled;
	if (relayTimelineEnabled.value) {
		juiceRelaysCache.fetch().then(r => {
			relays.value = r;
			pruneRelayTimelineFilter(r.map(relay => relay.id));
		});
	}
});

function isRelaySelected(id: string): boolean {
	return prefer.r.relayTimelineFilter.value.includes(id);
}

function onChangeRelayFilter(id: string, checked: boolean) {
	prefer.commit('relayTimelineFilter', checked
		? [...prefer.s.relayTimelineFilter, id]
		: prefer.s.relayTimelineFilter.filter(x => x !== id));
}

// JUICE: タイムラインページのタブバーに出すベーシックタイムライン・リレー・メディアタイムライン・
// リスト/アンテナ/チャンネルの切り替えショートカットを、それぞれ個別に非表示にできる
// (サーバー側で無効化されているタブはそもそも一覧に出さない)
const timelineTabOptions = computed(() => [
	...availableBasicTimelines().map(tl => ({ key: tl as string, label: i18n.ts._timelines[tl] })),
	...(relayTimelineEnabled.value ? [{ key: 'relay', label: i18n.ts._juice.relayTimelineTab }] : []),
	...(mediaTimelineEnabled.value ? [{ key: 'media', label: i18n.ts._juice.mediaTimelineTab }] : []),
	{ key: 'list', label: i18n.ts.lists },
	{ key: 'antenna', label: i18n.ts.antennas },
	{ key: 'channel', label: i18n.ts.channel },
]);

// JUICE: 上記タブ一覧を、保存済みの並び順(timelineTabOrder)に沿って並べ替える。
// 並び順未設定/新しく増えたタブはtimelineTabOptions本来の並びのまま末尾に追加される
const orderedTimelineTabItems = computed(() => {
	const order = prefer.r.timelineTabOrder.value;
	const options = timelineTabOptions.value;
	const known = options.filter(o => order.includes(o.key));
	const unknown = options.filter(o => !order.includes(o.key));
	known.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
	return [...known, ...unknown].map(o => ({ id: o.key, key: o.key, label: o.label }));
});

function onReorderTimelineTabs(items: { id: string; key: string; label: string }[]) {
	prefer.commit('timelineTabOrder', items.map(i => i.key));
}

function isTimelineTabVisible(key: string): boolean {
	return !prefer.r.hiddenTimelineTabs.value.includes(key);
}

function onChangeTimelineTabVisible(key: string, visible: boolean) {
	prefer.commit('hiddenTimelineTabs', visible
		? prefer.s.hiddenTimelineTabs.filter(x => x !== key)
		: [...prefer.s.hiddenTimelineTabs, key]);
}

// JUICE: 折りたたみの見出しに現在の選択状況を表示する(未選択=すべて表示中であることが分かるように)
const relaySelectedCountLabel = computed(() => prefer.r.relayTimelineFilter.value.length === 0
	? i18n.ts.all
	: i18n.tsx._juice.nSelected({ n: prefer.r.relayTimelineFilter.value.length }));

// JUICE: タイムライン(ホーム・ローカル・グローバル)に表示する言語の絞り込み。
// リレーフィルタと異なりサーバー側(アカウント)の設定なので、i/updateへ保存する
const filteredLanguages = ref($i.filteredLanguages);

function isLanguageFilterSelected(code: string): boolean {
	return filteredLanguages.value.includes(code);
}

function onChangeLanguageFilter(code: string, checked: boolean) {
	filteredLanguages.value = checked
		? [...filteredLanguages.value, code]
		: filteredLanguages.value.filter(x => x !== code);
	misskeyApi('i/update', {
		filteredLanguages: filteredLanguages.value,
	});
}

// JUICE: 折りたたみの見出しに現在の選択状況を表示する(未選択=すべて表示中であることが分かるように)
const languageSelectedCountLabel = computed(() => filteredLanguages.value.length === 0
	? i18n.ts.all
	: i18n.tsx._juice.nSelected({ n: filteredLanguages.value.length }));

// JUICE: 表示言語の絞り込みが有効な場合でも、自分自身の投稿を常に表示するか
function onChangeExcludeOwnNotesFromLanguageFilter(v: boolean) {
	misskeyApi('i/update', {
		excludeOwnNotesFromLanguageFilter: v,
	});
}

// JUICE: ウィジェットパネル/ドロワーを画面のどちら側に表示するか
const widgetsSide = prefer.model('widgetsSide');

// JUICE: ノートの画面にお気に入りのボタンを置くか
const showFavoriteButtonInNoteFooter = prefer.model('showFavoriteButtonInNoteFooter');
const disableNoteNyaize = prefer.model('disableNoteNyaize');
const novelTextDownloadDisabledByDefault = prefer.model('novelTextDownloadDisabledByDefault');

// JUICE: ノートの画面の「+」の左に置く、決めたリアクションを付けるボタン
const QUICK_REACTION_DEFAULT = '🧡';
const showQuickReactionButton = prefer.model('showQuickReactionButton');
const quickReaction = prefer.model('quickReaction');

function pickQuickReaction(ev: PointerEvent) {
	os.pickEmoji((ev.currentTarget ?? ev.target) as HTMLElement, { showPinned: false }).then((emoji) => {
		if (emoji) quickReaction.value = emoji;
	});
}

// JUICE: 添付MIDIファイル再生時のピアノロール・鍵盤ビジュアライザー表示設定
const midiVisualizerEnabled = prefer.model('midiVisualizerEnabled');
const midiRollWindowSeconds = prefer.model('midiRollWindowSeconds');
const midiMaxPolyphony = prefer.model('midiMaxPolyphony');
const mfmSearchEngine = prefer.model('mfmSearchEngine');
const mfmSearchEngineCustomUrl = prefer.model('mfmSearchEngineCustomUrl');
const searchEngineItems = [
	...SEARCH_ENGINE_IDS.map(id => ({ label: SEARCH_ENGINES[id].name, value: id })),
	{ label: i18n.ts._juice.mfmSearchEngineCustom, value: 'custom' as const },
];
// カスタムのURLが使えない(空・{query}が無い等)ときは、Googleで検索する
const customSearchUrlValid = computed(() => isValidCustomSearchUrl(mfmSearchEngineCustomUrl.value));

const muteAIGeneratedNotesItems = [
	{ label: i18n.ts.none, value: 'none' },
	{ label: i18n.ts._juice.muteAIGeneratedNotesMute, value: 'mute' },
	{ label: i18n.ts._juice.muteAIGeneratedNotesHardMute, value: 'hardMute' },
];

function save() {
	os.apiWithDialog('i/juice/update-email-lang', {
		// emailLang は langs (packages/i18n がサポートする言語コード一覧) から選ばれた値のみが入るが、
		// MkSelect の items 型が緩い string のため、送信時にエンドポイント側の厳密な enum 型へ合わせる
		emailLang: emailLang.value as Misskey.entities.IJuiceUpdateEmailLangRequest['emailLang'],
	});
}

function saveMuteAIGeneratedNotes() {
	os.apiWithDialog('i/juice/update-mute-ai-generated', {
		// MkSelect の items 型が緩い string のため、送信時にエンドポイント側の厳密な enum 型へ合わせる
		muteAIGeneratedNotes: muteAIGeneratedNotes.value as Misskey.entities.IJuiceUpdateMuteAiGeneratedRequest['muteAIGeneratedNotes'],
	});
}

function saveAutoLocalOnlyForMfm() {
	os.apiWithDialog('i/juice/update-auto-local-only-for-mfm', {
		autoLocalOnlyForMarkdownMfm: autoLocalOnlyForMarkdownMfm.value,
		autoLocalOnlyForFnMfm: autoLocalOnlyForFnMfm.value,
	});
}

function onChangeReceiveEmojiRequestResultEmail(v: boolean) {
	misskeyApi('i/update', {
		receiveEmojiRequestResultEmail: v,
	});
}

function onChangeReceiveAvatarDecorationRequestResultEmail(v: boolean) {
	misskeyApi('i/update', {
		receiveAvatarDecorationRequestResultEmail: v,
	});
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.juice,
	icon: 'ti ti-droplet',
}));
</script>

<style lang="scss" module>
.quickReaction {
	display: flex;
	align-items: center;
	gap: 12px;
}

.quickReactionPreview {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 44px;
	height: 44px;
	border-radius: var(--MI-radius);
	font-size: 22px;
	background: var(--MI_THEME-buttonBg);

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.tabItem {
	display: flex;
	align-items: center;
	gap: 4px;
	border-radius: var(--MI-radius);
}

.tabItemHandle {
	cursor: move;
	width: 32px;
	height: 32px;
	flex-shrink: 0;
	opacity: 0.5;
	touch-action: none;
}
</style>
