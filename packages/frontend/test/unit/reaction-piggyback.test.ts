/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';

// JUICE: リモートの絵文字のリアクションへの相乗りは、管理者の許可とユーザーの設定の両方がオンのときだけ使える

const adminSettings = ref<{ reactionPiggybackOnRemoteEnabled: boolean } | null>(null);
const userSetting = ref(true);

vi.mock('@/cache.js', () => ({
	juicePublicSettingsCache: { value: adminSettings },
}));

vi.mock('@/preferences.js', () => ({
	prefer: { r: { reactionPiggybackOnRemote: userSetting } },
}));

const { useReactionPiggybackOnRemoteEnabled } = await import('@/utility/reaction-piggyback.js');

describe('useReactionPiggybackOnRemoteEnabled', () => {
	test('管理者の設定を読み込む前は使えない', () => {
		adminSettings.value = null;
		userSetting.value = true;
		expect(useReactionPiggybackOnRemoteEnabled().value).toBe(false);
	});

	test('管理者が許可していなければ、ユーザーがオンでも使えない', () => {
		adminSettings.value = { reactionPiggybackOnRemoteEnabled: false };
		userSetting.value = true;
		expect(useReactionPiggybackOnRemoteEnabled().value).toBe(false);
	});

	test('管理者が許可していて、ユーザーがオンなら使える', () => {
		adminSettings.value = { reactionPiggybackOnRemoteEnabled: true };
		userSetting.value = true;
		expect(useReactionPiggybackOnRemoteEnabled().value).toBe(true);
	});

	test('管理者が許可していても、ユーザーがオフにしたら使えない(切り替えるとすぐ反映される)', () => {
		adminSettings.value = { reactionPiggybackOnRemoteEnabled: true };
		userSetting.value = true;
		const enabled = useReactionPiggybackOnRemoteEnabled();
		expect(enabled.value).toBe(true);
		userSetting.value = false;
		expect(enabled.value).toBe(false);
	});
});
