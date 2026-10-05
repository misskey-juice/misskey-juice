/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineAsyncComponent } from 'vue';
import { host } from '@@/js/config.js';
import type { MenuItem } from '@/types/menu.js';
import * as os from '@/os.js';
import { instance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { juicePublicSettingsCache } from '@/cache.js';

function toolsMenuItems(): MenuItem[] {
	const items: MenuItem[] = [{
		type: 'link',
		to: '/scratchpad',
		text: i18n.ts.scratchpad,
		icon: 'ti ti-terminal-2',
	}, {
		type: 'link',
		to: '/api-console',
		text: 'API Console',
		icon: 'ti ti-terminal-2',
	}, {
		type: 'link',
		to: '/clicker',
		text: '🍪👈',
		icon: 'ti ti-cookie',
	}];

	if ($i && ($i.isAdmin || $i.policies.canManageCustomEmojis)) {
		items.push({
			type: 'link',
			to: '/custom-emojis-manager',
			text: i18n.ts.manageCustomEmojis,
			icon: 'ti ti-icons',
		});
	}

	if ($i && ($i.isAdmin || $i.policies.canManageAvatarDecorations)) {
		items.push({
			type: 'link' as const,
			to: '/avatar-decorations',
			text: i18n.ts.manageAvatarDecorations,
			icon: 'ti ti-sparkles',
		});
	}

	// JUICE: モデレーター/管理者、またはロールポリシーで個別に承認権限を持つユーザー向けに、
	// コントロールパネル(/admin、iAmModeratorのみでガード)を経由しなくても各承認画面へ
	// 到達できるようにする(custom-emojis-manager/avatar-decorationsと同じ方式)。
	// 表示名は、一般ユーザー向けの申請メニュー項目(「絵文字申請」等)と同じメニュー内に
	// 並ぶと紛らわしいため、通常の.titleとは別に「〜を確認」の専用文言を使う
	if ($i && ($i.isModerator || $i.isAdmin || $i.policies.canApproveEmojiRequests)) {
		items.push({
			type: 'link',
			to: '/emoji-requests-manager',
			text: i18n.ts._emojiRequestApprovals.menuTitle,
			icon: 'ti ti-mood-plus',
			badge: true,
		});
	}

	if ($i && ($i.isModerator || $i.isAdmin || $i.policies.canApproveAvatarDecorationRequests)) {
		items.push({
			type: 'link',
			to: '/avatar-decoration-requests-manager',
			text: i18n.ts._avatarDecorationRequestApprovals.menuTitle,
			icon: 'ti ti-sparkles',
			badge: true,
		});
	}

	// JUICE: 承認式にしたインポートの審査
	if ($i && ($i.isModerator || $i.isAdmin || $i.policies.canApproveImportRequests)) {
		items.push({
			type: 'link',
			to: '/import-requests-manager',
			text: i18n.ts._importRequest.approvalsTitle,
			icon: 'ti ti-file-import',
			badge: true,
		});
	}

	if ($i && ($i.isModerator || $i.isAdmin || $i.policies.canApproveSignups)) {
		items.push({
			type: 'link',
			to: '/signup-approvals-manager',
			text: i18n.ts._juiceApprovals.title,
			icon: 'ti ti-user-question',
			badge: true,
		});
	}

	if ($i && ($i.isModerator || $i.isAdmin || $i.policies.canProcessContactForms)) {
		items.push({
			type: 'link',
			to: '/contact-form-manager',
			text: i18n.ts._contactForm._adminList.list,
			icon: 'ti ti-mail',
			badge: true,
		});
	}

	// JUICE: 通報管理は他の承認系メニューと異なりロールポリシーでの個別付与が無い
	// (バックエンドがrequireModeratorのみで判定するため)、モデレーター/管理者にのみ表示する
	if ($i && ($i.isModerator || $i.isAdmin)) {
		items.push({
			type: 'link',
			to: '/abuses-manager',
			text: i18n.ts._abuseUserReport.menuTitle,
			icon: 'ti ti-exclamation-circle',
			badge: true,
		});
	}

	return items;
}

export async function openInstanceMenu(ev: PointerEvent) {
	// JUICE: awaitを挟むとEvent.currentTargetはリスナー終了時にnullへリセットされるため、先に退避しておく
	const anchorElement = ev.currentTarget ?? ev.target;
	const menuItems: MenuItem[] = [];

	// JUICE: 絵文字申請・アバターデコレーション申請機能自体が無効化されているサーバーではメニューに出さない。
	// 設定取得に失敗した場合はメニュー全体が開かなくなるのを避けるため、フェイルオープン(従来通り表示する)にする
	let emojiRequestEnabled = true;
	let avatarDecorationRequestEnabled = true;
	let contactFormEnabled = true;
	try {
		const juicePublicSettings = await juicePublicSettingsCache.fetch();
		emojiRequestEnabled = juicePublicSettings.emojiRequestEnabled;
		avatarDecorationRequestEnabled = juicePublicSettings.avatarDecorationRequestEnabled;
		contactFormEnabled = juicePublicSettings.contactFormEnabled;
	} catch (err) {
		console.error('Failed to fetch juice public settings', err);
	}

	menuItems.push({
		text: instance.name ?? host,
		type: 'label',
	}, {
		type: 'link',
		text: i18n.ts.instanceInfo,
		icon: 'ti ti-info-circle',
		to: '/about',
	}, {
		type: 'link',
		text: i18n.ts.customEmojis,
		icon: 'ti ti-icons',
		to: '/about#emojis',
	});

	if (instance.federation !== 'none') {
		menuItems.push({
			type: 'link',
			text: i18n.ts.federation,
			icon: 'ti ti-whirl',
			to: '/about#federation',
		});
	}

	menuItems.push({
		type: 'link',
		text: i18n.ts.charts,
		icon: 'ti ti-chart-line',
		to: '/about#charts',
	}, { type: 'divider' }, {
		type: 'link',
		text: i18n.ts.ads,
		icon: 'ti ti-ad',
		to: '/ads',
	});

	if ($i && ($i.isAdmin || $i.policies.canInvite) && instance.disableRegistration) {
		menuItems.push({
			type: 'link',
			to: '/invite',
			text: i18n.ts.invite,
			icon: 'ti ti-user-plus',
		});
	}

	if ($i && emojiRequestEnabled) {
		menuItems.push({
			type: 'link',
			text: i18n.ts._juice.emojiRequest,
			icon: 'ti ti-mood-plus',
			to: '/emoji-request',
			badge: true,
		});
	}

	if ($i && avatarDecorationRequestEnabled) {
		menuItems.push({
			type: 'link',
			text: i18n.ts._juice.avatarDecorationRequest,
			icon: 'ti ti-sparkles',
			to: '/avatar-decoration-request',
			badge: true,
		});
	}

	menuItems.push({
		type: 'parent',
		text: i18n.ts.tools,
		icon: 'ti ti-tool',
		children: toolsMenuItems(),
	}, { type: 'divider' }, {
		type: 'link',
		text: i18n.ts.inquiry,
		icon: 'ti ti-help-circle',
		to: '/contact',
	});

	// JUICE: misskey-tempuraのコンタクトフォームを参考に追加
	if (contactFormEnabled) {
		menuItems.push({
			type: 'link',
			text: i18n.ts._contactForm._userForm.contactForm,
			icon: 'ti ti-mail',
			to: '/contact-form',
			badge: true,
		});
	}

	if (instance.impressumUrl) {
		menuItems.push({
			type: 'a',
			text: i18n.ts.impressum,
			icon: 'ti ti-file-invoice',
			href: instance.impressumUrl,
			target: '_blank',
		});
	}

	if (instance.tosUrl) {
		menuItems.push({
			type: 'a',
			text: i18n.ts.termsOfService,
			icon: 'ti ti-notebook',
			href: instance.tosUrl,
			target: '_blank',
		});
	}

	if (instance.privacyPolicyUrl) {
		menuItems.push({
			type: 'a',
			text: i18n.ts.privacyPolicy,
			icon: 'ti ti-shield-lock',
			href: instance.privacyPolicyUrl,
			target: '_blank',
		});
	}

	if (instance.impressumUrl != null || instance.tosUrl != null || instance.privacyPolicyUrl != null) {
		menuItems.push({ type: 'divider' });
	}

	menuItems.push({
		type: 'a',
		text: i18n.ts.document,
		icon: 'ti ti-bulb',
		href: 'https://misskey-hub.net/docs/for-users/',
		target: '_blank',
	});

	if ($i) {
		menuItems.push({
			text: i18n.ts._initialTutorial.launchTutorial,
			icon: 'ti ti-presentation',
			action: async () => {
				const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkTutorialDialog.vue').then(x => x.default), {}, {
					closed: () => dispose(),
				});
			},
		});
	}

	menuItems.push({
		type: 'link',
		text: i18n.ts.aboutMisskey,
		to: '/about-misskey',
	}, {
		type: 'link',
		text: i18n.ts._aboutJuice.title,
		icon: 'ti ti-droplet',
		to: '/about-juice',
		badge: true,
	});

	os.popupMenu(menuItems, anchorElement, {
		align: 'left',
	});
}

export function openToolsMenu(ev: PointerEvent) {
	os.popupMenu(toolsMenuItems(), ev.currentTarget ?? ev.target, {
		align: 'left',
	});
}
