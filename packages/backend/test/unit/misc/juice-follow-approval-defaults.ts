/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { applyFollowApprovalDefaults, resolveFollowApprovalDefaultSettings } from '@/models/JuiceSettings.js';

describe('フォローの承認制の既定値(JUICE)', () => {
	test('何も設定していなければ、ローカル・リモートとも無効', () => {
		expect(resolveFollowApprovalDefaultSettings({})).toEqual({
			followApprovalDefaultLocalSeconds: 0,
			followApprovalDefaultRemoteSeconds: 0,
		});
	});

	test('新しい設定がまだ無ければ、前の「新規アカウントからのフォローをリクエスト化する」の値を両方に使う', () => {
		expect(resolveFollowApprovalDefaultSettings({
			newAccountFollowRequestEnabled: true,
			newAccountFollowRequestThresholdMs: 2 * 60 * 60 * 1000,
		})).toEqual({
			followApprovalDefaultLocalSeconds: 2 * 60 * 60,
			followApprovalDefaultRemoteSeconds: 2 * 60 * 60,
		});

		// しきい値が無ければ、前の既定(1日)
		expect(resolveFollowApprovalDefaultSettings({ newAccountFollowRequestEnabled: true })).toEqual({
			followApprovalDefaultLocalSeconds: 24 * 60 * 60,
			followApprovalDefaultRemoteSeconds: 24 * 60 * 60,
		});

		// 前の設定がオフなら無効
		expect(resolveFollowApprovalDefaultSettings({
			newAccountFollowRequestEnabled: false,
			newAccountFollowRequestThresholdMs: 2 * 60 * 60 * 1000,
		})).toEqual({
			followApprovalDefaultLocalSeconds: 0,
			followApprovalDefaultRemoteSeconds: 0,
		});
	});

	test('新しい設定があれば、前の設定より優先する', () => {
		expect(resolveFollowApprovalDefaultSettings({
			newAccountFollowRequestEnabled: true,
			newAccountFollowRequestThresholdMs: 2 * 60 * 60 * 1000,
			followApprovalDefaultLocalSeconds: 0,
			followApprovalDefaultRemoteSeconds: 3 * 24 * 60 * 60,
		})).toEqual({
			followApprovalDefaultLocalSeconds: 0,
			followApprovalDefaultRemoteSeconds: 3 * 24 * 60 * 60,
		});
	});

	test('「既定値を使う」(null)だけを既定値で埋め、ユーザーが決めた値(無効の0を含む)はそのまま', () => {
		const settings = { followApprovalDefaultLocalSeconds: 86400, followApprovalDefaultRemoteSeconds: 7 * 86400 };
		expect(applyFollowApprovalDefaults({ followApprovalLocalSeconds: null, followApprovalRemoteSeconds: null }, settings)).toEqual({
			followApprovalLocalSeconds: 86400,
			followApprovalRemoteSeconds: 7 * 86400,
		});
		expect(applyFollowApprovalDefaults({ followApprovalLocalSeconds: 0, followApprovalRemoteSeconds: 3600 }, settings)).toEqual({
			followApprovalLocalSeconds: 0,
			followApprovalRemoteSeconds: 3600,
		});
	});
});
