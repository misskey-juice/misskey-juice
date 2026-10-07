/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed } from 'vue';
import { juicePublicSettingsCache } from '@/cache.js';
import { prefer } from '@/preferences.js';

/**
 * JUICE: リモートのカスタム絵文字を使ったリアクションへの相乗り(既存リアクションに便乗して
 * 同じリアクションを付けること)・絵文字パレットへの追加が使えるか。
 * 管理者設定で有効化されていて(リモートの絵文字画像を著作権者の許諾なく使用・保存することになりうるため、既定は無効)、
 * かつユーザーが自分の設定でオフにしていないときだけ使える。
 * MkReactionsViewer.reaction.vue・MkCustomEmoji.vueで共通の判定ロジックとして使う
 */
export function useReactionPiggybackOnRemoteEnabled() {
	return computed(() => (juicePublicSettingsCache.value.value?.reactionPiggybackOnRemoteEnabled ?? false) && prefer.r.reactionPiggybackOnRemote.value);
}
