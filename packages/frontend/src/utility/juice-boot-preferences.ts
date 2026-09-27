/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: 設定のバックアップ・復元で戻らなかった設定を、プロファイル(prefer)に持たせる。
// - 言語・文字の大きさ・システムフォント・カスタムCSSは、起動の最初(アプリより前、public/loader/boot.js)に
//   localStorageから当てるので、localStorageにも置いたまま、プロファイルにも同じ値を持つ。
//   復元などでプロファイルの値の方が変わっていたら、起動時にlocalStorageへ写して読み込み直す
// - 小説ビューワー・小説エディター・絵チャの表示の好みは、プロファイルへ移す(前の保存先の値は最初に1回だけ取り込む)

import { langs } from '@@/js/config.js';
import { miLocalStorage } from '@/local-storage.js';
import { prefer } from '@/preferences.js';
import { store } from '@/store.js';

type BootKey = 'juiceLang' | 'juiceFontSize' | 'juiceUseSystemFont' | 'juiceCustomCss';

// プロファイルの値と、localStorageでの表し方の対応
const BOOT_PREFERENCES: { [K in BootKey]: { read: () => Exclude<typeof prefer.s[K], 'unset'>; write: (value: Exclude<typeof prefer.s[K], 'unset'>) => void } } = {
	juiceLang: {
		read: () => miLocalStorage.getItem('lang') ?? '',
		write: value => (value === '' ? miLocalStorage.removeItem('lang') : miLocalStorage.setItem('lang', value)),
	},
	juiceFontSize: {
		read: () => (miLocalStorage.getItem('fontSize') ?? '') as '' | '1' | '2' | '3',
		write: value => (value === '' ? miLocalStorage.removeItem('fontSize') : miLocalStorage.setItem('fontSize', value)),
	},
	juiceUseSystemFont: {
		read: () => miLocalStorage.getItem('useSystemFont') != null,
		write: value => (value ? miLocalStorage.setItem('useSystemFont', 't') : miLocalStorage.removeItem('useSystemFont')),
	},
	juiceCustomCss: {
		read: () => miLocalStorage.getItem('customCss') ?? '',
		write: value => (value === '' ? miLocalStorage.removeItem('customCss') : miLocalStorage.setItem('customCss', value)),
	},
};

/**
 * 設定画面から変えたとき: localStorage(起動時に使う)とプロファイル(バックアップに入る)の両方に書く
 */
export function setBootPreference<K extends BootKey>(key: K, value: Exclude<typeof prefer.s[K], 'unset'>): void {
	BOOT_PREFERENCES[key].write(value);
	if (prefer.s[key] !== value) prefer.commit(key, value);
}

const SYNC_RELOAD_KEY = 'juice:bootPreferencesReloaded';

// プロファイルの値を、そのまま起動時に当てられるか。言語は、このサーバーのビルドに無いもの(別のサーバーのバックアップ等)や空だと、
// 起動処理(boot.js)がブラウザの言語で上書きしてしまい、起動のたびに食い違うので、当てずに今の値を取り込み直す
function isApplicable(key: BootKey, value: unknown): boolean {
	if (key !== 'juiceLang') return true;
	return typeof value === 'string' && langs.some(([code]) => code === value);
}

/**
 * 起動時: プロファイルに無ければ今のlocalStorageの値を取り込み、違っていればプロファイルの値をlocalStorageへ写す。
 * 写したら、起動の最初から当て直すため読み込み直す(うまく写せずに繰り返さないよう、続けては1回まで)。
 * 読み込み直すならtrueを返す(呼んだ側は、それ以上起動の処理を進めない)
 */
export function syncBootPreferences(): boolean {
	let changed = false;
	for (const key of Object.keys(BOOT_PREFERENCES) as BootKey[]) {
		const { read, write } = BOOT_PREFERENCES[key] as { read: () => unknown; write: (value: unknown) => void };
		const saved = prefer.s[key];
		const current = read();
		if (saved === 'unset' || !isApplicable(key, saved)) {
			if (saved !== current) prefer.commit(key, current as never);
		} else if (saved !== current) {
			write(saved);
			changed = true;
		}
	}
	let reloadedJustNow = false;
	try {
		reloadedJustNow = window.sessionStorage.getItem(SYNC_RELOAD_KEY) === '1';
		window.sessionStorage.removeItem(SYNC_RELOAD_KEY);
	} catch { /* sessionStorageが使えなければ、読み込み直しは1回だけにできないので読み込み直さない */
		return false;
	}
	if (!changed || reloadedJustNow) return false;
	try {
		window.sessionStorage.setItem(SYNC_RELOAD_KEY, '1');
	} catch {
		return false;
	}
	window.location.reload();
	return true;
}

/**
 * 前の保存先(端末ごとのstore・localStorage)にあった表示の好みを、プロファイルへ1回だけ取り込む。
 * 取り込んだかどうかはプロファイルの中に持つ(前の保存先の値は消さずに残す)。store.readyの後に呼ぶ
 */
export function migrateJuiceLocalPreferences(): void {
	if (prefer.s.juiceLocalPreferencesMigrated) return;

	// 小説ビューワー(storeの'device')
	for (const key of [
		'novelViewerWritingMode', 'novelViewerFontSize', 'novelViewerTheme', 'novelViewerParagraphIndent',
		'novelViewerAozoraNotation', 'novelViewerFontFamily', 'novelViewerCustomTextColor', 'novelViewerCustomBgColor',
	] as const) {
		const value = store.s[key];
		if (value !== prefer.s[key]) prefer.commit(key, value as never);
	}

	// 小説エディター(localStorageのJSON)。形が正しいかは、読み込むnovel-draft.tsで確かめる
	try {
		const raw = window.localStorage.getItem('juice:novelEditorSettings');
		if (raw != null && prefer.s.novelEditorSettings == null) prefer.commit('novelEditorSettings', JSON.parse(raw));
	} catch { /* 読めなければ初期設定のまま */ }

	// 絵チャ(localStorage)
	const readLocal = (key: string) => {
		try {
			return window.localStorage.getItem(key);
		} catch {
			return null;
		}
	};
	const bool = (raw: string | null) => (raw === 'true' ? true : raw === 'false' ? false : null);
	const num = (raw: string | null) => (raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null);
	const drawRoom = [
		['drawRoomShowCursors', bool(readLocal('juice:drawRoom:showCursors'))],
		['drawRoomCursorOpacity', num(readLocal('juice:drawRoom:cursorOpacity'))],
		['drawRoomSideHidden', bool(readLocal('juice:drawRoom:sideHidden'))],
		['drawRoomSideWidth', num(readLocal('juice:drawRoom:sideWidth'))],
		['drawRoomLayersRatio', num(readLocal('juice:drawRoom:layersRatio'))],
		['drawRoomWheelZoom', bool(readLocal('juice:drawRoom:wheelZoom'))],
		['drawRoomDotView', bool(readLocal('juice:drawRoom:dotView'))],
	] as const;
	for (const [key, value] of drawRoom) {
		if (value != null && value !== prefer.s[key]) prefer.commit(key, value as never);
	}
	const format = readLocal('juice:drawRoom:imageFormat');
	if ((format === 'png' || format === 'webp' || format === 'jpeg') && format !== prefer.s.drawRoomImageFormat) prefer.commit('drawRoomImageFormat', format);

	prefer.commit('juiceLocalPreferencesMigrated', true);
}
