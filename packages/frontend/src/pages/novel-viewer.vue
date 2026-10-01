<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :overridePageMetadata="embedded ? { title: i18n.ts._juice.novelEditorPreview, icon: 'ti ti-eye' } : undefined">
	<!-- JUICE: 縦書きでは、ページ全体を画面(エディターに並べたときはその枠)の高さに収め、本文に残りの高さを使う -->
	<div ref="spacerEl" class="_spacer" :class="{ [$style.fitHeight]: writingMode === 'vertical' }" style="--MI_SPACER-w: 800px;">
		<div v-if="appearNote != null || isPreview" class="_margin _gaps_s" :class="{ [$style.fitContent]: writingMode === 'vertical' }">
			<!-- JUICE: 小説エディターのプレビューでは、書いている下書きの題名を作者の上に出す -->
			<div v-if="isPreview" :class="$style.previewTitle">{{ currentWork.title || i18n.ts._juice.novelEditorUntitled }}</div>
			<div v-if="author != null" :class="$style.author">
				<MkAvatar :class="$style.avatar" :user="author" link preview/>
				<div :class="$style.authorText">
					<MkA v-user-preview="author.id" :class="$style.authorName" :to="userPage(author)"><MkUserName :user="author"/></MkA>
					<MkAcct :class="$style.authorAcct" :user="author"/>
				</div>
			</div>
			<!-- JUICE: 本文の文字数と、読み終わるまでのおおよその時間 -->
			<div v-if="!novelFileLoading && !novelFileError && novelCharCount > 0" :class="$style.stats">
				<span><i class="ti ti-letter-case"></i> {{ i18n.tsx._juice.novelViewerCharCount({ n: number(novelCharCount) }) }}</span>
				<span><i class="ti ti-clock"></i> {{ i18n.tsx._juice.novelViewerReadingTime({ n: number(novelReadingMinutes) }) }}</span>
			</div>
			<p v-if="appearNote != null && appearNote.cw != null" :class="$style.cw">
				<span v-if="appearNote.cw !== ''" :class="$style.novelText">{{ appearNote.cw }}</span>
				<MkCwButton v-model="showContent" :text="appearNote.text" :renote="appearNote.renote" :files="appearNote.files" :poll="appearNote.poll"/>
			</p>
			<!-- JUICE: 全画面表示では、この本文部分だけを画面いっぱいに広げる(上のツールバー付き)。
			ページの外枠にはposition: fixedの基準になる要素(transform等)があり、その中のままでは
			画面全体を覆えないため、全画面の間だけ<body>の直下へ移す(DOMを移すだけで作り直さない) -->
			<Teleport to="body" :disabled="!isFullscreen">
			<div v-show="appearNote == null || appearNote.cw == null || showContent" ref="readerEl" :class="[$style.reader, { [$style.fullscreen]: isFullscreen, [$style.readerFit]: writingMode === 'vertical' && !isFullscreen }]">
				<div v-if="isFullscreen" :class="$style.fullscreenToolbar">
					<button v-if="chapters.length > 1" v-tooltip="i18n.ts._juice.novelViewerToc" class="_button" :class="$style.fullscreenToolbarButton" :aria-label="i18n.ts._juice.novelViewerToc" @click="openToc"><i class="ti ti-list"></i><span :class="$style.fullscreenToolbarLabel">{{ i18n.ts._juice.novelViewerToc }}</span></button>
					<button v-tooltip="i18n.ts._juice.novelViewerSettings" class="_button" :class="$style.fullscreenToolbarButton" :aria-label="i18n.ts._juice.novelViewerSettings" @click="openSettings"><i class="ti ti-adjustments"></i><span :class="$style.fullscreenToolbarLabel">{{ i18n.ts._juice.novelViewerSettings }}</span></button>
					<button v-tooltip="writingModeToggleLabel" class="_button" :class="$style.fullscreenToolbarButton" :aria-label="writingModeToggleLabel" @click="toggleWritingMode"><i class="ti ti-camera-rotate"></i><span :class="$style.fullscreenToolbarLabel">{{ writingModeToggleLabel }}</span></button>
					<button v-tooltip="i18n.ts._juice.novelViewerExitFullscreen" class="_button" :class="$style.fullscreenToolbarButton" :aria-label="i18n.ts._juice.novelViewerExitFullscreen" @click="exitFullscreen"><i class="ti ti-minimize"></i><span :class="$style.fullscreenToolbarLabel">{{ i18n.ts._juice.novelViewerExitFullscreen }}</span></button>
				</div>
				<div
					ref="outerEl"
					:class="$style.body"
					:data-mode="writingMode"
					:data-theme="theme"
					:style="bodyStyle"
					@touchstart="writingMode === 'vertical' ? onTouchStart($event) : undefined"
					@touchend="writingMode === 'vertical' ? onTouchEnd($event) : undefined"
				>
					<!-- JUICE: isNovelなノートに.txtファイルが添付されていれば、そちらを本文として読み込む
					(文字数上限に収まらない長編向け)。読み込み中/失敗時はここに専用の表示を出す -->
					<div v-if="novelFileLoading" :class="$style.fileState"><MkLoading/></div>
					<MkError v-else-if="novelFileError" :class="$style.fileState" @retry="novelFile && loadNovelFile(novelFile)"/>
					<!-- JUICE: 縦書き見開きモード。画面が十分広いときだけ、同じ本文を2つのパネルへ
					少しずらして表示し、本を開いたときのような2ページ分割にする(CSS多段組は
					vertical-rl環境で機能しないため使えず、パネルを2つ並べる方式にしている) -->
					<div v-else-if="writingMode === 'vertical' && isSpread" :class="$style.spread">
						<div :data-mode="writingMode" :class="$style.panel">
							<div :ref="(el) => setPanelViewportEl(0, el as HTMLElement | null)" :data-mode="writingMode" :class="$style.panelViewport" @scroll="onViewportScroll">
								<div :ref="(el) => setPanelInnerEl(0, el as HTMLElement | null)" :class="$style.panelInner">
									<template v-for="(chapter, i) in chapters" :key="`${i}:${latinSideways}:${chapter.text}`">
										<div v-if="i > 0 && chapter.sectionStart" :class="$style.pageBreak" data-novel-page-break aria-hidden="true"></div>
										<div v-else-if="i > 0 && !chapter.titleStart" :class="$style.chapterBreak" aria-hidden="true">⁂</div>
										<span :ref="(el) => setChapterMarkerEl(i, el as HTMLElement | null)" :class="$style.chapterMarker"></span>
										<span :class="[$style.novelText, '_selectable']"><template v-for="(seg, j) in chapter.segments" :key="j"><ruby v-if="seg.type === 'ruby'" :class="{ [$style.bold]: seg.bold, [$style.italic]: seg.italic, [$style.strike]: seg.strike, [$style.emphasis]: seg.emphasis != null, [$style.emphasis_s]: seg.emphasis === 's', [$style.emphasis_S]: seg.emphasis === 'S', [$style.emphasis_c]: seg.emphasis === 'c', [$style.emphasis_C]: seg.emphasis === 'C' }">{{ seg.base }}<rt>{{ seg.reading }}</rt></ruby><span v-else-if="seg.bold || seg.italic || seg.strike || seg.emphasis" :class="{ [$style.bold]: seg.bold, [$style.italic]: seg.italic, [$style.strike]: seg.strike, [$style.emphasis]: seg.emphasis != null, [$style.emphasis_s]: seg.emphasis === 's', [$style.emphasis_S]: seg.emphasis === 'S', [$style.emphasis_c]: seg.emphasis === 'c', [$style.emphasis_C]: seg.emphasis === 'C' }">{{ seg.text }}</span><template v-else>{{ seg.text }}</template></template></span>
									</template>
								</div>
							</div>
						</div>
						<div :class="$style.spreadGutter" aria-hidden="true"></div>
						<!-- JUICE: 左パネルは「次ページのめくれ具合」を見せる視覚上の複製に過ぎず、本文としては
						右パネル(主パネル)側が唯一の正本。読み上げ・タブ移動・選択で本文が二重に扱われない
						よう、aria-hidden+inertで補助技術から隠し、選択もCSS側で禁止する(本文はMFMを通さない
						素のテキストなので、リンク等の操作できる要素はそもそも無い)。本文が右パネルで
						最終ページに達し、次ページの中身が存在しないときは、同じ内容を複製して見せるのではなく
						見開きの裏面として空白のまま(本を閉じる直前の白紙ページのイメージ)にする -->
						<div :data-mode="writingMode" :class="$style.panel" aria-hidden="true" inert>
							<div :ref="(el) => setPanelViewportEl(1, el as HTMLElement | null)" :data-mode="writingMode" :class="$style.panelViewport" @scroll="onViewportScroll">
								<div :ref="(el) => setPanelInnerEl(1, el as HTMLElement | null)" :class="$style.panelInner">
									<template v-if="currentPage < pageCount">
										<template v-for="(chapter, i) in chapters" :key="`${i}:${latinSideways}:${chapter.text}`">
											<div v-if="i > 0 && chapter.sectionStart" :class="$style.pageBreak" data-novel-page-break aria-hidden="true"></div>
											<div v-else-if="i > 0 && !chapter.titleStart" :class="$style.chapterBreak" aria-hidden="true">⁂</div>
											<span :class="$style.novelText"><template v-for="(seg, j) in chapter.segments" :key="j"><ruby v-if="seg.type === 'ruby'" :class="{ [$style.bold]: seg.bold, [$style.italic]: seg.italic, [$style.strike]: seg.strike, [$style.emphasis]: seg.emphasis != null, [$style.emphasis_s]: seg.emphasis === 's', [$style.emphasis_S]: seg.emphasis === 'S', [$style.emphasis_c]: seg.emphasis === 'c', [$style.emphasis_C]: seg.emphasis === 'C' }">{{ seg.base }}<rt>{{ seg.reading }}</rt></ruby><span v-else-if="seg.bold || seg.italic || seg.strike || seg.emphasis" :class="{ [$style.bold]: seg.bold, [$style.italic]: seg.italic, [$style.strike]: seg.strike, [$style.emphasis]: seg.emphasis != null, [$style.emphasis_s]: seg.emphasis === 's', [$style.emphasis_S]: seg.emphasis === 'S', [$style.emphasis_c]: seg.emphasis === 'c', [$style.emphasis_C]: seg.emphasis === 'C' }">{{ seg.text }}</span><template v-else>{{ seg.text }}</template></template></span>
										</template>
									</template>
								</div>
							</div>
						</div>
					</div>
					<div v-else :data-mode="writingMode" :class="$style.panel">
						<div :ref="(el) => setPanelViewportEl(0, el as HTMLElement | null)" :data-mode="writingMode" :class="$style.panelViewport" @scroll="onViewportScroll">
							<div :ref="(el) => setPanelInnerEl(0, el as HTMLElement | null)" :class="$style.panelInner">
								<!-- JUICE: 「小説家になろう」等を踏まえ、横書き時は各章の境目ごとに目次・前後の章への
								導線を置く(文書の最初と最後だけだと、読んでいる途中の章からは遠くて使えないため) -->
								<div v-if="writingMode === 'horizontal' && sectionCount > 1" :class="$style.chapterNav">
									<button class="_button" :class="$style.chapterNavLink" :disabled="currentSection === 0" @click="goToSection(currentSection - 1)"><i class="ti ti-chevron-left"></i> <span :class="$style.navLong">{{ i18n.ts._juice.novelViewerPrevPage }}</span><span :class="$style.navShort">{{ i18n.ts._juice.novelViewerPrevShort }}</span></button>
									<span :class="$style.sectionCount">{{ currentSection + 1 }} / {{ sectionCount }}</span>
									<button class="_button" :class="$style.chapterNavLink" :disabled="currentSection === sectionCount - 1" @click="goToSection(currentSection + 1)"><span :class="$style.navLong">{{ i18n.ts._juice.novelViewerNextPage }}</span><span :class="$style.navShort">{{ i18n.ts._juice.novelViewerNextShort }}</span> <i class="ti ti-chevron-right"></i></button>
								</div>
								<!-- JUICE: 横書きで[newpage]による改ページがある場合は、今のページに属する章だけを描画する -->
								<template v-for="(chapter, i) in chapters" :key="`${i}:${latinSideways}:${chapter.text}`">
									<template v-if="writingMode !== 'horizontal' || chapter.section === currentSection">
									<div v-if="writingMode === 'horizontal' && chapters.length > 1 && !(sectionCount > 1 && chapter.sectionStart)" :class="$style.chapterNav">
										<button class="_button" :class="$style.chapterNavLink" :disabled="i === 0" @click="jumpToChapter(i - 1)"><i class="ti ti-chevron-left"></i> <span :class="$style.navLong">{{ i18n.ts._juice.novelViewerPrevChapter }}</span><span :class="$style.navShort">{{ i18n.ts._juice.novelViewerPrevShort }}</span></button>
										<button class="_button" :class="$style.chapterNavLink" @click="openToc">{{ i18n.ts._juice.novelViewerToc }}</button>
										<button class="_button" :class="$style.chapterNavLink" :disabled="i === chapters.length - 1" @click="jumpToChapter(i + 1)"><span :class="$style.navLong">{{ i18n.ts._juice.novelViewerNextChapter }}</span><span :class="$style.navShort">{{ i18n.ts._juice.novelViewerNextShort }}</span> <i class="ti ti-chevron-right"></i></button>
									</div>
									<div v-else-if="writingMode !== 'horizontal' && i > 0 && chapter.sectionStart" :class="$style.pageBreak" data-novel-page-break aria-hidden="true"></div>
									<div v-else-if="writingMode !== 'horizontal' && i > 0 && !chapter.titleStart" :class="$style.chapterBreak" aria-hidden="true">⁂</div>
									<span :ref="(el) => setChapterMarkerEl(i, el as HTMLElement | null)" :class="$style.chapterMarker"></span>
									<span :class="[$style.novelText, '_selectable']"><template v-for="(seg, j) in chapter.segments" :key="j"><ruby v-if="seg.type === 'ruby'" :class="{ [$style.bold]: seg.bold, [$style.italic]: seg.italic, [$style.strike]: seg.strike, [$style.emphasis]: seg.emphasis != null, [$style.emphasis_s]: seg.emphasis === 's', [$style.emphasis_S]: seg.emphasis === 'S', [$style.emphasis_c]: seg.emphasis === 'c', [$style.emphasis_C]: seg.emphasis === 'C' }">{{ seg.base }}<rt>{{ seg.reading }}</rt></ruby><span v-else-if="seg.bold || seg.italic || seg.strike || seg.emphasis" :class="{ [$style.bold]: seg.bold, [$style.italic]: seg.italic, [$style.strike]: seg.strike, [$style.emphasis]: seg.emphasis != null, [$style.emphasis_s]: seg.emphasis === 's', [$style.emphasis_S]: seg.emphasis === 'S', [$style.emphasis_c]: seg.emphasis === 'c', [$style.emphasis_C]: seg.emphasis === 'C' }">{{ seg.text }}</span><template v-else>{{ seg.text }}</template></template></span>
									</template>
								</template>
								<div v-if="writingMode === 'horizontal' && sectionCount > 1" :class="$style.chapterNav">
									<button class="_button" :class="$style.chapterNavLink" :disabled="currentSection === 0" @click="goToSection(currentSection - 1)"><i class="ti ti-chevron-left"></i> <span :class="$style.navLong">{{ i18n.ts._juice.novelViewerPrevPage }}</span><span :class="$style.navShort">{{ i18n.ts._juice.novelViewerPrevShort }}</span></button>
									<button v-if="chapters.length > 1" class="_button" :class="$style.chapterNavLink" @click="openToc">{{ i18n.ts._juice.novelViewerToc }}</button>
									<span v-else :class="$style.sectionCount">{{ currentSection + 1 }} / {{ sectionCount }}</span>
									<button class="_button" :class="$style.chapterNavLink" :disabled="currentSection === sectionCount - 1" @click="goToSection(currentSection + 1)"><span :class="$style.navLong">{{ i18n.ts._juice.novelViewerNextPage }}</span><span :class="$style.navShort">{{ i18n.ts._juice.novelViewerNextShort }}</span> <i class="ti ti-chevron-right"></i></button>
								</div>
								<div v-else-if="writingMode === 'horizontal' && chapters.length > 1" :class="$style.chapterNav">
									<button class="_button" :class="$style.chapterNavLink" @click="jumpToChapter(chapters.length - 2)"><i class="ti ti-chevron-left"></i> <span :class="$style.navLong">{{ i18n.ts._juice.novelViewerPrevChapter }}</span><span :class="$style.navShort">{{ i18n.ts._juice.novelViewerPrevShort }}</span></button>
									<button class="_button" :class="$style.chapterNavLink" @click="openToc">{{ i18n.ts._juice.novelViewerToc }}</button>
									<button class="_button" :class="$style.chapterNavLink" disabled><span :class="$style.navLong">{{ i18n.ts._juice.novelViewerNextChapter }}</span><span :class="$style.navShort">{{ i18n.ts._juice.novelViewerNextShort }}</span> <i class="ti ti-chevron-right"></i></button>
								</div>
							</div>
						</div>
					</div>
				</div>
				<div v-if="writingMode === 'vertical'" :class="$style.pager">
					<button v-tooltip="i18n.ts._juice.novelViewerNextPage" class="_button" :class="$style.pagerButton" :disabled="!canGoNext" :aria-label="i18n.ts._juice.novelViewerNextPage" @click="turnPage('next')"><i class="ti ti-chevron-left"></i></button>
					<span :class="$style.pagerCount">{{ isSpread && currentPage < pageCount ? i18n.tsx._juice.novelViewerPageRange({ from: currentPage, to: currentPage + 1 }) : currentPage }} / {{ pageCount }}</span>
					<button v-tooltip="i18n.ts._juice.novelViewerPrevPage" class="_button" :class="$style.pagerButton" :disabled="!canGoPrev" :aria-label="i18n.ts._juice.novelViewerPrevPage" @click="turnPage('prev')"><i class="ti ti-chevron-right"></i></button>
				</div>
			</div>
			</Teleport>
			<MkA v-if="appearNote != null" :to="notePage(appearNote)" :class="$style.footerLink"><MkTime :time="appearNote.createdAt" mode="detail" colored/></MkA>
		</div>
		<MkError v-else-if="error" @retry="fetchNote()"/>
		<MkLoading v-else/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, markRaw, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, provide, ref, useTemplateRef, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { host } from '@@/js/config.js';
import { getScrollContainer } from '@@/js/scroll.js';
import * as os from '@/os.js';
import MkCwButton from '@/components/MkCwButton.vue';
import MkNovelViewerColorPicker from '@/components/MkNovelViewerColorPicker.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { store } from '@/store.js';
import { prefer } from '@/preferences.js';
import { getAppearNote } from '@/utility/get-appear-note.js';
import { userPage } from '@/filters/user.js';
import { notePage } from '@/filters/note.js';
import number from '@/filters/number.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { $i } from '@/i.js';
import { currentWork } from '@/utility/novel-draft.js';
import { decodeTextFile } from '@/utility/decode-text-file.js';
import { DI } from '@/di.js';
import { collapseHeaderActions } from '@/utility/collapse-header-actions.js';

const props = defineProps<{
	// JUICE: 無いときは、小説エディターの下書きのプレビューとして表示する
	noteId?: string;
	// JUICE: 小説エディターの中に並べて表示している(ページの題名は変えない)
	embedded?: boolean;
}>();

const isPreview = computed(() => props.noteId == null);

// JUICE: エディターの中に並べたときは、外側のページのヘッダーの高さを引き継がない(このビューワーのヘッダーが本文に重なるため)
if (props.embedded) {
	provide(DI.currentStickyTop, ref(0));
	provide(DI.currentStickyBottom, ref(0));
}

const note = ref<Misskey.entities.Note | null>(null);
const error = ref();
const showContent = ref(false);
const outerEl = useTemplateRef<HTMLDivElement>('outerEl');
const readerEl = useTemplateRef<HTMLDivElement>('readerEl');
// JUICE: このコンポーネントでは useCssModule() でスクリプト側から$styleを使わないこと。本番ビルドの
// rollup-plugin-unwind-css-module-class-name は、テンプレート中の$style参照をクラス名の文字列に置き換えた後、
// 参照が残っていなければ__cssModules自体を取り除く。<script setup>の直下で$styleを宣言すると、テンプレートは
// その変数を参照するためプラグインから見えず、結果として本番ではCSS Modulesが丸ごと消えて表示が崩れる
// (開発サーバーではこのプラグインが動かないため気付けない)。スクリプトで作る要素・探す要素はdata属性を使う

// JUICE: 縦書き見開き(2ページ分割)用。3層構造になっている:
// .panel(常にflexの割り当て幅=100%のまま、「使える幅」の測定基準) >
// .panelViewport(JSが1ページぶんの実測px幅を明示的に指定してoverflow:hiddenでクリップする窓) >
// .panelInner(本文本体、自然な内容量ぶんだけ幅を持つ)。
// ページ送りはinnerにtransform: translateXを直接指定するだけの単純な仕組みにする。scrollLeftを
// 使わないのは、パネルが差し替わった直後(見開き切替直後など)はブラウザ側のオーバーフロー計算
// (scrollWidth)がまだ済んでおらず、要求したscrollLeftが0へ強制的に丸められて二度と正しい
// 位置に戻らなくなる不具合が起きたため。translateXならオーバーフロー量を一切問わずそのままの
// 位置に反映されるので、この種のタイミング問題が起こりようがない
const panelInnerEls = ref<(HTMLDivElement | null)[]>([]);
const panelViewportEls = ref<(HTMLDivElement | null)[]>([]);

function setPanelInnerEl(i: number, el: HTMLElement | null): void {
	panelInnerEls.value[i] = el as HTMLDivElement | null;
}

function setPanelViewportEl(i: number, el: HTMLElement | null): void {
	panelViewportEls.value[i] = el as HTMLDivElement | null;
}

function primaryInnerEl(): HTMLDivElement | null {
	return panelInnerEls.value[0] ?? null;
}

function primaryViewportEl(): HTMLDivElement | null {
	return panelViewportEls.value[0] ?? null;
}

// JUICE: このページの本文カラムは `_spacer` の --MI_SPACER-w: 800px で頭打ちになるため、
// ウインドウをどれだけ広げてもouterElのclientWidthは800pxを超えない。閾値はこの上限内で
// 実際に見開きへ到達できる値にする(380pxのままだとchrome分を差し引いた瞬間に見開きが
// 永久に発動しなくなる)
const SPREAD_MIN_PANEL_WIDTH = 320;
// JUICE: outerElのclientWidthには縦書き時のpadding(20px×2)とパネル間のspreadGutter(1px+
// margin 12px×2)がそのまま含まれてしまい、そのまま閾値と比べるとパネル実幅が想定より狭い
// うちから見開きになってしまう。既知のchrome分をあらかじめ差し引いてから判定する
const SPREAD_CHROME_WIDTH = 40 + 25;
const isSpread = ref(false);

function updateSpreadMode(): void {
	const el = outerEl.value;
	isSpread.value = writingMode.value === 'vertical' && !!el && (el.clientWidth - SPREAD_CHROME_WIDTH) >= SPREAD_MIN_PANEL_WIDTH * 2;
}

const appearNote = computed(() => note.value ? (getAppearNote(note.value) ?? note.value) : null);
const author = computed(() => (isPreview.value ? $i : appearNote.value?.user) ?? null);

// JUICE: プレビューでは下書きの本文を表示する。打つたびに組み直すと重いので、少し待ってから反映する
const previewText = ref(currentWork.value.text);
let previewTimer: number | null = null;
watch(() => currentWork.value.text, (text) => {
	// 小説のノートを開いているビューワー(KeepAliveで裏に残っているものも)は、下書きの変更に反応しない
	if (!isPreview.value) return;
	if (previewTimer != null) window.clearTimeout(previewTimer);
	previewTimer = window.setTimeout(() => {
		previewTimer = null;
		previewText.value = text;
	}, 300);
});

// JUICE: 添付された.txtファイルがあれば、本文の代わりにそちらを小説の本体として読む。
// ノート本文だけだと文字数上限に収まらない長編を投稿できないための機能
// .txtが複数添付されている場合は、ドライブで「小説」フラグを付けたファイルを優先する
const novelFile = computed(() => {
	const textFiles = appearNote.value?.files?.filter(f => f.type === 'text/plain' || f.name.toLowerCase().endsWith('.txt')) ?? [];
	return textFiles.find(f => f.isNovel) ?? textFiles[0] ?? null;
});
const novelFileContent = ref<string | null>(null);
const novelFileLoading = ref(false);
const novelFileError = ref<unknown>(null);

// JUICE: KeepAliveで同じインスタンスが別ノートに使い回されるため、前のノートのファイル取得が
// 後から終わっても本文を上書きしないよう、最新の読み込み要求かどうかを世代番号で確認する
let novelFileLoadGeneration = 0;

async function loadNovelFile(file: Misskey.entities.DriveFile): Promise<void> {
	const generation = ++novelFileLoadGeneration;
	novelFileLoading.value = true;
	novelFileError.value = null;
	try {
		const res = await window.fetch(file.url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const content = decodeTextFile(await res.arrayBuffer());
		if (generation !== novelFileLoadGeneration) return;
		novelFileContent.value = content;
	} catch (err) {
		if (generation !== novelFileLoadGeneration) return;
		novelFileError.value = err;
	} finally {
		if (generation === novelFileLoadGeneration) novelFileLoading.value = false;
	}
}

watch(novelFile, (file) => {
	novelFileContent.value = null;
	if (file) {
		loadNovelFile(file);
	} else {
		// JUICE: ファイル無しのノートへ切り替わったら、読み込み中だった前のノートの結果は捨てる
		novelFileLoadGeneration++;
		novelFileLoading.value = false;
		novelFileError.value = null;
	}
}, { immediate: true });
// JUICE: 表示の設定はプロファイル(prefer)に持つ(バックアップ・復元で戻るように)。prefer.s・store.sは
// 非リアクティブなので、テンプレートで使う値は必ずリアクティブなprefer.r.xxx.valueから読む。
// 続きから読む位置(novelViewerProgress)は表示の設定ではないので、今まで通りstoreに置く
const writingMode = computed(() => prefer.r.novelViewerWritingMode.value);
const fontSize = computed({
	get: () => prefer.r.novelViewerFontSize.value,
	set: (v: number) => prefer.commit('novelViewerFontSize', v),
});
const theme = computed({
	get: () => prefer.r.novelViewerTheme.value,
	set: (v: 'auto' | 'light' | 'sepia' | 'dark' | 'custom') => prefer.commit('novelViewerTheme', v),
});
const fontFamily = computed({
	get: () => prefer.r.novelViewerFontFamily.value,
	set: (v: 'default' | 'mincho' | 'gothic') => prefer.commit('novelViewerFontFamily', v),
});
const customTextColor = computed(() => prefer.r.novelViewerCustomTextColor.value);
const customBgColor = computed(() => prefer.r.novelViewerCustomBgColor.value);

// JUICE: フォントサイズ・書体・(カスタムテーマ時の)文字色/背景色をまとめてinline styleで適用する。
// data-theme="custom"はプリセット4色と違ってSCSS側で固定値を持てないため、ここで直接上書きする
const fontFamilyStack: Record<'default' | 'mincho' | 'gothic', string | null> = {
	default: null,
	mincho: '"Hiragino Mincho ProN", "Yu Mincho", "MS Mincho", serif',
	gothic: '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif',
};
const bodyStyle = computed(() => {
	const style: Record<string, string> = { fontSize: `${fontSize.value}em` };
	const family = fontFamilyStack[fontFamily.value];
	if (family) style.fontFamily = family;
	if (theme.value === 'custom') {
		style.color = customTextColor.value;
		style.background = customBgColor.value;
	}
	return style;
});

const paragraphIndent = computed({
	get: () => prefer.r.novelViewerParagraphIndent.value,
	set: (v: boolean) => prefer.commit('novelViewerParagraphIndent', v),
});
const aozoraNotation = computed({
	get: () => prefer.r.novelViewerAozoraNotation.value,
	set: (v: boolean) => prefer.commit('novelViewerAozoraNotation', v),
});
// JUICE: 縦書きで、半角の英単語を横向きのまま組み込む(rotateSidewaysGlyphs参照)
const latinSideways = computed({
	get: () => prefer.r.novelViewerLatinSideways.value,
	set: (v: boolean) => prefer.commit('novelViewerLatinSideways', v),
});

// JUICE: 青空文庫形式のテキストによくある入力者注記を解釈する。対応するのはルビと字下げブロックのみ
// (アオゾラ形式は種類が非常に多く、全種対応はしない)。対応しきれない［＃...］注記は表示から取り除く
// JUICE: 傍点の種類。本文中では私用領域の文字 U+E000(種類)対象U+E001 という目印で表し、
// toNovelSegmentsで<span>(text-emphasis)に変換する
const EMPHASIS_KINDS = {
	傍点: 's',
	白ゴマ傍点: 'S',
	丸傍点: 'c',
	白丸傍点: 'C',
} as const;
type EmphasisKind = typeof EMPHASIS_KINDS[keyof typeof EMPHASIS_KINDS];
const EMPHASIS_START = '\uE000';
const EMPHASIS_END = '\uE001';

function wrapEmphasis(target: string, kind: EmphasisKind): string {
	return `${EMPHASIS_START}${kind}${target}${EMPHASIS_END}`;
}

function convertAozoraEmphasis(text: string): string {
	let result = text;
	// ［＃傍点］…［＃傍点終わり］(1行の中で閉じるもの)
	result = result.replace(/［＃(白ゴマ傍点|白丸傍点|丸傍点|傍点)］([^\n]*?)［＃\1終わり］/g, (_m, name: keyof typeof EMPHASIS_KINDS, target: string) => wrapEmphasis(target, EMPHASIS_KINDS[name]));
	// ［＃「対象」に傍点］
	const pattern = /［＃「([^」\n]+)」に(白ゴマ傍点|白丸傍点|丸傍点|傍点)］/;
	for (let match = pattern.exec(result); match != null; match = pattern.exec(result)) {
		const [annotation, target] = match;
		const kind = EMPHASIS_KINDS[match[2] as keyof typeof EMPHASIS_KINDS];
		const before = result.slice(0, match.index);
		const after = result.slice(match.index + annotation.length);
		if (before.endsWith(target)) {
			result = before.slice(0, -target.length) + wrapEmphasis(target, kind) + after;
		} else if (after.startsWith(target)) {
			result = before + wrapEmphasis(target, kind) + after.slice(target.length);
		} else {
			// 対象が見つからない注記は、ほかの未対応の注記と同じく表示から取り除く
			result = before + after;
		}
	}
	return result;
}

function convertAozoraNotation(text: string): string {
	let result = text;

	// 青空文庫形式の冒頭に定型で入る「テキスト中に現れる記号について」の凡例ブロック(罫線で
	// 前後を挟まれている)は本編の一部ではないので、章として数えないようまるごと取り除く。
	// この罫線と本編中の(章区切り等の用途で使われる)---を区別するため、凡例特有の見出し文言が
	// 含まれるブロックだけを対象にする
	result = result.replace(/^-{3,}\n([\s\S]*?)\n-{3,}\n?/m, (m, inner: string) => (inner.includes('テキスト中に現れる記号について') ? '' : m));

	// 傍点: ［＃「対象」に傍点］(対象の文字列の直後に置く。直前に置かれている場合も受け付ける)と、
	// ［＃傍点］…［＃傍点終わり］の2つの書き方がある。ルビの変換より先に行う(対象の文字列を
	// 本文とそのまま照合するため)。以降の処理で注記ごと消されないよう、専用の目印で包んでおく
	result = convertAozoraEmphasis(result);

	// ルビ: ｜基底《よみ》(基底の範囲を｜で明示) → pixiv小説のルビ記法 [[rb:基底 > よみ]] に変換
	// (MFMの$[ruby]は基底に空白を含められないため、空白を含む基底も表せるこちらに揃える)。
	// 基底の始まりの印は、青空文庫の｜のほか、半角の|や、声劇台本等で使われる＊・*も受け付ける
	result = result.replace(/／?[｜|＊*]([^｜|＊*《\n]+)《([^》\n]+)》/g, (_m, base: string, reading: string) => `[[rb:${base} > ${reading}]]`);
	// ｜が無い場合、直前の連続した漢字(＋一部の繰り返し記号)がルビの基底になる青空文庫の規則
	result = result.replace(/([\u4E00-\u9FFF\u3005\u3006\u30F6]+)《([^》]+)》/g, (_m, base: string, reading: string) => `[[rb:${base} > ${reading}]]`);

	// ［＃ここからN字下げ］～［＃ここで字下げ終わり］ブロックは、各行の先頭に全角スペースをN個補う
	result = result.replace(/［＃ここから(\d+)字下げ］\n?([\s\S]*?)［＃ここで字下げ終わり］\n?/g, (_m, n: string, inner: string) => {
		const indent = '\u3000'.repeat(Number(n));
		return inner.split('\n').map(line => (line.length > 0 ? indent + line : line)).join('\n') + '\n';
	});

	// 対応しきれない残りの入力者注記(［＃…］)は、注記自体を表示に残さないよう取り除く
	result = result.replace(/［＃[^］]*］/g, '');

	return result;
}

// JUICE: 行頭に全角/半角スペースが無い行へ全角スペースを補い、段落の字下げにする。
// 既に字下げされている行(青空文庫形式のテキスト等でよくある)はそのままにして二重字下げを避ける。
// 会話文等、始め括弧(「『（〔［｛〈《【〘〖“‘等)で始まる行と、中黒・ダッシュ・傍点類や丸・四角等の
// 記号(・―—﹅﹆●○◎◯◆◇■□★☆※、等)で始まる行(箇条書き・間・場面転換を表す行)は、
// 小説の組版の慣例どおり字下げしない
const PARAGRAPH_INDENT_SKIP_PATTERN = /^[\u3000 「『（(〔［[｛{〈《【〘〖｢“‘・･―—﹅﹆●○◎◯◆◇■□★☆※、。，]/;

// JUICE: pixiv小説のルビ記法 [[rb:…]] で始まる行は、半角の[ではなく本文(ルビ付きの文字)で始まる行なので字下げする
const RUBY_LINE_START_PATTERN = /^\[\[rb:/;

function applyParagraphIndent(text: string): string {
	return text.split('\n').map(line => (line.length === 0 || (PARAGRAPH_INDENT_SKIP_PATTERN.test(line) && !RUBY_LINE_START_PATTERN.test(line)) ? line : `\u3000${line}`)).join('\n');
}

// JUICE: 小説ビューワーではMFMを解釈せず、本文をそのまま文字として表示する(リンク・メンション・
// カスタム絵文字・$[…]の関数等は記法のまま出す)。例外として小説で使う表現だけは反映する:
// ・ルビ: MFMの $[ruby 基底 よみ]と、pixiv小説の [[rb:基底 > よみ]](青空文庫記法の《》もこの形に変換済み)
// ・文字の装飾: 標準のマークダウン記法の **太字**・*斜体*・~~打ち消し線~~(装飾の中にルビを含めてもよい)
type NovelDecoration = { bold?: boolean; italic?: boolean; strike?: boolean; emphasis?: EmphasisKind };
type NovelSegment = ({ type: 'text'; text: string } | { type: 'ruby'; base: string; reading: string }) & NovelDecoration;

const RUBY_PATTERN = /\$\[ruby ([^\s\]]+) ([^\]]+)\]|\[\[rb:\s*([^>\]]+?)\s*>\s*([^\]]+?)\s*\]\]/g;
// JUICE: 装飾は1行の中だけで閉じるものに限る(段落をまたいで意図せず装飾されないように)。記号の直後・直前が
// 空白の場合(「* 注」のような単独の記号)は装飾とみなさない
// 青空文庫記法の傍点(convertAozoraEmphasisで専用の目印に変換済み)もここで扱う
const DECORATION_PATTERN = /\*\*(?!\s)([^\n]+?)(?<!\s)\*\*|~~(?!\s)([^\n]+?)(?<!\s)~~|\*(?![\s*])([^*\n]+?)(?<!\s)\*|\uE000([sScC])([^\uE001]*)\uE001/;

function toRubySegments(text: string, decoration: NovelDecoration): NovelSegment[] {
	const segments: NovelSegment[] = [];
	let last = 0;
	for (const match of text.matchAll(RUBY_PATTERN)) {
		if (match.index > last) segments.push({ type: 'text', text: text.slice(last, match.index), ...decoration });
		segments.push({ type: 'ruby', base: match[1] ?? match[3], reading: match[2] ?? match[4], ...decoration });
		last = match.index + match[0].length;
	}
	if (last < text.length) segments.push({ type: 'text', text: text.slice(last), ...decoration });
	return segments;
}

function toNovelSegments(text: string, decoration: NovelDecoration = {}): NovelSegment[] {
	const match = DECORATION_PATTERN.exec(text);
	if (match == null) return toRubySegments(text, decoration);
	const inner = match[1] ?? match[2] ?? match[3] ?? match[5];
	const innerDecoration: NovelDecoration = {
		...decoration,
		...(match[1] != null ? { bold: true } : match[2] != null ? { strike: true } : match[3] != null ? { italic: true } : { emphasis: match[4] as EmphasisKind }),
	};
	return [
		...toRubySegments(text.slice(0, match.index), decoration),
		// JUICE: **太字の中の~~打ち消し~~** のような入れ子にも対応する
		...toNovelSegments(inner, innerDecoration),
		...toNovelSegments(text.slice(match.index + match[0].length), decoration),
	];
}

// JUICE: pixiv小説の記法のうち、ルビ(toNovelSegmentsで処理)・改ページ・章タイトル(chaptersで処理)
// 以外の、表示に意味を持たない記法を取り除く。[[jumpuri:表示名 > URL]] は表示名だけを残す
// (ビューワーの本文ではリンクを張らない)。[jump:N]・[pixivimage:…] はそのまま消す
function convertPixivNotation(text: string): string {
	return text
		.replace(/\[\[jumpuri:\s*([^>\]]+?)\s*>\s*[^\]]*\]\]/g, '$1')
		.replace(/\[(?:jump|pixivimage):[^\]]*\]/g, '');
}

type NovelChapter = {
	text: string;
	segments: NovelSegment[];
	// JUICE: pixiv小説の [chapter:タイトル] で付けられた章タイトル(目次に使う)
	title: string | null;
	// JUICE: 何ページ目([newpage]で区切られた単位、0始まり)に属するか
	section: number;
	// JUICE: そのページの最初の章か(=直前で改ページしている)
	sectionStart: boolean;
	// JUICE: 区切り線ではなく、[chapter:タイトル]の行から始まった章か(前に⁂を出さない)
	titleStart: boolean;
};

// JUICE: pixiv小説と同じく、独立行の [newpage] を改ページとして扱う。横書きでは1ページずつ表示して
// 前後のページへのボタンで行き来し、縦書きではそこで必ず次のページから始まるようにする。
// ページの中はさらに区切り線(独立行の---等)で章に分ける。どちらも無ければ全文が1ページ1章になる。
// 青空文庫記法の変換(凡例ブロックの除去含む)は分割より前に、全文に対して1回だけ行う
const NEWPAGE_PATTERN = /^[ \t\u3000]*\[newpage\][ \t\u3000]*$/m;
// JUICE: タイトルの中にルビ記法 [[rb:…]] を含めてもよい(途中の ] で打ち切らない)。
// 改行はまたがない(閉じ忘れたときに、後ろの本文まで題名にしないように。エディターの目次と同じ)
const CHAPTER_TITLE_PATTERN = /\[chapter:\s*((?:\[\[rb:[^\]]*\]\]|[^\]\n])*?)\s*\]/g;

// JUICE: [chapter:タイトル] のある行から新しい章にする(その前に本文があるときだけ。区切り線・改ページのすぐ後の
// 章タイトルは、その章の題名にする)。区切り線を入れずに章タイトルだけを並べた作品でも、全ての章が目次に出るように
// (エディターの目次 buildNovelOutline と同じ数え方)
function splitByChapterTitles(part: string): string[] {
	const starts: number[] = [];
	let last = 0;
	for (const m of part.matchAll(CHAPTER_TITLE_PATTERN)) {
		const lineStart = part.lastIndexOf('\n', m.index) + 1;
		if (lineStart <= last) continue;
		if (part.slice(last, lineStart).trim() === '') continue;
		starts.push(lineStart);
		last = lineStart;
	}
	const pieces: string[] = [];
	let from = 0;
	for (const start of starts) {
		pieces.push(part.slice(from, start));
		from = start;
	}
	pieces.push(part.slice(from));
	return pieces.map(t => t.trim()).filter(t => t.length > 0);
}
const PIXIV_RUBY_BASE_PATTERN = /\[\[rb:\s*([^>\]]+?)\s*>[^\]]*\]\]/g;

const chapters = computed<NovelChapter[]>(() => {
	const text = isPreview.value ? previewText.value : (novelFileContent.value ?? appearNote.value?.text);
	if (!text) return [{ text: '', segments: [], title: null, section: 0, sectionStart: true, titleStart: false }];
	let normalized = convertPixivNotation(text.replace(/\r\n/g, '\n'));
	if (aozoraNotation.value) normalized = convertAozoraNotation(normalized);
	const sectionTexts = normalized.split(NEWPAGE_PATTERN).map(t => t.trim()).filter(t => t.length > 0);
	const result: NovelChapter[] = [];
	for (const [section, sectionText] of (sectionTexts.length > 0 ? sectionTexts : [normalized]).entries()) {
		const parts = sectionText.split(/\n{0,2}^-{3,}$\n{0,2}/m).map(t => t.trim()).filter(t => t.length > 0);
		for (const [j, part] of (parts.length > 0 ? parts : [sectionText]).entries()) {
			for (const [k, piece] of splitByChapterTitles(part).entries()) {
				// JUICE: 目次に出すタイトルは、ルビ記法を基底の文字だけにする
				const title = [...piece.matchAll(CHAPTER_TITLE_PATTERN)][0]?.[1]?.replace(PIXIV_RUBY_BASE_PATTERN, '$1') ?? null;
				const withoutTitleSyntax = piece.replace(CHAPTER_TITLE_PATTERN, '$1');
				const chapterText = paragraphIndent.value ? applyParagraphIndent(withoutTitleSyntax) : withoutTitleSyntax;
				result.push({ text: chapterText, segments: toNovelSegments(chapterText), title: title || null, section, sectionStart: j === 0 && k === 0, titleStart: k > 0 });
			}
		}
	}
	return result;
});

// JUICE: 表示される本文の文字数(空白・改行・字下げの全角スペースは数えない。ルビはよみを除いた
// 基底の文字だけ数える)。サロゲートペアの文字(絵文字等)も1文字として数える
const novelCharCount = computed(() => {
	let count = 0;
	for (const chapter of chapters.value) {
		for (const seg of chapter.segments) {
			count += [...(seg.type === 'ruby' ? seg.base : seg.text).replace(/\s/g, '')].length;
		}
	}
	return count;
});

// JUICE: 日本語の小説の一般的な黙読速度(1分あたりおよそ500文字)で見積もる。1分未満でも「約1分」と出す
const NOVEL_READING_CHARS_PER_MINUTE = 500;
const novelReadingMinutes = computed(() => Math.max(1, Math.round(novelCharCount.value / NOVEL_READING_CHARS_PER_MINUTE)));

const sectionCount = computed(() => (chapters.value.at(-1)?.section ?? 0) + 1);

// JUICE: 横書きで今表示しているページ([newpage]単位、0始まり)
const currentSection = ref(0);

function goToSection(section: number): void {
	currentSection.value = Math.min(Math.max(section, 0), sectionCount.value - 1);
	// JUICE: ページを替えたら本文の先頭(固定ヘッダーのすぐ下)へ戻す
	nextTick(() => outerEl.value?.scrollIntoView({ behavior: 'instant', block: 'start' }));
}

let chapterMarkerEls: (HTMLElement | null)[] = [];

function setChapterMarkerEl(i: number, el: HTMLElement | null): void {
	chapterMarkerEls[i] = el;
}

// JUICE: 縦書きモードは1画面分の幅ごとに右から左へページめくり式で読む。見開き時はinner2枚を
// 同期させ、右(panelInnerEls[0])が基準ページ・左(panelInnerEls[1])が次ページを表示する
const pageCount = ref(1);
const currentPage = ref(1);
const canGoNext = computed(() => currentPage.value + (isSpread.value ? 1 : 0) < pageCount.value);
const canGoPrev = computed(() => currentPage.value > 1);

// JUICE: vertical-rlの1行(1列)の幅は通常line-heightと一致するが、ルビ付きの行はルビの分だけ
// 素の行より幅が広くなり、line-heightをそのまま単位にすると行の途中でページが切れてしまう
// (見切れる)。実際に描画されたルビ要素の最大幅を測り、それをline-heightとして明示的に
// 上書きすることで、ルビの有無に関わらずすべての行の幅を揃える(揃っていれば「幅の整数倍で
// ページを区切る」という単純な計算がそのまま安全に成り立つ)
function applyUniformColumnWidth(inner: HTMLDivElement): number {
	inner.style.removeProperty('line-height');
	const baseLineHeight = parseFloat(getComputedStyle(inner).lineHeight) || 32;
	let columnWidth = baseLineHeight;
	for (const ruby of inner.querySelectorAll('ruby')) {
		// JUICE: vertical-rlでは<rt>(ルビ本体)が<ruby>自身のgetBoundingClientRectの外に
		// はみ出して描画される(<ruby>の矩形はベース文字の範囲までしか含まない)。<ruby>だけを
		// 測るとルビの分の幅を過小評価してしまい、実際の列幅より狭いline-heightを設定して
		// しまう結果、ルビが列からはみ出て隣の列と重なって見切れる。<rt>を含めた実際の
		// 外接矩形の幅を測る
		const rubyRect = ruby.getBoundingClientRect();
		let left = rubyRect.left;
		let right = rubyRect.right;
		for (const rt of ruby.querySelectorAll('rt')) {
			const rtRect = rt.getBoundingClientRect();
			left = Math.min(left, rtRect.left);
			right = Math.max(right, rtRect.right);
		}
		columnWidth = Math.max(columnWidth, right - left);
	}
	columnWidth = Math.ceil(columnWidth);
	inner.style.lineHeight = `${columnWidth}px`;
	return columnWidth;
}

// JUICE: ルビが多い文章では、均一なページ幅(行幅の整数倍)だと「たまたまルビがページ境界に
// かかる」ケースをどうしても避けられない(境界を1行分ずらしても、別のルビが今度はそこに
// かかるだけ)。line-heightに指定した値と実際に描画される列の間隔がサブピクセル単位で
// 完全には一致しないため、ページを重ねるほど数px単位でズレるうえ、この文章はルビの密度が
// 高く(数十文字に1回程度)、大抵のページ境界の近くに何かしらルビが存在するため。
// そのため、ページ幅を機械的な均一割りにするのではなく、各ルビ(<rt>込みの外接矩形)の
// 本文先頭からの距離の範囲を求め、ページ境界がその範囲の内側に来る場合だけそのページを
// 少し短く切り上げてルビの手前で区切る(=ページごとに幅が微妙に前後する)
function getRubyZones(inner: HTMLDivElement): { start: number; end: number }[] {
	const innerRight = inner.getBoundingClientRect().right;
	const zones: { start: number; end: number }[] = [];
	for (const ruby of inner.querySelectorAll('ruby')) {
		const r = ruby.getBoundingClientRect();
		let left = r.left;
		let right = r.right;
		for (const rt of ruby.querySelectorAll('rt')) {
			const rtRect = rt.getBoundingClientRect();
			left = Math.min(left, rtRect.left);
			right = Math.max(right, rtRect.right);
		}
		// JUICE: 距離は「本文の先頭(=innerの右端)からどれだけ離れているか」。vertical-rlは
		// 右から左へ進むため、leftのほうが先頭からより遠い(distanceが大きい)
		zones.push({ start: innerRight - right, end: innerRight - left });
	}
	zones.sort((a, b) => a.start - b.start);
	return zones;
}

// JUICE: [newpage](改ページ)の位置。縦書きでは.pageBreak(幅0のブロック)がその位置に置かれ、
// 次の本文はその左(=次の列)から始まる。本文先頭(innerの右端)からの距離で返す
function getForcedPageBreaks(inner: HTMLDivElement): number[] {
	const innerRight = inner.getBoundingClientRect().right;
	return [...inner.querySelectorAll('[data-novel-page-break]')]
		.map(el => innerRight - el.getBoundingClientRect().left)
		.sort((a, b) => a - b);
}

// JUICE: ルビの矩形がページの境界にぴったり接しているだけでも、文字のアンチエイリアス分が
// 境界の外へ1px程度にじみ、隣のページの端に切れ端として見えることがある。接している場合も
// 「かかっている」とみなし、この分だけ手前で区切る
const RUBY_BLEED_MARGIN = 2;

function computePageOffsets(inner: HTMLDivElement, naturalPageWidth: number, rubyZones: { start: number; end: number }[], forcedBreaks: number[]): number[] {
	const total = inner.scrollWidth;
	if (naturalPageWidth <= 0 || (total <= naturalPageWidth && forcedBreaks.length === 0)) return [0];
	const offsets = [0];
	let current = 0;
	// JUICE: 改ページはルビを避けて少し手前で区切ることがあるため、「currentより後ろか」だけでは
	// 同じ改ページを2回拾ってしまう。使い終わった改ページは先頭から順に捨てていく
	const pendingBreaks = forcedBreaks.filter(f => f > 1 && f < total - 1);
	while (current + naturalPageWidth < total || pendingBreaks.length > 0) {
		let boundary = current + naturalPageWidth;
		// JUICE: このページの範囲内に改ページがあれば、ルビの調整より優先してそこで区切る
		// (ルビを避けて手前で区切った後は位置が数pxずれているので、その分の余裕を持たせる。そうしないと
		// 改ページがちょうどページの端に来たとき、幅数pxの空のページが1枚増えてしまう)
		const forced = pendingBreaks[0] != null && pendingBreaks[0] <= boundary + RUBY_BLEED_MARGIN ? pendingBreaks.shift() : undefined;
		if (forced != null) {
			// JUICE: 改ページ直後の列の先頭にルビがあると、ルビが列の外(前のページ側)へはみ出して
			// 描画され、前のページの端にルビの切れ端が見えてしまう。改ページ位置にかかるルビがあれば
			// その手前で区切る
			const straddlingStarts = rubyZones.filter(z => z.start > current && z.start < forced + RUBY_BLEED_MARGIN && z.end > forced).map(z => z.start - RUBY_BLEED_MARGIN);
			const cut = Math.max(current + 1, Math.min(forced, ...straddlingStarts));
			offsets.push(cut);
			current = cut;
			continue;
		}
		if (boundary >= total) break;
		const straddling = rubyZones.find(z => z.start > current && z.start < boundary + RUBY_BLEED_MARGIN && z.end > boundary);
		if (straddling) boundary = straddling.start - RUBY_BLEED_MARGIN;
		if (boundary <= current) boundary = current + naturalPageWidth;
		offsets.push(boundary);
		current = boundary;
	}
	return offsets;
}

// JUICE: パネル間で共有する単純な配列で十分(見開きの2パネルは同じ本文・同じフォント設定
// なので同じ内容になる)。offsets[i]は「ページi+1が始まる、本文先頭からの距離」
let primaryPageOffsets: number[] = [0];

function updatePageCount(): void {
	const inner = primaryInnerEl();
	const viewport = primaryViewportEl();
	// JUICE: 「使える幅」は.panelViewportの親である.panel(常にflexの割り当て幅=100%のまま)から
	// 測る。.panelViewport自身は後段でページ幅ちょうどに縮めるため、そちらを基準にすると
	// 次回計測時にはすでに縮んだ幅を「使える幅」と誤認してどんどん縮んでいってしまう
	const outer = viewport?.parentElement as HTMLDivElement | undefined;
	if (!inner || !viewport || !outer || outer.clientWidth === 0) return;
	const columnWidth = applyUniformColumnWidth(inner);
	const secondaryInner = panelInnerEls.value[1];
	// JUICE: 見開きの2パネルは同じ本文なので、CSSのline-height指定値を主パネル(右)から
	// そのままコピーする(数値を再計算して個別に指定すると、サブピクセルの丸め等でわずかに
	// 違う値になることがあり、2パネルの位置計算が前提とする「同じ列幅」が崩れて継ぎ目で
	// 内容が二重に見えていた)。同じCSS値・同じ本文なら実際の描画結果も一致するはず
	if (isSpread.value && secondaryInner) secondaryInner.style.lineHeight = inner.style.lineHeight;
	const naturalPageWidth = Math.max(1, Math.floor(outer.clientWidth / columnWidth)) * columnWidth;
	primaryPageOffsets = computePageOffsets(inner, naturalPageWidth, getRubyZones(inner), getForcedPageBreaks(inner));
	pageCount.value = Math.max(1, primaryPageOffsets.length);
}

// JUICE: しおり(直近50件まで、MkEmojiPicker.vueのrecentlyUsedEmojisと同じ方式で切り詰める)。
// 縦書きはページ番号ではなく本文全体のうちの位置(割合)で覚える(文字サイズ・画面の幅が変わるとページの区切りが
// 変わり、同じページ番号でも別の箇所になるため)。横書きは[newpage]のページと、そのページの中の位置で覚える。
// 本文を測れないとき(読み込み中・画面から外れた後など)は、前に覚えた位置を消さないよう何もしない
function saveProgress(): void {
	const id = appearNote.value?.id;
	if (!id || isPreview.value || novelFileLoading.value || restoringProgress) return;
	const prev = store.s.novelViewerProgress[id];
	let entry: NonNullable<typeof prev>;
	if (writingMode.value === 'vertical') {
		const inner = primaryInnerEl();
		if (inner == null || inner.scrollWidth <= 0) return;
		entry = { ...prev, page: currentPage.value, ratio: currentReadingRatio(), updatedAt: Date.now() };
	} else {
		const ratio = horizontalReadingRatio();
		if (ratio == null) return;
		entry = { ...prev, section: currentSection.value, sectionRatio: ratio, updatedAt: Date.now() };
	}
	const rest = Object.entries(store.s.novelViewerProgress)
		.filter(([key]) => key !== id)
		.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
		.slice(0, 49);
	rest.push([id, entry]);
	store.set('novelViewerProgress', Object.fromEntries(rest));
}

// JUICE: 横書きで、表示しているページ([newpage]単位)の本文のうち、画面の上端までに読み進めた割合
function horizontalReadingRatio(): number | null {
	const el = outerEl.value;
	if (el == null) return null;
	const rect = el.getBoundingClientRect();
	if (rect.height <= 0) return null;
	return Math.min(1, Math.max(0, -rect.top / rect.height));
}

// JUICE: しおりの位置へ戻している間は、スクロールで位置を覚え直さない(戻す途中の位置で上書きしないように)
let restoringProgress = false;

// JUICE: 横書きのしおりの位置へ戻す(本文が描かれてから、そのページの中の位置までスクロールする)
function restoreHorizontalProgress(): void {
	const id = appearNote.value?.id;
	const saved = id ? store.s.novelViewerProgress[id] : undefined;
	if (saved?.section == null || isPreview.value) return;
	restoringProgress = true;
	currentSection.value = Math.min(Math.max(saved.section, 0), sectionCount.value - 1);
	nextTick(async () => {
		await window.document.fonts.ready;
		const el = outerEl.value;
		if (el != null && writingMode.value === 'horizontal') {
			const rect = el.getBoundingClientRect();
			const delta = rect.top + (saved.sectionRatio ?? 0) * rect.height;
			const container = getScrollContainer(el);
			if (container == null) window.scrollBy({ top: delta, behavior: 'instant' });
			else container.scrollBy({ top: delta, behavior: 'instant' });
		}
		// スクロールの知らせが届き終わってから、また覚え始める
		window.requestAnimationFrame(() => {
			restoringProgress = false;
		});
	});
}

// JUICE: 横書きでスクロールしたら、少し待ってからしおりの位置を覚える(スクロールのたびに保存しないように)
let progressSaveTimer: number | null = null;

function onAnyScroll(): void {
	if (writingMode.value !== 'horizontal') return;
	if (progressSaveTimer != null) return;
	progressSaveTimer = window.setTimeout(() => {
		progressSaveTimer = null;
		saveProgress();
	}, 500);
}

// JUICE: transform: translateXで直接ページ位置を反映する(アニメーションなし)。scrollLeftは
// 使わない — ブラウザ側のオーバーフロー計算(scrollWidth)に依存するため、パネルが差し替わった
// 直後(見開き切替直後など)はまだ計算が終わっておらず、要求した位置が0へ強制的に丸められて
// 二度と正しい位置に戻らないことがあった。transformはオーバーフロー量を一切問わないので、
// このタイミング問題が起こりようがない。
// 符号はscrollLeftと逆: vertical-rlは内容がinnerの右端を起点に左へ伸びる(width: max-content)
// ため、後のページを見せるにはinnerを右へ(=正のtranslateX)ずらす必要がある。
// ページごとに幅が微妙に前後する(ルビを避けるため)ので、クリップする窓の幅もページごとに
// 都度合わせ直す
function setInnerPage(inner: HTMLDivElement, viewport: HTMLDivElement, page: number, offsets: number[]): void {
	const start = offsets[page - 1] ?? offsets[offsets.length - 1] ?? 0;
	const end = offsets[page] ?? inner.scrollWidth;
	viewport.style.width = `${Math.max(1, end - start)}px`;
	inner.style.transform = `translateX(${start}px)`;
}

// JUICE: 縦書きはtext-orientation: uprightで英数字も1文字ずつ正立させているが、縦書き用の字形を
// 持たない約物(…‥―—や半角の括弧・ハイフン等)まで正立したまま横向きの形で並んでしまう。
// これらだけtext-orientation: mixedのspanで包み、通常の縦書きと同じく90度回転させて縦向きにする。
// 本文の描画結果(DOM)を直接書き換えるため、テンプレート側は本文をkeyにして、本文が変わったら
// 必ず作り直させている(Vueが保持するテキストノードとずれないように)
const VERTICAL_ROTATE_CHARS = /[…‥―—–\-~()[\]{}<>=_|]+/g;

// JUICE: 半角の英単語(と3桁以上の数字)。単語の中の空白・記号(Mr. Smith、e-mail、10:30等)も含めて1つにする
const LATIN_RUN = /[A-Za-z0-9](?:[A-Za-z0-9.,'!?&:;%#@/+\- ]*[A-Za-z0-9.!?%])?/g;

// JUICE: 半角の英単語を、横向きのまま(90度回して)組み込む。2桁の数字は縦中横(横に並べて1文字分に収める)、
// 1文字だけの英数字は今まで通り正立のまま
function rotateLatinRuns(root: HTMLElement): void {
	const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) => {
			const parent = node.parentElement;
			if (parent == null || parent.closest('[data-novel-sideways], [data-novel-tcy], rt') != null) return NodeFilter.FILTER_REJECT;
			LATIN_RUN.lastIndex = 0;
			return LATIN_RUN.test(node.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
		},
	});
	const targets: Text[] = [];
	while (walker.nextNode()) targets.push(walker.currentNode as Text);
	for (const node of targets) {
		const text = node.nodeValue ?? '';
		const fragment = window.document.createDocumentFragment();
		let last = 0;
		for (const match of text.matchAll(LATIN_RUN)) {
			const run = match[0];
			if (run.length < 2) continue;
			if (match.index > last) fragment.append(text.slice(last, match.index));
			const span = window.document.createElement('span');
			span.textContent = run;
			if (/^[0-9]{2}$/.test(run)) span.dataset.novelTcy = '';
			else span.dataset.novelSideways = '';
			fragment.append(span);
			last = match.index + run.length;
		}
		if (last === 0) continue;
		if (last < text.length) fragment.append(text.slice(last));
		node.replaceWith(fragment);
	}
}

function rotateSidewaysGlyphs(root: HTMLElement): void {
	if (latinSideways.value) rotateLatinRuns(root);
	const walker = window.document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode: (node) => {
			const parent = node.parentElement;
			if (parent == null || parent.closest('[data-novel-sideways], [data-novel-tcy]') != null) return NodeFilter.FILTER_REJECT;
			VERTICAL_ROTATE_CHARS.lastIndex = 0;
			return VERTICAL_ROTATE_CHARS.test(node.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
		},
	});
	const targets: Text[] = [];
	while (walker.nextNode()) targets.push(walker.currentNode as Text);
	for (const node of targets) {
		const text = node.nodeValue ?? '';
		const fragment = window.document.createDocumentFragment();
		let last = 0;
		for (const match of text.matchAll(VERTICAL_ROTATE_CHARS)) {
			if (match.index > last) fragment.append(text.slice(last, match.index));
			// JUICE: 三点リーダー・二点リーダーは、回転させると点が行の片側(左)に寄ってしまう(横書きの字形は点が下にあるため)。
			// 縦書き用の字形(︙・︰。点が行の真ん中に縦に並ぶ)に置き換え、正立のまま置く。それ以外は回転させる
			for (const part of match[0].split(/([…‥]+)/)) {
				if (part === '') continue;
				const span = window.document.createElement('span');
				if (/^[…‥]+$/.test(part)) {
					span.dataset.novelEllipsis = '';
					span.textContent = part.replace(/…/g, '\uFE19').replace(/‥/g, '\uFE30');
				} else {
					span.textContent = part;
				}
				span.dataset.novelSideways = '';
				fragment.append(span);
			}
			last = match.index + match[0].length;
		}
		if (last < text.length) fragment.append(text.slice(last));
		node.replaceWith(fragment);
	}
}

// JUICE: 見開きの左パネルの本文は、ページ数が確定した後の再描画で初めて中身が入る(v-if)ため、
// applyLayout時点では処理できない。描画のたびに未処理の部分だけ処理し直す(処理済みの約物は
// .sidewaysの中にあるので二重には包まない)。左パネルは右パネルのページ位置をそのまま使うので、
// 字形を揃えないと継ぎ目で内容がずれる。本文はPageWithHeaderのslot内(=子コンポーネント側)で
// 描画されるためonUpdatedは発火しない。DOM更新後に走るflush: 'post'のwatchで拾う
watch([currentPage, pageCount, isSpread, chapters], () => {
	if (writingMode.value !== 'vertical') return;
	const secondaryInner = panelInnerEls.value[1];
	if (!isSpread.value || !secondaryInner) return;
	rotateSidewaysGlyphs(secondaryInner);
}, { flush: 'post' });

// JUICE: ページ送りはtransformで行い、クリップ窓(.panelViewport, overflow: hidden)自体はスクロールさせない
// 前提になっている。ところがブラウザのページ内検索(Ctrl+F)で見つかった箇所や、文字選択のドラッグ等では
// overflow: hiddenの要素でもブラウザが勝手にスクロールさせてしまい、左右のページの内容がずれる。
// スクロールされたら即座に元へ戻す
function onViewportScroll(ev: Event): void {
	if (writingMode.value !== 'vertical') return;
	const el = ev.currentTarget as HTMLElement;
	if (el.scrollLeft !== 0) el.scrollLeft = 0;
	if (el.scrollTop !== 0) el.scrollTop = 0;
}

function syncSecondaryPanel(): void {
	if (!isSpread.value) return;
	const secondaryInner = panelInnerEls.value[1];
	const secondaryViewport = panelViewportEls.value[1];
	if (!secondaryInner || !secondaryViewport) return;
	const secondaryPage = Math.min(currentPage.value + 1, pageCount.value);
	setInnerPage(secondaryInner, secondaryViewport, secondaryPage, primaryPageOffsets);
}

// JUICE: 読んでいた位置を「本文全体のうち何割目か」で表す。ウインドウ幅・文字サイズが変わると
// ページの区切りが変わり、同じページ番号でも別の箇所を指してしまう(開き直すと読んでいた所から
// 大きくずれる)ため、再レイアウトの前後はページ番号ではなくこの割合で位置を引き継ぐ
function currentReadingRatio(): number {
	const inner = primaryInnerEl();
	const total = inner?.scrollWidth ?? 0;
	if (total <= 0) return 0;
	return (primaryPageOffsets[currentPage.value - 1] ?? 0) / total;
}

// JUICE: リサイズを続けて行う(狭めてから戻す等)と、毎回「いま表示しているページの先頭」から
// 割合を取り直すせいで、ページの区切り方が変わるたびに少しずつ前へずれていく。ユーザーが自分で
// ページをめくる/移動するまでは、最初に取った割合を使い続ける
let readingAnchorRatio: number | null = null;

function anchoredReadingPosition(): { ratio: number } {
	readingAnchorRatio ??= currentReadingRatio();
	return { ratio: readingAnchorRatio };
}

function pageAtRatio(ratio: number, total: number): number {
	const distance = ratio * total;
	let page = 1;
	for (let p = 0; p < primaryPageOffsets.length; p++) {
		// JUICE: 境界ちょうど(丸め誤差込み)の場合は後ろのページに寄せる
		if (primaryPageOffsets[p] <= distance + 1) page = p + 1;
		else break;
	}
	return page;
}

// JUICE: リサイズ中は連続で呼ばれるうえ、中でfonts.readyをawaitするため、先に呼んだ計測が後から
// 終わって新しい結果を上書きすることがある。最新の呼び出し以外の結果は捨てる
let layoutGeneration = 0;
// JUICE: 実行中(fonts.ready待ち等)の再レイアウトの目標位置。開いた直後のしおり復元が終わる前に
// リサイズ(ResizeObserverの初回通知等)が来ると、まだ古いページ位置から割合を取ってしまい、
// しおり位置が上書きされていた。実行中の目標があればリサイズ側もそれを引き継ぐ
let pendingLayoutTarget: number | { ratio: number } | null = null;

function applyLayout(target: number | { ratio: number }): void {
	const generation = ++layoutGeneration;
	pendingLayoutTarget = target;
	// JUICE: ページ番号を直接指定する移動(しおり・目次・表示の作り直し)は、読む位置の基準も作り直す
	if (typeof target === 'number') readingAnchorRatio = null;
	nextTick(() => {
		updateSpreadMode();
		// JUICE: isSpreadの変更はここで初めて反映されるリアクティブな状態で、実際のDOM(パネルが
		// 1枚か2枚か)への反映はさらに1tick遅れる。ここでnextTickを重ねずにpanelInnerEls/transform
		// を触ると、見開きに切り替わった直後は古いDOM(または未生成のパネル)を参照してしまう
		nextTick(async () => {
			const inner = primaryInnerEl();
			const viewport = primaryViewportEl();
			if (!inner || !viewport) return;
			// JUICE: 字形の向きを直すと字幅も変わるため、ページ幅を測る前に済ませる
			for (const el of panelInnerEls.value) {
				if (el) rotateSidewaysGlyphs(el);
			}

			// JUICE: Webフォントの読み込みが完了する前に幅を測ると、フォールバックフォントの
			// 字幅で計算してしまい、後から本来のフォントに置き換わった時点でページ境界がずれる
			// (最悪、行の途中で切れて見切れる)。document.fonts.readyを待ってから測る
			await window.document.fonts.ready;
			if (generation !== layoutGeneration) return;
			if (outerEl.value) lastLayoutSize = bodySizeKey(outerEl.value);
			updatePageCount();
			const targetPage = typeof target === 'number' ? target : pageAtRatio(target.ratio, inner.scrollWidth);
			let page = Math.min(Math.max(targetPage, 1), pageCount.value);
			// JUICE: 見開きは本と同じく(1,2)(3,4)…の組で表示し、右ページは常に奇数ページにする。
			// 目次からの移動等で偶数ページが指定されたときにそのまま右ページへ置くと、(2,3)の
			// ような組になって章の頭が左から右へ飛んで見え、以降のめくりもずれたままになっていた
			if (isSpread.value && page % 2 === 0) page -= 1;
			currentPage.value = page;
			setInnerPage(inner, viewport, currentPage.value, primaryPageOffsets);
			syncSecondaryPanel();
			pendingLayoutTarget = null;
		});
	});
}

function resetPager(): void {
	const id = appearNote.value?.id;
	const saved = id ? store.s.novelViewerProgress[id] : undefined;
	// JUICE: 本文全体のうちの位置で覚えていればそこへ(画面の幅・文字サイズが前と違っても同じ箇所に戻る)。
	// 古いしおり(ページ番号だけ)はページ番号で戻す
	if (saved?.ratio != null) {
		readingAnchorRatio = saved.ratio;
		applyLayout({ ratio: saved.ratio });
		return;
	}
	applyLayout(saved?.page ?? 1);
}

function turnPage(direction: 'next' | 'prev'): void {
	const inner = primaryInnerEl();
	const viewport = primaryViewportEl();
	if (!inner || !viewport) return;
	if (direction === 'next' && !canGoNext.value) return;
	if (direction === 'prev' && !canGoPrev.value) return;
	// JUICE: 見開き時は基本2ページ分まとめてめくるが、終端付近では1ページ分しか動けないことがある
	// (全2ページ中の2ページ目からprevすると1ページ目にしか戻れない、等)ため、まず目標ページを
	// [1, pageCount]へクランプする
	const step = isSpread.value ? 2 : 1;
	const rawTarget = currentPage.value + (direction === 'next' ? step : -step);
	const targetPage = Math.min(Math.max(rawTarget, 1), pageCount.value);
	if (targetPage === currentPage.value) return;
	currentPage.value = targetPage;
	readingAnchorRatio = null;
	setInnerPage(inner, viewport, targetPage, primaryPageOffsets);
	syncSecondaryPanel();
	saveProgress();
}

function jumpToChapter(i: number): void {
	// JUICE: 横書きは通常のページスクロールなので、scrollIntoViewで移動するだけでよい。
	// ただしマーカー自体ではなく、その章の頭にある章ナビ(前の章/目次/次の章)を基準にする。
	// マーカー基準だとページ上部の固定ヘッダーの裏に章タイトルが隠れてしまい、移動したように
	// 見えなかった(章ナビ側はCSSのscroll-margin-topで固定ヘッダーの高さ分だけ下げて止める)。
	// 別のページ([newpage])にある章なら、先にそのページへ切り替えてから(描画を待って)移動する
	if (writingMode.value === 'horizontal') {
		const chapter = chapters.value[i];
		if (chapter == null) return;
		if (chapter.sectionStart) {
			goToSection(chapter.section);
			return;
		}
		currentSection.value = chapter.section;
		nextTick(() => {
			const marker = chapterMarkerEls[i];
			if (!marker) return;
			const target = (marker.previousElementSibling as HTMLElement | null) ?? marker;
			target.scrollIntoView({ behavior: 'instant', block: 'start' });
		});
		return;
	}
	const marker = chapterMarkerEls[i];
	if (!marker) return;
	const inner = primaryInnerEl();
	if (!inner) return;
	// JUICE: 縦書きはtransformでページ送りするため(scrollIntoViewが効く対象がそもそも無い)、
	// マーカーの現在位置から直接ページ番号を計算する。inner/markerのgetBoundingClientRectの
	// 差は、現在のtransform量がどちらにも等しくかかっているぶん打ち消し合うため、transformの
	// 値に関係なく「本文の先頭からの絶対距離」がそのまま求まる
	const innerRect = inner.getBoundingClientRect();
	const markerRect = marker.getBoundingClientRect();
	const distanceFromStart = innerRect.right - markerRect.right;
	// primaryPageOffsetsの中でdistanceFromStart以下の最大の開始位置を含むページを探す
	let targetPage = 1;
	for (let p = 0; p < primaryPageOffsets.length; p++) {
		if (primaryPageOffsets[p] <= distanceFromStart) targetPage = p + 1;
		else break;
	}
	applyLayout(targetPage);
	saveProgress();
}

function openToc(ev: PointerEvent): void {
	os.popupMenu(chapters.value.map((chapter, i) => ({
		text: chapter.title ?? i18n.tsx._juice.novelViewerChapter({ n: i + 1 }),
		action: () => jumpToChapter(i),
	})), ev.currentTarget ?? ev.target ?? undefined);
}

function openSettings(ev: PointerEvent): void {
	os.popupMenu([{
		type: 'radio' as const,
		icon: 'ti ti-text-size',
		text: i18n.ts._juice.novelViewerFontSize,
		ref: fontSize,
		options: [
			{ label: i18n.ts._juice.novelViewerFontSizeSmall, value: 0.9 },
			{ label: i18n.ts._juice.novelViewerFontSizeMedium, value: 1.1 },
			{ label: i18n.ts._juice.novelViewerFontSizeLarge, value: 1.35 },
			{ label: i18n.ts._juice.novelViewerFontSizeXLarge, value: 1.6 },
		],
	}, {
		type: 'switch' as const,
		icon: 'ti ti-indent-increase',
		text: i18n.ts._juice.novelViewerParagraphIndent,
		caption: i18n.ts._juice.novelViewerParagraphIndentCaption,
		ref: paragraphIndent,
	}, {
		type: 'switch' as const,
		icon: 'ti ti-forms',
		text: i18n.ts._juice.novelViewerAozoraNotation,
		caption: i18n.ts._juice.novelViewerAozoraNotationCaption,
		ref: aozoraNotation,
	}, {
		type: 'switch' as const,
		icon: 'ti ti-text-orientation',
		text: i18n.ts._juice.novelViewerLatinSideways,
		caption: i18n.ts._juice.novelViewerLatinSidewaysCaption,
		ref: latinSideways,
	}, {
		type: 'radio' as const,
		icon: 'ti ti-typography',
		text: i18n.ts._juice.novelViewerFontFamily,
		ref: fontFamily,
		options: [
			{ label: i18n.ts._juice.novelViewerFontFamilyDefault, value: 'default' },
			{ label: i18n.ts._juice.novelViewerFontFamilyMincho, value: 'mincho' },
			{ label: i18n.ts._juice.novelViewerFontFamilyGothic, value: 'gothic' },
		],
	}, {
		type: 'radio' as const,
		icon: 'ti ti-palette',
		text: i18n.ts._juice.novelViewerTheme,
		ref: theme,
		options: [
			{ label: i18n.ts._juice.novelViewerThemeAuto, value: 'auto' },
			{ label: i18n.ts._juice.novelViewerThemeLight, value: 'light' },
			{ label: i18n.ts._juice.novelViewerThemeSepia, value: 'sepia' },
			{ label: i18n.ts._juice.novelViewerThemeDark, value: 'dark' },
			{ label: i18n.ts._juice.novelViewerThemeCustom, value: 'custom' },
		],
	}, {
		type: 'component' as const,
		component: markRaw(MkNovelViewerColorPicker),
	}], ev.currentTarget ?? ev.target ?? undefined);
}

let touchStartX = 0;
let touchStartY = 0;

function onTouchStart(ev: TouchEvent): void {
	touchStartX = ev.changedTouches[0]?.clientX ?? 0;
	touchStartY = ev.changedTouches[0]?.clientY ?? 0;
}

function onTouchEnd(ev: TouchEvent): void {
	const endX = ev.changedTouches[0]?.clientX ?? touchStartX;
	const endY = ev.changedTouches[0]?.clientY ?? touchStartY;
	const deltaX = endX - touchStartX;
	const deltaY = endY - touchStartY;
	if (Math.abs(deltaX) < 40) return;
	// JUICE: 縦スクロールの途中で指が横にぶれただけのときはページをめくらない
	if (Math.abs(deltaY) > Math.abs(deltaX)) return;
	// JUICE: 右スワイプ(指を右へ)で次ページ・左スワイプ(指を左へ)で前ページ
	turnPage(deltaX > 0 ? 'next' : 'prev');
}

// JUICE: iOS Safari等の「画面端からのスワイプで戻る/進む」はtouch-actionでは止まらないため、
// 縦書き本文の高さの範囲で画面端付近から始まったタッチだけ既定動作を止める(ページめくりの
// スワイプ開始位置が端に寄ったときに誤って前のページへ戻ってしまうのを防ぐ)
const EDGE_SWIPE_GUARD_WIDTH = 24;

function onWindowTouchStart(ev: TouchEvent): void {
	if (writingMode.value !== 'vertical' || outerEl.value == null) return;
	const touch = ev.touches[0];
	if (touch == null) return;
	if (touch.clientX > EDGE_SWIPE_GUARD_WIDTH && touch.clientX < window.innerWidth - EDGE_SWIPE_GUARD_WIDTH) return;
	const rect = outerEl.value.getBoundingClientRect();
	if (touch.clientY < rect.top || touch.clientY > rect.bottom) return;
	ev.preventDefault();
}

function onKeydown(ev: KeyboardEvent): void {
	// JUICE: Fullscreen API非対応の環境(CSSだけの全画面表示)でも、Escキーで全画面を抜けられるようにする。
	// ただし設定メニュー等のポップアップを閉じるためのEsc(フォーカスはポップアップ側にある)では抜けない
	if (ev.key === 'Escape' && isFullscreen.value && window.document.fullscreenElement == null) {
		const target = ev.target;
		const fromReader = target === window.document.body || target === window.document.documentElement || (target instanceof Node && readerEl.value?.contains(target) === true);
		if (fromReader) exitFullscreen();
		return;
	}
	if (writingMode.value !== 'vertical') return;
	// JUICE: 入力欄(投稿フォームのダイアログ・検索欄等)でのカーソル移動やIME変換中の
	// 矢印キーまでページめくりに奪わない
	if (ev.isComposing || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
	const target = ev.target;
	if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select') != null)) return;
	if (ev.key === 'ArrowLeft') {
		turnPage('next');
	} else if (ev.key === 'ArrowRight') {
		turnPage('prev');
	}
}

// JUICE: ウインドウのリサイズ(ドラッグ中は連続で発生する)は、止まってから1回だけ再レイアウトする
let resizeTimer: number | null = null;
let lastLayoutSize = '';

function onResize(): void {
	if (writingMode.value !== 'vertical') return;
	if (resizeTimer != null) window.clearTimeout(resizeTimer);
	resizeTimer = window.setTimeout(() => {
		resizeTimer = null;
		if (writingMode.value !== 'vertical') return;
		const wasSpread = isSpread.value;
		updateSpreadMode();
		// JUICE: 見開き⇔単ページが切り替わらない範囲のリサイズでも、幅が変わればページ数もtransform量も
		// 変わる。毎回必ずapplyLayoutでページ境界へ位置を計算し直す
		if (isSpread.value !== wasSpread) {
			// JUICE: 見開き⇔単ページの切り替えはDOM構造(パネル数)も変わるため、マーカーを取り直す
			chapterMarkerEls = [];
		}
		applyLayout(pendingLayoutTarget ?? anchoredReadingPosition());
	}, 150);
}

// JUICE: window.resizeが発生しない表示領域の変化(デッキのカラム幅変更・サイドバーの開閉等)でも
// 本文の枠の大きさが変わるため、枠そのものの大きさを監視する
// 比較の基準は「最後にレイアウトした時点の枠の大きさ」(applyLayoutで記録)にする
function bodySizeKey(el: HTMLElement): string {
	return `${el.clientWidth}x${el.clientHeight}`;
}

const bodyResizeObserver = new ResizeObserver((entries) => {
	const el = entries[0]?.target as HTMLElement | undefined;
	// JUICE: 別ページへ遷移してKeepAliveで非表示になったときは大きさが0になる。このとき測り直すと
	// 読んでいた位置が失われるため無視し、再表示時の本来の大きさとだけ比べる
	if (el == null || el.clientWidth === 0 || el.clientHeight === 0) return;
	if (bodySizeKey(el) === lastLayoutSize) return;
	onResize();
});

watch(outerEl, (el, oldEl) => {
	if (oldEl) bodyResizeObserver.unobserve(oldEl);
	if (el) bodyResizeObserver.observe(el);
}, { immediate: true });

// JUICE: Chrome(Android)等の、横方向のオーバースクロールで履歴を戻る/進む挙動を
// ビューワーを開いている間だけ無効化する(閉じたら元の値に戻す)
let prevRootOverscrollBehaviorX = '';
let listenersAttached = false;

// JUICE: ページはKeepAliveでキャッシュされ、別ページへ遷移してもunmountされないため、
// window側のリスナーとルート要素のスタイルはactivate/deactivateに合わせて付け外しする
function attachWindowListeners(): void {
	if (listenersAttached) return;
	listenersAttached = true;
	window.addEventListener('resize', onResize);
	window.document.addEventListener('fullscreenchange', onFullscreenChange);
	// JUICE: 横書きのしおり。スクロールする要素は場所によって違う(ページ全体・デッキのカラム等)ので、windowで
	// 全ての要素のscrollを捕まえる(scrollは伝わらないが、捕捉(capture)では届く)
	window.addEventListener('scroll', onAnyScroll, { capture: true, passive: true });
	// JUICE: エディターの中に並べたときは、キーでのページめくり・画面端のスワイプ対策をしない
	// (エディターでの入力やボタン操作、エディター側のタッチ操作に割り込まないように)
	if (props.embedded) return;
	window.addEventListener('keydown', onKeydown);
	window.addEventListener('touchstart', onWindowTouchStart, { passive: false });
	prevRootOverscrollBehaviorX = window.document.documentElement.style.overscrollBehaviorX;
	window.document.documentElement.style.overscrollBehaviorX = 'none';
}

function detachWindowListeners(): void {
	if (!listenersAttached) return;
	listenersAttached = false;
	window.removeEventListener('resize', onResize);
	window.document.removeEventListener('fullscreenchange', onFullscreenChange);
	window.removeEventListener('scroll', onAnyScroll, { capture: true });
	if (progressSaveTimer != null) {
		window.clearTimeout(progressSaveTimer);
		progressSaveTimer = null;
	}
	if (props.embedded) return;
	window.removeEventListener('keydown', onKeydown);
	window.removeEventListener('touchstart', onWindowTouchStart);
	window.document.documentElement.style.overscrollBehaviorX = prevRootOverscrollBehaviorX;
}

onMounted(attachWindowListeners);
onActivated(attachWindowListeners);
onDeactivated(() => {
	// JUICE: 全画面のまま別のページへ移ったら全画面も解除する
	if (isFullscreen.value) exitFullscreen();
	// 横書きのしおりは、スクロールを止めてすぐ別のページへ移っても残るよう、先に覚える
	saveProgress();
	detachWindowListeners();
	// JUICE: 非表示になった後でリサイズ待ちのタイマーが発火すると、大きさ0で測って表示が崩れる
	if (resizeTimer != null) {
		window.clearTimeout(resizeTimer);
		resizeTimer = null;
	}
	saveProgress();
});
onUnmounted(() => {
	if (isFullscreen.value) exitFullscreen();
	detachWindowListeners();
	bodyResizeObserver.disconnect();
	if (resizeTimer != null) window.clearTimeout(resizeTimer);
	if (previewTimer != null) window.clearTimeout(previewTimer);
	saveProgress();
});

// JUICE: プレビューはノートを読み込まない(appearNoteが変わらない)ので、開いたときに最初の組版をここで行う
onMounted(() => {
	if (isPreview.value && writingMode.value === 'vertical') resetPager();
});

// JUICE: プレビューで本文が変わったら、読んでいた位置を保ったまま組み直す(先頭に戻さない)
watch(previewText, () => {
	if (!isPreview.value) return;
	if (writingMode.value === 'vertical') applyLayout(anchoredReadingPosition());
});

// JUICE: 縦書きのページ送りでJSから付けた位置・幅(本文のずらし・切り取る窓の幅・列の幅)は、横書きでは
// 使わない。同じ要素が横書きでも使われるため、残っているとページを送った分だけ本文が枠の外へずれて見えなくなる
function clearVerticalLayoutStyles(): void {
	for (const el of panelInnerEls.value) {
		el?.style.removeProperty('transform');
		el?.style.removeProperty('line-height');
	}
	for (const el of panelViewportEls.value) el?.style.removeProperty('width');
}

watch([appearNote, writingMode, showContent, novelFileContent], () => {
	chapterMarkerEls = [];
	currentSection.value = 0;
	if (writingMode.value === 'vertical') resetPager();
	else {
		nextTick(clearVerticalLayoutStyles);
		// JUICE: 横書きでも、しおりの位置から読めるようにする
		restoreHorizontalProgress();
	}
});

// JUICE: 文字サイズ等の変更時は読んでいた位置(本文全体に対する割合)を保ったまま再計測する(しおり位置には戻さない)
watch([fontSize, fontFamily, paragraphIndent, aozoraNotation, latinSideways], () => {
	if (writingMode.value === 'vertical') applyLayout(anchoredReadingPosition());
});

function fetchNote(): void {
	if (props.noteId == null) return;
	note.value = null;
	error.value = undefined;

	misskeyApi('notes/show', {
		noteId: props.noteId,
	}).then(res => {
		note.value = res;
	}).catch(err => {
		if (['fbcc002d-37d9-4944-a6b0-d9e29f2d33ab', '145f88d2-b03d-4087-8143-a78928883c4b'].includes(err.id)) {
			pleaseLogin({
				path: '/',
				message: err.id === 'fbcc002d-37d9-4944-a6b0-d9e29f2d33ab' ? i18n.ts.thisContentsAreMarkedAsSigninRequiredByAuthor : i18n.ts.signinOrContinueOnRemote,
				openOnRemote: {
					type: 'lookup',
					url: `https://${host}/notes/${props.noteId}`,
				},
			});
		}
		error.value = err;
	});
}

watch(() => props.noteId, fetchNote, {
	immediate: true,
});

function toggleWritingMode(): void {
	prefer.commit('novelViewerWritingMode', prefer.s.novelViewerWritingMode === 'vertical' ? 'horizontal' : 'vertical');
}

const writingModeToggleLabel = computed(() => (writingMode.value === 'vertical' ? i18n.ts._juice.novelViewerHorizontalMode : i18n.ts._juice.novelViewerVerticalMode));

// JUICE: 全画面表示。本文部分をCSSで画面いっぱいに広げ(position: fixed)、ブラウザが対応していれば
// Fullscreen APIでブラウザ自体も全画面にする。全画面にするのは<html>全体にしている(本文の要素だけを
// 全画面にすると、設定メニュー等のポップアップ(bodyの直下に出る)が全画面の外になって見えなくなるため)。
// iPhoneのSafariのように要素の全画面表示に対応していない環境でも、CSS側だけで画面いっぱいに表示できる
const isFullscreen = ref(false);

function enterFullscreen(): void {
	isFullscreen.value = true;
	const root = window.document.documentElement;
	if (typeof root.requestFullscreen === 'function' && window.document.fullscreenElement == null) {
		root.requestFullscreen().catch(() => { /* 対応していない・拒否された場合はCSS側の表示だけで続ける */ });
	}
}

function exitFullscreen(): void {
	isFullscreen.value = false;
	if (window.document.fullscreenElement != null) {
		window.document.exitFullscreen().catch(() => { /* 既に解除されている */ });
	}
}

// JUICE: Escキー等でブラウザ側の全画面が解除されたら、表示も元に戻す
function onFullscreenChange(): void {
	if (window.document.fullscreenElement == null && isFullscreen.value) isFullscreen.value = false;
}

// JUICE: ビューワーの幅(狭いときはヘッダーのボタンを名前付きのメニューにまとめる)
const spacerEl = useTemplateRef<HTMLDivElement>('spacerEl');
const viewerNarrow = ref(false);
const spacerResizeObserver = new ResizeObserver(entries => {
	for (const entry of entries) viewerNarrow.value = entry.contentRect.width < 600;
});
watch(spacerEl, (el, oldEl) => {
	if (oldEl) spacerResizeObserver.unobserve(oldEl);
	if (el) spacerResizeObserver.observe(el);
});
onUnmounted(() => spacerResizeObserver.disconnect());

const headerActions = computed(() => {
	const actions = [{
		text: i18n.ts._juice.novelViewerSettings,
		icon: 'ti ti-adjustments',
		handler: openSettings,
	}, {
		text: writingModeToggleLabel.value,
		icon: 'ti ti-camera-rotate',
		handler: toggleWritingMode,
	}, {
		text: i18n.ts._juice.novelViewerFullscreen,
		icon: 'ti ti-maximize',
		handler: enterFullscreen,
	}];
	if (chapters.value.length > 1) {
		actions.unshift({
			text: i18n.ts._juice.novelViewerToc,
			icon: 'ti ti-list',
			handler: openToc,
		});
	}
	// JUICE: 狭いときは名前付きのメニューにまとめる
	return collapseHeaderActions(actions, viewerNarrow.value);
});

if (!props.embedded) {
	definePage(() => ({
		title: isPreview.value ? i18n.ts._juice.novelEditorPreview : i18n.ts._juice.novelViewer,
	}));
}
</script>

<style lang="scss" module>
.previewTitle {
	font-size: 1.3em;
	font-weight: bold;
}

.author {
	display: flex;
	align-items: center;
	gap: 12px;
}

.avatar {
	width: 48px;
	height: 48px;
}

.authorText {
	display: flex;
	flex-direction: column;
	min-width: 0;
}

.authorName {
	font-weight: bold;
}

.authorAcct {
	opacity: 0.7;
}

.stats {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 16px;
	font-size: 0.9em;
	opacity: 0.7;
}

.cw {
	margin: 0 0 1em 0;
}

.body {
	// JUICE: 横書きで[newpage]のページを替えたとき、本文の先頭を固定ヘッダーの裏に隠さない
	scroll-margin-top: var(--MI-stickyTop, 0px);
	line-height: 2;
	transition: background-color 0.2s ease, color 0.2s ease;

	// JUICE: 電子書籍リーダーの背景テーマ。autoはアプリのテーマに合わせたパネル色にする
	// (ページ背景と同色だと本文の範囲・角丸が分からないため)
	&[data-theme="auto"] {
		background: var(--MI_THEME-panel);
	}
	&[data-theme="light"] {
		background: #fff;
		color: #1a1a1a;
	}
	&[data-theme="sepia"] {
		background: #f4ecd8;
		color: #5b4636;
	}
	&[data-theme="dark"] {
		background: #000;
		color: #ddd;
	}

	&[data-mode="horizontal"] {
		// JUICE: 縦書きと揃えて、本文の周りに余白を取り背景を角丸にする
		padding: 20px 24px;
		border-radius: var(--MI-radius);
	}

	&[data-mode="vertical"] {
		height: 70vh;
		max-height: 720px;
		padding: 20px;
		border-radius: var(--MI-radius);
		// JUICE: 横方向のスワイプはページめくりに使うため、ブラウザ側の横パン(=Chrome等の
		// スワイプで戻る/進む)として扱わせない。縦スクロールとピンチズームは残す
		touch-action: pan-y pinch-zoom;
	}
}

.fileState {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 32px 0;
	writing-mode: horizontal-tb;
}

// JUICE: 縦書き見開き用のパネル2枚(右=現在ページ・左=次ページ)を並べる横並びコンテナ。
// 本を開いたときのように中央にspreadGutterで見た目の継ぎ目を入れる
.spread {
	display: flex;
	// JUICE: 縦書き(右→左)の見開きは、本を開いたときと同じく右ページ=現在ページ・左ページ=
	// 次ページになるべき。DOM順(panelEls[0]=現在・[1]=次)はそのままに、見た目だけrow-reverseで
	// 右→左へ並べ替える
	flex-direction: row-reverse;
	height: 100%;
}

.spreadGutter {
	flex-shrink: 0;
	width: 1px;
	margin: 0 12px;
	background: currentColor;
	opacity: 0.2;
}

.panel {
	height: 100%;

	.spread > & {
		flex: 1 1 0;
		min-width: 0;
	}

	// JUICE: 見開きの左パネル(次ページの見た目上の複製、aria-hidden+inert)はテキスト選択の
	// 対象からも外す
	.spread > &:last-child {
		user-select: none;
	}

	&[data-mode="horizontal"] {
		writing-mode: horizontal-tb;
	}

	&[data-mode="vertical"] {
		// JUICE: mixedだと英数字だけ横倒しに回転して周囲と向きが揃わないため、upright指定で
		// 英字・数字も1文字ずつそのまま縦に並べ、全体の向きを統一する
		writing-mode: vertical-rl;
		text-orientation: upright;
		// JUICE: .panel自体はクリップせず「使える幅」の測定基準として常にflexの割り当て幅
		// (100%)のまま保つ。実際にクリップする窓は子の.panelViewportが担う(理由は後述)
		width: 100%;
		max-width: 100%;
	}
}

.panelViewport {
	height: 100%;

	// JUICE: 幅は必ずJS側(setInnerPage)がそのページぶんの実測px値を明示的に設定する
	// (ルビを避けるためページごとに微妙に幅が前後する)。.panel(=100%固定)をそのまま
	// クリップ窓にすると、幅がページの実際の中身より広くなり(半端な余白)、ページを
	// 1つ進めても窓の端に前ページの残りがはみ出て見えてしまう(見開きの継ぎ目で内容が
	// 二重に見える不具合の原因だった)。めくり幅とクリップ幅を常に一致させる
	[data-mode="vertical"] > & {
		overflow: hidden;
	}
}

.panelInner {
	height: 100%;

	// JUICE: vertical-rlは1行ごとに右→左へ積み上がる自然な折り返しでwidth方向に伸びる
	// (CSS column-widthはvertical-rl環境だと列がheight方向に伸びてしまい期待通り機能しない
	// ため使わない: headless Chromiumで実機検証済み)。width: max-contentで実際の内容量ぶんの
	// 幅を持たせ、親の.panelViewport(overflow:hidden)を窓としてtransform: translateXで
	// 動かしてページめくりを実現する。スクロールバーでの手動ドラッグはさせず、ページ送り
	// ボタン/スワイプ/矢印キー経由のみにする
	[data-mode="vertical"] > & {
		width: max-content;
	}
}

// JUICE: 章の先頭位置を覚えておくためだけの空要素(章ジャンプ時にgetBoundingClientRectで
// 位置を測る)。中身が無くても、縦書きでは行ボックスとしてフォントの高さぶんの領域を
// 確保してしまい、本文の先頭に隙間([#ここから2字下げ]等の直後で顕著)ができる原因に
// なっていた。display:inline-blockでサイズを明示的に0にして、位置測定の起点としての
// 役割だけ残しつつ見た目には一切影響しないようにする
// JUICE: MFMを通さずに本文をそのまま表示するため、改行・連続スペース(字下げの全角スペース含む)を保つ
.novelText {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}

.bold {
	font-weight: bold;
}

.italic {
	font-style: italic;
}

.strike {
	text-decoration: line-through;
}

// JUICE: 青空文庫記法の傍点。縦書きでは文字の右側、横書きでは上側に付く(日本語の既定の位置)
.emphasis {
	text-emphasis-position: over right;
}

.emphasis_s {
	text-emphasis-style: filled sesame;
}

.emphasis_S {
	text-emphasis-style: open sesame;
}

.emphasis_c {
	text-emphasis-style: filled circle;
}

.emphasis_C {
	text-emphasis-style: open circle;
}

// JUICE: 縦書き用の字形を持たない約物を、通常の縦書きと同じく90度回転させる(rotateSidewaysGlyphs参照)。
// スクリプト側で作る要素なので、CSS Modulesのクラスではなくdata属性で指定する(下記の注意を参照)
[data-novel-sideways] {
	text-orientation: mixed;
}

// JUICE: 縦中横(2桁の半角数字を横に並べて1文字分に収める。rotateLatinRuns参照)
[data-novel-tcy] {
	text-combine-upright: all;
}

// JUICE: 縦書き用の字形に置き換えた三点リーダー・二点リーダーは、回転させずに正立で置く
[data-novel-ellipsis] {
	text-orientation: upright;
}

.chapterMarker {
	display: inline-block;
	width: 0;
	height: 0;
	overflow: hidden;
}

.chapterNav {
	scroll-margin-top: var(--MI-stickyTop, 0px);
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 12px 0;
	opacity: 0.8;
	font-size: 0.9em;

	&:not(:first-child) {
		// JUICE: 背景テーマ(ライト/セピア/ダーク/カスタム)ごとの文字色に馴染むよう、文字色を薄めて使う
		border-top: 1px solid color-mix(in srgb, currentColor 25%, transparent);
	}
}

.chapterNavLink {
	padding: 4px 8px;
	white-space: nowrap;

	&:disabled {
		opacity: 0.3;
	}
}

// JUICE: 狭い画面では「前のページ」等が折り返して見切れるので、「前へ」「次へ」と短くする
.navShort {
	display: none;
}

@container (max-width: 400px) {
	.navLong {
		display: none;
	}

	.navShort {
		display: inline;
	}
}

// JUICE: [newpage]の位置に置く幅0のブロック。縦書きでは次の本文をここから新しい列として始めさせ、
// ページの区切り位置の目印にもなる(getForcedPageBreaks)。見た目には何も出さない
.pageBreak {
	[data-mode="vertical"] & {
		display: block;
		inline-size: 0;
		block-size: 0;
	}
}

.sectionCount {
	opacity: 0.8;
	font-variant-numeric: tabular-nums;
}

.chapterBreak {
	text-align: center;
	opacity: 0.5;
	margin: 1.5em 0;
}

// JUICE: 縦書きでは、作者・文字数・ページ送りなどを含めたページ全体を、見えている高さに収める
// (本文を70vhで決めていたときは、上下の要素の分だけ画面からはみ出していた)。
// ごく低い画面では本文が潰れないよう、ページ全体の高さに下限を設けてスクロールさせる
.fitHeight {
	display: flex;
	flex-direction: column;
	height: calc(100cqh - var(--MI-stickyTop, 0px) - var(--MI-stickyBottom, 0px));
	min-height: 480px;
}

.fitContent {
	flex: 1;
	min-height: 0;
}

.readerFit {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-height: 0;

	> .body[data-mode="vertical"] {
		flex: 1 1 0;
		min-height: 240px;
		height: auto;
	}

	> .pager {
		flex-shrink: 0;
	}
}

// JUICE: 全画面表示。popupMenu等のポップアップ(z-indexは500000〜)より下、アプリの通常のUIより上に重ねる
.reader.fullscreen {
	position: fixed;
	inset: 0;
	// JUICE: 全画面では<body>の直下に移るため、ページ送りの「前へ」「次へ」の切り替えの基準をここにする
	container-type: inline-size;
	z-index: 400000;
	display: flex;
	flex-direction: column;
	gap: 8px;
	box-sizing: border-box;
	padding: 8px 16px 12px;
	overflow-y: auto;
	background: var(--MI_THEME-bg);

	> .body {
		width: 100%;
		max-width: 1200px;
		margin: 0 auto;
		box-sizing: border-box;

		// JUICE: 縦書きは画面の高さいっぱいを本文に使う(通常表示の70vh・最大720pxの制限を外す)
		&[data-mode="vertical"] {
			flex: 1 1 0;
			min-height: 0;
			height: auto;
			max-height: none;
		}
	}

	> .pager {
		flex-shrink: 0;
	}
}

.fullscreenToolbar {
	// JUICE: 横書きの全画面は本文ごとスクロールするため、ツールバーは常に上端に貼り付けておく
	position: sticky;
	top: -8px;
	z-index: 1;
	display: flex;
	justify-content: flex-end;
	flex-shrink: 0;
	gap: 4px;
	margin: -8px -16px 0;
	padding: 8px 16px;
	background: var(--MI_THEME-bg);
}

.fullscreenToolbarButton {
	padding: 8px;
	border-radius: 6px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	// JUICE: 狭い画面(スマホ等)ではツールチップが出ないので、アイコンの下に小さく名前を出す
	@media (max-width: 600px) {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		padding: 4px 6px 2px;
	}
}

.fullscreenToolbarLabel {
	display: none;

	@media (max-width: 600px) {
		display: block;
		font-size: 9px;
		line-height: 1.2;
		white-space: nowrap;
		opacity: 0.8;
	}
}

.pager {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 16px;
	margin-top: 8px;
}

.pagerButton {
	padding: 8px;
	border-radius: 999px;

	&:disabled {
		opacity: 0.3;
	}
}

.pagerCount {
	opacity: 0.7;
	font-variant-numeric: tabular-nums;
}

.footerLink {
	display: block;
	opacity: 0.7;
}
</style>
