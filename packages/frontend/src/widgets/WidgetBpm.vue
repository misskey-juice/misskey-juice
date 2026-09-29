<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: タップ・クリック、またはタイムライン・通知の速さでBPM(1分あたりの拍の数)を測り、メトロノームを鳴らせるウィジェット -->
<template>
<MkContainer :showHeader="widgetProps.showHeader" class="mkw-bpm">
	<template #icon><i class="ti ti-metronome"></i></template>
	<template #header>{{ i18n.ts._widgets.bpm }}</template>
	<template #func="{ buttonStyleClass }"><button class="_button" :class="buttonStyleClass" :aria-label="i18n.ts._juice.bpmReset" @click="reset"><i class="ti ti-refresh"></i></button></template>

	<div :class="$style.root">
		<div :class="$style.value" :aria-live="isTap ? 'polite' : 'off'">
			<span :class="[$style.beat, { [$style.beatActive]: beating }]" aria-hidden="true"></span>
			<span :class="$style.number">{{ bpmText }}</span>
			<span :class="$style.unit">BPM</span>
		</div>
		<button
			class="_button"
			:class="[$style.metronomeToggle, { [$style.metronomeToggleOn]: widgetProps.metronome }]"
			:aria-pressed="widgetProps.metronome"
			@click="toggleMetronome"
		>
			<i :class="widgetProps.metronome ? 'ti ti-volume' : 'ti ti-volume-off'"></i> {{ i18n.ts._juice.bpmMetronome }}
		</button>
		<template v-if="isTap">
			<div :class="$style.meta">{{ i18n.tsx._juice.bpmTaps({ n: taps.length }) }}</div>
			<button
				class="_button"
				:class="[$style.tap, { [$style.tapActive]: flashing }]"
				:aria-label="i18n.ts._juice.bpmTap"
				@pointerdown.prevent="tap"
				@keydown.space.prevent="onKeyTap"
				@keydown.enter.prevent="onKeyTap"
				@click="onClickTap"
			>
				<i class="ti ti-hand-finger"></i> {{ i18n.ts._juice.bpmTap }}
			</button>
			<div :class="$style.hint">{{ i18n.ts._juice.bpmHint }}</div>
		</template>
		<template v-else>
			<div :class="$style.meta">{{ sourceLabel }} · {{ i18n.tsx._juice.bpmEvents({ n: events.length }) }}</div>
			<div :class="$style.hint">{{ i18n.ts._juice.bpmStreamHint }}</div>
		</template>
	</div>
</MkContainer>
</template>

<script lang="ts" setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import { useWidgetPropsManager } from './widget.js';
import type { WidgetComponentEmits, WidgetComponentExpose, WidgetComponentProps } from './widget.js';
import type { FormWithDefault, GetFormResultType } from '@/utility/form.js';
import { i18n } from '@/i18n.js';
import { useStream } from '@/stream.js';
import { prefer } from '@/preferences.js';
import * as sound from '@/utility/sound.js';
import { soundsTypes } from '@/utility/sound.js';
import MkContainer from '@/components/MkContainer.vue';

const name = 'bpm';

// JUICE: 何の速さを測るか。タップのほかに、タイムラインに流れてくる投稿・届く通知の速さをBPMにできる
const sourceOptions = [
	{ label: i18n.ts._juice.bpmSourceTap, value: 'tap' },
	{ label: i18n.ts._timelines.home, value: 'home' },
	{ label: i18n.ts._timelines.local, value: 'local' },
	{ label: i18n.ts._timelines.social, value: 'social' },
	{ label: i18n.ts._timelines.global, value: 'global' },
	{ label: i18n.ts._juice.mediaTimelineTab, value: 'media' },
	{ label: i18n.ts._juice.relayTimelineTab, value: 'relay' },
	{ label: i18n.ts.notifications, value: 'notifications' },
] as const;
type Source = typeof sourceOptions[number]['value'];

const soundEnumOptions = soundsTypes
	.filter((t): t is Exclude<typeof soundsTypes[number], null | '_driveFile_'> => t != null && t !== '_driveFile_')
	.map(t => ({ label: t, value: t }));

const widgetPropsDef = {
	showHeader: {
		type: 'boolean',
		label: i18n.ts._widgetOptions.showHeader,
		default: true,
	},
	source: {
		type: 'enum',
		label: i18n.ts._widgetOptions._bpm.source,
		enum: [...sourceOptions],
		default: 'tap' as Source,
	},
	metronome: {
		type: 'boolean',
		label: i18n.ts._widgetOptions._bpm.metronome,
		default: false,
	},
	metronomeSound: {
		type: 'enum',
		label: i18n.ts._widgetOptions._bpm.metronomeSound,
		enum: soundEnumOptions,
		default: 'syuilo/pope1',
	},
} satisfies FormWithDefault;

type WidgetProps = GetFormResultType<typeof widgetPropsDef>;

const props = defineProps<WidgetComponentProps<WidgetProps>>();
const emit = defineEmits<WidgetComponentEmits<WidgetProps>>();

const { widgetProps, configure, save } = useWidgetPropsManager(name,
	widgetPropsDef,
	props,
	emit,
);

const isTap = computed(() => widgetProps.source === 'tap');
const sourceLabel = computed(() => sourceOptions.find(o => o.value === widgetProps.source)?.label ?? '');

//#region タップ
// この時間(ms)より間が空いたら、測り直す
const RESET_AFTER_MS = 2000;
// テンポの変化に付いていけるよう、直近のこの数の間隔の平均で測る
const WINDOW = 16;

const taps = ref<number[]>([]);
const flashing = ref(false);
let flashTimer: number | null = null;

const tapBpm = computed(() => {
	const t = taps.value;
	if (t.length < 2) return null;
	const recent = t.slice(-(WINDOW + 1));
	const interval = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
	return interval > 0 ? 60000 / interval : null;
});

function tap(): void {
	const now = performance.now();
	const last = taps.value.at(-1);
	taps.value = last != null && now - last > RESET_AFTER_MS ? [now] : [...taps.value, now].slice(-(WINDOW + 1));
	// 押したことが分かるよう、一瞬だけ色を変える
	flashing.value = true;
	if (flashTimer != null) window.clearTimeout(flashTimer);
	flashTimer = window.setTimeout(() => {
		flashing.value = false;
	}, 80);
}
//#endregion

//#region タイムライン・通知
// 直近1分に届いた数をBPMにする(測り始めて1分たつまでは、たった時間で割る)
const STREAM_WINDOW_MS = 60000;
// 測り始めてすぐは数が少なくて大きく振れるので、これより前は出さない
const STREAM_MIN_ELAPSED_MS = 5000;

const events = ref<number[]>([]);
const startedAt = ref(Date.now());
const now = ref(Date.now());
const clock = window.setInterval(() => {
	now.value = Date.now();
	const since = now.value - STREAM_WINDOW_MS;
	if (events.value.length > 0 && events.value[0] < since) events.value = events.value.filter(t => t >= since);
}, 1000);

const streamBpm = computed(() => {
	const elapsed = Math.min(STREAM_WINDOW_MS, now.value - startedAt.value);
	if (elapsed < STREAM_MIN_ELAPSED_MS) return null;
	return events.value.length * 60000 / elapsed;
});

function onEvent(): void {
	events.value = [...events.value, Date.now()];
}

const stream = useStream();
let disconnect: (() => void) | null = null;

function connect(source: Source): void {
	disconnect?.();
	disconnect = null;
	events.value = [];
	startedAt.value = Date.now();
	now.value = startedAt.value;
	if (source === 'tap') return;
	if (source === 'notifications') {
		const connection = stream.useChannel('main');
		connection.on('notification', onEvent);
		disconnect = () => connection.dispose();
		return;
	}
	if (source === 'relay') {
		// リレータイムラインの画面と同じく、JUICE設定の「表示するリレー」で絞り込む
		const relayIds = prefer.s.relayTimelineFilter;
		const connection = stream.useChannel('relayTimeline', { withRenotes: true, relayIds: relayIds.length > 0 ? relayIds : undefined });
		connection.on('note', onEvent);
		disconnect = () => connection.dispose();
		return;
	}
	// メディアタイムラインは、その画面で選んでいるタイムラインのファイル付きの投稿だけを数える
	const base = source === 'media' ? prefer.s.mediaTimelineSrc : source;
	const channel = ({ home: 'homeTimeline', local: 'localTimeline', social: 'hybridTimeline', global: 'globalTimeline' } as const)[base];
	const connection = stream.useChannel(channel, { withRenotes: true, withFiles: source === 'media' ? true : undefined });
	connection.on('note', onEvent);
	disconnect = () => connection.dispose();
}

watch(() => widgetProps.source, connect, { immediate: true });
// メディア・リレーは、メディアタイムラインの対象・表示するリレーの設定を変えたらつなぎ直す
watch([() => prefer.r.mediaTimelineSrc.value, () => prefer.r.relayTimelineFilter.value.join(',')], () => {
	if (widgetProps.source === 'media' || widgetProps.source === 'relay') connect(widgetProps.source);
});
//#endregion

const bpm = computed(() => (isTap.value ? tapBpm.value : streamBpm.value));
const bpmText = computed(() => (bpm.value == null ? '--' : bpm.value.toFixed(1)));

// キーを押しっぱなしにしたときの繰り返しは数えない
function onKeyTap(ev: KeyboardEvent): void {
	if (ev.repeat) return;
	tap();
}

// スクリーンリーダーやスイッチ操作ではpointerdownが来ずclickだけが来るので、それも数える
// (マウス・タッチのclickはpointerdownで数えているのでdetailが1以上。キーボード・支援技術のclickはdetailが0。
// キーボードのclickは上のkeydownで止めているので、ここに来るのは支援技術から)
function onClickTap(ev: MouseEvent): void {
	if (ev.detail === 0) tap();
}

function reset(): void {
	taps.value = [];
	events.value = [];
	startedAt.value = Date.now();
	now.value = startedAt.value;
}

//#region メトロノーム
// 速すぎて音が重なり続けないよう、鳴らすのはこの範囲のBPMだけにする
const METRONOME_MIN_BPM = 1;
const METRONOME_MAX_BPM = 400;

const beating = ref(false);
let beatTimer: number | null = null;
let metronomeTimer: number | null = null;
let metronomeBuffer: AudioBuffer | null = null;

watch(() => widgetProps.metronomeSound, (soundType) => {
	metronomeBuffer = null;
	sound.loadAudio(`/client-assets/sounds/${soundType}.mp3`).then(buf => {
		if (buf != null && soundType === widgetProps.metronomeSound) metronomeBuffer = buf;
	}).catch(() => {});
}, { immediate: true });

function beat(): void {
	beating.value = true;
	if (beatTimer != null) window.clearTimeout(beatTimer);
	beatTimer = window.setTimeout(() => {
		beating.value = false;
	}, 100);

	const masterVolume = prefer.s['sound.masterVolume'];
	if (metronomeBuffer != null && masterVolume > 0 && !sound.isMute()) {
		sound.createSourceNode(metronomeBuffer, { volume: masterVolume }).soundSource.start();
	}
}

// 1拍ごとに、その時のBPMで次の拍までの間を決める(BPMが変わってもすぐ付いていく)
function scheduleBeat(): void {
	if (metronomeTimer != null) window.clearTimeout(metronomeTimer);
	metronomeTimer = null;
	if (!widgetProps.metronome) return;
	const value = bpm.value;
	if (value == null || value < METRONOME_MIN_BPM) {
		// まだ測れていなければ、測れるまで待つ
		metronomeTimer = window.setTimeout(scheduleBeat, 500);
		return;
	}
	metronomeTimer = window.setTimeout(() => {
		beat();
		scheduleBeat();
	}, 60000 / Math.min(value, METRONOME_MAX_BPM));
}

watch(() => widgetProps.metronome, scheduleBeat, { immediate: true });

// 設定を開かなくても、ウィジェットからすぐ切り替えられるように
function toggleMetronome(): void {
	widgetProps.metronome = !widgetProps.metronome;
	save();
}
//#endregion

onUnmounted(() => {
	window.clearInterval(clock);
	if (metronomeTimer != null) window.clearTimeout(metronomeTimer);
	if (beatTimer != null) window.clearTimeout(beatTimer);
	if (flashTimer != null) window.clearTimeout(flashTimer);
	disconnect?.();
});

defineExpose<WidgetComponentExpose>({
	name,
	configure,
	id: props.widget ? props.widget.id : null,
});
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 6px;
	padding: 12px 16px 16px;
}

.value {
	display: flex;
	align-items: baseline;
	gap: 6px;
}

// メトロノームの拍に合わせて光る
.beat {
	align-self: center;
	width: 8px;
	height: 8px;
	border-radius: 50%;
	background: var(--MI_THEME-divider);
	transition: background 0.1s;
}

.beatActive {
	background: var(--MI_THEME-accent);
	transition: none;
}

.number {
	font-size: 2.4em;
	font-weight: bold;
	font-variant-numeric: tabular-nums;
}

.unit {
	opacity: 0.7;
}

.metronomeToggle {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 4px 12px;
	border-radius: 999px;
	font-size: 0.85em;
	background: var(--MI_THEME-buttonBg);
	color: color-mix(in srgb, var(--MI_THEME-fg), transparent 30%);

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&:focus-visible {
		outline: 2px solid var(--MI_THEME-focus);
	}
}

.metronomeToggleOn {
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);

	&:hover {
		background: var(--MI_THEME-accentedBg);
	}
}

.meta,
.hint {
	font-size: 0.8em;
	opacity: 0.7;
}

.tap {
	width: 100%;
	padding: 18px 0;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-buttonBg);
	font-weight: bold;
	// 連打しても文字が選択されたり、ダブルタップで拡大されたりしないように
	user-select: none;
	touch-action: manipulation;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&:focus-visible {
		outline: 2px solid var(--MI_THEME-focus);
	}
}

.tapActive {
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
}
</style>
