/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as Misskey from 'misskey-js';
import { hemisphere } from '@@/js/intl-const.js';
import { DEFAULT_EMOJIS } from '@@/js/const.js';
import { prefersReducedMotion } from '@@/js/config.js';
import { definePreferences } from './manager.js';
import type { Theme } from '@@/js/theme.js';
import type { SoundType } from '@/utility/sound.js';
import type { Plugin } from '@/plugin.js';
import type { DeviceKind } from '@/utility/device-kind.js';
import type { DeckProfile } from '@/deck.js';
import type { WatermarkPreset } from '@/utility/watermark/WatermarkRenderer.js';
import type { ImageFramePreset } from '@/utility/image-frame-renderer/ImageFrameRenderer.js';
import { genId } from '@/utility/id.js';
import { DEFAULT_DEVICE_KIND } from '@/utility/device-kind.js';
import { deepEqual } from '@/utility/deep-equal.js';

/** サウンド設定 */
export type SoundStore = {
	type: Exclude<SoundType, '_driveFile_'>;
	volume: number;
} | {
	type: '_driveFile_';

	/** ドライブのファイルID */
	fileId: string;

	/** ファイルURL（こちらが優先される） */
	fileUrl: string;

	volume: number;
};

export type StatusbarStore = {
	name: string | null;
	id: string;
	type: string | null;
	size: 'verySmall' | 'small' | 'medium' | 'large' | 'veryLarge';
	black: boolean;
	props: Record<string, any>;
};

export type DataSaverStore = {
	media: boolean;
	avatar: boolean;
	urlPreviewThumbnail: boolean;
	disableUrlPreview: boolean;
	code: boolean;
};

type OmitStrict<T, K extends keyof T> = T extends any ? Pick<T, Exclude<keyof T, K>> : never;

// NOTE: デフォルト値は他の設定の状態に依存してはならない(依存していた場合、ユーザーがその設定項目単体で「初期値にリセット」した場合不具合の原因になる)

export const PREF_DEF = definePreferences({
	accounts: {
		default: [] as [host: string, user: {
			id: string;
			username: string;
		}][],
	},

	pinnedUserLists: {
		accountDependent: true,
		default: [] as Misskey.entities.UserList[],
	},
	uploadFolder: {
		accountDependent: true,
		default: null as string | null,
	},
	widgets: {
		accountDependent: true,
		default: () => [{
			name: 'calendar',
			id: genId(), place: 'right', data: {},
		}, {
			name: 'notifications',
			id: genId(), place: 'right', data: {},
		}, {
			name: 'trends',
			id: genId(), place: 'right', data: {},
		}] as {
			name: string;
			id: string;
			place: string | null;
			data: Record<string, any>;
		}[],
	},
	'deck.profile': {
		accountDependent: true,
		default: null as string | null,
	},
	'deck.profiles': {
		accountDependent: true,
		default: [] as DeckProfile[],
	},

	// JUICE: リレータイムラインを絞り込むリレーIDの一覧(空 = 絞り込みなし、全リレーを表示)
	relayTimelineFilter: {
		accountDependent: true,
		default: [] as string[],
	},

	// JUICE: メディアタイムラインが対象とするタイムライン範囲(ホーム/ローカル/ソーシャル/グローバル)
	mediaTimelineSrc: {
		accountDependent: true,
		default: 'local' as 'home' | 'local' | 'social' | 'global',
	},

	// JUICE: ライトボックス・メディアタイムラインのインライン再生で共通して使う音量(0-1)。
	// 一度調整すれば、以後どの動画/音声を開いても同じ音量になるようにするための端末ローカル設定
	mediaVolume: {
		default: 0.25,
	},

	// JUICE: 添付MIDIファイル再生時のピアノロール・鍵盤ビジュアライザーを表示するか。
	// 黒MIDI等ノート数が極端に多いファイルでは描画コスト自体を避けたい場合もあるため無効化できる
	midiVisualizerEnabled: {
		default: true,
	},

	// JUICE: ピアノロールが何秒ぶんを一画面に収めるか(小さいほどノートが速く流れる)。
	// 曲頭のテンポを基準に、テンポに依存しないtick軸のスクロール速度へ1回だけ変換して使う
	midiRollWindowSeconds: {
		default: 0.8,
	},

	// JUICE: MIDI再生時のFluidSynthの同時発音数上限(synth.polyphony)。既定はFluidSynth本体の
	// 既定値(256)に合わせてある。黒MIDI等で音が薄くなりやすい曲では上げると改善することがあるが、
	// 上げすぎるとAudioWorkletの実時間レンダリングが追いつかず逆に無音になることがある
	// (詳細はjuice-midi-player.tsのコメント参照)。設定画面のスライダーは32-640の範囲に収めている
	midiMaxPolyphony: {
		default: 256,
	},

	// JUICE: ノートの画面の「+」(リアクション)の右に、お気に入りのボタンを置く
	showFavoriteButtonInNoteFooter: {
		default: false,
	},

	// JUICE: ノートの画面の「+」の左に、決めたリアクションを1回で付けるボタンを置く
	showQuickReactionButton: {
		default: false,
	},

	// JUICE: 上のボタンで付けるリアクション(絵文字、またはカスタム絵文字の:name:)
	quickReaction: {
		default: '🧡',
	},

	// JUICE: リモートのカスタム絵文字のリアクションへの相乗り(と絵文字パレットへの追加)を自分でも使うか。
	// 管理者がJUICE設定で許可しているときだけ効く(utility/reaction-piggyback.ts)
	reactionPiggybackOnRemote: {
		default: true,
	},

	// JUICE: MFMの「○○ 検索」(検索窓)で使う検索エンジン(utility/juice-search-engines.tsのid、または'custom')
	mfmSearchEngine: {
		default: 'google' as import('@/utility/juice-search-engines.js').SearchEngineId,
	},

	// JUICE: 検索エンジンを'custom'にしたときの検索URL。検索語を入れる場所に{query}を書く
	mfmSearchEngineCustomUrl: {
		default: '',
	},

	// JUICE: 起動の最初(アプリより前)に当てるため、ブラウザのlocalStorageにも置く設定。
	// バックアップ・復元で戻るよう、プロファイルにも同じ値を持つ(起動時にlocalStorageと合わせる。utility/juice-boot-preferences.ts)。
	// 'unset' はまだプロファイルに無い(今のlocalStorageの値を取り込む)
	juiceLang: {
		default: 'unset' as 'unset' | string,
	},
	// 文字の大きさ(''は標準)
	juiceFontSize: {
		default: 'unset' as 'unset' | '' | '1' | '2' | '3',
	},
	juiceUseSystemFont: {
		default: 'unset' as 'unset' | boolean,
	},
	juiceCustomCss: {
		default: 'unset' as 'unset' | string,
	},

	// JUICE: 前の保存先(端末ごとのstore・localStorage)にあった表示の好みを、このプロファイルへ取り込んだか。
	// プロファイルの中に持つので、古い版のタブがプロファイルを上書きして取り込んだ値が消えたときは、もう一度取り込む
	juiceLocalPreferencesMigrated: {
		default: false,
	},
	// JUICE: 小説エディター・絵チャを、前からのナビゲーションバーにも1回だけ足したか(外した人には戻さない)
	juiceNavbarItemsAdded: {
		default: false,
	},
	// JUICE: 落書きを、前からのナビゲーションバーにも1回だけ足したか(外した人には戻さない)
	juiceNavbarDoodleAdded: {
		default: false,
	},
	// JUICE: 落書きのタイムラプスに重ねる、ウォーターマークのプリセット(画像のアップロードと同じプリセットから選ぶ。nullなら重ねない)
	juiceDoodleTimelapseWatermarkPresetId: {
		accountDependent: true,
		default: null as string | null,
	},

	// JUICE: ネコのアカウントの投稿の文字を置き換えない(nyaizeしない。ネコミミは出す。misskey-tempuraを参考)
	disableNoteNyaize: {
		default: false,
	},

	// JUICE: 投稿フォームで小説のtxtを添付したとき、初めからほかの人にダウンロードさせないようにする
	novelTextDownloadDisabledByDefault: {
		default: false,
	},

	// JUICE: 小説ビューワーの表示(以前は端末ごとのstoreにあった。バックアップ・復元で戻るようプロファイルへ移した)
	novelViewerWritingMode: {
		default: 'vertical' as 'vertical' | 'horizontal',
	},
	// 文字サイズ(em単位の倍率)
	novelViewerFontSize: {
		default: 1.1,
	},
	novelViewerTheme: {
		default: 'auto' as 'auto' | 'light' | 'sepia' | 'dark' | 'custom',
	},
	// 段落字下げ(行頭に全角スペースが無ければ自動で補う)
	novelViewerParagraphIndent: {
		default: true,
	},
	// 青空文庫記法変換(｜漢字《かんじ》のルビ、［＃ここからN字下げ］等)
	novelViewerAozoraNotation: {
		default: true,
	},
	novelViewerFontFamily: {
		default: 'default' as 'default' | 'mincho' | 'gothic',
	},
	// 縦書きで、半角の英単語を1文字ずつ縦に並べず、横向きのまま(90度回して)組み込む(2桁の数字は縦中横)
	novelViewerLatinSideways: {
		default: false,
	},
	// カスタムテーマ(novelViewerTheme: 'custom' のときに使う文字色・背景色)
	novelViewerCustomTextColor: {
		default: '#1a1a1a',
	},
	novelViewerCustomBgColor: {
		default: '#ffffff',
	},

	// JUICE: 小説エディターの表示・入力の設定(下書きの作品はこのブラウザだけに置き、ここには入れない)
	novelEditorSettings: {
		default: null as import('@/utility/novel-draft.js').NovelEditorSettings | null,
	},

	// JUICE: 絵チャの表示の好み
	drawRoomShowCursors: {
		default: true,
	},
	drawRoomCursorOpacity: {
		default: 1,
	},
	// レイヤーとチャットを右へしまっているか、その幅と、レイヤーとチャットの高さの割合
	drawRoomSideHidden: {
		default: false,
	},
	drawRoomSideWidth: {
		default: 340,
	},
	drawRoomLayersRatio: {
		default: 0.55,
	},
	// ホイールだけで拡大縮小するか(オフならホイールは移動、拡大縮小はCtrl+ホイール)
	drawRoomWheelZoom: {
		default: true,
	},
	// ピクセルアート拡大モード
	drawRoomDotView: {
		default: false,
	},
	// ペン・消しゴムの太さ(そのキャンバスで一番太い筆を100%とした割合。nullならキャンバスに合った太さから始める)と、濃さ(%)
	drawRoomPenSizePercent: {
		default: null as number | null,
	},
	drawRoomEraserSizePercent: {
		default: null as number | null,
	},
	drawRoomOpacity: {
		default: 100,
	},
	// 図形ツールの線の太さ(割合)と濃さ(ペンとは別に覚える)
	drawRoomShapeSizePercent: {
		default: null as number | null,
	},
	drawRoomShapeOpacity: {
		default: 100,
	},
	// 筆圧で太さを変えるか・濃さを変えるか(ペン・消しゴム)
	drawRoomPressureSize: {
		default: true,
	},
	drawRoomPressureOpacity: {
		default: false,
	},
	// カラーパレットに保存した色と、最近使った色
	drawRoomSavedColors: {
		default: [] as string[],
	},
	drawRoomRecentColors: {
		default: [] as string[],
	},
	// 塗りつぶし・線の中だけ塗るの隙間閉じ(この幅より狭い線の隙間は閉じているものとして塗る)
	drawRoomGapClose: {
		default: 'off' as 'off' | 'small' | 'medium' | 'large',
	},
	// 図形ツールの形(直線・四角・丸・三角)と、線だけ描くか中も塗るか
	drawRoomShapeKind: {
		default: 'rect' as 'line' | 'rect' | 'ellipse' | 'triangle',
	},
	drawRoomShapeFill: {
		default: 'outline' as 'outline' | 'fill',
	},
	// 線の本数・データ量・描き直しの時間などのデバッグ情報を、キャンバスの上に出す
	drawRoomShowDebugInfo: {
		default: false,
	},
	// 画像を保存する形式
	drawRoomImageFormat: {
		default: 'png' as 'png' | 'webp' | 'jpeg',
	},

	// JUICE: タイムラインページのタブバーから、閲覧者側の好みで個別に非表示にしたベーシックタイムライン
	// (ホーム/ローカル/ソーシャル/グローバル)およびリレー/メディアタイムラインのタブ一覧(空 = 全て表示)
	hiddenTimelineTabs: {
		accountDependent: true,
		default: [] as string[],
	},

	// JUICE: タイムラインページのタブバーの並び順(タブのkeyの配列)。並べ替えていない/新しく増えたタブは
	// この配列に含まれず、既定の並び順で末尾に追加される
	timelineTabOrder: {
		accountDependent: true,
		default: [] as string[],
	},

	emojiPalettes: {
		serverDependent: true,
		default: () => [{
			id: genId(),
			name: '',
			emojis: DEFAULT_EMOJIS,
		}] as {
			id: string;
			name: string;
			emojis: string[];
		}[],
		mergeStrategy: (a, b) => {
			const mergedItems = [] as typeof a;
			for (const x of a.concat(b)) {
				const sameIdItem = mergedItems.find(y => y.id === x.id);
				if (sameIdItem != null) {
					if (deepEqual(x, sameIdItem)) { // 完全な重複は無視
						continue;
					} else { // IDは同じなのに内容が違う場合はマージ不可とする
						throw new Error();
					}
				} else {
					mergedItems.push(x);
				}
			}
			return mergedItems;
		},
	},
	emojiPaletteForReaction: {
		serverDependent: true,
		default: null as string | null,
	},
	emojiPaletteForMain: {
		serverDependent: true,
		default: null as string | null,
	},

	overridedDeviceKind: {
		default: null as DeviceKind | null,
	},
	themes: {
		default: [] as Theme[],
		mergeStrategy: (a, b) => {
			const mergedItems = [] as typeof a;
			for (const x of a.concat(b)) {
				const sameIdItem = mergedItems.find(y => y.id === x.id);
				if (sameIdItem != null) {
					if (deepEqual(x, sameIdItem)) { // 完全な重複は無視
						continue;
					} else { // IDは同じなのに内容が違う場合はマージ不可とする
						throw new Error();
					}
				} else {
					mergedItems.push(x);
				}
			}
			return mergedItems;
		},
	},
	lightTheme: {
		default: null as Theme | null,
	},
	darkTheme: {
		default: null as Theme | null,
	},
	syncDeviceDarkMode: {
		default: true,
	},
	defaultNoteVisibility: {
		default: 'public' as (typeof Misskey.noteVisibilities)[number],
	},
	defaultNoteLocalOnly: {
		default: false,
	},
	keepCw: {
		default: true,
	},
	rememberNoteVisibility: {
		default: false,
	},
	reportError: {
		default: false,
	},
	collapseRenotes: {
		default: true,
	},
	menu: {
		default: [
			'notifications',
			'clips',
			'drive',
			'followRequests',
			'chat',
			'-',
			'explore',
			'announcements',
			'channels',
			'search',
			'-',
			// JUICE: 小説エディター・落書き・絵チャ
			'novelEditor',
			'doodle',
			'drawRoom',
			'-',
			'ui',
		],
	},
	statusbars: {
		default: [] as StatusbarStore[],
	},
	serverDisconnectedBehavior: {
		default: 'quiet' as 'quiet' | 'reload' | 'dialog',
	},
	nsfw: {
		default: 'respect' as 'respect' | 'force' | 'ignore',
	},
	highlightSensitiveMedia: {
		default: false,
	},
	animation: {
		default: !prefersReducedMotion,
	},
	animatedMfm: {
		default: !prefersReducedMotion,
	},
	advancedMfm: {
		default: true,
	},
	showReactionsCount: {
		default: false,
	},
	enableQuickAddMfmFunction: {
		default: false,
	},
	loadRawImages: {
		default: false,
	},
	imageNewTab: {
		default: false,
	},
	disableShowingAnimatedImages: {
		default: false,
	},
	emojiStyle: {
		default: 'twemoji' as 'native' | 'fluentEmoji' | 'twemoji',
	},
	menuStyle: {
		default: 'auto' as 'auto' | 'popup' | 'drawer',
	},
	useBlurEffectForModal: {
		default: true,
	},
	useBlurEffect: {
		default: true,
	},
	useStickyIcons: {
		default: true,
	},
	enableHighQualityImagePlaceholders: {
		default: true,
	},
	showFixedPostForm: {
		default: false,
	},
	showFixedPostFormInChannel: {
		default: false,
	},
	enableInfiniteScroll: {
		default: true,
	},
	useReactionPickerForContextMenu: {
		default: false,
	},
	instanceTicker: {
		default: 'remote' as 'none' | 'remote' | 'always',
	},
	emojiPickerScale: {
		default: 2,
	},
	emojiPickerWidth: {
		default: 2,
	},
	emojiPickerHeight: {
		default: 3,
	},
	emojiPickerStyle: {
		default: 'auto' as 'auto' | 'popup' | 'drawer',
	},
	squareAvatars: {
		default: false,
	},
	showAvatarDecorations: {
		default: true,
	},
	numberOfPageCache: {
		default: 3,
	},
	pollingInterval: {
		// 1 ... 低
		// 2 ... 中
		// 3 ... 高
		default: 2,
	},
	showNoteActionsOnlyHover: {
		default: false,
	},
	showClipButtonInNoteFooter: {
		default: false,
	},
	reactionsDisplaySize: {
		default: 'medium' as 'small' | 'medium' | 'large',
	},
	limitWidthOfReaction: {
		default: true,
	},
	forceShowAds: {
		default: false,
	},
	aiChanMode: {
		default: false,
	},
	devMode: {
		default: false,
	},
	mediaListWithOneImageAppearance: {
		default: 'expand' as 'expand' | '16_9' | '1_1' | '2_3',
	},
	showMediaListByGridInWideArea: {
		default: false,
	},
	notificationPosition: {
		default: 'rightBottom' as 'leftTop' | 'leftBottom' | 'rightTop' | 'rightBottom',
	},
	notificationStackAxis: {
		default: 'horizontal' as 'vertical' | 'horizontal',
	},
	keepScreenOn: {
		default: false,
	},
	useGroupedNotifications: {
		default: true,
	},
	dataSaver: {
		default: {
			media: false,
			avatar: false,
			urlPreviewThumbnail: false,
			disableUrlPreview: false,
			code: false,
		} as DataSaverStore,
	},
	hemisphere: {
		default: hemisphere as 'N' | 'S',
	},
	enableSeasonalScreenEffect: {
		default: false,
	},
	enableHorizontalSwipe: {
		default: false,
	},
	enablePullToRefresh: {
		default: true,
	},
	useNativeUiForVideoAudioPlayer: {
		default: false,
	},
	keepOriginalFilename: {
		default: true,
	},
	alwaysConfirmFollow: {
		default: true,
	},
	confirmWhenRevealingSensitiveMedia: {
		default: false,
	},
	contextMenu: {
		default: 'app' as 'app' | 'appWithShift' | 'native',
	},
	skipNoteRender: {
		default: true,
	},
	showSoftWordMutedWord: {
		default: false,
	},
	confirmOnReact: {
		default: false,
	},
	defaultFollowWithReplies: {
		default: false,
	},
	makeEveryTextElementsSelectable: {
		default: DEFAULT_DEVICE_KIND === 'desktop',
	},
	showNavbarSubButtons: {
		default: true,
	},
	showTitlebar: {
		default: false,
	},
	// JUICE: ウィジェットパネル(デスクトップ)/ウィジェットドロワー(モバイル)を画面のどちら側に表示するか
	widgetsSide: {
		default: 'right' as 'left' | 'right',
	},
	showAvailableReactionsFirstInNote: {
		default: false,
	},
	showPageTabBarBottom: {
		default: false,
	},
	plugins: {
		default: [] as (OmitStrict<Plugin, 'config'> & { config: Record<string, any> })[],
		mergeStrategy: (a, b) => {
			const sameIdExists = a.some(x => b.some(y => x.installId === y.installId));
			if (sameIdExists) throw new Error();
			const sameNameExists = a.some(x => b.some(y => x.name === y.name));
			if (sameNameExists) throw new Error();
			return a.concat(b);
		},
	},
	mutingEmojis: {
		default: [] as string[],
		mergeStrategy: (a, b) => {
			return [...new Set(a.concat(b))];
		},
	},
	watermarkPresets: {
		accountDependent: true,
		default: [] as WatermarkPreset[],
		mergeStrategy: (a, b) => {
			const mergedItems = [] as typeof a;
			for (const x of a.concat(b)) {
				const sameIdItem = mergedItems.find(y => y.id === x.id);
				if (sameIdItem != null) {
					if (deepEqual(x, sameIdItem)) { // 完全な重複は無視
						continue;
					} else { // IDは同じなのに内容が違う場合はマージ不可とする
						throw new Error();
					}
				} else {
					mergedItems.push(x);
				}
			}
			return mergedItems;
		},
	},
	defaultWatermarkPresetId: {
		accountDependent: true,
		default: null as WatermarkPreset['id'] | null,
	},
	imageFramePresets: {
		accountDependent: true,
		default: [] as ImageFramePreset[],
		mergeStrategy: (a, b) => {
			const mergedItems = [] as typeof a;
			for (const x of a.concat(b)) {
				const sameIdItem = mergedItems.find(y => y.id === x.id);
				if (sameIdItem != null) {
					if (deepEqual(x, sameIdItem)) { // 完全な重複は無視
						continue;
					} else { // IDは同じなのに内容が違う場合はマージ不可とする
						throw new Error();
					}
				} else {
					mergedItems.push(x);
				}
			}
			return mergedItems;
		},
	},
	defaultImageCompressionLevel: {
		default: 2 as 0 | 1 | 2 | 3,
	},
	defaultVideoCompressionLevel: {
		default: 2 as 0 | 1 | 2 | 3,
	},

	'sound.masterVolume': {
		default: 0.5,
	},
	'sound.notUseSound': {
		default: false,
	},
	'sound.useSoundOnlyWhenActive': {
		default: false,
	},
	'sound.on.note': {
		default: { type: 'syuilo/n-aec', volume: 1 } as SoundStore,
	},
	'sound.on.noteMy': {
		default: { type: 'syuilo/n-cea-4va', volume: 1 } as SoundStore,
	},
	'sound.on.notification': {
		default: { type: 'syuilo/n-ea', volume: 1 } as SoundStore,
	},
	'sound.on.reaction': {
		default: { type: 'syuilo/bubble2', volume: 1 } as SoundStore,
	},
	'sound.on.chatMessage': {
		default: { type: 'syuilo/waon', volume: 1 } as SoundStore,
	},

	'deck.alwaysShowMainColumn': {
		default: true,
	},
	'deck.navWindow': {
		default: true,
	},
	'deck.useSimpleUiForNonRootPages': {
		default: true,
	},
	'deck.columnAlign': {
		default: 'center' as 'left' | 'center',
	},
	'deck.columnGap': {
		default: 6,
	},
	'deck.menuPosition': {
		default: 'bottom' as 'right' | 'bottom',
	},
	'deck.navbarPosition': {
		default: 'left' as 'left' | 'top' | 'bottom',
	},
	'deck.wallpaper': {
		default: null as string | null,
	},

	'chat.showSenderName': {
		default: false,
	},
	'chat.sendOnEnter': {
		default: false,
	},

	'game.dropAndFusion': {
		default: {
			bgmVolume: 0.25,
			sfxVolume: 1,
		},
	},

	'experimental.stackingRouterView': {
		default: false,
	},
	'experimental.enableFolderPageView': {
		default: false,
	},
	'experimental.enableHapticFeedback': {
		default: false,
	},
	'experimental.enableWebTranslatorApi': {
		default: false,
	},
});
