<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: 絵チャのカラーパレット。色相の輪と、明るさ・鮮やかさの四角で選び、コード・RGB・HSVの数値でも決められる。
よく使う色を保存でき(プロファイルに覚える)、最近使った色も並ぶ -->
<template>
<MkModal
	ref="modal"
	:zPriority="'high'"
	:anchorElement="anchorElement"
	:transparentBg="true"
	@click="modal?.close()"
	@closed="emit('closed')"
>
	<div :class="$style.root" role="dialog" :aria-label="i18n.ts._drawRoom.colorPalette">
		<div :class="$style.wheel" :style="{ width: `${WHEEL_SIZE}px`, height: `${WHEEL_SIZE}px` }">
			<div
				:class="$style.ring"
				role="slider"
				tabindex="0"
				:aria-label="i18n.ts._drawRoom.hue"
				aria-valuemin="0"
				aria-valuemax="359"
				:aria-valuenow="Math.round(hsv.h)"
				@pointerdown="onRingDown"
				@pointermove="onRingMove"
				@pointerup="dragging = null"
				@pointercancel="dragging = null"
				@keydown="onRingKey"
			>
				<span :class="$style.ringThumb" :style="ringThumbStyle"></span>
			</div>
			<div
				:class="$style.square"
				:style="{ width: `${SQUARE_SIZE}px`, height: `${SQUARE_SIZE}px`, background: squareBackground }"
				role="slider"
				tabindex="0"
				:aria-label="i18n.ts._drawRoom.saturationValue"
				:aria-valuetext="`S ${Math.round(hsv.s * 100)}%, V ${Math.round(hsv.v * 100)}%`"
				@pointerdown="onSquareDown"
				@pointermove="onSquareMove"
				@pointerup="dragging = null"
				@pointercancel="dragging = null"
				@keydown="onSquareKey"
			>
				<span :class="$style.squareThumb" :style="{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }"></span>
			</div>
		</div>

		<div :class="$style.row">
			<span :class="$style.preview" :style="{ background: hex }"></span>
			<label :class="$style.field">
				<span>#</span>
				<input :value="hexInput" :class="$style.hexInput" maxlength="7" spellcheck="false" :aria-label="i18n.ts._drawRoom.colorCode" @input="onHexInput(($event.target as HTMLInputElement).value)" @blur="hexInput = hex.slice(1)"/>
			</label>
		</div>
		<div :class="$style.row">
			<label v-for="(channel, i) in (['R', 'G', 'B'] as const)" :key="channel" :class="$style.field">
				<span>{{ channel }}</span>
				<input type="number" min="0" max="255" :value="rgb[i]" :class="$style.numberInput" :aria-label="channel" @change="onRgbInput(i, ($event.target as HTMLInputElement).valueAsNumber)"/>
			</label>
		</div>
		<div :class="$style.row">
			<label :class="$style.field">
				<span>H</span>
				<input type="number" min="0" max="359" :value="Math.round(hsv.h)" :class="$style.numberInput" aria-label="H" @change="setHsv({ h: clamp(($event.target as HTMLInputElement).valueAsNumber, 0, 359) })"/>
			</label>
			<label :class="$style.field">
				<span>S</span>
				<input type="number" min="0" max="100" :value="Math.round(hsv.s * 100)" :class="$style.numberInput" aria-label="S" @change="setHsv({ s: clamp(($event.target as HTMLInputElement).valueAsNumber, 0, 100) / 100 })"/>
			</label>
			<label :class="$style.field">
				<span>V</span>
				<input type="number" min="0" max="100" :value="Math.round(hsv.v * 100)" :class="$style.numberInput" aria-label="V" @change="setHsv({ v: clamp(($event.target as HTMLInputElement).valueAsNumber, 0, 100) / 100 })"/>
			</label>
		</div>

		<div :class="$style.sectionHeader">
			<span>{{ i18n.ts._drawRoom.savedColors }}</span>
			<button v-if="!savedColors.includes(hex)" v-tooltip="i18n.ts._drawRoom.saveColor" class="_button" :class="$style.headerButton" :aria-label="i18n.ts._drawRoom.saveColor" :disabled="savedColors.length >= MAX_SAVED" @click="saveColor"><i class="ti ti-plus"></i></button>
			<button v-if="savedColors.length > 0" v-tooltip="i18n.ts._drawRoom.editSavedColors" class="_button" :class="[$style.headerButton, { [$style.headerButtonActive]: editing }]" :aria-label="i18n.ts._drawRoom.editSavedColors" :aria-pressed="editing" @click="editing = !editing"><i class="ti ti-pencil"></i></button>
		</div>
		<div v-if="savedColors.length > 0" :class="$style.swatches">
			<button
				v-for="c in savedColors"
				:key="c"
				v-tooltip="editing ? i18n.ts._drawRoom.removeSavedColor : c"
				class="_button"
				:class="[$style.swatch, { [$style.swatchActive]: c === hex, [$style.swatchRemovable]: editing }]"
				:style="{ background: c }"
				:aria-label="editing ? `${i18n.ts._drawRoom.removeSavedColor}: ${c}` : c"
				@click="editing ? removeColor(c) : setHex(c)"
			><i v-if="editing" class="ti ti-x"></i></button>
		</div>
		<div v-else :class="$style.empty">{{ i18n.ts._drawRoom.noSavedColors }}</div>

		<template v-if="recentColors.length > 0">
			<div :class="$style.sectionHeader"><span>{{ i18n.ts._drawRoom.recentColors }}</span></div>
			<div :class="$style.swatches">
				<button
					v-for="c in recentColors"
					:key="c"
					v-tooltip="c"
					class="_button"
					:class="[$style.swatch, { [$style.swatchActive]: c === hex }]"
					:style="{ background: c }"
					:aria-label="c"
					@click="setHex(c)"
				></button>
			</div>
		</template>
	</div>
</MkModal>
</template>

<script lang="ts" setup>
import { computed, reactive, ref, useTemplateRef } from 'vue';
import MkModal from '@/components/MkModal.vue';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';

const props = defineProps<{
	color: string;
	anchorElement?: HTMLElement | null;
}>();

const emit = defineEmits<{
	(ev: 'update', color: string): void;
	(ev: 'closed'): void;
}>();

const WHEEL_SIZE = 200;
const RING_WIDTH = 20;
// 輪の内側に収まる四角(輪との間に少し隙間を空ける)
const SQUARE_SIZE = Math.floor((WHEEL_SIZE - RING_WIDTH * 2 - 12) / Math.SQRT2);
const MAX_SAVED = 40;

const modal = useTemplateRef('modal');

function clamp(value: number, min: number, max: number): number {
	return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function hexToRgb(value: string): [number, number, number] {
	return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16)];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
	return `#${[r, g, b].map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsv([r, g, b]: [number, number, number], fallbackHue: number): { h: number; s: number; v: number } {
	const [rf, gf, bf] = [r / 255, g / 255, b / 255];
	const max = Math.max(rf, gf, bf);
	const min = Math.min(rf, gf, bf);
	const d = max - min;
	let h = fallbackHue;
	if (d > 0) {
		if (max === rf) h = 60 * (((gf - bf) / d) % 6);
		else if (max === gf) h = 60 * ((bf - rf) / d + 2);
		else h = 60 * ((rf - gf) / d + 4);
		if (h < 0) h += 360;
	}
	return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb({ h, s, v }: { h: number; s: number; v: number }): [number, number, number] {
	const f = (n: number) => {
		const k = (n + h / 60) % 6;
		return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
	};
	return [f(5), f(3), f(1)];
}

// 色相は、灰色(鮮やかさ0)にしても覚えておく(輪の位置が飛ばないように)
const hsv = reactive(rgbToHsv(hexToRgb(props.color), 0));
const hex = computed(() => rgbToHex(hsvToRgb(hsv)));
const rgb = computed(() => hexToRgb(hex.value));
const hexInput = ref(hex.value.slice(1));

function changed(): void {
	hexInput.value = hex.value.slice(1);
	emit('update', hex.value);
}

function setHsv(patch: Partial<{ h: number; s: number; v: number }>): void {
	Object.assign(hsv, patch);
	changed();
}

function setHex(value: string): void {
	Object.assign(hsv, rgbToHsv(hexToRgb(value), hsv.h));
	changed();
}

function onHexInput(value: string): void {
	hexInput.value = value.replace(/^#/, '');
	if (/^[0-9a-fA-F]{6}$/.test(hexInput.value)) setHex(`#${hexInput.value.toLowerCase()}`);
}

function onRgbInput(index: number, value: number): void {
	const next = [...rgb.value] as [number, number, number];
	next[index] = clamp(value, 0, 255);
	setHex(rgbToHex(next));
}

const squareBackground = computed(() => `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))`);

const ringThumbStyle = computed(() => {
	const angle = (hsv.h * Math.PI) / 180;
	const radius = WHEEL_SIZE / 2 - RING_WIDTH / 2;
	return {
		left: `${WHEEL_SIZE / 2 + Math.sin(angle) * radius}px`,
		top: `${WHEEL_SIZE / 2 - Math.cos(angle) * radius}px`,
		background: `hsl(${hsv.h}, 100%, 50%)`,
	};
});

//#region 輪・四角のドラッグとキーボード
const dragging = ref<'ring' | 'square' | null>(null);

function pickHue(ev: PointerEvent): void {
	const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
	const dx = ev.clientX - (rect.left + rect.width / 2);
	const dy = ev.clientY - (rect.top + rect.height / 2);
	let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
	if (deg < 0) deg += 360;
	setHsv({ h: deg });
}

function pickSv(ev: PointerEvent): void {
	const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
	setHsv({
		s: clamp((ev.clientX - rect.left) / rect.width, 0, 1),
		v: 1 - clamp((ev.clientY - rect.top) / rect.height, 0, 1),
	});
}

function onRingDown(ev: PointerEvent): void {
	// 輪の内側(四角のある所)を押したときは、四角の方で受ける
	const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
	const distance = Math.hypot(ev.clientX - (rect.left + rect.width / 2), ev.clientY - (rect.top + rect.height / 2));
	if (distance < WHEEL_SIZE / 2 - RING_WIDTH - 4) return;
	(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
	dragging.value = 'ring';
	pickHue(ev);
}

function onRingMove(ev: PointerEvent): void {
	if (dragging.value === 'ring') pickHue(ev);
}

function onSquareDown(ev: PointerEvent): void {
	ev.stopPropagation();
	(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
	dragging.value = 'square';
	pickSv(ev);
}

function onSquareMove(ev: PointerEvent): void {
	if (dragging.value === 'square') pickSv(ev);
}

function onRingKey(ev: KeyboardEvent): void {
	const step = ev.shiftKey ? 10 : 1;
	if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') setHsv({ h: (hsv.h + step) % 360 });
	else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') setHsv({ h: (hsv.h - step + 360) % 360 });
	else return;
	ev.preventDefault();
}

function onSquareKey(ev: KeyboardEvent): void {
	const step = ev.shiftKey ? 0.1 : 0.01;
	if (ev.key === 'ArrowRight') setHsv({ s: clamp(hsv.s + step, 0, 1) });
	else if (ev.key === 'ArrowLeft') setHsv({ s: clamp(hsv.s - step, 0, 1) });
	else if (ev.key === 'ArrowUp') setHsv({ v: clamp(hsv.v + step, 0, 1) });
	else if (ev.key === 'ArrowDown') setHsv({ v: clamp(hsv.v - step, 0, 1) });
	else return;
	ev.preventDefault();
}
//#endregion

//#region 保存した色・最近使った色
const savedColors = computed(() => prefer.r.drawRoomSavedColors.value);
const recentColors = computed(() => prefer.r.drawRoomRecentColors.value);
const editing = ref(false);

function saveColor(): void {
	if (savedColors.value.includes(hex.value) || savedColors.value.length >= MAX_SAVED) return;
	prefer.commit('drawRoomSavedColors', [...savedColors.value, hex.value]);
}

function removeColor(c: string): void {
	const next = savedColors.value.filter(x => x !== c);
	prefer.commit('drawRoomSavedColors', next);
	if (next.length === 0) editing.value = false;
}
//#endregion
</script>

<style lang="scss" module>
.root {
	display: flex;
	flex-direction: column;
	gap: 8px;
	width: 232px;
	padding: 12px;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-popup);
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.wheel {
	position: relative;
	align-self: center;
}

.ring {
	position: absolute;
	inset: 0;
	border-radius: 50%;
	background: conic-gradient(hsl(0, 100%, 50%), hsl(60, 100%, 50%), hsl(120, 100%, 50%), hsl(180, 100%, 50%), hsl(240, 100%, 50%), hsl(300, 100%, 50%), hsl(360, 100%, 50%));
	// 輪の部分だけを見せる(中はくり抜いて、四角を置く)。円の半径(closest-side)から輪の太さぶん内側を透明にする
	-webkit-mask: radial-gradient(closest-side, transparent calc(100% - 21px), #000 calc(100% - 20px));
	mask: radial-gradient(closest-side, transparent calc(100% - 21px), #000 calc(100% - 20px));
	touch-action: none;
	cursor: pointer;

	&:focus-visible {
		outline: solid 2px var(--MI_THEME-focus);
	}
}

.ringThumb {
	position: absolute;
	width: 14px;
	height: 14px;
	margin: -7px 0 0 -7px;
	border-radius: 50%;
	box-shadow: 0 0 0 2px #fff, 0 0 0 3px rgba(0, 0, 0, 0.4);
	pointer-events: none;
}

.square {
	position: absolute;
	top: 50%;
	left: 50%;
	transform: translate(-50%, -50%);
	border-radius: 4px;
	touch-action: none;
	cursor: crosshair;

	&:focus-visible {
		outline: solid 2px var(--MI_THEME-focus);
	}
}

.squareThumb {
	position: absolute;
	width: 12px;
	height: 12px;
	margin: -6px 0 0 -6px;
	border-radius: 50%;
	box-shadow: 0 0 0 2px #fff, 0 0 0 3px rgba(0, 0, 0, 0.4);
	pointer-events: none;
}

.row {
	display: flex;
	align-items: center;
	gap: 6px;
}

.preview {
	width: 28px;
	height: 28px;
	flex-shrink: 0;
	border-radius: 6px;
	border: solid 1px var(--MI_THEME-divider);
}

.field {
	display: flex;
	flex: 1;
	align-items: center;
	gap: 3px;
	min-width: 0;
	font-size: 0.8em;
	opacity: 0.9;
}

.hexInput,
.numberInput {
	flex: 1;
	min-width: 0;
	padding: 3px 5px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: 4px;
	background: var(--MI_THEME-bg);
	color: var(--MI_THEME-fg);
	font: inherit;
	font-family: monospace;
}

.sectionHeader {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 0.8em;
	opacity: 0.8;

	> span {
		flex: 1;
	}
}

.headerButton {
	padding: 2px 6px;
	border-radius: 4px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&:disabled {
		opacity: 0.4;
	}
}

.headerButtonActive {
	color: var(--MI_THEME-accent);
}

.swatches {
	display: flex;
	flex-wrap: wrap;
	gap: 5px;
}

.swatch {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	border-radius: 50%;
	border: solid 1px var(--MI_THEME-divider);
}

.swatchActive {
	outline: solid 2px var(--MI_THEME-accent);
	outline-offset: 1px;
}

.swatchRemovable {
	color: #fff;
	text-shadow: 0 0 2px #000;
	font-size: 0.8em;
}

.empty {
	font-size: 0.8em;
	opacity: 0.6;
}
</style>
