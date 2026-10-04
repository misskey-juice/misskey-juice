<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: 落書きのタイムラプス。描いた線を順に再生し、動画にして保存・投稿できる -->
<template>
<MkModalWindow
	ref="dialog"
	:width="720"
	:height="640"
	@close="close()"
	@closed="emit('closed')"
>
	<template #header><i class="ti ti-player-play"></i> {{ i18n.ts._juice.doodleTimelapse }}</template>

	<div :class="$style.root" class="_gaps">
		<div :class="$style.stage">
			<!-- 録った動画があれば動画を、無ければ再生用のキャンバスを見せる(キャンバスは録るときにも使うので、消さずに隠す) -->
			<video v-if="videoUrl != null" :src="videoUrl" :class="$style.media" controls loop autoplay muted playsinline></video>
			<canvas v-show="videoUrl == null" ref="canvasEl" :class="$style.media" role="img" :aria-label="i18n.ts._juice.doodleTimelapse"></canvas>
		</div>
		<div v-if="empty" :class="$style.note">{{ i18n.ts._juice.doodleTimelapseEmpty }}</div>
		<template v-else>
			<div :class="$style.progress" role="progressbar" :aria-valuenow="Math.round(progress * 100)" aria-valuemin="0" aria-valuemax="100" :aria-label="i18n.ts._juice.doodleTimelapse">
				<div :class="$style.progressFill" :style="{ width: `${progress * 100}%` }"></div>
			</div>
			<div :class="$style.controls">
				<MkSelect v-model="duration" :items="durationItems" small :disabled="recording" :class="$style.duration">
					<template #label>{{ i18n.ts._juice.doodleTimelapseDuration }}</template>
				</MkSelect>
				<MkButton v-if="!recording" rounded @click="replay"><i class="ti ti-player-play"></i> {{ i18n.ts._juice.doodleTimelapseReplay }}</MkButton>
				<MkButton v-if="!recording && videoType != null" primary rounded @click="record"><i class="ti ti-video"></i> {{ i18n.ts._juice.doodleTimelapseRecord }}</MkButton>
				<MkButton v-if="recording" rounded danger @click="cancelRecording"><i class="ti ti-x"></i> {{ i18n.ts.cancel }}</MkButton>
			</div>
			<div v-if="recording" :class="$style.note" role="status">{{ i18n.ts._juice.doodleTimelapseRecording }}<br>{{ i18n.ts._juice.doodleTimelapseKeepOpen }}</div>
			<div v-else-if="videoType == null" :class="$style.note">{{ i18n.ts._juice.doodleTimelapseUnsupported }}</div>
			<div v-if="video != null && !recording" :class="$style.controls">
				<MkButton rounded @click="download"><i class="ti ti-download"></i> {{ i18n.ts.download }}</MkButton>
				<MkButton rounded @click="saveToDrive"><i class="ti ti-cloud-upload"></i> {{ i18n.ts._juice.doodleTimelapseSaveToDrive }}</MkButton>
				<MkButton rounded primary @click="post"><i :class="attachable ? 'ti ti-paperclip' : 'ti ti-pencil'"></i> {{ attachable ? i18n.ts._juice.doodleAttach : i18n.ts._juice.doodleTimelapsePost }}</MkButton>
			</div>
		</template>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { uploadFile } from '@/utility/drive.js';
import { DrawTimelapse, timelapseVideoType } from '@/utility/draw-timelapse.js';
import { $i } from '@/i.js';

const props = defineProps<{
	title: string;
	canvasWidth: number;
	canvasHeight: number;
	strokes: Misskey.entities.DrawStroke[];
	layers: Misskey.entities.DrawLayer[];
	// 投稿フォームから開いた落書き(動画をそのフォームに添付する)
	attachable?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'attach', file: Misskey.entities.DriveFile): void;
	(ev: 'closed'): void;
}>();

// 動画の長い辺の上限と、1秒あたりのコマ数
const VIDEO_MAX_SIZE = 1280;
const VIDEO_FPS = 30;
// 描き終えた絵を見せておく時間(ミリ秒)
const HOLD_MS = 1500;

const dialog = useTemplateRef('dialog');
const canvasEl = useTemplateRef('canvasEl');
const timelapse = shallowRef<DrawTimelapse | null>(null);
const empty = ref(false);
const progress = ref(0);
const recording = ref(false);
const video = shallowRef<{ blob: Blob; ext: string } | null>(null);
const videoUrl = ref<string | null>(null);
const videoType = timelapseVideoType();

const duration = ref(20);
const durationItems = computed(() => [10, 20, 30, 60].map(seconds => ({ label: i18n.tsx._juice.doodleTimelapseSeconds({ n: seconds }), value: seconds })));

let frame: number | null = null;
let recorder: MediaRecorder | null = null;
// 再生を始めた時刻と、終わったときに呼ぶもの
let startedAt = 0;
let onFinished: (() => void) | null = null;
// 再生している途中か(描き終えて止まったらfalse)
let playing = false;
// 画面が隠れた時刻(隠れている間は再生・録画を止め、戻ったら続きから)
let hiddenAt: number | null = null;

function draw(fraction: number): void {
	const t = timelapse.value;
	const ctx = canvasEl.value?.getContext('2d');
	if (t == null || ctx == null) return;
	// 録画中は、絵が変わっていなくても毎回描く(描かないと、動画にコマが入らない)
	t.render(ctx, t.totalUnits * fraction, recording.value);
	progress.value = fraction;
}

function stopPlayback(): void {
	if (frame != null) window.cancelAnimationFrame(frame);
	frame = null;
	onFinished = null;
	playing = false;
}

function tick(): void {
	const elapsed = performance.now() - startedAt;
	draw(Math.min(1, elapsed / (duration.value * 1000)));
	if (elapsed < duration.value * 1000 + HOLD_MS) {
		frame = window.requestAnimationFrame(tick);
		return;
	}
	frame = null;
	playing = false;
	const done = onFinished;
	onFinished = null;
	done?.();
}

// 最初から、決めた長さで再生する。描き終えたら少し止めてから、finishedを呼ぶ
function play(finished?: () => void): void {
	stopPlayback();
	onFinished = finished ?? null;
	startedAt = performance.now();
	playing = true;
	// 隠れているときは、表示されてから始める
	if (window.document.visibilityState === 'visible') tick();
	else hiddenAt = startedAt;
}

// 画面が隠れている間は、ブラウザが描画を止める。録画は時間どおりに進んでしまうので、隠れたら再生・録画を止め、
// 戻ったら隠れていた時間を飛ばして続きから進める(止まったコマ・飛んだコマが動画に入らないように)
function onVisibilityChange(): void {
	if (window.document.visibilityState !== 'visible') {
		if (!playing || hiddenAt != null) return;
		hiddenAt = performance.now();
		if (frame != null) window.cancelAnimationFrame(frame);
		frame = null;
		if (recorder?.state === 'recording') recorder.pause();
		return;
	}
	if (hiddenAt == null) return;
	startedAt += performance.now() - hiddenAt;
	hiddenAt = null;
	if (!playing) return;
	if (recorder?.state === 'paused') recorder.resume();
	tick();
}

function clearVideo(): void {
	if (videoUrl.value != null) URL.revokeObjectURL(videoUrl.value);
	videoUrl.value = null;
	video.value = null;
}

function replay(): void {
	// 録った動画を見ていたら、再生用のキャンバスに戻す(動画はそのまま持っておく)
	if (videoUrl.value != null) URL.revokeObjectURL(videoUrl.value);
	videoUrl.value = null;
	play();
}

// 長さを変えたら、録った動画は捨てて(長さが違うので)、最初から再生し直す
watch(duration, () => {
	if (recording.value) return;
	clearVideo();
	play();
});

function record(): void {
	const canvas = canvasEl.value;
	if (canvas == null || videoType == null || recording.value || timelapse.value == null) return;
	clearVideo();
	const chunks: Blob[] = [];
	let canceled = false;
	const stream = canvas.captureStream(VIDEO_FPS);
	// 画質(1秒あたりのデータ量)。長い動画でも、ドライブに上げられる大きさ(ロールで決まる上限の8割まで)に収める
	const maxBits = ($i?.policies.maxFileSizeMb ?? 30) * 1024 * 1024 * 8 * 0.8;
	const videoBitsPerSecond = Math.round(Math.max(500_000, Math.min(5_000_000, maxBits / (duration.value + HOLD_MS / 1000))));
	const r = new MediaRecorder(stream, { mimeType: videoType.mimeType, videoBitsPerSecond });
	recorder = r;
	r.ondataavailable = (ev) => {
		if (ev.data.size > 0) chunks.push(ev.data);
	};
	r.onstop = () => {
		for (const track of stream.getTracks()) track.stop();
		if (recorder === r) recorder = null;
		recording.value = false;
		if (canceled || chunks.length === 0) return;
		const blob = new Blob(chunks, { type: videoType.mimeType.split(';')[0] });
		video.value = { blob, ext: videoType.ext };
		videoUrl.value = URL.createObjectURL(blob);
	};
	r.onerror = () => {
		canceled = true;
		stopPlayback();
		if (r.state !== 'inactive') r.stop();
		os.toast(i18n.ts._juice.doodleTimelapseFailed);
	};
	cancelCurrentRecording = () => {
		canceled = true;
		stopPlayback();
		if (r.state !== 'inactive') r.stop();
	};
	recording.value = true;
	// 最初のコマ(白い紙)を描いてから録り始める
	draw(0);
	r.start();
	play(() => {
		if (r.state !== 'inactive') r.stop();
	});
	// 隠れているときに始めたら、表示されるまで録画も止めておく
	if (hiddenAt != null && r.state === 'recording') r.pause();
}

let cancelCurrentRecording: (() => void) | null = null;

function cancelRecording(): void {
	cancelCurrentRecording?.();
	cancelCurrentRecording = null;
	draw(1);
}

function fileName(ext: string): string {
	const title = (props.title || i18n.ts._juice.doodle).replace(/[\\/:*?"<>|]/g, '_');
	const d = new Date();
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${title}_timelapse_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
}

function download(): void {
	const v = video.value;
	if (v == null) return;
	const url = URL.createObjectURL(v.blob);
	const a = window.document.createElement('a');
	a.href = url;
	a.download = fileName(v.ext);
	a.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function upload(): Promise<Misskey.entities.DriveFile | null> {
	const v = video.value;
	if (v == null) return null;
	try {
		// 失敗したときの知らせは、アップロードの処理が出す(ここでは重ねて出さない)
		return await os.promiseDialog(uploadFile(v.blob, { name: fileName(v.ext) }).filePromise, null, () => {});
	} catch {
		return null;
	}
}

async function saveToDrive(): Promise<void> {
	if (await upload() != null) os.toast(i18n.ts._juice.doodleTimelapseSaved);
}

async function post(): Promise<void> {
	const file = await upload();
	if (file == null) return;
	if (props.attachable) emit('attach', file);
	else os.post({ initialFiles: [file] });
	close();
}

function close(): void {
	cancelCurrentRecording?.();
	cancelCurrentRecording = null;
	stopPlayback();
	dialog.value?.close();
}

onMounted(() => {
	window.document.addEventListener('visibilitychange', onVisibilityChange);
	const canvas = canvasEl.value;
	if (canvas == null) return;
	const t = new DrawTimelapse(props.canvasWidth, props.canvasHeight, props.strokes, props.layers, VIDEO_MAX_SIZE);
	timelapse.value = t;
	canvas.width = t.width;
	canvas.height = t.height;
	empty.value = t.totalUnits === 0;
	if (empty.value) draw(1);
	else play();
});

onUnmounted(() => {
	window.document.removeEventListener('visibilitychange', onVisibilityChange);
	cancelCurrentRecording?.();
	stopPlayback();
	if (videoUrl.value != null) URL.revokeObjectURL(videoUrl.value);
	timelapse.value?.dispose();
	timelapse.value = null;
});
</script>

<style lang="scss" module>
.root {
	padding: 16px;
}

.stage {
	display: flex;
	align-items: center;
	justify-content: center;
	// 縦長・横長どちらの絵も、ダイアログの中に収める
	height: min(52vh, 380px);
	border-radius: 8px;
	background: var(--MI_THEME-bg);
	overflow: hidden;
}

.media {
	display: block;
	max-width: 100%;
	max-height: 100%;
	box-shadow: 0 0 0 1px var(--MI_THEME-divider);
}

.progress {
	height: 4px;
	border-radius: 999px;
	background: var(--MI_THEME-divider);
	overflow: hidden;
}

.progressFill {
	height: 100%;
	background: var(--MI_THEME-accent);
}

.controls {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	justify-content: center;
	gap: 8px;
}

.duration {
	min-width: 120px;
}

.note {
	text-align: center;
	font-size: 0.9em;
	opacity: 0.8;
}
</style>
