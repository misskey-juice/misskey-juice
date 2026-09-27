/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 小説エディターの下書き(作品ごと)と、エディターの表示設定。このブラウザに自動で保存し、
// エディターとプレビュー(小説ビューワー)で共有する(プレビューを開いたまま書くと、そのまま反映される)

import { computed, reactive, ref, watch } from 'vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';

const WORKS_STORAGE_KEY = 'juice:novelEditorWorks';
const CURRENT_STORAGE_KEY = 'juice:novelEditorCurrentWork';

export type NovelWork = {
	id: string;
	title: string;
	text: string;
	// 目標文字数(決めていなければnull)
	goal: number | null;
	createdAt: number;
	updatedAt: number;
};

function newWorkId(): string {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function makeWork(init: Partial<Pick<NovelWork, 'title' | 'text'>> = {}): NovelWork {
	const now = Date.now();
	return { id: newWorkId(), title: init.title ?? '', text: init.text ?? '', goal: null, createdAt: now, updatedAt: now };
}

// 保存してある作品の一覧を読む。読めない・空なら null
function parseWorks(raw: string | null): NovelWork[] | null {
	try {
		const saved = JSON.parse(raw ?? 'null');
		if (!Array.isArray(saved)) return null;
		const works = saved.filter(w => w != null && typeof w.id === 'string' && typeof w.title === 'string' && typeof w.text === 'string').map((w): NovelWork => ({
			id: w.id,
			title: w.title,
			text: w.text,
			goal: typeof w.goal === 'number' && w.goal > 0 ? w.goal : null,
			createdAt: typeof w.createdAt === 'number' ? w.createdAt : Date.now(),
			updatedAt: typeof w.updatedAt === 'number' ? w.updatedAt : Date.now(),
		}));
		return works.length > 0 ? works : null;
	} catch {
		return null;
	}
}

function loadWorks(): NovelWork[] {
	let raw: string | null = null;
	try {
		raw = window.localStorage.getItem(WORKS_STORAGE_KEY);
	} catch { /* 読めなければ空の作品から */ }
	return parseWorks(raw) ?? [makeWork()];
}

export const novelWorks = reactive<NovelWork[]>(loadWorks());

function loadCurrentId(): string {
	try {
		const id = window.localStorage.getItem(CURRENT_STORAGE_KEY);
		if (id != null && novelWorks.some(w => w.id === id)) return id;
	} catch { /* 読めなければ最近書いた作品 */ }
	return [...novelWorks].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
}

export const currentWorkId = ref(loadCurrentId());

// 今書いている作品。作品が1つも無くならないようにしているので、常にある
export const currentWork = computed(() => novelWorks.find(w => w.id === currentWorkId.value) ?? novelWorks[0]);

// JUICE: 保存に失敗した(容量不足など)ときは、エディターに知らせる
export const novelSaveFailed = ref(false);

// 打つたびに書き込むと重いので、少し待ってから作品をまとめて保存する
let saveTimer: number | null = null;

function saveNow(): void {
	saveTimer = null;
	try {
		window.localStorage.setItem(WORKS_STORAGE_KEY, JSON.stringify(novelWorks));
		window.localStorage.setItem(CURRENT_STORAGE_KEY, currentWorkId.value);
		novelSaveFailed.value = false;
	} catch {
		novelSaveFailed.value = true;
	}
}

function scheduleSave(): void {
	if (saveTimer != null) window.clearTimeout(saveTimer);
	saveTimer = window.setTimeout(saveNow, 500);
}

watch(novelWorks, scheduleSave, { deep: true });
watch(currentWorkId, scheduleSave);

// JUICE: 別のタブで保存されたら取り込む(取り込まずにこのタブの古い一覧で上書きすると、あちらで書いた分が消えるため)。
// 作品ごとに新しい方を残し、あちらで消された作品は消す(こちらで、あちらの最後の保存より後に書いたものは残す)
function mergeSavedWorks(incoming: NovelWork[]): void {
	const newestIncoming = Math.max(...incoming.map(w => w.updatedAt));
	const incomingIds = new Set(incoming.map(w => w.id));
	for (const work of incoming) {
		const local = novelWorks.find(w => w.id === work.id);
		if (local == null) novelWorks.push(work);
		else if (work.updatedAt > local.updatedAt) Object.assign(local, work);
	}
	for (let i = novelWorks.length - 1; i >= 0; i--) {
		if (!incomingIds.has(novelWorks[i].id) && novelWorks[i].updatedAt <= newestIncoming) novelWorks.splice(i, 1);
	}
	if (novelWorks.length === 0) novelWorks.push(makeWork());
	if (!novelWorks.some(w => w.id === currentWorkId.value)) currentWorkId.value = [...novelWorks].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
}

window.addEventListener('storage', (ev) => {
	if (ev.key !== WORKS_STORAGE_KEY) return;
	const incoming = parseWorks(ev.newValue);
	if (incoming != null) mergeSavedWorks(incoming);
});

// ページを閉じるときは、待っている分をすぐ保存する
window.addEventListener('pagehide', () => {
	if (saveTimer != null) {
		window.clearTimeout(saveTimer);
		saveNow();
	}
});

export function updateCurrentWork(patch: Partial<Pick<NovelWork, 'title' | 'text' | 'goal'>>): void {
	Object.assign(currentWork.value, patch, { updatedAt: Date.now() });
}

export function createWork(init?: Partial<Pick<NovelWork, 'title' | 'text'>>): NovelWork {
	const work = makeWork(init);
	novelWorks.unshift(work);
	currentWorkId.value = work.id;
	return work;
}

export function selectWork(id: string): void {
	if (novelWorks.some(w => w.id === id)) currentWorkId.value = id;
}

export function deleteWork(id: string): void {
	const index = novelWorks.findIndex(w => w.id === id);
	if (index === -1) return;
	novelWorks.splice(index, 1);
	// 最後の1つを消したら、空の作品を用意する
	if (novelWorks.length === 0) novelWorks.push(makeWork());
	if (currentWorkId.value === id) currentWorkId.value = [...novelWorks].sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
}

// JUICE: エディターの表示・入力の設定。バックアップ・復元で戻るよう、プロファイル(prefer)に持つ
// (以前はlocalStorageにあった。前の値はjuice-boot-preferences.tsで1回だけ取り込む)
export type NovelEditorSettings = {
	fontFamily: 'default' | 'mincho' | 'gothic';
	fontSize: number;
	lineHeight: number;
	// 改行したら段落の頭に全角スペースを入れる
	autoIndent: boolean;
	// 「などを打ったら、閉じ括弧も入れる
	autoCloseBrackets: boolean;
	// 書いている行を画面の真ん中に保つ
	typewriter: boolean;
	// 広い画面では、エディターの横にプレビューを並べる
	sidePreview: boolean;
};

const DEFAULT_SETTINGS: NovelEditorSettings = {
	fontFamily: 'default',
	fontSize: 16,
	lineHeight: 1.9,
	autoIndent: false,
	autoCloseBrackets: true,
	typewriter: false,
	sidePreview: true,
};

function loadSettings(): NovelEditorSettings {
	try {
		// 形が正しいものだけを使う(プロファイルは読み込み・復元で書き換えられうるため)
		const saved = prefer.s.novelEditorSettings as Partial<Record<keyof NovelEditorSettings, unknown>> | null;
		if (saved != null && typeof saved === 'object') {
			const result = { ...DEFAULT_SETTINGS };
			if (saved.fontFamily === 'default' || saved.fontFamily === 'mincho' || saved.fontFamily === 'gothic') result.fontFamily = saved.fontFamily;
			if (typeof saved.fontSize === 'number' && saved.fontSize >= 12 && saved.fontSize <= 32) result.fontSize = saved.fontSize;
			if (typeof saved.lineHeight === 'number' && saved.lineHeight >= 1.2 && saved.lineHeight <= 3) result.lineHeight = saved.lineHeight;
			for (const key of ['autoIndent', 'autoCloseBrackets', 'typewriter', 'sidePreview'] as const) {
				if (typeof saved[key] === 'boolean') result[key] = saved[key];
			}
			return result;
		}
	} catch { /* 読めなければ初期設定 */ }
	return { ...DEFAULT_SETTINGS };
}

export const novelEditorSettings = reactive<NovelEditorSettings>(loadSettings());

watch(novelEditorSettings, () => {
	prefer.commit('novelEditorSettings', { ...novelEditorSettings });
}, { deep: true });

// 別のタブで変えた・プロファイルを読み込んだなど、プロファイルの方が変わったら取り込む(古い値で上書きしないように)
watch(prefer.r.novelEditorSettings, () => {
	Object.assign(novelEditorSettings, loadSettings());
});

// JUICE: 文字数(空白・改行と、ルビのよみ・注記などの記法は数えない)
export function countNovelChars(text: string): number {
	return [...stripNovelNotation(text).replace(/\s/g, '')].length;
}

// JUICE: 400字詰め原稿用紙に換算した枚数。1行20字で、段落(改行)ごとに新しい行から書く
export function countManuscriptPages(text: string): number {
	const paragraphs = stripNovelNotation(text).replace(/\r\n/g, '\n').split('\n');
	// 末尾の空行は数えない
	while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1].trim() === '') paragraphs.pop();
	if (paragraphs.length === 0) return 0;
	let lines = 0;
	for (const paragraph of paragraphs) lines += Math.max(1, Math.ceil([...paragraph].length / 20));
	return Math.ceil(lines / 20);
}

// 小説ビューワーの数え方に合わせて、表示されない記法・記号を取り除く
function stripNovelNotation(text: string): string {
	return text
		// 青空文庫形式の冒頭の凡例ブロック(罫線で挟まれた「テキスト中に現れる記号について」)
		.replace(/^-{3,}\n([\s\S]*?)\n-{3,}\n?/m, (m, inner: string) => (inner.includes('テキスト中に現れる記号について') ? '' : m))
		// ルビ(pixiv形式・MFM・青空文庫形式)は基底の文字だけ残す
		.replace(/\[\[rb:\s*([^>\]]+?)\s*>[^\]]*\]\]/g, '$1')
		.replace(/\$\[ruby ([^\s\]]+) [^\]]+\]/g, '$1')
		.replace(/[｜|＊*]([^｜|＊*《\n]+)《[^》\n]+》/g, '$1')
		.replace(/《[^》\n]+》/g, '')
		// pixiv小説のリンクは表示名だけ、ページ移動・画像は表示されない
		.replace(/\[\[jumpuri:\s*([^>\]]+?)\s*>\s*[^\]]*\]\]/g, '$1')
		.replace(/\[(?:jump|pixivimage):[^\]]*\]/g, '')
		// 章タイトルは中身だけ、改ページ・区切り線・注記は数えない
		.replace(/\[chapter:\s*([^\]]*)\]/g, '$1')
		.replace(/^[ \t\u3000]*\[newpage\][ \t\u3000]*$/gm, '')
		.replace(/^-{3,}$/gm, '')
		.replace(/［＃[^］]*］/g, '')
		// 太字・打ち消し線・斜体の記号
		.replace(/\*\*(?!\s)([^\n]+?)(?<!\s)\*\*/g, '$1')
		.replace(/~~(?!\s)([^\n]+?)(?<!\s)~~/g, '$1')
		.replace(/\*(?![\s*])([^*\n]+?)(?<!\s)\*/g, '$1');
}

// JUICE: 投稿前のチェック(ドキュメントの「投稿前のチェックリスト」のうち、本文から確かめられるもの)
export type NovelCheckIssue = {
	kind:
		| 'rubyBase' | 'rubyNoBase' | 'rubySyntax' | 'decoration' | 'firstChapterTitle' | 'emptyChapter'
		| 'bracketUnclosed' | 'bracketStray' | 'ellipsisSingle' | 'ellipsisDots' | 'dashSingle' | 'exclamationSpace'
		| 'annotationUnclosed' | 'indentUnclosed' | 'annotationUnsupported' | 'annotationNewPage' | 'newpageInline';
	line: number;
	excerpt: string;
};

const KANJI = /[一-鿿々〆ヶ]/;
const RUBY_MARKERS = /[｜|＊*]/;

export function novelCheckIssueText(issue: NovelCheckIssue): string {
	switch (issue.kind) {
		case 'rubyNoBase': return i18n.tsx._juice.novelEditorCheckRubyNoBase({ line: issue.line, text: issue.excerpt });
		case 'rubyBase': return i18n.tsx._juice.novelEditorCheckRubyBase({ line: issue.line, text: issue.excerpt });
		case 'decoration': return i18n.tsx._juice.novelEditorCheckDecoration({ line: issue.line, text: issue.excerpt });
		case 'firstChapterTitle': return i18n.ts._juice.novelEditorCheckFirstChapterTitle;
		case 'rubySyntax': return i18n.tsx._juice.novelEditorCheckRubySyntax({ line: issue.line, text: issue.excerpt });
		case 'emptyChapter': return i18n.tsx._juice.novelEditorCheckEmptyChapter({ line: issue.line });
		case 'bracketUnclosed': return i18n.tsx._juice.novelEditorCheckBracketUnclosed({ line: issue.line, text: issue.excerpt });
		case 'bracketStray': return i18n.tsx._juice.novelEditorCheckBracketStray({ line: issue.line, text: issue.excerpt });
		case 'ellipsisSingle': return i18n.tsx._juice.novelEditorCheckEllipsisSingle({ line: issue.line, text: issue.excerpt });
		case 'ellipsisDots': return i18n.tsx._juice.novelEditorCheckEllipsisDots({ line: issue.line, text: issue.excerpt });
		case 'dashSingle': return i18n.tsx._juice.novelEditorCheckDashSingle({ line: issue.line, text: issue.excerpt });
		case 'exclamationSpace': return i18n.tsx._juice.novelEditorCheckExclamationSpace({ line: issue.line, text: issue.excerpt });
		case 'annotationUnclosed': return i18n.tsx._juice.novelEditorCheckAnnotationUnclosed({ line: issue.line, text: issue.excerpt });
		case 'indentUnclosed': return i18n.tsx._juice.novelEditorCheckIndentUnclosed({ line: issue.line, text: issue.excerpt });
		case 'annotationUnsupported': return i18n.tsx._juice.novelEditorCheckAnnotationUnsupported({ line: issue.line, text: issue.excerpt });
		case 'annotationNewPage': return i18n.tsx._juice.novelEditorCheckAnnotationNewPage({ line: issue.line });
		case 'newpageInline': return i18n.tsx._juice.novelEditorCheckNewpageInline({ line: issue.line });
	}
}

// 問題の箇所の前後を少しだけ抜き出す
function excerptAround(line: string, index: number, length: number): string {
	const start = Math.max(0, index - 6);
	const end = Math.min(line.length, index + length + 6);
	return (start > 0 ? '…' : '') + line.slice(start, end) + (end < line.length ? '…' : '');
}

// ビューワーが解釈できる青空文庫の注記
const SUPPORTED_ANNOTATION = /^［＃(?:(?:白ゴマ傍点|白丸傍点|丸傍点|傍点)(?:終わり)?|「[^」]+」に(?:白ゴマ傍点|白丸傍点|丸傍点|傍点)|ここから\d+字下げ|ここで字下げ終わり)］$/;
const BRACKET_PAIRS: Record<string, string> = { '「': '」', '『': '』', '（': '）', '【': '】' };
const BRACKET_CLOSERS: Record<string, string> = { '」': '「', '』': '『', '）': '（', '】': '【' };

// JUICE: 別ウインドウのチェッカーから、エディターにその行へ移ってもらう(同じ行を続けて押しても移れるよう、押した時刻も持つ)
export const novelEditorJumpRequest = ref<{ line: number; at: number } | null>(null);

export function requestNovelEditorJump(line: number): void {
	novelEditorJumpRequest.value = { line, at: Date.now() };
}

export function checkNovelText(text: string): NovelCheckIssue[] {
	const issues: NovelCheckIssue[] = [];
	const lines = text.split('\n');
	// 青空文庫形式の冒頭の凡例ブロック(記法の説明なので調べない)の行の範囲
	const legend = legendRange(text);
	const legendFirstLine = legend == null ? -1 : text.slice(0, legend[0]).split('\n').length - 1;
	const legendLastLine = legend == null ? -1 : text.slice(0, legend[1]).split('\n').length - 1;
	// 括弧は会話文が複数の行にまたがることもあるので、本文全体で対応を見る
	const openBrackets: { ch: string; line: number; excerpt: string }[] = [];
	// 字下げの注記は複数の行にまたがるので、閉じるまで覚えておく
	let openIndent: { line: number; excerpt: string } | null = null;
	for (const [index, line] of lines.entries()) {
		const lineNo = index + 1;
		if (legend != null && index >= legendFirstLine && index < legendLastLine) continue;
		// 注記・ルビ記法の中の文字は、括弧などを調べる対象から外す
		const plain = line.replace(/［＃[^］]*］/g, m => '\u0000'.repeat(m.length)).replace(/\[\[rb:[^\]]*\]\]/g, m => '\u0000'.repeat(m.length));
		// 括弧の対応
		for (const [i, ch] of [...plain].entries()) {
			if (BRACKET_PAIRS[ch] != null) {
				openBrackets.push({ ch, line: lineNo, excerpt: excerptAround(line, i, 1) });
			} else if (BRACKET_CLOSERS[ch] != null) {
				const last = openBrackets.at(-1);
				if (last != null && last.ch === BRACKET_CLOSERS[ch]) openBrackets.pop();
				else issues.push({ kind: 'bracketStray', line: lineNo, excerpt: excerptAround(line, i, 1) });
			}
		}
		// 三点リーダー・ダッシュは2つ続けて使う(……・――)。中黒を並べた「・・・」は三点リーダーにする
		for (const m of plain.matchAll(/…+/g)) {
			if (m[0].length % 2 === 1) issues.push({ kind: 'ellipsisSingle', line: lineNo, excerpt: excerptAround(line, m.index, m[0].length) });
		}
		for (const m of plain.matchAll(/[・･]{2,}/g)) issues.push({ kind: 'ellipsisDots', line: lineNo, excerpt: excerptAround(line, m.index, m[0].length) });
		for (const m of plain.matchAll(/―+/g)) {
			if (m[0].length % 2 === 1) issues.push({ kind: 'dashSingle', line: lineNo, excerpt: excerptAround(line, m.index, m[0].length) });
		}
		// ！？の後に文が続くときは全角スペースを空ける(閉じ括弧・記号・行末・空白の前は不要)
		for (const m of plain.matchAll(/[！？]+(?=[^！？!?\s\u3000」』）】〉》…―、。\u0000])/g)) {
			issues.push({ kind: 'exclamationSpace', line: lineNo, excerpt: excerptAround(line, m.index, m[0].length) });
		}
		// 青空文庫の注記: 対応しているか、傍点(1行の中で閉じるもの)・字下げが閉じているか
		for (const m of line.matchAll(/［＃[^］]*］/g)) {
			const note = m[0];
			if (/^［＃改(?:ページ|丁|頁)］$/.test(note)) {
				issues.push({ kind: 'annotationNewPage', line: lineNo, excerpt: note });
			} else if (!SUPPORTED_ANNOTATION.test(note)) {
				issues.push({ kind: 'annotationUnsupported', line: lineNo, excerpt: note });
			} else if (/^［＃ここから\d+字下げ］$/.test(note)) {
				if (openIndent == null) openIndent = { line: lineNo, excerpt: note };
			} else if (note === '［＃ここで字下げ終わり］') {
				openIndent = null;
			}
		}
		for (const m of line.matchAll(/［＃(白ゴマ傍点|白丸傍点|丸傍点|傍点)］/g)) {
			if (!line.slice(m.index + m[0].length).includes(`［＃${m[1]}終わり］`)) issues.push({ kind: 'annotationUnclosed', line: lineNo, excerpt: excerptAround(line, m.index, m[0].length) });
		}
		// 改ページは、それだけの行にしないと効かない
		if (line.includes('[newpage]') && !/^[ \t\u3000]*\[newpage\][ \t\u3000]*$/.test(line)) {
			issues.push({ kind: 'newpageInline', line: lineNo, excerpt: '' });
		}
		// pixiv形式のルビは [[rb:基底 > よみ]] の形(>とよみが無い・閉じていないものはそのまま表示される)
		for (const m of line.matchAll(/\[\[rb:/g)) {
			const rest = line.slice(m.index);
			if (!/^\[\[rb:\s*[^>\]]+?\s*>\s*[^\]]+?\s*\]\]/.test(rest)) issues.push({ kind: 'rubySyntax', line: lineNo, excerpt: excerptAround(line, m.index, 10) });
		}
		// ルビ: ｜などで始まりを示していない《》は、直前に続く漢字だけにルビが付く
		for (const m of line.matchAll(/《([^》]+)》/g)) {
			const before = line.slice(0, m.index);
			// 同じ行の手前に、まだ閉じていない始まりの印があれば問題ない
			const lastMarker = Math.max(...[...before.matchAll(new RegExp(RUBY_MARKERS.source, 'g'))].map(x => x.index), -1);
			if (lastMarker !== -1 && !/[《》]/.test(before.slice(lastMarker))) continue;
			let run = 0;
			while (run < before.length && KANJI.test(before[before.length - 1 - run])) run++;
			const excerpt = line.slice(Math.max(0, m.index - 6), m.index + m[0].length);
			if (run === 0) {
				issues.push({ kind: 'rubyNoBase', line: lineNo, excerpt });
			} else {
				// 漢字のすぐ前に続くかなが、よみの中にもそのまま含まれているときは、かなも含む語全体に
				// ルビを振ろうとしている可能性が高い(例: 潮待ち便《しおまちびん》の「ち」、日の丸《ひのまる》の「の」)。
				// わたしの掌《てのひら》のように、前のかながよみに含まれないものは問題ない
				const kanaEnd = before.length - run;
				let kanaStart = kanaEnd;
				while (kanaStart > 0 && /[\u3041-\u309F\u30A0-\u30FF]/.test(before[kanaStart - 1])) kanaStart--;
				const kana = before.slice(kanaStart, kanaEnd);
				if (kana !== '' && m[1].includes(kana)) {
					issues.push({ kind: 'rubyBase', line: lineNo, excerpt });
				}
			}
		}
		// 太字・打ち消し線は1行の中で閉じているときだけ反映される
		const bold = line.match(/\*\*/g)?.length ?? 0;
		const strike = line.match(/~~/g)?.length ?? 0;
		if (bold % 2 === 1 || strike % 2 === 1) {
			issues.push({ kind: 'decoration', line: lineNo, excerpt: line.slice(0, 20) });
		}
	}
	for (const open of openBrackets) issues.push({ kind: 'bracketUnclosed', line: open.line, excerpt: open.excerpt });
	if (openIndent != null) issues.push({ kind: 'indentUnclosed', line: openIndent.line, excerpt: openIndent.excerpt });
	// 2章目以降に章タイトルがあるのに、1章目に無い(目次に「第1章」と出る)
	const outline = buildNovelOutline(text);
	// 中身の無い章(区切り・改ページが続いている等)。冒頭のタイトルの無い部分は、中身が無ければ章にならないので除く
	for (const [i, item] of outline.entries()) {
		if (item.chars > 0 || (i === 0 && item.kind === 'start' && item.title == null)) continue;
		issues.push({ kind: 'emptyChapter', line: text.slice(0, item.pos).split('\n').length, excerpt: '' });
	}
	if (outline.length > 1 && outline[0].title == null && outline[0].chars > 0 && outline.slice(1).some(item => item.title != null)) {
		issues.push({ kind: 'firstChapterTitle', line: 1, excerpt: '' });
	}
	return issues.sort((a, b) => a.line - b.line);
}

// JUICE: 目次。章タイトル・区切り線・改ページの位置と、そこから次の区切りまでの文字数
export type NovelOutlineItem = {
	kind: 'start' | 'chapter' | 'break' | 'page';
	title: string | null;
	// 本文の中の位置(文字の位置)
	pos: number;
	chars: number;
};

const OUTLINE_LINE_PATTERN = /^(?:[ \t\u3000]*\[newpage\][ \t\u3000]*|-{3,})$|\[chapter:\s*((?:\[\[rb:[^\]]*\]\]|[^\]\n])*?)\s*\]/gm;

// 青空文庫形式の冒頭の凡例ブロック(ビューワーでは取り除かれるので、中の罫線を章の区切りとして数えない)
function legendRange(text: string): [number, number] | null {
	const m = /^-{3,}\n([\s\S]*?)\n-{3,}\n?/m.exec(text);
	return m != null && m[1].includes('テキスト中に現れる記号について') ? [m.index, m.index + m[0].length] : null;
}

export function buildNovelOutline(text: string): NovelOutlineItem[] {
	const marks: Omit<NovelOutlineItem, 'chars'>[] = [{ kind: 'start', title: null, pos: 0 }];
	const legend = legendRange(text);
	for (const m of text.matchAll(OUTLINE_LINE_PATTERN)) {
		const pos = m.index;
		if (legend != null && pos >= legend[0] && pos < legend[1]) continue;
		if (m[1] != null) {
			const title = m[1].replace(/\[\[rb:\s*([^>\]]+?)\s*>[^\]]*\]\]/g, '$1').trim();
			// 区切りのすぐ後の章タイトルは、同じ章の題名として区切りにまとめる
			const last = marks[marks.length - 1];
			if (last.kind !== 'chapter' && last.title == null && text.slice(last.pos, pos).replace(/^(?:[ \t\u3000]*\[newpage\][ \t\u3000]*|-{3,})$/m, '').trim() === '') {
				last.title = title;
				if (last.kind === 'start') last.kind = 'chapter';
				continue;
			}
			marks.push({ kind: 'chapter', title, pos });
		} else {
			marks.push({ kind: m[0].includes('newpage') ? 'page' : 'break', title: null, pos });
		}
	}
	return marks.map((mark, i) => ({
		...mark,
		chars: countNovelChars(text.slice(mark.pos, marks[i + 1]?.pos ?? text.length)),
	}));
}
