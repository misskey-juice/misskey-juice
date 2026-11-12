<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<img
	v-if="shouldMute"
	:class="[$style.root, { [$style.normal]: normal, [$style.noStyle]: noStyle }]"
	src="/client-assets/unknown.png"
	:title="alt"
	draggable="false"
	style="-webkit-user-drag: none;"
	@click="onClick"
/>
<img
	v-else-if="errored && fallbackToImage"
	:class="[$style.root, { [$style.normal]: normal, [$style.noStyle]: noStyle }]"
	src="/client-assets/dummy.png"
	:title="alt"
	draggable="false"
	style="-webkit-user-drag: none;"
/>
<span v-else-if="errored">:{{ customEmojiName }}:</span>
<img
	v-else
	:class="[$style.root, { [$style.normal]: normal, [$style.noStyle]: noStyle }]"
	:src="url"
	:alt="alt"
	:title="alt"
	decoding="async"
	draggable="false"
	@error="errored = true"
	@load="errored = false"
	@click="onClick"
/>
</template>

<script lang="ts" setup>
import { computed, defineAsyncComponent, inject, ref, watch } from 'vue';
import { normalizeCustomEmojiName, isLocalCustomEmojiName, getCustomEmojiImagePath } from '@@/js/emoji-name.js';
import type { MenuItem } from '@/types/menu.js';
import { getProxiedImageUrl, getStaticImageUrl } from '@/utility/media-proxy.js';
import { customEmojisMap } from '@/custom-emojis.js';
import * as os from '@/os.js';
import { misskeyApi, misskeyApiGet } from '@/utility/misskey-api.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { i18n } from '@/i18n.js';
import MkCustomEmojiDetailedDialog from '@/components/MkCustomEmojiDetailedDialog.vue';
import { $i } from '@/i.js';
import { prefer } from '@/preferences.js';
import { DI } from '@/di.js';
import { makeEmojiMuteKey, mute as muteEmoji, unmute as unmuteEmoji, checkMuted as checkEmojiMuted } from '@/utility/emoji-mute';
import { addToEmojiPalette } from '@/utility/emoji-palette.js';
import { useReactionPiggybackOnRemoteEnabled } from '@/utility/reaction-piggyback.js';

const props = defineProps<{
	name: string;
	normal?: boolean;
	noStyle?: boolean;
	host?: string | null;
	url?: string;
	useOriginalSize?: boolean;
	menu?: boolean;
	menuReaction?: boolean;
	fallbackToImage?: boolean;
	ignoreMuted?: boolean;
}>();

const react = inject(DI.mfmEmojiReactCallback, null);

const customEmojiName = computed(() => normalizeCustomEmojiName(props.name));
const isLocal = computed(() => isLocalCustomEmojiName(customEmojiName.value, props.host));
const emojiCodeToMute = computed(() => makeEmojiMuteKey(props));
const isMuted = checkEmojiMuted(emojiCodeToMute);
const shouldMute = computed(() => !props.ignoreMuted && isMuted.value);

// JUICE: ノート本文等に埋め込まれたリモートのカスタム絵文字への相乗りリアクション・
// 絵文字パレットへの追加を、MkReactionsViewer.reaction.vueの相乗り機能と同じ管理者設定で
// 許可するかどうか判定する
const reactionPiggybackOnRemoteEnabled = useReactionPiggybackOnRemoteEnabled();
const canUseRemoteEmojiActions = computed(() => isLocal.value || reactionPiggybackOnRemoteEnabled.value);
// JUICE: リアクション文字列はローカルなら`:name:`、リモートなら`:name@host:`
// (MFM由来のprops.nameはホスト情報を含まないため、ここで組み立てる。hostが無い場合は
// isLocalCustomEmojiNameの判定上ローカル扱いになるはずだが、念のためフォールバックする)
const reactionString = computed(() => (isLocal.value || !props.host) ? `:${props.name}:` : `:${customEmojiName.value}@${props.host}:`);

const rawUrl = computed(() => {
	if (props.url) {
		return props.url;
	}
	if (isLocal.value) {
		return customEmojisMap.get(customEmojiName.value)?.url ?? null;
	}
	return getCustomEmojiImagePath(customEmojiName.value, props.host);
});

const url = computed(() => {
	if (rawUrl.value == null) return undefined;

	// JUICE: URL.createObjectURL由来のblob: URL(絵文字申請フォームで、PCから選択した
	// 未アップロードのローカルファイルをリアクションプレビューに直接差し込む場合等に使われる)は
	// このブラウザタブ内でのみ有効で、サーバー側からは絶対に取得できない。
	// image proxy(getProxiedImageUrl/getStaticImageUrl)を経由させると、サーバーが
	// blob: URLへのフェッチを必ず失敗させ、画像読み込み失敗のダミー画像にフォールバックして
	// しまうため、プロキシを一切通さずそのまま表示する
	if (rawUrl.value.startsWith('blob:') || rawUrl.value.startsWith('data:')) {
		return rawUrl.value;
	}

	const proxied =
		(rawUrl.value.startsWith('/emoji/') || (props.useOriginalSize && isLocal.value))
			? rawUrl.value
			: getProxiedImageUrl(
				rawUrl.value,
				props.useOriginalSize ? undefined : 'emoji',
				false,
				true,
			);
	return prefer.s.disableShowingAnimatedImages
		? getStaticImageUrl(proxied)
		: proxied;
});

const alt = computed(() => `:${customEmojiName.value}:`);
const errored = ref(url.value == null);

// url が差し替わったときに前の絵文字の読み込み失敗状態を引きずらないようにする
// (errored が立っている間は <img> 自体が描画されないので load イベントでは復帰できない)
watch(url, (v) => {
	errored.value = v == null;
});

function onClick(ev: PointerEvent) {
	if (props.menu) {
		const menuItems: MenuItem[] = [];

		menuItems.push({
			type: 'label',
			// JUICE: リモート絵文字はホストを含めて表示し、ローカルの同名絵文字と区別できるようにする
			text: reactionString.value,
		});

		if (isLocal.value) {
			menuItems.push({
				text: i18n.ts.copy,
				icon: 'ti ti-copy',
				action: () => {
					copyToClipboard(`:${props.name}:`);
				},
			});
		}

		if (props.menuReaction && react && canUseRemoteEmojiActions.value) {
			menuItems.push({
				text: i18n.ts.doReaction,
				icon: 'ti ti-plus',
				action: () => {
					react(reactionString.value);
				},
			});
		}

		menuItems.push({
			type: 'divider',
		}, {
			// JUICE: リモートのカスタム絵文字(ノート本文・CW・プロフィール等に埋め込まれたもの)でも
			// ライセンス等の詳細情報を確認できるように、ローカル限定の制約を撤廃してhostを渡す
			text: i18n.ts.info,
			icon: 'ti ti-info-circle',
			action: async () => {
				const { dispose } = os.popup(MkCustomEmojiDetailedDialog, {
					emoji: await misskeyApiGet('emoji', {
						name: customEmojiName.value,
						...(isLocal.value ? {} : { host: props.host }),
					}),
				}, {
					closed: () => dispose(),
				});
			},
		});

		if (isMuted.value) {
			menuItems.push({
				text: i18n.ts.emojiUnmute,
				icon: 'ti ti-mood-smile',
				action: async () => {
					await unmute();
				},
			});
		} else {
			menuItems.push({
				text: i18n.ts.emojiMute,
				icon: 'ti ti-mood-off',
				action: async () => {
					await mute();
				},
			});
		}

		if (canUseRemoteEmojiActions.value) {
			menuItems.push({
				text: i18n.ts.addToEmojiPalette,
				icon: 'ti ti-palette',
				action: () => {
					addToEmojiPalette(reactionString.value);
				},
			});
		}

		if (($i?.isModerator ?? $i?.isAdmin) && isLocal.value) {
			menuItems.push({
				type: 'divider',
			}, {
				text: i18n.ts.edit,
				icon: 'ti ti-pencil',
				action: async () => {
					await edit(props.name);
				},
			});
		}

		os.popupMenu(menuItems, ev.currentTarget ?? ev.target);
	}
}

async function edit(name: string) {
	const emoji = await misskeyApi('emoji', {
		name: name,
	});
	const { dispose } = await os.popupAsyncWithDialog(import('@/pages/emoji-edit-dialog.vue').then(x => x.default), {
		emoji: emoji,
	}, {
		closed: () => dispose(),
	});
}

function mute() {
	// 確認ダイアログを開いている間に props が変わっても、ダイアログに出したものと同じ絵文字を対象にする
	const targetEmojiCode = emojiCodeToMute.value;
	const titleEmojiName = isLocal.value
		? `:${customEmojiName.value}:`
		: targetEmojiCode;
	os.confirm({
		type: 'question',
		title: i18n.tsx.muteX({ x: titleEmojiName }),
	}).then(({ canceled }) => {
		if (canceled) {
			return;
		}
		muteEmoji(targetEmojiCode);
	});
}

function unmute() {
	const targetEmojiCode = emojiCodeToMute.value;
	const titleEmojiName = isLocal.value
		? `:${customEmojiName.value}:`
		: targetEmojiCode;
	os.confirm({
		type: 'question',
		title: i18n.tsx.unmuteX({ x: titleEmojiName }),
	}).then(({ canceled }) => {
		if (canceled) {
			return;
		}
		unmuteEmoji(targetEmojiCode);
	});
}

</script>

<style lang="scss" module>
.root {
	height: 2em;
	vertical-align: middle;
	-webkit-user-drag: none;
	transition: transform 0.2s ease;

	&:hover {
		transform: scale(1.2);
	}
}

.normal {
	height: 1.25em;
	vertical-align: -0.25em;

	&:hover {
		transform: none;
	}
}

.noStyle {
	height: auto !important;
}
</style>
