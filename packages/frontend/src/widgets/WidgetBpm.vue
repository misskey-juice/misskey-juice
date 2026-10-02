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
// JUICE: 拍は、音の時計(AudioContextのcurrentTime)で少し先まで決めておき、その時刻に鳴らす。
// setTimeoutで1拍ずつ待つと、待ちの遅れが積み重なって測ったBPMより遅くなり、画面を見ていないタブでは
// ブラウザがタイマーを1秒に1回ほどに減らすので、BPM60あたりで頭打ちになるため
// BPMの上限は無い。ただし1秒に100拍(BPM6000)を超える速さでは、音を1拍ずつ作ると重くなり画面が固まるので、
// 決めきれない分は飛ばす(その速さでは、もう拍ではなく1つの音にしか聞こえない)
const METRONOME_MIN_BPM = 1;
const METRONOME_MAX_BEATS_PER_SECOND = 100;
// 同時に鳴らす音の数の上限。音は最後まで鳴らし、速くてこれより多く重なるときだけ、古い音から止める
// (重なる数に上限が無いと、速いときに何千もの音が同時に鳴って重くなるため)
const METRONOME_MAX_VOICES = 32;
// 光らせるのはこの間隔(秒)より拍が長いときだけ(速いときは、光ったままにする)
const FLASH_MIN_INTERVAL_S = 0.05;
// 先に決めておく時間(秒)。見ていないタブではタイマーが1秒に1回ほどになるので、それより長くする
const LOOKAHEAD_VISIBLE_S = 0.1;
const LOOKAHEAD_HIDDEN_S = 1.5;
// 拍を決め直す間隔(ms)
const SCHEDULER_TICK_MS = 25;

const beating = ref(false);
let beatTimer: number | null = null;
let metronomeTimer: number | null = null;
let metronomeBuffer: AudioBuffer | null = null;
// 次の拍の時刻(秒。clockの時計で)。止めたら・時計を替えたらnull
let nextBeatAt: number | null = null;
let clockKind: 'audio' | 'performance' | null = null;
// 音の時計を動かし直している途中か
let resuming = false;
// 鳴らす予定・鳴っている音(鳴らし始める順。止めるときは、まだ鳴っていない分も止める)
const scheduledSources: AudioBufferSourceNode[] = [];
// 重なりすぎて、途中で止める時刻を決めた音(メトロノームを止めたときは、その時刻を待たずに止める)
const evictedSources = new Set<AudioBufferSourceNode>();
// 光らせる予定のタイマー
const flashTimers = new Set<number>();

watch(() => widgetProps.metronomeSound, (soundType) => {
	metronomeBuffer = null;
	sound.loadAudio(`/client-assets/sounds/${soundType}.mp3`).then(buf => {
		if (buf != null && soundType === widgetProps.metronomeSound) metronomeBuffer = buf;
	}).catch(() => {});
}, { immediate: true });

function flash(): void {
	beating.value = true;
	if (beatTimer != null) window.clearTimeout(beatTimer);
	beatTimer = window.setTimeout(() => {
		beating.value = false;
	}, 100);
}

// 今の時刻(秒)。音が鳴らせる(AudioContextが動いている)ならその時計、まだ動いていなければ画面の時計(光らせるだけ)
function currentClock(): { kind: 'audio' | 'performance'; now: number; ctx: AudioContext | null } {
	const ctx = sound.getAudioContext();
	if (ctx != null && ctx.state === 'running') return { kind: 'audio', now: ctx.currentTime, ctx };
	return { kind: 'performance', now: performance.now() / 1000, ctx: null };
}

// 1拍を、時計の時刻atに鳴らす(光らせる)
function scheduleBeatAt(at: number, now: number, ctx: AudioContext | null, withFlash: boolean): void {
	if (withFlash) {
		const delayMs = Math.max(0, (at - now) * 1000);
		const timer = window.setTimeout(() => {
			flashTimers.delete(timer);
			flash();
		}, delayMs);
		flashTimers.add(timer);
	}

	const masterVolume = prefer.s['sound.masterVolume'];
	if (ctx == null || metronomeBuffer == null || masterVolume <= 0 || sound.isMute()) return;
	const source = sound.createSourceNode(metronomeBuffer, { volume: masterVolume }).soundSource;
	source.start(at);
	// 重なりすぎるときは、一番古い音をこの拍で止める
	if (scheduledSources.length >= METRONOME_MAX_VOICES) {
		const oldest = scheduledSources.shift()!;
		try {
			oldest.stop(at);
			evictedSources.add(oldest);
			oldest.addEventListener('ended', () => evictedSources.delete(oldest), { once: true });
		} catch {
			// もう止まっている
		}
	}
	scheduledSources.push(source);
	source.addEventListener('ended', () => {
		const index = scheduledSources.indexOf(source);
		if (index >= 0) scheduledSources.splice(index, 1);
	}, { once: true });
}

function stopMetronome(): void {
	if (metronomeTimer != null) window.clearTimeout(metronomeTimer);
	metronomeTimer = null;
	nextBeatAt = null;
	clockKind = null;
	for (const timer of flashTimers) window.clearTimeout(timer);
	flashTimers.clear();
	for (const source of [...scheduledSources, ...evictedSources]) {
		try {
			source.stop();
		} catch {
			// 鳴らし始める前に止めた等(もう止まっている)
		}
	}
	scheduledSources.length = 0;
	evictedSources.clear();
}

// 少し先までの拍を、その時のBPMで決めていく(BPMが変わっても、先に決めた分の後からすぐ付いていく)
function tickMetronome(): void {
	metronomeTimer = null;
	if (!widgetProps.metronome) return;
	const value = bpm.value;
	if (value == null || !Number.isFinite(value) || value < METRONOME_MIN_BPM) {
		// まだ測れていなければ、測れるまで待つ
		nextBeatAt = null;
		metronomeTimer = window.setTimeout(tickMetronome, 250);
		return;
	}
	const { kind, now, ctx } = currentClock();
	// 鳴らす前に止まっていたら動かし直す(画面を操作した後なら動く。動くまでは光らせるだけ)。
	// 画面を操作する前は動かし直しが終わらずに待たされるので、待っている間は頼み直さない(頼みが溜まり続けないように)
	const audioCtx = sound.getAudioContext();
	if (audioCtx != null && audioCtx.state === 'suspended' && !resuming) {
		resuming = true;
		audioCtx.resume().catch(() => {}).finally(() => {
			resuming = false;
		});
	}
	const interval = 60 / value;
	// 始めたとき・時計を替えたとき・止まっていて大きく遅れたとき(スリープ等)は、今から数え直す
	if (nextBeatAt == null || clockKind !== kind || nextBeatAt < now - interval) {
		nextBeatAt = now + 0.05;
		clockKind = kind;
	}
	const lookahead = window.document.visibilityState === 'visible' ? LOOKAHEAD_VISIBLE_S : LOOKAHEAD_HIDDEN_S;
	const horizon = now + lookahead;
	const withFlash = interval >= FLASH_MIN_INTERVAL_S;
	if (!withFlash) flash();
	let budget = Math.ceil(METRONOME_MAX_BEATS_PER_SECOND * lookahead);
	while (nextBeatAt < horizon && budget-- > 0) {
		scheduleBeatAt(nextBeatAt, now, ctx, withFlash);
		nextBeatAt += interval;
	}
	// 決めきれなかった分は飛ばす
	if (nextBeatAt < horizon) nextBeatAt = horizon;
	metronomeTimer = window.setTimeout(tickMetronome, SCHEDULER_TICK_MS);
}

watch(() => widgetProps.metronome, (on) => {
	stopMetronome();
	if (on) tickMetronome();
}, { immediate: true });

// 設定を開かなくても、ウィジェットからすぐ切り替えられるように
function toggleMetronome(): void {
	widgetProps.metronome = !widgetProps.metronome;
	save();
}
//#endregion

onUnmounted(() => {
	window.clearInterval(clock);
	stopMetronome();
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
