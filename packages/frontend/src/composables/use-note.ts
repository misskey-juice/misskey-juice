/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, computed, watch } from 'vue';
import type { Ref } from 'vue';
import * as mfm from 'mfm-js';
import * as Misskey from 'misskey-js';
import { isLink } from '@@/js/is-link.js';
import { shouldCollapsed } from '@@/js/collapsed.js';
import { host } from '@@/js/config.js';
import { pleaseLogin } from '@/utility/please-login.js';
import type { OpenOnRemoteOptions } from '@/utility/please-login.js';
import { checkWordMute } from '@/utility/check-word-mute.js';
import { checkAIGeneratedMute } from '@/utility/check-ai-generated-mute.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import * as sound from '@/utility/sound.js';
import * as os from '@/os.js';
import { reactionPicker } from '@/utility/reaction-picker.js';
import { extractUrlFromMfm } from '@/utility/extract-url-from-mfm.js';
import { getNoteClipMenu, getNoteMenu, getRenoteMenu, getAbuseNoteMenu, getCopyNoteLinkMenu } from '@/utility/get-note-menu.js';
import { noteEvents, useNoteCapture } from '@/composables/use-note-capture.js';
import { deepClone } from '@/utility/clone.js';
import { useTooltip } from '@/composables/use-tooltip.js';
import { claimAchievement } from '@/utility/achievements.js';
import { showMovedDialog } from '@/utility/show-moved-dialog.js';
import { getAppearNote } from '@/utility/get-appear-note.js';
import { prefer } from '@/preferences.js';
import { getPluginHandlers } from '@/plugin.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { globalEvents, useGlobalEvent } from '@/events.js';
import { favoriteStateOf, setFavoriteState } from '@/utility/juice-favorite-state.js';
import MkUsersTooltip from '@/components/MkUsersTooltip.vue';
import MkReactionsViewerDetails from '@/components/MkReactionsViewer.details.vue';
import MkRippleEffect from '@/components/MkRippleEffect.vue';
import { notePage } from '@/filters/note.js';
import type { DI as DIType } from '@/di.js';
import type { ExtractInjectedType } from '@/types/misc.js';
import type { MenuItem } from '@/types/menu.js';
import type { WordMuteResult } from '@/utility/check-word-mute.js';

export interface UseNoteProps {
	note: Misskey.entities.Note;
	pinned?: boolean;
	mock?: boolean;
	withHardMute?: boolean;
}

export interface UseNoteElements {
	rootEl?: Ref<HTMLElement | null>;
	menuButton?: Ref<HTMLElement | null>;
	renoteButton?: Ref<HTMLElement | null>;
	renoteTime?: Ref<HTMLElement | null>;
	reactButton?: Ref<HTMLElement | null>;
	clipButton?: Ref<HTMLElement | null>;
	quickReactButton?: Ref<HTMLElement | null>;
}

export interface UseNoteOptions {
	inTimeline?: boolean;
	tl_withSensitive?: Ref<boolean>;
	inChannel?: ExtractInjectedType<typeof DIType['inChannel']>;
	currentClip?: Ref<Misskey.entities.Clip | null> | null;
	currentAntenna?: Ref<Misskey.entities.Antenna | null> | null;
}

export function checkNoteWordMute(
	noteToCheck: Misskey.entities.Note,
	user: typeof $i,
	mutedWords: Array<string | string[]> | null,
): WordMuteResult {
	if (mutedWords != null) {
		const result = checkWordMute(noteToCheck, user, mutedWords);
		if (Array.isArray(result)) return result;

		const replyResult = noteToCheck.reply && checkWordMute(noteToCheck.reply, user, mutedWords);
		if (Array.isArray(replyResult)) return replyResult;

		const renoteResult = noteToCheck.renote && checkWordMute(noteToCheck.renote, user, mutedWords);
		if (Array.isArray(renoteResult)) return renoteResult;
	}

	return false;
}

export function checkBuiltinSoftMute(
	noteToCheck: Misskey.entities.Note,
	checkForSensitiveMedia: boolean,
): 'sensitiveMute' | false {
	if (checkForSensitiveMedia && noteToCheck.files?.some((v) => v.isSensitive)) {
		return 'sensitiveMute' as never;
	}

	return false;
}

/** MkNote, MkNoteDetailedの共通ロジック */
export function useNote(
	props: UseNoteProps,
	els: UseNoteElements = {},
	options: UseNoteOptions = {},
) {
	const inTimeline = options.inTimeline ?? false;
	const tl_withSensitive = options.tl_withSensitive ?? ref(true);
	const inChannel = options.inChannel ?? null;
	const currentClip = options.currentClip ?? null;
	const currentAntenna = options.currentAntenna ?? null;

	// プラグインの割り込み処理
	let rawNote = deepClone(props.note);
	let hideByPlugin = false;
	const noteViewInterruptors = getPluginHandlers('note_view_interruptor');

	if (noteViewInterruptors.length > 0) {
		let result: Misskey.entities.Note | null = deepClone(rawNote);
		for (const interruptor of noteViewInterruptors) {
			try {
				result = interruptor.handler(result!) as Misskey.entities.Note | null;

				// nullになった場合（非表示）はこれ以上やることがないのでループを抜ける
				if (result == null) {
					break;
				}
			} catch (err) {
				console.error(err);
			}
		}
		if (result == null) {
			hideByPlugin = true;
		} else {
			rawNote = result;
		}
	}

	// 基本状態
	const isRenote = Misskey.note.isPureRenote(rawNote);
	const appearNote = getAppearNote(rawNote) ?? rawNote;

	// キャプチャ（ストリーム購読）
	const { $note: $appearNote, subscribe: subscribeManuallyToNoteCapture } = useNoteCapture({
		note: appearNote,
		parentNote: rawNote,
		mock: props.mock,
	});

	// 各種フラグ状態
	const showContent = ref(false);
	const isDeleted = ref(false);
	const translating = ref(false);
	const translation = ref<Misskey.entities.NotesTranslateResponse | null>(null);

	// ミュート判定
	// mutedはミュート解除の操作で書き換わるのでref。hardMutedも通常は解除できず不変だが、
	// JUICE: AI生成物ミュートはワードミュートとは独立した設定のため、checkNoteWordMute/checkBuiltinSoftMuteの
	// 外で判定する。自分自身除外・設定値の解釈は check-ai-generated-mute.ts の checkAIGeneratedMute に
	// 一本化し、MkNoteSub.vue と実装がずれないようにする。
	// ノートの isAIGenerated は投稿後にストリーム経由で変わりうる ($appearNote.isAIGenerated, aiGeneratedChanged
	// イベント) ため、初期値の算出だけでなく watch でも追従させる必要があり、hardMutedもrefにしている(下記)。
	const aiGeneratedMuteMode = computed(() => checkAIGeneratedMute({ userId: appearNote.userId, isAIGenerated: $appearNote.isAIGenerated }, $i));
	const isAIGeneratedMuteTarget = computed(() => aiGeneratedMuteMode.value !== 'none');

	const muted = ref(
		aiGeneratedMuteMode.value === 'mute' ? 'aiGeneratedMute' as const :
		$i ? checkNoteWordMute(appearNote, $i, $i.mutedWords) || checkBuiltinSoftMute(appearNote, inTimeline && !tl_withSensitive.value) : false,
	);
	const hardMuted = ref(
		aiGeneratedMuteMode.value === 'hardMute' ? true :
		props.withHardMute && $i ? checkNoteWordMute(appearNote, $i, $i.hardMutedWords) !== false : false,
	);

	// JUICE: AI生成物フラグが後から変わった場合(投稿者が notes/juice/update-ai-generated で切り替えた等)に
	// ミュート判定もバッジ表示と同様に追従させる。ただし hardMuted は理由を持たない単一の真偽値なので、
	// 別の理由(ワードハードミュート等)で既に true になっているケースを誤って解除しないよう、
	// 「ミュート対象になった」方向のみ確実に反映し、「対象から外れた」方向は muted の理由が
	// 'aiGeneratedMute' だったときだけ安全に戻す。
	watch(isAIGeneratedMuteTarget, (isTarget) => {
		if (isTarget) {
			if (aiGeneratedMuteMode.value === 'hardMute') {
				hardMuted.value = true;
			} else if (aiGeneratedMuteMode.value === 'mute' && muted.value === false) {
				muted.value = 'aiGeneratedMute';
			}
		} else if (muted.value === 'aiGeneratedMute') {
			muted.value = false;
		}
	});

	// 導出値
	// rawNote / appearNote / $i.id / prefer.s は変化しないので一度だけ計算する
	const isMyRenote = $i != null && ($i.id === rawNote.userId);
	// JUICE: 本文はリモートで編集されると差し替わるので、編集日時が変わったら作り直す
	const parsed = computed(() => {
		void $appearNote.updatedAt;
		return appearNote.text ? mfm.parse(appearNote.text) : null;
	});
	const urls = computed(() => parsed.value ? extractUrlFromMfm(parsed.value).filter((url) => appearNote.renote?.url !== url && appearNote.renote?.uri !== url) : null);
	const isLong = computed(() => shouldCollapsed(appearNote, urls.value ?? []));
	const collapsed = ref(appearNote.cw == null && isLong.value);
	const canRenote = ['public', 'home'].includes(appearNote.visibility) || (appearNote.visibility === 'followers' && appearNote.userId === $i?.id);
	const showTicker = (prefer.s.instanceTicker === 'always') || (prefer.s.instanceTicker === 'remote' && appearNote.user.instance);
	const renoteCollapsed = ref(prefer.s.collapseRenotes && isRenote && (($i && ($i.id === rawNote.userId || $i.id === appearNote.userId)) || ($appearNote.myReaction != null)));

	const pleaseLoginContext: OpenOnRemoteOptions = {
		type: 'lookup',
		url: `https://${host}/notes/${appearNote.id}`,
	};

	// グローバルイベントの監視
	useGlobalEvent('noteDeleted', (noteId) => {
		if (noteId === rawNote.id || noteId === appearNote.id) {
			isDeleted.value = true;
		}
	});

	// ツールチップのセットアップ (Mockでない場合のみ)
	if (!props.mock) {
		if (els.renoteButton != null) {
			useTooltip(els.renoteButton, async (showing) => {
				const renotes = await misskeyApi('notes/renotes', {
					noteId: appearNote.id,
					limit: 11,
				});
				const users = renotes.map(x => x.user);
				if (users.length < 1 || els.renoteButton!.value == null) return;
				const { dispose } = os.popup(MkUsersTooltip, {
					showing,
					users,
					count: appearNote.renoteCount,
					anchorElement: els.renoteButton!.value,
				}, {
					closed: () => dispose(),
				});
			});
		}

		if (appearNote.reactionAcceptance === 'likeOnly' && els.reactButton != null) {
			useTooltip(els.reactButton, async (showing) => {
				const reactions = await misskeyApi('notes/reactions', {
					noteId: appearNote.id,
					limit: 10,
				});
				const users = reactions.map(x => x.user);
				if (users.length < 1 || els.reactButton!.value == null) return;
				const { dispose } = os.popup(MkReactionsViewerDetails, {
					showing,
					reaction: '❤️',
					users,
					count: $appearNote.reactionCount,
					anchorElement: els.reactButton!.value,
				}, {
					closed: () => dispose(),
				});
			});
		}
	}

	// 共通アクション関数群
	async function renote() {
		if (props.mock) return;
		const isLoggedIn = await pleaseLogin({ openOnRemote: pleaseLoginContext });
		if (!isLoggedIn) return;
		showMovedDialog();
		if (els.renoteButton == null) return;
		const { menu } = getRenoteMenu({
			note: rawNote,
			renoteButton: els.renoteButton,
			mock: props.mock,
		});
		os.popupMenu(menu, els.renoteButton.value);
		subscribeManuallyToNoteCapture();
	}

	async function reply() {
		if (props.mock) return;
		const isLoggedIn = await pleaseLogin({ openOnRemote: pleaseLoginContext });
		if (!isLoggedIn) return;
		os.post({
			reply: appearNote,
			channel: appearNote.channel,
		}).then(() => {
			focus();
		});
	}

	async function react(createReactionMock?: (reaction: string) => void) {
		const isLoggedIn = await pleaseLogin({ openOnRemote: pleaseLoginContext });
		if (!isLoggedIn) return;
		showMovedDialog();

		if (appearNote.reactionAcceptance === 'likeOnly') {
			sound.playMisskeySfx('reaction');
			if (props.mock) return;
			misskeyApi('notes/reactions/create', {
				noteId: appearNote.id,
				reaction: '❤️',
			}).then(() => {
				noteEvents.emit(`reacted:${appearNote.id}`, { userId: $i!.id, reaction: '❤️' });
			});
			if (els.reactButton != null && els.reactButton.value != null && prefer.s.animation) {
				const rect = els.reactButton.value.getBoundingClientRect();
				const { dispose } = os.popup(MkRippleEffect, {
					x: rect.left + (els.reactButton.value.offsetWidth / 2),
					y: rect.top + (els.reactButton.value.offsetHeight / 2),
				}, {
					end: () => dispose(),
				});
			}
		} else {
			blur();
			reactionPicker.show(els.reactButton?.value ?? null, rawNote, async (reaction) => {
				if (prefer.s.confirmOnReact) {
					const confirm = await os.confirm({
						type: 'question',
						text: i18n.tsx.reactAreYouSure({ emoji: reaction.replace('@.', '') }),
					});
					if (confirm.canceled) return;
				}
				sound.playMisskeySfx('reaction');
				if (props.mock) {
					if (createReactionMock) createReactionMock(reaction);
					return;
				}
				misskeyApi('notes/reactions/create', {
					noteId: appearNote.id,
					reaction: reaction,
				}).then(() => {
					noteEvents.emit(`reacted:${appearNote.id}`, { userId: $i!.id, reaction: reaction });
				});
				if (appearNote.text && appearNote.text.length > 100 && (Date.now() - new Date(appearNote.createdAt).getTime() < 1000 * 3)) {
					claimAchievement('reactWithoutRead');
				}
			}, () => { focus(); });
		}
	}

	async function reactViaMfmEmoji(reaction: string) {
		if (props.mock) return;
		const isLoggedIn = await pleaseLogin({ openOnRemote: pleaseLoginContext });
		if (!isLoggedIn) return;
		showMovedDialog();
		sound.playMisskeySfx('reaction');
		misskeyApi('notes/reactions/create', {
			noteId: appearNote.id,
			reaction: reaction,
		}).then(() => {
			noteEvents.emit(`reacted:${appearNote.id}`, {
				userId: $i!.id,
				reaction: reaction,
			});
		});
	}

	// JUICE: 「+」の左の、決めたリアクションを1回で付けるボタン(misskey-tempuraを参考)。まだリアクションしていないノートにだけ出し、外すのは「+」(−)で行う
	async function quickReact(): Promise<void> {
		if (props.mock) return;
		if ($appearNote.myReaction != null) return;
		const isLoggedIn = await pleaseLogin({ openOnRemote: pleaseLoginContext });
		if (!isLoggedIn) return;
		showMovedDialog();

		const reaction = prefer.s.quickReaction;
		if (prefer.s.confirmOnReact) {
			const { canceled } = await os.confirm({ type: 'question', text: i18n.tsx.reactAreYouSure({ emoji: reaction.replace('@.', '') }) });
			if (canceled) return;
		}

		sound.playMisskeySfx('reaction');
		const button = els.quickReactButton?.value;
		if (button != null && prefer.s.animation) {
			const rect = button.getBoundingClientRect();
			const { dispose } = os.popup(MkRippleEffect, {
				x: rect.left + (button.offsetWidth / 2),
				y: rect.top + (button.offsetHeight / 2),
			}, {
				end: () => dispose(),
			});
		}

		misskeyApi('notes/reactions/create', { noteId: appearNote.id, reaction }).then(() => {
			noteEvents.emit(`reacted:${appearNote.id}`, { userId: $i!.id, reaction });
		});
		if (appearNote.text && appearNote.text.length > 100 && (Date.now() - new Date(appearNote.createdAt).getTime() < 1000 * 3)) {
			claimAchievement('reactWithoutRead');
		}
	}

	function undoReact(): void {
		const oldReaction = $appearNote.myReaction;
		if (!oldReaction) return;
		if (props.mock) return;
		misskeyApi('notes/reactions/delete', { noteId: appearNote.id }).then(() => {
			noteEvents.emit(`unreacted:${appearNote.id}`, { userId: $i!.id, reaction: oldReaction });
		});
	}

	function toggleReact(customMockCallback?: (reaction: string) => void) {
		if ($appearNote.myReaction == null) {
			react(customMockCallback);
		} else {
			if (props.mock && customMockCallback) {
				customMockCallback($appearNote.myReaction);
			} else {
				undoReact();
			}
		}
	}

	function onContextmenu(ev: PointerEvent): void {
		if (props.mock) return;
		if (ev.target && isLink(ev.target as HTMLElement)) return;
		if (window.getSelection()?.toString() !== '') return;

		if (prefer.s.useReactionPickerForContextMenu) {
			ev.preventDefault();
			react();
		} else {
			const { menu, cleanup } = getNoteMenu({
				note: rawNote,
				translating,
				translation,
				currentClip: currentClip?.value,
				currentAntenna: currentAntenna?.value ?? undefined,
			});
			os.contextMenu(menu, ev).then(focus).finally(cleanup);
		}
	}

	function showMenu(): void {
		if (props.mock || els.menuButton == null) return;
		const { menu, cleanup } = getNoteMenu({
			note: rawNote,
			translating,
			translation,
			currentClip: currentClip?.value,
			currentAntenna: currentAntenna?.value ?? undefined,
		});
		os.popupMenu(menu, els.menuButton.value).then(focus).finally(cleanup);
	}

	async function clip(): Promise<void> {
		if (props.mock) return;
		os.popupMenu(await getNoteClipMenu({
			note: rawNote,
			currentClip: currentClip?.value,
		}), els.clipButton?.value).then(focus);
	}

	// JUICE: ノートの画面のお気に入りボタン。お気に入りかどうかは、お気に入りの一覧に出した・登録/解除したノートなら
	// 分かっている(juice-favorite-state)。分からなければ、押したときに初めて調べる(ノートごとに問い合わせない)
	const isFavorited = computed(() => favoriteStateOf(appearNote.id));
	const favoriting = ref(false);

	async function toggleFavorite(): Promise<void> {
		if (props.mock || favoriting.value) return;
		const isLoggedIn = await pleaseLogin({ openOnRemote: pleaseLoginContext });
		if (!isLoggedIn) return;

		favoriting.value = true;
		try {
			if (isFavorited.value == null) {
				const state = await misskeyApi('notes/state', { noteId: appearNote.id }).catch(() => null);
				if (state == null) {
					os.alert({ type: 'error', text: i18n.ts.somethingHappened });
					return;
				}
				setFavoriteState(appearNote.id, state.isFavorited);
				// 見えていなかった状態で解除してしまわないよう、登録済みだったら知らせるだけにする
				if (state.isFavorited) {
					os.toast(i18n.ts.alreadyFavorited);
					return;
				}
			}

			const favorite = !isFavorited.value;
			if (favorite) claimAchievement('noteFavorited1');
			// 失敗はapiWithDialogが知らせる
			const ok = await os.apiWithDialog(favorite ? 'notes/favorites/create' : 'notes/favorites/delete', { noteId: appearNote.id }).then(() => true, () => false);
			if (!ok) return;
			setFavoriteState(appearNote.id, favorite);
			globalEvents.emit(favorite ? 'noteFavorited' : 'noteUnfavorited', appearNote.id);
		} finally {
			favoriting.value = false;
		}
	}

	async function showRenoteMenu() {
		if (props.mock) return;
		const isLoggedIn = await pleaseLogin({ openOnRemote: pleaseLoginContext });
		if (!isLoggedIn) return;

		const getUnrenote = () => ({
			text: i18n.ts.unrenote,
			icon: 'ti ti-trash',
			danger: true,
			action: () => {
				misskeyApi('notes/delete', { noteId: rawNote.id }).then(() => { globalEvents.emit('noteDeleted', rawNote.id); });
			},
		});

		const menuItems: MenuItem[] = [{
			type: 'link',
			text: i18n.ts.renoteDetails,
			icon: 'ti ti-info-circle',
			to: notePage(rawNote),
		}];

		if (props.note.channelId != null && (inChannel == null || props.note.channelId !== inChannel.value)) {
			menuItems.push({
				type: 'link',
				text: i18n.ts.viewRenotedChannel,
				icon: 'ti ti-device-tv',
				to: `/channels/${props.note.channelId}`,
			});
		}

		menuItems.push(getCopyNoteLinkMenu(rawNote, i18n.ts.copyLinkRenote));
		menuItems.push({ type: 'divider' });

		if (isMyRenote) {
			menuItems.push(getUnrenote());
			os.popupMenu(menuItems, els.renoteTime?.value);
		} else {
			menuItems.push(getAbuseNoteMenu(rawNote, i18n.ts.reportAbuseRenote));
			if ($i?.isModerator || $i?.isAdmin) {
				menuItems.push(getUnrenote());
			}

			os.popupMenu(menuItems, els.renoteTime?.value);
		}
	}

	// フォーカス制御
	function focus() { els.rootEl?.value?.focus(); }

	function blur() { els.rootEl?.value?.blur(); }

	return {
		// 状態・データ
		note: rawNote,
		appearNote,
		$appearNote,
		hideByPlugin,
		isRenote,
		showContent,
		isDeleted,
		translating,
		translation,
		muted,
		hardMuted,
		collapsed,
		renoteCollapsed,

		// 導出値
		isMyRenote,
		parsed,
		urls,
		isLong,
		showTicker,
		canRenote,

		// アクション関数
		renote,
		reply,
		react,
		reactViaMfmEmoji,
		toggleReact,
		onContextmenu,
		showMenu,
		clip,
		isFavorited,
		toggleFavorite,
		quickReact,
		showRenoteMenu,
		focus,
		blur,
	};
}
