<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: JUICE独自のエントランス。サーバーの紹介・登録と並べて、登録しているユーザー・オンライン・つながっているサーバーの数、タイムライン、人気の投稿を一覧できるようにしたもの -->
<template>
<div v-if="meta" :class="[$style.root, { [$style.withBg]: meta.backgroundImageUrl }]">
	<!-- 管理画面(ブランディング)の「背景画像のURL」。classicと同じく、設定されていればページ全体に敷く -->
	<div v-if="meta.backgroundImageUrl" :class="$style.bg" :style="{ backgroundImage: `url(${ meta.backgroundImageUrl })` }"></div>
	<div :class="$style.container">
		<div :class="$style.side">
			<MkVisitorDashboard mainOnly :translucent="!!meta.backgroundImageUrl"/>
		</div>

		<div :class="$style.body">
			<!-- 数(訪問者にアクティビティを見せない設定のときは出さない) -->
			<div v-if="showActivities" :class="$style.stats">
				<div :class="[$style.panel, $style.stat]">
					<div :class="$style.statIcon"><i class="ti ti-users"></i></div>
					<div :class="$style.statLabel">{{ i18n.ts._juiceEntrance.registeredUsers }}</div>
					<div :class="$style.statValue"><MkNumber v-if="stats" :value="stats.originalUsersCount"/><span v-else>-</span></div>
				</div>
				<div :class="[$style.panel, $style.stat]">
					<div :class="$style.statIcon"><i class="ti ti-access-point"></i></div>
					<div :class="$style.statLabel"><span :class="$style.onlineDot"></span>{{ i18n.ts._juiceEntrance.onlineUsers }}</div>
					<div :class="$style.statValue"><MkNumber v-if="onlineUsersCount != null" :value="onlineUsersCount"/><span v-else>-</span></div>
				</div>
				<div v-if="meta.federation !== 'none'" :class="[$style.panel, $style.stat]">
					<div :class="$style.statIcon"><i class="ti ti-world"></i></div>
					<div :class="$style.statLabel">{{ i18n.ts._juiceEntrance.connectedServers }}</div>
					<div :class="$style.statValue"><MkNumber v-if="stats" :value="stats.instances"/><span v-else>-</span></div>
				</div>
				<div :class="[$style.panel, $style.stat]">
					<div :class="$style.statIcon"><i class="ti ti-pencil"></i></div>
					<div :class="$style.statLabel">{{ i18n.ts._juiceEntrance.notes }}</div>
					<div :class="$style.statValue"><MkNumber v-if="stats" :value="stats.originalNotesCount"/><span v-else>-</span></div>
				</div>
			</div>

			<div :class="[$style.feeds, { [$style.feedsSingle]: !showTimeline }]">
				<section v-if="showTimeline" :class="[$style.panel, $style.feed]">
					<header :class="$style.feedHeader"><i class="ti ti-planet"></i> {{ i18n.ts._juiceEntrance.timeline }}</header>
					<div :class="$style.feedBody">
						<MkStreamingNotesTimeline src="local"/>
					</div>
				</section>
				<section :class="[$style.panel, $style.feed]">
					<header :class="$style.feedHeader"><i class="ti ti-flame"></i> {{ i18n.ts._juiceEntrance.popular }}</header>
					<div :class="$style.feedBody">
						<div v-if="trends.length > 0" :class="$style.tags">
							<MkA v-for="trend in trends" :key="trend.tag" :to="`/tags/${encodeURIComponent(trend.tag)}`" :class="$style.tag" behavior="window">#{{ trend.tag }}</MkA>
						</div>
						<MkNotesTimeline :paginator="featuredPaginator" :withControl="false" :pullToRefresh="false" noGap/>
					</div>
				</section>
			</div>

			<section v-if="showActivities" :class="$style.panel">
				<header :class="$style.feedHeader"><i class="ti ti-chart-bar"></i> {{ i18n.ts.activity }}</header>
				<XActiveUsersChart/>
			</section>

			<!-- つながっているサーバー(よくやり取りしているところから一部だけ) -->
			<section v-if="meta.federation !== 'none' && instances && instances.length > 0" :class="[$style.panel, $style.federation]">
				<header :class="$style.feedHeader"><i class="ti ti-world"></i> {{ i18n.ts._juiceEntrance.someConnectedServers }}</header>
				<div :class="$style.federationBody">
					<MkMarqueeText :duration="40">
						<MkA v-for="instance in instances" :key="instance.id" :class="$style.federationInstance" :to="`/instance-info/${instance.host}`" behavior="window">
							<img v-if="instance.iconUrl" :class="$style.federationInstanceIcon" :src="getInstanceIcon(instance)" alt=""/>
							<span class="_monospace">{{ instance.host }}</span>
						</MkA>
					</MkMarqueeText>
				</div>
			</section>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { markRaw, ref } from 'vue';
import * as Misskey from 'misskey-js';
import { useInterval } from '@@/js/use-interval.js';
import MkVisitorDashboard from '@/components/MkVisitorDashboard.vue';
import MkNumber from '@/components/MkNumber.vue';
import MkMarqueeText from '@/components/MkMarqueeText.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import XActiveUsersChart from '@/components/MkVisitorDashboard.ActiveUsersChart.vue';
import { misskeyApi, misskeyApiGet } from '@/utility/misskey-api.js';
import { getProxiedImageUrl } from '@/utility/media-proxy.js';
import { Paginator } from '@/utility/paginator.js';
import { instance as meta } from '@/instance.js';
import { i18n } from '@/i18n.js';

const showActivities = meta.clientOptions.showActivitiesForVisitor !== false;
const showTimeline = meta.policies.ltlAvailable && meta.clientOptions.showTimelineForVisitor !== false;

const stats = ref<Misskey.entities.StatsResponse | null>(null);
const onlineUsersCount = ref<number | null>(null);
const instances = ref<Misskey.entities.FederationInstance[]>();
const trends = ref<Misskey.entities.HashtagsTrendResponse>([]);

const featuredPaginator = markRaw(new Paginator('notes/featured', {
	limit: 10,
}));

if (showActivities) {
	misskeyApi('stats', {}).then(res => {
		stats.value = res;
	});

	// オンラインの人数は、ウィジェット(WidgetOnlineUsers)と同じように時々読み直す
	useInterval(() => {
		misskeyApiGet('get-online-users-count').then(res => {
			onlineUsersCount.value = res.count;
		});
	}, 1000 * 60, {
		immediate: true,
		afterMounted: true,
	});
}

misskeyApiGet('hashtags/trend').then(res => {
	trends.value = res;
});

if (meta.federation !== 'none') {
	misskeyApiGet('federation/instances', {
		sort: '+pubSub',
		limit: 20,
		blocked: false,
	}).then(res => {
		instances.value = res;
	});
}

function getInstanceIcon(instance: Misskey.entities.FederationInstance): string {
	if (!instance.iconUrl) {
		return '';
	}

	return getProxiedImageUrl(instance.iconUrl, 'preview');
}
</script>

<style lang="scss" module>
.root {
	height: 100cqh;
	overflow: auto;
	overscroll-behavior: contain;
	// 上の方だけアクセント色を薄く敷く
	background:
		linear-gradient(to bottom, color(from var(--MI_THEME-accent) srgb r g b / 0.12), transparent 480px),
		var(--MI_THEME-bg);
}

// 背景画像(固定)。ホイール操作は奪わない(classicの.bgと同じ)
.bg {
	position: fixed;
	inset: 0;
	background-position: center;
	background-size: cover;
	pointer-events: none;
}

.container {
	position: relative;
	box-sizing: border-box;
	display: grid;
	grid-template-columns: 380px minmax(0, 1fr);
	align-items: start;
	gap: 24px;
	max-width: 1400px;
	margin: 0 auto;
	padding: 48px 32px;

	@media (max-width: 1000px) {
		grid-template-columns: minmax(0, 1fr);
		max-width: 640px;
		padding: 24px 16px;
	}
}

.body {
	display: flex;
	flex-direction: column;
	gap: 16px;
	min-width: 0;
	// サーバーの紹介(上のアイコンがはみ出す分の余白がある)と高さを揃える
	padding-top: 32px;

	@media (max-width: 1000px) {
		padding-top: 0;
	}
}

.panel {
	position: relative;
	background: var(--MI_THEME-panel);
	border-radius: var(--MI-radius);
	box-shadow: 0 4px 16px rgb(0 0 0 / 8%);
	overflow: clip;
}

// 背景画像があるときは、パネルを半透明にして(ぼかして)背景画像が透けて見えるようにする。
// タイムライン・人気の中のノートは、読みやすさと「もっと見る」(長いノートを畳んだときのフェード)のため、いつもの地で塗ったままにする
.withBg .panel {
	background: color(from var(--MI_THEME-panel) srgb r g b / 0.8);
	-webkit-backdrop-filter: var(--MI-blur, blur(15px));
	backdrop-filter: var(--MI-blur, blur(15px));
}

.stats {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	gap: 16px;

	@media (max-width: 500px) {
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
}

.stat {
	padding: 16px 20px;
}

.statIcon {
	position: absolute;
	top: 12px;
	right: 14px;
	font-size: 1.6em;
	color: var(--MI_THEME-accent);
	opacity: 0.25;
}

.statLabel {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: 0.9em;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.8);
}

.statValue {
	margin-top: 4px;
	font-size: 1.8em;
	font-weight: bold;
	color: var(--MI_THEME-accent);

	@media (max-width: 500px) {
		font-size: 1.4em;
	}
}

.onlineDot {
	display: inline-block;
	width: 8px;
	height: 8px;
	border-radius: 999px;
	background: var(--MI_THEME-success);
	box-shadow: 0 0 0 3px color(from var(--MI_THEME-success) srgb r g b / 0.25);
}

.feeds {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	gap: 16px;

	@media (max-width: 1250px) {
		grid-template-columns: minmax(0, 1fr);
	}
}

.feedsSingle {
	grid-template-columns: minmax(0, 1fr);
}

.feed {
	display: flex;
	flex-direction: column;
}

.feedHeader {
	padding: 12px 16px;
	border-bottom: solid 1px var(--MI_THEME-divider);
	font-weight: bold;
}

// 中身が少ないとき(人気の投稿が無いなど)は縮める
.feedBody {
	max-height: 600px;
	overflow: auto;

	@media (max-width: 1000px) {
		max-height: 480px;
	}
}

.tags {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	padding: 12px 16px;
	border-bottom: solid 1px var(--MI_THEME-divider);
}

.tag {
	padding: 2px 10px;
	border-radius: 999px;
	background: var(--MI_THEME-buttonBg);
	font-size: 0.9em;

	&:hover {
		text-decoration: none;
		background: var(--MI_THEME-buttonHoverBg);
	}
}

.federationBody {
	padding: 10px 0;
}

.federationInstance {
	display: inline-flex;
	align-items: center;
	vertical-align: bottom;
	padding: 6px 12px 6px 6px;
	margin: 0 10px 0 0;
	background: var(--MI_THEME-buttonBg);
	border-radius: 999px;
}

.federationInstanceIcon {
	display: inline-block;
	width: 20px;
	height: 20px;
	margin-right: 5px;
	border-radius: 999px;
}
</style>
