<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: 連合しているサーバーとの連合の診断(サーバー情報のページの「診断」タブ)。どこで連合が止まっているかを確かめる -->
<template>
<div class="_gaps_m">
	<MkInfo>{{ t.description }}</MkInfo>
	<div :class="$style.actions">
		<MkButton primary rounded :wait="running" @click="run"><i class="ti ti-stethoscope"></i> {{ result == null ? t.run : t.rerun }}</MkButton>
	</div>
	<div v-if="running" :class="$style.note" role="status">{{ t.running }}</div>
	<MkError v-else-if="failed" @retry="run"/>
	<template v-else-if="result != null">
		<MkInfo v-if="errorCount === 0 && warnCount === 0">{{ t.summaryOk }}</MkInfo>
		<MkInfo v-else :warn="true">{{ i18n.tsx._juice._federationDiagnosis.summaryProblems({ errors: errorCount, warns: warnCount }) }}</MkInfo>
		<FormSection v-for="section in sections" :key="section.title">
			<template #label>{{ section.title }}</template>
			<div class="_gaps_s">
				<div v-for="check in section.checks" :key="check.id" class="_panel" :class="[$style.check, $style[`check_${check.status}`]]">
					<i :class="[statusIcon(check.status), $style.icon]" role="img" :aria-label="t._status[check.status]"></i>
					<div :class="$style.body">
						<div :class="$style.title">{{ t._checks[check.id] }}</div>
						<div :class="$style.message">{{ messageOf(check) }}</div>
						<div v-if="detailOf(check) != null" :class="$style.detail">{{ detailOf(check) }}</div>
					</div>
					<div v-if="check.elapsedMs != null" :class="$style.elapsed">{{ check.elapsedMs }}ms</div>
				</div>
			</div>
		</FormSection>
		<div :class="$style.note">{{ t.checkedAt }}: <MkTime :time="result.checkedAt" mode="detail"/></div>
	</template>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import FormSection from '@/components/form/section.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';

type Result = Misskey.entities.AdminFederationDiagnoseInstanceResponse;
type Check = Result['checks'][number];

const props = defineProps<{
	host: string;
}>();

const t = i18n.ts._juice._federationDiagnosis;

const result = ref<Result | null>(null);
const running = ref(false);
const failed = ref(false);

// このサーバーの設定・状態を見る項目(それ以外は、相手のサーバーへ問い合わせる項目)
const LOCAL_CHECK_IDS: Check['id'][] = ['federationMode', 'blocked', 'silenced', 'suspension', 'responding', 'lastReceived', 'deliverQueue'];
// 補足が日時の項目
const DATE_DETAIL_IDS: Check['id'][] = ['responding', 'lastReceived'];

const sections = computed(() => {
	const checks = result.value?.checks ?? [];
	return [
		{ title: t.localSection, checks: checks.filter(check => LOCAL_CHECK_IDS.includes(check.id)) },
		{ title: t.remoteSection, checks: checks.filter(check => !LOCAL_CHECK_IDS.includes(check.id)) },
	].filter(section => section.checks.length > 0);
});
const errorCount = computed(() => result.value?.checks.filter(check => check.status === 'error').length ?? 0);
const warnCount = computed(() => result.value?.checks.filter(check => check.status === 'warn').length ?? 0);

function statusIcon(status: Check['status']): string {
	switch (status) {
		case 'ok': return 'ti ti-circle-check';
		case 'warn': return 'ti ti-alert-triangle';
		case 'error': return 'ti ti-circle-x';
		case 'skipped': return 'ti ti-circle-minus';
	}
}

// 結果の説明(結果の種類に合う説明があればそれを、無ければ状態の名前を出す)
function messageOf(check: Check): string {
	const codes = t._codes as Record<string, string | undefined>;
	return (check.code != null ? codes[check.code] : undefined) ?? t._status[check.status];
}

function detailOf(check: Check): string | null {
	if (check.detail == null || check.detail === '') return null;
	if (DATE_DETAIL_IDS.includes(check.id)) {
		const date = new Date(check.detail);
		return Number.isNaN(date.getTime()) ? check.detail : date.toLocaleString();
	}
	return check.detail;
}

// 今の診断の番号(診断している間に別のサーバーのページへ移ったら、前の診断の結果は捨てる)
let runId = 0;

async function run(): Promise<void> {
	if (running.value) return;
	const id = ++runId;
	running.value = true;
	failed.value = false;
	try {
		const res = await misskeyApi('admin/federation/diagnose-instance', { host: props.host });
		if (id === runId) result.value = res;
	} catch {
		if (id === runId) failed.value = true;
	} finally {
		if (id === runId) running.value = false;
	}
}

// 別のサーバーのページへ移ったら、前の結果と、進行中の診断の表示は消す
watch(() => props.host, () => {
	runId++;
	running.value = false;
	result.value = null;
	failed.value = false;
});
</script>

<style lang="scss" module>
.actions {
	display: flex;
	justify-content: center;
}

.note {
	text-align: center;
	font-size: 0.9em;
	opacity: 0.8;
}

.check {
	display: flex;
	align-items: flex-start;
	gap: 12px;
	padding: 12px 16px;
}

.icon {
	flex-shrink: 0;
	font-size: 1.4em;
	line-height: 1.2;
}

.check_ok .icon {
	color: var(--MI_THEME-success);
}

.check_warn .icon {
	color: var(--MI_THEME-warn);
}

.check_error .icon {
	color: var(--MI_THEME-error);
}

.check_skipped .icon {
	opacity: 0.5;
}

.body {
	flex: 1;
	min-width: 0;
}

.title {
	font-weight: bold;
}

.message {
	font-size: 0.9em;
	overflow-wrap: anywhere;
}

.detail {
	margin-top: 2px;
	font-size: 0.85em;
	opacity: 0.7;
	overflow-wrap: anywhere;
	font-family: Consolas, Monaco, 'Andale Mono', 'Ubuntu Mono', monospace;
}

.elapsed {
	flex-shrink: 0;
	font-size: 0.8em;
	opacity: 0.6;
	font-variant-numeric: tabular-nums;
}
</style>
