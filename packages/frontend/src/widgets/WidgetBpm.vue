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
		<!-- JUICE: スライダー・数の入力で、BPMを決める(1〜100000) -->
		<template v-else-if="isSlider">
			<MkRange
				:class="$style.sliderControl"
				:modelValue="sliderPosition"
				:min="0"
				:max="SLIDER_STEPS"
				:step="1"
				:continuousUpdate="true"
				:textConverter="(v) => formatBpm(positionToBpm(v))"
				@update:modelValue="v => setSliderBpm(positionToBpm(v))"
			>
				<template #label>{{ i18n.ts._juice.bpmSourceSlider }}</template>
			</MkRange>
			<MkInput
				:class="$style.sliderControl"
				:modelValue="widgetProps.sliderBpm"
				type="number"
				:min="SLIDER_MIN_BPM"
				:max="SLIDER_MAX_BPM"
				:step="0.1"
				manualSave
				@update:modelValue="v => setSliderBpm(Number(v))"
			>
				<template #label>BPM</template>
				<template #caption>{{ i18n.tsx._juice.bpmSliderRange({ min: SLIDER_MIN_BPM, max: SLIDER_MAX_BPM }) }}</template>
			</MkInput>
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
import MkRange from '@/components/MkRange.vue';
import MkInput from '@/components/MkInput.vue';

const name = 'bpm';

// JUICE: 何の速さを測るか。タップのほかに、タイムラインに流れてくる投稿・届く通知の速さをBPMにできる
const sourceOptions = [
	{ label: i18n.ts._juice.bpmSourceTap, value: 'tap' },
	// JUICE: 決めたBPMで鳴らす(スライダー・数の入力)
	{ label: i18n.ts._juice.bpmSourceSlider, value: 'slider' },
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
	// JUICE: 「スライダー」で決めたBPM
	sliderBpm: {
		type: 'number',
		label: i18n.ts._widgetOptions._bpm.sliderBpm,
		default: 120,
		step: 0.1,
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
const isSlider = computed(() => widgetProps.source === 'slider');

//#region スライダー
// JUICE: 1〜100000BPMを、スライダーでは対数で動かす(普通の目盛りでは、遅いBPMがほとんど選べないため)
const SLIDER_MIN_BPM = 1;
const SLIDER_MAX_BPM = 100000;
const SLIDER_STEPS = 1000;

function positionToBpm(position: number): number {
	const bpm = SLIDER_MIN_BPM * Math.pow(SLIDER_MAX_BPM / SLIDER_MIN_BPM, position / SLIDER_STEPS);
	// 目盛りの細かさに合わせて丸める(100未満は0.1、10000未満は1、それより上は10ずつ)
	if (bpm < 100) return Math.round(bpm * 10) / 10;
	if (bpm < 10000) return Math.round(bpm);
	return Math.round(bpm / 10) * 10;
}

function bpmToPosition(bpm: number): number {
	return Math.round(Math.log(bpm / SLIDER_MIN_BPM) / Math.log(SLIDER_MAX_BPM / SLIDER_MIN_BPM) * SLIDER_STEPS);
}

function clampSliderBpm(bpm: number): number {
	if (!Number.isFinite(bpm)) return 120;
	return Math.min(SLIDER_MAX_BPM, Math.max(SLIDER_MIN_BPM, bpm));
}

function formatBpm(bpm: number): string {
	return bpm < 100 ? bpm.toFixed(1) : String(Math.round(bpm));
}

const sliderPosition = computed(() => bpmToPosition(clampSliderBpm(widgetProps.sliderBpm)));

function setSliderBpm(bpm: number): void {
	if (!Number.isFinite(bpm)) return;
	const next = clampSliderBpm(bpm);
	if (next === widgetProps.sliderBpm) return;
	widgetProps.sliderBpm = next;
	save();
}
//#endregion

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
	if (source === 'tap' || source === 'slider') return;
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

const bpm = computed(() => (isTap.value ? tapBpm.value : isSlider.value ? clampSliderBpm(widgetProps.sliderBpm) : streamBpm.value));
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
// 音の時計の動かし直しを最後に頼んだ時刻(画面を操作する前は頼んでも終わらないので、頼みすぎないように)
let lastResumeRequestAt = 0;

// JUICE: 音の時計が止まっていれば動かし直す。ブラウザは画面を操作した瞬間にしか動かさないので、
// 画面のどこかを押した・キーを押したときにも呼ぶ(リロードの直後など、操作するまで音が鳴らないため)
function resumeAudio(): void {
	const audioCtx = sound.getAudioContext();
	if (audioCtx == null || audioCtx.state !== 'suspended') return;
	lastResumeRequestAt = Date.now();
	audioCtx.resume().catch(() => {});
}

function onUserGesture(): void {
	if (widgetProps.metronome) resumeAudio();
}

window.addEventListener('pointerdown', onUserGesture, { capture: true });
window.addEventListener('keydown', onUserGesture, { capture: true });
// 鳴らす予定・鳴っている音(鳴らし始める順。止めるときは、まだ鳴っていない分も止める)
const scheduledSources: AudioBufferSourceNode[] = [];
// 重なりすぎて、途中で止める時刻を決めた音(メトロノームを止めたときは、その時刻を待たずに止める)
const evictedSources = new Set<AudioBufferSourceNode>();
// 光らせる予定のタイマー
const flashTimers = new Set<number>();
// JUICE: 鳴らす予定の拍の時刻(clockの時計で)と、その音・光らせるタイマー(速さが変わったら、まだ来ていない拍を取りやめるため)
const scheduledBeats: { at: number; source: AudioBufferSourceNode | null; timer: number | null }[] = [];
// 予定を決めたときの拍の間隔(秒)
let scheduledInterval: number | null = null;

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
	const beat: (typeof scheduledBeats)[number] = { at, source: null, timer: null };
	scheduledBeats.push(beat);
	if (withFlash) {
		const delayMs = Math.max(0, (at - now) * 1000);
		const timer = window.setTimeout(() => {
			flashTimers.delete(timer);
			flash();
		}, delayMs);
		flashTimers.add(timer);
		beat.timer = timer;
	}

	const masterVolume = prefer.s['sound.masterVolume'];
	if (ctx == null || metronomeBuffer == null || masterVolume <= 0 || sound.isMute()) return;
	const source = sound.createSourceNode(metronomeBuffer, { volume: masterVolume }).soundSource;
	source.start(at);
	beat.source = source;
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

// まだ来ていない拍を取りやめる(音と、光らせるタイマー)
function cancelBeat(beat: (typeof scheduledBeats)[number]): void {
	if (beat.timer != null) {
		window.clearTimeout(beat.timer);
		flashTimers.delete(beat.timer);
	}
	if (beat.source != null) {
		try {
			beat.source.stop();
		} catch {
			// もう止まっている
		}
		const index = scheduledSources.indexOf(beat.source);
		if (index >= 0) scheduledSources.splice(index, 1);
	}
}

function stopMetronome(): void {
	if (metronomeTimer != null) window.clearTimeout(metronomeTimer);
	metronomeTimer = null;
	nextBeatAt = null;
	clockKind = null;
	scheduledBeats.length = 0;
	scheduledInterval = null;
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
	// 画面を操作する前は動かし直しが終わらずに待たされるので、頼むのは1秒に1回まで(頼みが溜まり続けないように)
	if (Date.now() - lastResumeRequestAt >= 1000) resumeAudio();
	const interval = 60 / value;
	// 済んだ拍は忘れる(最後の1つは、速さが変わったときに次の拍を決めるのに使う)
	while (scheduledBeats.length > 1 && scheduledBeats[1].at <= now) scheduledBeats.shift();
	// JUICE: 速さが変わったら、まだ来ていない拍を取りやめ、最後に鳴った拍から新しい間隔で数え直す
	// (前の速さで先に決めた拍を待つと、遅い速さから速くしたときに、しばらく新しい速さにならないため)
	if (nextBeatAt != null && clockKind === kind && scheduledInterval != null && Math.abs(scheduledInterval - interval) > 1e-9) {
		const lastPlayed = scheduledBeats.length > 0 && scheduledBeats[0].at <= now ? scheduledBeats[0].at : null;
		for (const beat of scheduledBeats.filter(b => b.at > now)) cancelBeat(beat);
		scheduledBeats.splice(0, scheduledBeats.length, ...(lastPlayed != null ? [scheduledBeats[0]] : []));
		nextBeatAt = lastPlayed != null ? Math.max(lastPlayed + interval, now + 0.005) : now + 0.05;
	}
	scheduledInterval = interval;
	// 始めたとき・時計を替えたとき・止まっていて大きく遅れたとき(スリープ等)は、今から数え直す
	if (nextBeatAt == null || clockKind !== kind || nextBeatAt < now - interval) {
		// 時計が替わったら、前の時計で覚えた拍の時刻は使えない
		if (clockKind !== kind) scheduledBeats.length = 0;
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
	window.removeEventListener('pointerdown', onUserGesture, { capture: true });
	window.removeEventListener('keydown', onUserGesture, { capture: true });
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

.sliderControl {
	// 中身は真ん中に寄せているが、スライダー・入力欄は横いっぱいに広げる
	align-self: stretch;
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
