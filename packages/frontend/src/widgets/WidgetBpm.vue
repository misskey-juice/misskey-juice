<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: タップ・クリックでBPM(1分あたりの拍の数)を測るウィジェット -->
<template>
<MkContainer :showHeader="widgetProps.showHeader" class="mkw-bpm">
	<template #icon><i class="ti ti-metronome"></i></template>
	<template #header>{{ i18n.ts._widgets.bpm }}</template>
	<template #func="{ buttonStyleClass }"><button class="_button" :class="buttonStyleClass" :aria-label="i18n.ts._juice.bpmReset" @click="reset"><i class="ti ti-refresh"></i></button></template>

	<div :class="$style.root">
		<div :class="$style.value" aria-live="polite">
			<span :class="$style.number">{{ bpmText }}</span>
			<span :class="$style.unit">BPM</span>
		</div>
		<div :class="$style.meta">{{ i18n.tsx._juice.bpmTaps({ n: taps.length }) }}</div>
		<button
			class="_button"
			:class="[$style.tap, { [$style.tapActive]: flashing }]"
			:aria-label="i18n.ts._juice.bpmTap"
			@pointerdown.prevent="tap"
			@keydown.space.prevent="tap"
			@keydown.enter.prevent="tap"
		>
			<i class="ti ti-hand-finger"></i> {{ i18n.ts._juice.bpmTap }}
		</button>
		<div :class="$style.hint">{{ i18n.ts._juice.bpmHint }}</div>
	</div>
</MkContainer>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import { useWidgetPropsManager } from './widget.js';
import type { WidgetComponentEmits, WidgetComponentExpose, WidgetComponentProps } from './widget.js';
import type { FormWithDefault, GetFormResultType } from '@/utility/form.js';
import { i18n } from '@/i18n.js';
import MkContainer from '@/components/MkContainer.vue';

const name = 'bpm';

const widgetPropsDef = {
	showHeader: {
		type: 'boolean',
		label: i18n.ts._widgetOptions.showHeader,
		default: true,
	},
} satisfies FormWithDefault;

type WidgetProps = GetFormResultType<typeof widgetPropsDef>;

const props = defineProps<WidgetComponentProps<WidgetProps>>();
const emit = defineEmits<WidgetComponentEmits<WidgetProps>>();

const { widgetProps, configure } = useWidgetPropsManager(name,
	widgetPropsDef,
	props,
	emit,
);

// この時間(ms)より間が空いたら、測り直す
const RESET_AFTER_MS = 2000;
// テンポの変化に付いていけるよう、直近のこの数の間隔の平均で測る
const WINDOW = 16;

const taps = ref<number[]>([]);
const flashing = ref(false);
let flashTimer: number | null = null;

const bpm = computed(() => {
	const t = taps.value;
	if (t.length < 2) return null;
	const recent = t.slice(-(WINDOW + 1));
	const interval = (recent[recent.length - 1] - recent[0]) / (recent.length - 1);
	return interval > 0 ? 60000 / interval : null;
});

const bpmText = computed(() => (bpm.value == null ? '--' : bpm.value.toFixed(1)));

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

function reset(): void {
	taps.value = [];
}

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

.number {
	font-size: 2.4em;
	font-weight: bold;
	font-variant-numeric: tabular-nums;
}

.unit {
	opacity: 0.7;
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
