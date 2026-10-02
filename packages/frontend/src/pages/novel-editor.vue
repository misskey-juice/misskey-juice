<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: 小説エディター。下書きは作品ごとにこのブラウザへ自動で保存し、書き終わったら本文を.txtにして、小説フラグ付きで投稿する -->
<template>
<PageWithHeader :actions="headerActions">
	<div ref="rootEl" :class="$style.root">
		<div :class="[$style.layout, { [$style.withSidebar]: showSidebar, [$style.withPreview]: showSidePreview }]">
			<!-- 作品一覧と目次(広い画面だけ。狭い画面では上のボタンから出す) -->
			<aside v-if="showSidebar" :class="$style.sidebar">
				<section :class="$style.sideSection">
					<div :class="$style.sideHeader">
						<span><i class="ti ti-books"></i> {{ i18n.ts._juice.novelEditorWorks }}</span>
						<button v-tooltip="i18n.ts._juice.novelEditorNewWork" class="_button" :class="$style.sideHeaderButton" :aria-label="i18n.ts._juice.novelEditorNewWork" @click="newWork"><i class="ti ti-plus"></i></button>
					</div>
					<div :class="$style.workList">
						<div v-for="work in sortedWorks" :key="work.id" :class="[$style.workItem, { [$style.workItemActive]: work.id === currentWorkId }]">
							<button class="_button" :class="$style.workItemMain" :aria-current="work.id === currentWorkId" @click="selectWork(work.id)">
								<span :class="$style.workTitle">{{ work.title || i18n.ts._juice.novelEditorUntitled }}</span>
								<span :class="$style.workMeta"><MkTime :key="Math.floor(work.updatedAt / 60000)" :time="work.updatedAt"/></span>
							</button>
							<button v-tooltip="i18n.ts._juice.novelEditorDeleteWork" class="_button" :class="$style.workItemDelete" :aria-label="i18n.ts._juice.novelEditorDeleteWork" @click="removeWork(work)"><i class="ti ti-trash"></i></button>
						</div>
					</div>
				</section>
				<section :class="$style.sideSection">
					<div :class="$style.sideHeader"><span><i class="ti ti-list"></i> {{ i18n.ts._juice.novelViewerToc }}</span></div>
					<div :class="$style.outline">
						<button v-for="(item, i) in outline" :key="i" class="_button" :class="$style.outlineItem" @click="jumpTo(item.pos)">
							<span :class="$style.outlineTitle"><i :class="outlineIcon(item)"></i> {{ outlineLabel(item, i) }}</span>
							<span :class="$style.outlineChars">{{ number(item.chars) }}</span>
						</button>
					</div>
				</section>
			</aside>

			<div :class="$style.main">
				<!-- 投稿・保存などは、書いている途中でもすぐ押せるよう上に置く -->
				<div :class="$style.actions">
					<MkButton v-if="!showSidePreview" @click="openPreview"><i class="ti ti-eye"></i> {{ i18n.ts._juice.novelEditorPreview }}</MkButton>
					<MkButton @click="openImportMenu"><i class="ti ti-file-import"></i> {{ i18n.ts._juice.novelEditorImport }}</MkButton>
					<MkButton @click="downloadText"><i class="ti ti-download"></i> {{ i18n.ts._juice.novelEditorDownload }}</MkButton>
					<span :class="$style.actionsSpacer"></span>
					<MkButton primary :disabled="charCount === 0" @click="postNovel"><i class="ti ti-send"></i> {{ i18n.ts._juice.novelEditorPost }}</MkButton>
				</div>
				<MkInput v-model="title">
					<template #label>{{ i18n.ts._juice.novelEditorTitle }}</template>
				</MkInput>

				<!-- 集中モードでは、この入力欄だけを画面いっぱいに出す -->
				<Teleport to="body" :disabled="!focusMode">
					<div :class="[$style.editor, { [$style.editorFocus]: focusMode }]" :style="editorStyle">
						<!-- 記法の入力・検索・表示の設定 -->
						<div :class="$style.toolbar" role="toolbar" :aria-label="i18n.ts._juice.novelEditorNotation">
							<button v-tooltip="i18n.ts._juice.novelEditorRubyHint" class="_button" :class="$style.toolButton" @click="insertRuby"><i class="ti ti-language-hiragana"></i><span :class="$style.toolLabel">{{ i18n.ts._juice.novelEditorRuby }}</span></button>
							<button v-tooltip="i18n.ts._juice.novelEditorEmphasisHint" class="_button" :class="$style.toolButton" @click="openEmphasisMenu"><i class="ti ti-point"></i><span :class="$style.toolLabel">{{ i18n.ts._juice.novelEditorEmphasis }}</span></button>
							<button v-tooltip="i18n.ts._juice.novelEditorDecorationHint" class="_button" :class="$style.toolButton" @click="openDecorationMenu"><i class="ti ti-bold"></i><span :class="$style.toolLabel">{{ i18n.ts._juice.novelEditorDecoration }}</span></button>
							<button v-tooltip="i18n.ts._juice.novelEditorIndentHint" class="_button" :class="$style.toolButton" @click="insertIndentBlock"><i class="ti ti-indent-increase"></i><span :class="$style.toolLabel">{{ i18n.ts._juice.novelEditorIndent }}</span></button>
							<button v-tooltip="i18n.ts._juice.novelEditorDashHint" class="_button" :class="$style.toolButton" :aria-label="i18n.ts._juice.novelEditorDashHint" @click="insertText('――')">――<span :class="$style.toolLabelNarrow">{{ i18n.ts._juice.novelEditorShortDash }}</span></button>
							<button v-tooltip="i18n.ts._juice.novelEditorEllipsisHint" class="_button" :class="$style.toolButton" :aria-label="i18n.ts._juice.novelEditorEllipsisHint" @click="insertText('……')">……<span :class="$style.toolLabelNarrow">{{ i18n.ts._juice.novelEditorShortEllipsis }}</span></button>
							<span :class="$style.toolSeparator"></span>
							<button v-tooltip="i18n.ts._juice.novelEditorChapterTitleHint" class="_button" :class="$style.toolButton" @click="insertChapterTitle"><i class="ti ti-heading"></i><span :class="$style.toolLabel">{{ i18n.ts._juice.novelEditorChapterTitle }}</span></button>
							<button v-tooltip="i18n.ts._juice.novelEditorSectionBreakHint" class="_button" :class="$style.toolButton" @click="insertLine('---')"><i class="ti ti-separator"></i><span :class="$style.toolLabel">{{ i18n.ts._juice.novelEditorSectionBreak }}</span></button>
							<button v-tooltip="i18n.ts._juice.novelEditorNewPageHint" class="_button" :class="$style.toolButton" @click="insertLine('[newpage]')"><i class="ti ti-file-plus"></i><span :class="$style.toolLabel">{{ i18n.ts._juice.novelEditorNewPage }}</span></button>
							<span :class="$style.toolSpacer"></span>
							<button v-tooltip="i18n.ts._juice.novelEditorCheck" class="_button" :class="$style.toolButton" :aria-label="i18n.ts._juice.novelEditorCheck" @click="openChecker"><i class="ti ti-checklist"></i><span :class="$style.toolLabelNarrow">{{ i18n.ts._juice.novelEditorShortCheck }}</span></button>
							<button v-tooltip="i18n.ts._juice.novelEditorSearch" class="_button" :class="$style.toolButton" :aria-label="i18n.ts._juice.novelEditorSearch" @click="openSearch"><i class="ti ti-search"></i><span :class="$style.toolLabelNarrow">{{ i18n.ts.search }}</span></button>
							<button v-tooltip="i18n.ts._juice.novelEditorSettings" class="_button" :class="$style.toolButton" :aria-label="i18n.ts._juice.novelEditorSettings" @click="openSettings"><i class="ti ti-adjustments"></i><span :class="$style.toolLabelNarrow">{{ i18n.ts._juice.novelEditorShortSettings }}</span></button>
							<button v-tooltip="focusMode ? i18n.ts._juice.novelEditorExitFocus : i18n.ts._juice.novelEditorFocus" class="_button" :class="$style.toolButton" :aria-label="focusMode ? i18n.ts._juice.novelEditorExitFocus : i18n.ts._juice.novelEditorFocus" @click="toggleFocus"><i :class="focusMode ? 'ti ti-minimize' : 'ti ti-maximize'"></i><span :class="$style.toolLabelNarrow">{{ i18n.ts._juice.novelEditorShortFocus }}</span></button>
						</div>
						<div ref="editorEl" :class="$style.editorBody"></div>
						<!-- 文字数・選んでいる文字数・原稿用紙換算・目標までの進み具合 -->
						<div :class="$style.stats">
							<span><i class="ti ti-letter-case"></i> {{ i18n.tsx._juice.novelViewerCharCount({ n: number(charCount) }) }}</span>
							<span v-if="selectedChars > 0">{{ i18n.tsx._juice.novelEditorSelectedChars({ n: number(selectedChars) }) }}</span>
							<span><i class="ti ti-file-text"></i> {{ i18n.tsx._juice.novelEditorManuscriptPages({ n: number(manuscriptPages) }) }}</span>
							<button class="_button" :class="$style.goal" @click="setGoal">
								<template v-if="currentWork.goal != null">
									<span :class="$style.goalBar" role="progressbar" :aria-valuenow="Math.min(charCount, currentWork.goal)" :aria-valuemax="currentWork.goal" :aria-label="i18n.ts._juice.novelEditorGoal"><span :class="$style.goalBarFill" :style="{ width: `${goalRatio * 100}%` }"></span></span>
									<span>{{ i18n.tsx._juice.novelEditorGoalProgress({ n: number(charCount), goal: number(currentWork.goal) }) }}</span>
								</template>
								<template v-else><i class="ti ti-target"></i> {{ i18n.ts._juice.novelEditorSetGoal }}</template>
							</button>
						</div>
					</div>
				</Teleport>

				<MkInfo v-if="novelSaveFailed" warn>{{ i18n.ts._juice.novelEditorSaveFailed }}</MkInfo>

				<div :class="$style.caption">{{ i18n.ts._juice.novelEditorCaption }}</div>
			</div>

			<!-- 広い画面では、プレビュー(小説ビューワー)を横に並べる -->
			<section v-if="showSidePreview" :class="$style.preview" :aria-label="i18n.ts._juice.novelEditorPreview">
				<div :class="$style.previewInner">
					<XNovelViewer embedded/>
				</div>
			</section>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, onDeactivated, onMounted, onUnmounted, ref, toRef, useTemplateRef, watch } from 'vue';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { openSearchPanel } from '@codemirror/search';
import type { MenuItem } from '@/types/menu.js';
import type { NovelOutlineItem, NovelWork } from '@/utility/novel-draft.js';
import MkInput from '@/components/MkInput.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { chooseDriveFile, uploadFile } from '@/utility/drive.js';
import { decodeTextFile } from '@/utility/decode-text-file.js';
import number from '@/filters/number.js';
import {
	novelWorks, currentWorkId, currentWork, novelSaveFailed, novelEditorSettings,
	updateCurrentWork, createWork, selectWork, deleteWork,
	countNovelChars, countManuscriptPages, buildNovelOutline, checkNovelText, novelCheckIssueText, novelEditorJumpRequest,
} from '@/utility/novel-draft.js';
import { novelEditorExtensions } from '@/utility/novel-editor-extensions.js';
import { collapseHeaderActions } from '@/utility/collapse-header-actions.js';
import { isNovelTextFile } from '@/utility/novel-text-file.js';

const XNovelViewer = defineAsyncComponent(() => import('@/pages/novel-viewer.vue'));

const rootEl = useTemplateRef<HTMLDivElement>('rootEl');
const editorEl = useTemplateRef<HTMLDivElement>('editorEl');

const title = computed({
	get: () => currentWork.value.title,
	set: (value: string) => updateCurrentWork({ title: value }),
});

const sortedWorks = computed(() => [...novelWorks].sort((a, b) => b.updatedAt - a.updatedAt));

//#region 画面の広さに合わせた並べ方
// 作品一覧・目次は900px以上、横のプレビューは1200px以上の広さがあるときだけ出す
const rootWidth = ref(0);
const showSidebar = computed(() => rootWidth.value >= 900);
const showSidePreview = computed(() => rootWidth.value >= 1200 && novelEditorSettings.sidePreview);
const resizeObserver = new ResizeObserver(entries => {
	for (const entry of entries) rootWidth.value = entry.contentRect.width;
});
//#endregion

//#region 表示の設定
const FONT_FAMILIES: Record<'default' | 'mincho' | 'gothic', string> = {
	default: 'inherit',
	mincho: '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP", "Noto Serif CJK JP", serif',
	gothic: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", YuGothic, "Noto Sans JP", "Noto Sans CJK JP", sans-serif',
};

const editorStyle = computed(() => ({
	'--novelEditorFontFamily': FONT_FAMILIES[novelEditorSettings.fontFamily],
	'--novelEditorFontSize': `${novelEditorSettings.fontSize}px`,
	'--novelEditorLineHeight': `${novelEditorSettings.lineHeight}`,
}));

function openSettings(ev: MouseEvent): void {
	const items: MenuItem[] = [{
		type: 'radio',
		text: i18n.ts._juice.novelViewerFontFamily,
		ref: toRef(novelEditorSettings, 'fontFamily'),
		options: [
			{ label: i18n.ts._juice.novelViewerFontFamilyDefault, value: 'default' },
			{ label: i18n.ts._juice.novelViewerFontFamilyMincho, value: 'mincho' },
			{ label: i18n.ts._juice.novelViewerFontFamilyGothic, value: 'gothic' },
		],
	}, {
		type: 'radio',
		text: i18n.ts._juice.novelViewerFontSize,
		ref: toRef(novelEditorSettings, 'fontSize'),
		options: [14, 16, 18, 20, 24].map(size => ({ label: `${size}px`, value: size })),
	}, {
		type: 'radio',
		text: i18n.ts._juice.novelEditorLineHeight,
		ref: toRef(novelEditorSettings, 'lineHeight'),
		options: [1.5, 1.7, 1.9, 2.2, 2.5].map(value => ({ label: `${value}`, value })),
	}, { type: 'divider' }, {
		type: 'switch',
		text: i18n.ts._juice.novelEditorAutoIndent,
		ref: toRef(novelEditorSettings, 'autoIndent'),
	}, {
		type: 'switch',
		text: i18n.ts._juice.novelEditorAutoCloseBrackets,
		ref: toRef(novelEditorSettings, 'autoCloseBrackets'),
	}, {
		type: 'switch',
		text: i18n.ts._juice.novelEditorTypewriter,
		ref: toRef(novelEditorSettings, 'typewriter'),
	}];
	if (rootWidth.value >= 1200) {
		items.push({
			type: 'switch',
			text: i18n.ts._juice.novelEditorSidePreview,
			ref: toRef(novelEditorSettings, 'sidePreview'),
		});
	}
	os.popupMenu(items, ev.currentTarget as HTMLElement);
}
//#endregion

//#region 本文の入力欄(CodeMirror 6)
let view: EditorView | null = null;
const selectedChars = ref(0);

const editorExtensions = novelEditorExtensions({
	placeholder: i18n.ts._juice.novelEditorPlaceholder,
	label: i18n.ts._juice.novelEditorBody,
	// 検索・置換の欄の言葉
	phrases: {
		'Find': i18n.ts._juice.novelEditorFind,
		'Replace': i18n.ts._juice.novelEditorReplace,
		'next': i18n.ts._juice.novelEditorFindNext,
		'previous': i18n.ts._juice.novelEditorFindPrevious,
		'all': i18n.ts._juice.novelEditorFindAll,
		'match case': i18n.ts._juice.novelEditorMatchCase,
		'regexp': i18n.ts._juice.novelEditorRegexp,
		'by word': i18n.ts._juice.novelEditorByWord,
		'replace': i18n.ts._juice.novelEditorReplaceOne,
		'replace all': i18n.ts._juice.novelEditorReplaceAll,
		'close': i18n.ts.close,
	},
	onChange: (text) => {
		updateCurrentWork({ text });
	},
	onSelectionChange: (text) => {
		selectedChars.value = text === '' ? 0 : countNovelChars(text);
	},
});

// 作品を切り替えたら、その作品の本文で入力欄を作り直す(元に戻す履歴も作品ごと)
function loadCurrentWorkIntoEditor(): void {
	if (view == null) return;
	view.setState(EditorState.create({ doc: currentWork.value.text, extensions: editorExtensions }));
	selectedChars.value = 0;
}

onMounted(() => {
	if (rootEl.value != null) resizeObserver.observe(rootEl.value);
	if (editorEl.value == null) return;
	view = new EditorView({
		parent: editorEl.value,
		state: EditorState.create({ doc: currentWork.value.text, extensions: editorExtensions }),
	});
	window.document.addEventListener('fullscreenchange', onFullscreenChange);
});

onUnmounted(() => {
	resizeObserver.disconnect();
	if (countTimer != null) window.clearTimeout(countTimer);
	window.document.removeEventListener('fullscreenchange', onFullscreenChange);
	window.removeEventListener('keydown', onFocusKeydown);
	if (focusMode.value) exitFocus();
	view?.destroy();
	view = null;
});

watch(currentWorkId, () => {
	loadCurrentWorkIntoEditor();
	refreshCounts();
});

// JUICE: 別のタブ(や、デッキに並べたもう1つのエディター)で同じ作品が書き換えられたら、この入力欄も合わせる
watch(() => currentWork.value.text, (text) => {
	if (view == null || view.state.doc.toString() === text) return;
	const anchor = Math.min(view.state.selection.main.head, text.length);
	view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor } });
});

type Range = { from: number; to: number };

function selectionRange(): Range | null {
	if (view == null) return null;
	const { from, to } = view.state.selection.main;
	return { from, to };
}

function textOf(range: Range | null): string {
	return view == null || range == null ? '' : view.state.sliceDoc(range.from, range.to);
}

/**
 * 範囲の文字を置き換え(範囲が空ならその位置に入れ)、カーソルを入れた文字の中の指定の位置(無ければ末尾)に置く
 */
function replaceRange(range: Range, text: string, cursor?: number): void {
	if (view == null) return;
	view.dispatch({
		changes: { from: range.from, to: range.to, insert: text },
		selection: { anchor: range.from + (cursor ?? text.length) },
		scrollIntoView: true,
	});
	view.focus();
}

function insertText(text: string): void {
	const range = selectionRange();
	if (range != null) replaceRange(range, text);
}

// ルビ: [[rb:漢字 > かんじ]](pixiv小説の記法。ビューワーの設定に関係なく表示される)
async function insertRuby(): Promise<void> {
	// ダイアログを出している間に選択が変わらないよう、先に範囲を覚えておく
	const range = selectionRange();
	if (range == null) return;
	let base = textOf(range).trim();
	if (base === '' || base.includes('\n')) {
		const { canceled, result } = await os.inputText({ title: i18n.ts._juice.novelEditorRubyBase, default: '' });
		if (canceled || result == null || result.trim() === '') return;
		base = result.trim();
	}
	const { canceled, result: reading } = await os.inputText({ title: i18n.tsx._juice.novelEditorRubyReading({ base }), default: '' });
	if (canceled || reading == null || reading.trim() === '') return;
	replaceRange(range, `[[rb:${base} > ${reading.trim()}]]`);
}

// 傍点: ［＃傍点］…［＃傍点終わり］(青空文庫の記法。1行の中で閉じる)
const EMPHASIS_KINDS = ['傍点', '白ゴマ傍点', '丸傍点', '白丸傍点'] as const;

function insertEmphasis(kind: typeof EMPHASIS_KINDS[number], range: Range): void {
	const open = `［＃${kind}］`;
	const close = `［＃${kind}終わり］`;
	const selected = textOf(range);
	if (selected === '') {
		replaceRange(range, open + close, open.length);
		return;
	}
	// 改行をまたぐ傍点は表示できないので、行ごとに付ける
	replaceRange(range, selected.split('\n').map(line => (line === '' ? line : open + line + close)).join('\n'));
}

function openEmphasisMenu(ev: MouseEvent): void {
	const range = selectionRange();
	if (range == null) return;
	os.popupMenu(EMPHASIS_KINDS.map(kind => ({
		text: {
			傍点: i18n.ts._juice.novelEditorEmphasisSesame,
			白ゴマ傍点: i18n.ts._juice.novelEditorEmphasisWhiteSesame,
			丸傍点: i18n.ts._juice.novelEditorEmphasisDot,
			白丸傍点: i18n.ts._juice.novelEditorEmphasisWhiteDot,
		}[kind],
		action: () => insertEmphasis(kind, range),
	})), ev.currentTarget as HTMLElement);
}

// 章タイトル・区切り線・改ページは、それだけの行として入れる
function insertLine(line: string, range: Range | null = selectionRange()): void {
	if (view == null || range == null) return;
	const before = view.state.sliceDoc(Math.max(0, range.from - 1), range.from);
	const after = view.state.sliceDoc(range.to, range.to + 1);
	const head = range.from === 0 || before === '\n' ? '' : '\n';
	const tail = after === '\n' ? '' : '\n';
	replaceRange(range, head + line + tail);
}

async function insertChapterTitle(): Promise<void> {
	const range = selectionRange();
	const { canceled, result } = await os.inputText({ title: i18n.ts._juice.novelEditorChapterTitle, default: textOf(range).trim() });
	if (canceled || result == null || result.trim() === '') return;
	insertLine(`[chapter:${result.trim()}]`, range);
}

// 太字・斜体・打ち消し線(1行の中で閉じているときだけ反映されるので、行ごとに付ける)
function insertDecoration(mark: '**' | '*' | '~~', range: Range): void {
	const selected = textOf(range);
	if (selected === '') {
		replaceRange(range, mark + mark, mark.length);
		return;
	}
	replaceRange(range, selected.split('\n').map(line => (line.trim() === '' ? line : mark + line + mark)).join('\n'));
}

function openDecorationMenu(ev: MouseEvent): void {
	const range = selectionRange();
	if (range == null) return;
	os.popupMenu([{
		text: i18n.ts._juice.novelEditorBold,
		icon: 'ti ti-bold',
		action: () => insertDecoration('**', range),
	}, {
		text: i18n.ts._juice.novelEditorItalic,
		icon: 'ti ti-italic',
		action: () => insertDecoration('*', range),
	}, {
		text: i18n.ts._juice.novelEditorStrike,
		icon: 'ti ti-strikethrough',
		action: () => insertDecoration('~~', range),
	}], ev.currentTarget as HTMLElement);
}

// 字下げ: 選んだ行(選んでいなければ今の行)を［＃ここからN字下げ］…［＃ここで字下げ終わり］で囲む
async function insertIndentBlock(): Promise<void> {
	const selected = selectionRange();
	if (view == null || selected == null) return;
	const { canceled, result } = await os.inputNumber({ title: i18n.ts._juice.novelEditorIndentAmount, default: 2 });
	if (canceled || result == null || result < 1) return;
	const n = Math.min(10, Math.floor(result));
	const doc = view.state.doc;
	const from = doc.lineAt(selected.from).from;
	const to = doc.lineAt(selected.to).to;
	replaceRange({ from, to }, `［＃ここから${n}字下げ］\n${doc.sliceString(from, to)}\n［＃ここで字下げ終わり］`);
}

//#region 投稿前のチェック
function jumpToLine(lineNo: number): void {
	if (view == null) return;
	jumpTo(view.state.doc.line(Math.max(1, Math.min(lineNo, view.state.doc.lines))).from);
}

// チェックの結果は別ウインドウで開く(書いている間もそのまま結果が変わり、押すとここへ移る)
function openChecker(): void {
	os.pageWindow('/novel-editor/check');
}

watch(novelEditorJumpRequest, (request) => {
	if (request != null) jumpToLine(request.line);
});
//#endregion

function openSearch(): void {
	if (view == null) return;
	openSearchPanel(view);
}

// 目次から選んだ位置へ移る
function jumpTo(pos: number): void {
	if (view == null) return;
	const anchor = Math.min(pos, view.state.doc.length);
	view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'start', yMargin: 24 }) });
	view.focus();
}
//#endregion

//#region 文字数・目次・目標
// 打つたびに数え直すと長編で重いので、少し待ってから数える
const charCount = ref(0);
const manuscriptPages = ref(0);
const outline = ref<NovelOutlineItem[]>([]);
let countTimer: number | null = null;

function refreshCounts(): void {
	const text = currentWork.value.text;
	charCount.value = countNovelChars(text);
	manuscriptPages.value = countManuscriptPages(text);
	outline.value = buildNovelOutline(text);
}

refreshCounts();

watch(() => currentWork.value.text, () => {
	if (countTimer != null) window.clearTimeout(countTimer);
	countTimer = window.setTimeout(() => {
		countTimer = null;
		refreshCounts();
	}, 300);
});

const goalRatio = computed(() => (currentWork.value.goal == null ? 0 : Math.min(1, charCount.value / currentWork.value.goal)));

async function setGoal(): Promise<void> {
	const { canceled, result } = await os.inputNumber({
		title: i18n.ts._juice.novelEditorGoal,
		text: i18n.ts._juice.novelEditorGoalCaption,
		default: currentWork.value.goal,
	});
	if (canceled) return;
	updateCurrentWork({ goal: result != null && result > 0 ? Math.floor(result) : null });
}

function outlineIcon(item: NovelOutlineItem): string {
	switch (item.kind) {
		case 'page': return 'ti ti-file-plus';
		case 'break': return 'ti ti-separator';
		case 'chapter': return 'ti ti-heading';
		default: return 'ti ti-file-text';
	}
}

function outlineLabel(item: NovelOutlineItem, i: number): string {
	if (item.title != null && item.title !== '') return item.title;
	if (item.kind === 'start') return i18n.ts._juice.novelEditorOutlineStart;
	return i18n.tsx._juice.novelViewerChapter({ n: i + 1 });
}

function openOutlineMenu(ev: MouseEvent): void {
	os.popupMenu(outline.value.map((item, i) => ({
		text: `${outlineLabel(item, i)} (${number(item.chars)})`,
		icon: outlineIcon(item),
		action: () => jumpTo(item.pos),
	})), ev.currentTarget ?? ev.target);
}
//#endregion

//#region 作品
function newWork(): void {
	createWork();
}

async function removeWork(work: NovelWork): Promise<void> {
	const { canceled } = await os.confirm({
		type: 'warning',
		text: i18n.tsx._juice.novelEditorDeleteWorkConfirm({ title: work.title || i18n.ts._juice.novelEditorUntitled }),
	});
	if (canceled) return;
	deleteWork(work.id);
}

function openWorksMenu(ev: MouseEvent): void {
	os.popupMenu([
		...sortedWorks.value.map(work => ({
			type: 'radioOption' as const,
			text: work.title || i18n.ts._juice.novelEditorUntitled,
			active: work.id === currentWorkId.value,
			action: () => selectWork(work.id),
		})),
		{ type: 'divider' },
		{ text: i18n.ts._juice.novelEditorNewWork, icon: 'ti ti-plus', action: newWork },
		{ text: i18n.ts._juice.novelEditorDeleteWork, icon: 'ti ti-trash', danger: true, action: () => removeWork(currentWork.value) },
	], ev.currentTarget ?? ev.target);
}

// .txtを読み込んで、新しい作品として開く(文字コードはUTF-8・Shift_JIS・EUC-JPを判定する)
function openWorkFromText(name: string, buffer: ArrayBuffer): void {
	const text = decodeTextFile(buffer).replace(/\r\n/g, '\n');
	createWork({ title: name.replace(/\.txt$/i, ''), text });
	os.toast(i18n.ts._juice.novelEditorImported);
}

function isTextFile(name: string, type: string): boolean {
	return isNovelTextFile({ name, type });
}

function importFromDevice(): void {
	const input = window.document.createElement('input');
	input.type = 'file';
	input.accept = '.txt,text/plain';
	input.onchange = async () => {
		const file = input.files?.[0];
		if (file == null) return;
		if (!isTextFile(file.name, file.type)) {
			os.alert({ type: 'error', text: i18n.ts._juice.novelEditorImportNotText });
			return;
		}
		openWorkFromText(file.name, await file.arrayBuffer());
	};
	input.click();
}

async function importFromDrive(): Promise<void> {
	const [file] = await chooseDriveFile({ multiple: false });
	if (file == null) return;
	if (!isTextFile(file.name, file.type)) {
		os.alert({ type: 'error', text: i18n.ts._juice.novelEditorImportNotText });
		return;
	}
	const buffer = await os.promiseDialog((async () => {
		const res = await window.fetch(file.url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return await res.arrayBuffer();
	})());
	if (buffer != null) openWorkFromText(file.name, buffer);
}

function openImportMenu(ev: MouseEvent): void {
	os.popupMenu([{
		text: i18n.ts.upload,
		icon: 'ti ti-upload',
		action: importFromDevice,
	}, {
		text: i18n.ts.fromDrive,
		icon: 'ti ti-cloud',
		action: importFromDrive,
	}], ev.currentTarget as HTMLElement);
}
//#endregion

//#region 集中モード
// 入力欄だけを画面いっぱいに出す。ブラウザが対応していれば、ブラウザ自体も全画面にする
const focusMode = ref(false);

function enterFocus(): void {
	focusMode.value = true;
	const root = window.document.documentElement;
	if (typeof root.requestFullscreen === 'function' && window.document.fullscreenElement == null) {
		root.requestFullscreen().catch(() => { /* 対応していない・拒否された場合は画面の中だけで広げる */ });
	}
	window.setTimeout(() => view?.focus(), 0);
}

function exitFocus(): void {
	focusMode.value = false;
	if (window.document.fullscreenElement != null) {
		window.document.exitFullscreen().catch(() => { /* 既に解除されている */ });
	}
}

function toggleFocus(): void {
	if (focusMode.value) exitFocus();
	else enterFocus();
}

// Escキー等でブラウザの全画面が解除されたら、集中モードも終える
function onFullscreenChange(): void {
	if (window.document.fullscreenElement == null && focusMode.value) focusMode.value = false;
}

// ブラウザの全画面に対応していない環境(iPhoneのSafari等)でも、Escキーで集中モードを終えられるようにする。
// 入力欄の中でEscを使う操作(検索の欄を閉じる等)が先に処理したときは何もしない
function onFocusKeydown(ev: KeyboardEvent): void {
	if (ev.key === 'Escape' && focusMode.value && !ev.defaultPrevented) exitFocus();
}

watch(focusMode, (on) => {
	if (on) window.addEventListener('keydown', onFocusKeydown);
	else window.removeEventListener('keydown', onFocusKeydown);
});

// ページはKeepAliveで残るので、集中モードのまま別のページへ移ったら終える(入力欄が画面いっぱいに残らないように)
onDeactivated(() => {
	if (focusMode.value) exitFocus();
});
//#endregion

//#region プレビュー・保存・投稿
// 狭い画面では、プレビューをウインドウで開く(書いている間もそのまま反映される)
function openPreview(): void {
	os.pageWindow('/novel-editor/preview');
}

function fileName(): string {
	const name = currentWork.value.title.trim() || i18n.ts._juice.novelEditorUntitled;
	return `${name.replace(/[\\/:*?"<>|]/g, '_')}.txt`;
}

function textBlob(): Blob {
	return new Blob([currentWork.value.text], { type: 'text/plain' });
}

function downloadText(): void {
	const url = URL.createObjectURL(textBlob());
	const a = window.document.createElement('a');
	a.href = url;
	a.download = fileName();
	a.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 本文を.txtにしてドライブへ上げ、小説フラグを付けて、投稿フォームに添付する(投稿自体にも小説フラグが付く)
async function postNovel(): Promise<void> {
	// 投稿前のチェックで気になるところがあれば、先に知らせる
	const issues = checkNovelText(currentWork.value.text);
	if (issues.length > 0) {
		// 本文の抜き出しに記法が含まれるので、MFMとして解釈させない
		const shown = issues.slice(0, 5).map(issue => `・<plain>${novelCheckIssueText(issue)}</plain>`);
		if (issues.length > 5) shown.push(i18n.tsx._juice.novelEditorCheckMore({ n: issues.length - 5 }));
		const { canceled } = await os.confirm({
			type: 'warning',
			title: i18n.ts._juice.novelEditorCheck,
			text: shown.join('\n'),
			okText: i18n.ts._juice.novelEditorPostAnyway,
		});
		if (canceled) return;
	}
	const file = await os.promiseDialog((async () => {
		const uploaded = await uploadFile(textBlob(), { name: fileName() }).filePromise;
		return await misskeyApi('drive/files/update', { fileId: uploaded.id, isNovel: true });
	})());
	if (file == null) return;
	os.post({ initialFiles: [file], initialText: currentWork.value.title.trim() });
}
//#endregion

// 作品一覧・目次を横に出さないときはヘッダーのボタンから出す。スマホほど狭いときは名前付きのメニューにまとめる
const headerActions = computed(() => collapseHeaderActions(showSidebar.value ? [] : [{
	icon: 'ti ti-books',
	text: i18n.ts._juice.novelEditorWorks,
	handler: openWorksMenu,
}, {
	icon: 'ti ti-list',
	text: i18n.ts._juice.novelViewerToc,
	handler: openOutlineMenu,
}], rootWidth.value < 600));

definePage(() => ({
	title: i18n.ts._juice.novelEditor,
	icon: 'ti ti-writing',
}));
</script>

<style lang="scss" module>
.root {
	// JUICE: 画面全体を見えている高さに収め、本文・作品一覧・プレビューはそれぞれの中でスクロールする。
	// ごく低い画面では入力欄が潰れないよう、下限を設けてページ全体をスクロールさせる
	height: calc(100cqh - var(--MI-stickyTop, 0px) - var(--MI-stickyBottom, 0px));
	min-height: 480px;
	padding: 16px;
	box-sizing: border-box;
}

.layout {
	display: grid;
	grid-template-columns: minmax(0, 1fr);
	grid-template-rows: minmax(0, 1fr);
	gap: 16px;
	height: 100%;
	max-width: 900px;
	margin: 0 auto;

	&.withSidebar {
		grid-template-columns: 220px minmax(0, 1fr);
		max-width: 1200px;
	}

	&.withSidebar.withPreview {
		grid-template-columns: 220px minmax(0, 1fr) minmax(0, 1fr);
		max-width: none;
	}
}

.sidebar {
	display: flex;
	flex-direction: column;
	gap: 16px;
	min-width: 0;
	min-height: 0;
	overflow-y: auto;
}

.sideSection {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.sideHeader {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0 4px;
	font-size: 0.9em;
	font-weight: bold;
	opacity: 0.8;
}

.sideHeaderButton {
	padding: 4px 6px;
	border-radius: 6px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.workList {
	display: flex;
	flex-direction: column;
	gap: 2px;
	max-height: 40vh;
	overflow-y: auto;
}

.workItem {
	display: flex;
	align-items: center;
	border-radius: 6px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.workItemActive {
	background: color(from var(--MI_THEME-accent) srgb r g b / 0.15);

	&:hover {
		background: color(from var(--MI_THEME-accent) srgb r g b / 0.2);
	}
}

.workItemMain {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-width: 0;
	padding: 6px 8px;
	text-align: left;
}

.workTitle {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.workMeta {
	font-size: 0.75em;
	opacity: 0.7;
}

.workItemDelete {
	padding: 6px 8px;
	opacity: 0.5;

	&:hover {
		opacity: 1;
		color: var(--MI_THEME-error);
	}
}

.outline {
	display: flex;
	flex-direction: column;
	gap: 2px;
}

.outlineItem {
	display: flex;
	align-items: center;
	gap: 8px;
	padding: 6px 8px;
	border-radius: 6px;
	font-size: 0.9em;
	text-align: left;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.outlineTitle {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.outlineChars {
	font-size: 0.85em;
	opacity: 0.6;
}

.main {
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-width: 0;
	min-height: 0;
}

.editor {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-height: 200px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
	overflow: clip;
	container-type: inline-size;
}

// 集中モード: 画面いっぱいに入力欄だけを出し、入力欄の中でスクロールする
.editorFocus {
	position: fixed;
	inset: 0;
	z-index: 10000;
	border: none;
	border-radius: 0;
	background: var(--MI_THEME-bg);

	.editorBody :global(.cm-content) {
		max-width: 800px;
		margin: 0 auto;
	}
}

.toolbar {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 2px;
	padding: 6px 8px;
	border-bottom: solid 1px var(--MI_THEME-divider);
	background: var(--MI_THEME-panel);

}

.toolButton {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 6px 8px;
	border-radius: 6px;
	font-size: 0.9em;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	// JUICE: 狭い画面(スマホ等)ではツールチップが出ないので、アイコンの下に小さく名前を出す
	@container (max-width: 800px) {
		flex-direction: column;
		flex-shrink: 0;
		justify-content: center;
		gap: 1px;
		min-width: 44px;
		padding: 4px 4px 2px;
	}
}

.toolLabel,
.toolLabelNarrow {
	@container (max-width: 800px) {
		font-size: 9px;
		line-height: 1.2;
		white-space: nowrap;
		opacity: 0.8;
	}
}

// 広い画面ではツールチップで分かるので、アイコンだけのボタンの名前は出さない
.toolLabelNarrow {
	display: none;

	@container (max-width: 800px) {
		display: block;
	}
}

.toolSeparator {
	width: 1px;
	height: 20px;
	margin: 0 4px;
	background: var(--MI_THEME-divider);
}

.toolSpacer {
	flex: 1;
}

// 狭い画面ではボタンを2列に折り返すので、右寄せや区切り線を入れず順に並べる
.toolSpacer,
.toolSeparator {
	@container (max-width: 800px) {
		display: none;
	}
}

.editorBody {
	flex: 1;
	min-height: 0;

	// CodeMirrorの入力欄を枠いっぱいに広げ、長くなったら入力欄の中でスクロールする
	:global(.cm-editor) {
		height: 100%;
	}

	:global(.cm-scroller) {
		overflow: auto;
	}
}

.stats {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px 16px;
	padding: 6px 12px;
	border-top: solid 1px var(--MI_THEME-divider);
	font-size: 0.85em;
	opacity: 0.85;
}

.goal {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	margin-left: auto;
	padding: 2px 6px;
	border-radius: 6px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.goalBar {
	position: relative;
	width: 80px;
	height: 6px;
	border-radius: 3px;
	background: var(--MI_THEME-divider);
	overflow: hidden;
}

.goalBarFill {
	position: absolute;
	inset: 0 auto 0 0;
	background: var(--MI_THEME-accent);
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

// 投稿は右端に置く
.actionsSpacer {
	flex: 1;
}

.caption {
	font-size: 0.85em;
	opacity: 0.7;
}

// 横に並べたプレビューは、枠の高さに収めて中でスクロールする
.preview {
	min-width: 0;
	min-height: 0;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	overflow: hidden;
	container-type: size;
}

// プレビューの中のヘッダーが、外側のページのヘッダーの高さ分だけずれないようにする。
// 狭い枠の中なので、ビューワーの上下・左右の余白も詰める
.previewInner {
	--MI-stickyTop: 0px;
	--MI-stickyBottom: 0px;
	--MI_SPACER-max: 12px;
	--MI-margin: 0px;
	height: 100%;
}
</style>
