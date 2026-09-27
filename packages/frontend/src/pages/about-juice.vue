<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div style="overflow: clip;">
		<div class="_spacer" style="--MI_SPACER-w: 600px; --MI_SPACER-min: 20px;">
			<div class="_gaps_m">
				<div v-panel :class="$style.banner" :style="{ '--rain-angle': `${rainAngle}deg` }">
					<img
						src="/client-assets/juice-icon-transparent.png" alt=""
						:class="$style.bannerIcon" draggable="false"
						role="button" tabindex="0"
						@click="startRain"
						@keydown.enter="startRain"
						@keydown.space.prevent="startRain"
					/>
					<div :class="$style.bannerName">misskey-juice</div>
					<div :class="$style.bannerVersion">v{{ version }}</div>
					<span
						v-for="drop in rainDrops"
						:key="drop.id"
						:class="$style.rainDrop"
						:style="{ left: `${drop.left}%`, animationDelay: `${drop.delay}s`, animationDuration: `${drop.duration}s` }"
					></span>
				</div>

				<MkInfo warn>
					<div class="_gaps_s">
						<div>{{ i18n.ts._aboutJuice.selfHostingNoticeWarning }}</div>
						<div :class="$style.selfHostingNoticeLinks">
							<a href="https://mq1.dev/entry/krpvl5itbr9h#h0cb67a7186" target="_blank" rel="noopener" class="_link">{{ i18n.ts._aboutJuice.selfHostingNoticeLinkText }}</a>
							<a href="https://misskey-hub.net/ja/docs/for-admin/install/guides/" target="_blank" rel="noopener" class="_link">{{ i18n.ts._aboutJuice.selfHostingNoticeOfficialGuideLinkText }}</a>
						</div>
						<div>{{ i18n.ts._aboutJuice.selfHostingNoticeGeneralApplicability }}</div>
					</div>
				</MkInfo>

				<MkKeyValue>
					<template #key>{{ i18n.ts._aboutJuice.description }}</template>
					<template #value>{{ i18n.ts._aboutJuice.descriptionText }}</template>
				</MkKeyValue>

				<FormSection>
					<template #label>{{ i18n.ts._aboutJuice.developer }}</template>
					<a href="https://github.com/Zel9278" target="_blank" :class="$style.developer">
						<img src="https://github.com/Zel9278.png" alt="" :class="$style.developerAvatar"/>
						<span :class="$style.developerName">c30 (Zel9278)</span>
					</a>
				</FormSection>

				<FormSection>
					<template #label>{{ i18n.ts._aboutJuice.contributors }}</template>
					<div :class="$style.contributors">
						<a
							v-for="contributor in contributors"
							:key="contributor.name"
							:href="contributor.url"
							target="_blank"
							:class="$style.developer"
						>
							<img :src="contributor.avatar" alt="" :class="$style.developerAvatar"/>
							<span :class="$style.developerName">{{ contributor.name }}</span>
						</a>
					</div>
				</FormSection>

				<FormSection>
					<template #label>{{ i18n.ts._aboutJuice.sourceAndLicense }}</template>
					<div class="_gaps_s">
						<FormLink to="https://github.com/misskey-juice/misskey-juice" external>
							<template #icon><i class="ti ti-code"></i></template>
							{{ i18n.ts._aboutMisskey.source }}
							<template #suffix>GitHub</template>
						</FormLink>
						<MkKeyValue>
							<template #key>{{ i18n.ts.license }}</template>
							<template #value>AGPL-3.0-only</template>
						</MkKeyValue>
					</div>
				</FormSection>

				<FormSection>
					<template #label>{{ i18n.ts._aboutJuice.midiSoundfont }}</template>
					<div class="_gaps_s">
						<div>{{ i18n.ts._aboutJuice.midiSoundfontText }}</div>
						<FormLink to="https://github.com/mrbumpy409/GeneralUser-GS" external>
							<template #icon><i class="ti ti-music"></i></template>
							GeneralUser GS
							<template #suffix>GitHub</template>
						</FormLink>
						<MkKeyValue>
							<template #key>{{ i18n.ts.license }}</template>
							<template #value>{{ i18n.ts._aboutJuice.midiSoundfontLicense }}</template>
						</MkKeyValue>
					</div>
				</FormSection>

				<FormSection>
					<template #label>{{ i18n.ts._aboutJuice.midiSynth }}</template>
					<div class="_gaps_s">
						<div>{{ i18n.ts._aboutJuice.midiSynthText }}</div>
						<FormLink to="https://github.com/jet2jet/js-synthesizer" external>
							<template #icon><i class="ti ti-code"></i></template>
							js-synthesizer
							<template #suffix>GitHub</template>
						</FormLink>
						<MkKeyValue>
							<template #key>{{ i18n.ts.license }}</template>
							<template #value>BSD-3-Clause</template>
						</MkKeyValue>
						<FormLink to="https://www.fluidsynth.org/" external>
							<template #icon><i class="ti ti-code"></i></template>
							FluidSynth
							<template #suffix>fluidsynth.org</template>
						</FormLink>
						<MkKeyValue>
							<template #key>{{ i18n.ts.license }}</template>
							<template #value>LGPL-2.1-only</template>
						</MkKeyValue>
					</div>
				</FormSection>

				<FormSection>
					<template #label>{{ i18n.ts._aboutJuice.inspiredBy }}</template>
					<div class="_gaps_s">
						<FormLink to="https://github.com/kokonect-link/cherrypick" external>
							<template #icon><i class="ti ti-bulb"></i></template>
							CherryPick
							<template #suffix>GitHub</template>
						</FormLink>
						<FormLink to="https://github.com/lqvp/misskey-tempura" external>
							<template #icon><i class="ti ti-bulb"></i></template>
							misskey-tempura
							<template #suffix>GitHub</template>
						</FormLink>
						<FormLink to="https://github.com/harumaki2000/misskey-springroll" external>
							<template #icon><i class="ti ti-bulb"></i></template>
							misskey-springroll
							<template #suffix>GitHub</template>
						</FormLink>
						<FormLink to="https://github.com/pixelfed/pixelfed" external>
							<template #icon><i class="ti ti-bulb"></i></template>
							PixelFed
							<template #suffix>GitHub</template>
						</FormLink>
						<!-- JUICE: 投稿の編集(ActivityPubのUpdate)の受け取りは、この2つの形式・振る舞いに合わせたので横に並べる -->
						<div :class="$style.inspiredPair">
							<FormLink to="https://github.com/mastodon/mastodon" external>
								<template #icon><i class="ti ti-bulb"></i></template>
								Mastodon
								<template #suffix>GitHub</template>
							</FormLink>
							<FormLink to="https://github.com/fedibird/mastodon" external>
								<template #icon><i class="ti ti-bulb"></i></template>
								Fedibird
								<template #suffix>GitHub</template>
							</FormLink>
						</div>
					</div>
				</FormSection>

				<MkFolder>
					<template #icon><i class="ti ti-stars"></i></template>
					<template #label>{{ i18n.ts._aboutJuice.features }}</template>
					<div class="_gaps_m">
						<MkInfo v-if="reactionPiggybackOnRemoteEnabled" warn>
							<div class="_gaps_s">
								<div>{{ i18n.ts._aboutJuice.reactionPiggybackOnRemoteWarningLicense }}</div>
								<I18n :src="i18n.ts._aboutJuice.reactionPiggybackOnRemoteWarningTestNotice" tag="div">
								<template #juiceServer>
									<a href="https://mk-juice.dev" target="_blank" rel="noopener" class="_link">{{ i18n.ts._aboutJuice.reactionPiggybackOnRemoteWarningTestNoticeLinkText }}</a>
								</template>
							</I18n>
							</div>
						</MkInfo>
						<div :class="$style.features">
							<div v-for="feature in features" :key="feature.text" :class="$style.feature">
								<i :class="[feature.icon, $style.featureIcon]"></i>
								<span :class="$style.featureText">{{ feature.text }}</span>
							</div>
						</div>
					</div>
				</MkFolder>

				<MkFolder>
					<template #icon><i class="ti ti-route"></i></template>
					<template #label>{{ i18n.ts._aboutJuice.route }}</template>
					<ol :class="$style.route">
						<li v-for="step in routeSteps" :key="step.title" :class="$style.routeStep">
							<div :class="$style.routeStepBody">
								<div :class="$style.routeStepTitle">{{ step.title }}</div>
								<div :class="$style.routeStepDesc">{{ step.desc }}</div>
							</div>
						</li>
					</ol>
				</MkFolder>

				<FormLink to="/about-misskey">
					<template #icon><i class="ti ti-info-circle"></i></template>
					{{ i18n.ts.aboutMisskey }}
				</FormLink>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import { version } from '@@/js/config.js';
import FormLink from '@/components/form/link.vue';
import FormSection from '@/components/form/section.vue';
import MkKeyValue from '@/components/MkKeyValue.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkInfo from '@/components/MkInfo.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { claimAchievement } from '@/utility/achievements.js';
import { juicePublicSettingsCache } from '@/cache.js';

// JUICE: 相乗りリアクションが有効な間、著作権に関する注意書きを表示するために取得
const reactionPiggybackOnRemoteEnabled = ref((await juicePublicSettingsCache.fetch()).reactionPiggybackOnRemoteEnabled);

// JUICE: PRを送ってくれたコントリビューター一覧(開発者本人は上の developer セクションで別掲)
const contributors = [
	{ name: 'chan-mai', url: 'https://github.com/chan-mai', avatar: 'https://github.com/chan-mai.png' },
];

const features = [
	{ icon: 'ti ti-user-check', text: i18n.ts._aboutJuice._features.approvalSignup },
	{ icon: 'ti ti-ai', text: i18n.ts._aboutJuice._features.aiGenerated },
	{ icon: 'ti ti-mood-plus', text: i18n.ts._aboutJuice._features.emojiRequest },
	{ icon: 'ti ti-frame', text: i18n.ts._aboutJuice._features.avatarDecorationRequest },
	{ icon: 'ti ti-world', text: i18n.ts._aboutJuice._features.remoteAvatarDecorations },
	{ icon: 'ti ti-pencil', text: i18n.ts._aboutJuice._features.remoteNoteEdit },
	{ icon: 'ti ti-replace', text: i18n.ts._aboutJuice._features.requestReplacement },
	{ icon: 'ti ti-shield-check', text: i18n.ts._aboutJuice._features.roleApprovalDelegation },
	{ icon: 'ti ti-arrows-join', text: i18n.ts._aboutJuice._features.reactionPiggyback },
	{ icon: 'ti ti-world-search', text: i18n.ts._aboutJuice._features.postLanguage },
	{ icon: 'ti ti-filter-search', text: i18n.ts._aboutJuice._features.advancedNoteSearch },
	{ icon: 'ti ti-trophy', text: i18n.ts._aboutJuice._features.ranking },
	{ icon: 'ti ti-broadcast', text: i18n.ts._aboutJuice._features.relayTimeline },
	{ icon: 'ti ti-photo', text: i18n.ts._aboutJuice._features.mediaTimeline },
	{ icon: 'ti ti-language', text: i18n.ts._aboutJuice._features.emailI18n },
	{ icon: 'ti ti-arrow-bar-to-left', text: i18n.ts._aboutJuice._features.widgetsSide },
	{ icon: 'ti ti-mood-happy', text: i18n.ts._aboutJuice._features.announcementReaction },
	{ icon: 'ti ti-list-check', text: i18n.ts._aboutJuice._features.announcementPoll },
	{ icon: 'ti ti-math-function', text: i18n.ts._aboutJuice._features.latex },
	{ icon: 'ti ti-tag', text: i18n.ts._aboutJuice._features.nickname },
	{ icon: 'ti ti-shield-exclamation', text: i18n.ts._aboutJuice._features.loginFailedNotification },
	{ icon: 'ti ti-mail', text: i18n.ts._aboutJuice._features.contactForm },
	{ icon: 'ti ti-message-report', text: i18n.ts._aboutJuice._features.reportCategories },
	{ icon: 'ti ti-bell-exclamation', text: i18n.ts._aboutJuice._features.moderationNotifications },
	{ icon: 'ti ti-brand-oauth', text: i18n.ts._aboutJuice._features.oauthLogin },
	{ icon: 'ti ti-piano', text: i18n.ts._aboutJuice._features.midiPlayer },
	{ icon: 'ti ti-book', text: i18n.ts._aboutJuice._features.novel },
	{ icon: 'ti ti-palette', text: i18n.ts._aboutJuice._features.drawRoom },
	{ icon: 'ti ti-writing', text: i18n.ts._aboutJuice._features.novelEditor },
	{ icon: 'ti ti-search', text: i18n.ts._aboutJuice._features.mfmSearchEngine },
];

// JUICE: この一覧に載っている機能が、どういう経路で実装されたかをざっくり示す
const routeSteps = [
	{ title: i18n.ts._aboutJuice._route.base, desc: i18n.ts._aboutJuice._route.baseDesc },
	{ title: i18n.ts._aboutJuice._route.misskeyArt, desc: i18n.ts._aboutJuice._route.misskeyArtDesc },
	{ title: i18n.ts._aboutJuice._route.roadmap, desc: i18n.ts._aboutJuice._route.roadmapDesc },
	{ title: i18n.ts._aboutJuice._route.additional, desc: i18n.ts._aboutJuice._route.additionalDesc },
];

// JUICE: アイコンクリックでオレンジの雨が降るイースターエッグ
const RAIN_DROP_COUNT = 40;
// delay(最大0.4s)+duration(最大0.9s)より確実に長くする(アニメ完了前に消去されて欠けて見えるのを防ぐ)
const RAIN_DURATION_MS = 2000;
const RAIN_MAX_ANGLE = 25; // 度、左右にこの範囲でランダムに傾く

const rainDrops = ref<{ id: string; left: number; delay: number; duration: number }[]>([]);
const rainAngle = ref(0);
let rainTimeoutId: number | undefined;
// クリックのたびに要素を確実に再マウントさせてアニメーションを最初から再生させるためのバースト番号
let rainBurstId = 0;

function startRain() {
	claimAchievement('juiceRain');

	if (rainTimeoutId != null) window.clearTimeout(rainTimeoutId);

	rainAngle.value = (Math.random() * 2 - 1) * RAIN_MAX_ANGLE;
	rainBurstId++;

	rainDrops.value = Array.from({ length: RAIN_DROP_COUNT }, (_, i) => ({
		id: `${rainBurstId}-${i}`,
		left: Math.random() * 100,
		delay: Math.random() * 0.4,
		duration: 0.5 + Math.random() * 0.4,
	}));

	rainTimeoutId = window.setTimeout(() => {
		rainDrops.value = [];
		rainTimeoutId = undefined;
	}, RAIN_DURATION_MS);
}

onBeforeUnmount(() => {
	if (rainTimeoutId != null) window.clearTimeout(rainTimeoutId);
});

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts._aboutJuice.title,
	icon: 'ti ti-droplet',
}));
</script>

<style lang="scss" module>
.inspiredPair {
	display: grid;
	// 狭い画面では1列に戻す
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 8px;
}

// JUICEブランドカラー(テーマの--MI_THEME-accent等はユーザー設定で変わるため、雨の色は固定にする)
$juice-rain-color: #f2841f;

.banner {
	position: relative;
	overflow: hidden;
	border-radius: var(--MI-radius);
	padding: 32px 16px;
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
}

.bannerIcon {
	width: 72px;
	height: 72px;
	position: relative;
	z-index: 1;
	cursor: pointer;
}

.bannerName {
	margin-top: 0.5em;
	font-weight: bold;
	font-size: 1.2em;
	position: relative;
	z-index: 1;
}

.bannerVersion {
	opacity: 0.5;
	position: relative;
	z-index: 1;
}

// JUICE: アイコンクリックで降らせるオレンジの雨(細い線)。--rain-angleはクリックのたびにランダムに変わる
.rainDrop {
	position: absolute;
	top: -100px;
	width: 2px;
	height: 90px;
	background: linear-gradient(to bottom, transparent, $juice-rain-color, transparent);
	pointer-events: none;
	animation-name: juiceRain;
	animation-timing-function: linear;
	animation-fill-mode: forwards;
}

@keyframes juiceRain {
	0% {
		transform: rotate(var(--rain-angle)) translateY(0);
		opacity: 0;
	}
	15% {
		opacity: 1;
	}
	100% {
		transform: rotate(var(--rain-angle)) translateY(340px);
		opacity: 0;
	}
}

.selfHostingNoticeLinks {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.developer {
	display: flex;
	align-items: center;
	padding: 12px;
	background: var(--MI_THEME-buttonBg);
	border-radius: 8px;

	&:hover {
		text-decoration: none;
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.developerAvatar {
	width: 42px;
	height: 42px;
	border-radius: 100%;
}

.developerName {
	margin-left: 12px;
	font-weight: bold;
}

.contributors {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
	grid-gap: 12px;
}

.features {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
	grid-gap: 12px;
}

.feature {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px;
	background: var(--MI_THEME-buttonBg);
	border-radius: 8px;
	line-height: 1.4;
}

.featureIcon {
	flex-shrink: 0;
	font-size: 20px;
	color: var(--MI_THEME-accent);
}

// JUICE: 「Discord/Google/GitHub/GitLab/Microsoft」のように区切り位置の無い長い英字列がカードの
// 外へはみ出さないよう、必要なら単語の途中でも折り返す(flexの子はmin-widthが中身の幅になるため0に)
.featureText {
	min-width: 0;
	overflow-wrap: anywhere;
}

// JUICE: 「どういう経路で実装されたか」の折りたたみ表示
.route {
	counter-reset: route-step;
	list-style: none;
	padding: 0;
	margin: 0;
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.routeStep {
	display: flex;
	gap: 8px;
	word-break: break-word;

	&::before {
		flex-shrink: 0;
		display: flex;
		counter-increment: route-step;
		content: counter(route-step);
		width: 28px;
		height: 28px;
		line-height: 28px;
		background-color: var(--MI_THEME-accentedBg);
		color: var(--MI_THEME-accent);
		font-size: 13px;
		font-weight: bold;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
	}
}

.routeStepBody {
	padding-top: 2px;
}

.routeStepTitle {
	font-weight: bold;
}

.routeStepDesc {
	margin-top: 2px;
	font-size: 0.9em;
	opacity: 0.75;
}
</style>
