<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="{ [$style.done]: closed || isVoted }">
	<ul :class="$style.choices">
		<li v-for="(choice, i) in choices" :key="i" :class="$style.choice" @click="vote(i)">
			<div :class="$style.bg" :style="{ 'width': `${showResult ? (choice.votes / total * 100) : 0}%` }"></div>
			<span :class="$style.fg">
				<template v-if="choice.isVoted"><i class="ti ti-check" style="margin-right: 4px; color: var(--MI_THEME-accent);"></i></template>
				<Mfm :text="choice.text" :plain="true"/>
				<span v-if="showResult" style="margin-left: 4px; opacity: 0.7;">({{ i18n.tsx._poll.votesCount({ n: choice.votes }) }})</span>
			</span>
		</li>
	</ul>
	<p v-if="!readOnly" :class="$style.info">
		<span>{{ i18n.tsx._poll.totalVotes({ n: total }) }}</span>
		<span> · </span>
		<a v-if="!closed && !isVoted" style="color: inherit;" @click="showResult = !showResult">{{ showResult ? i18n.ts._poll.vote : i18n.ts._poll.showResult }}</a>
		<span v-if="isVoted">{{ i18n.ts._poll.voted }}</span>
		<span v-else-if="closed">{{ i18n.ts._poll.closed }}</span>
		<span v-if="remaining > 0"> · {{ timer }}</span>
	</p>
</div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { sum } from '@/utility/array.js';
import { pleaseLogin } from '@/utility/please-login.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { useLowresTime } from '@@/js/use-lowres-time.js';

type AnnouncementPollChoice = { text: string; votes: number; isVoted: boolean };

const props = defineProps<{
	announcementId: Misskey.entities.Announcement['id'];
	multiple: boolean;
	expiresAt: string | null;
	choices: AnnouncementPollChoice[];
	readOnly?: boolean;
}>();

const emit = defineEmits<{
	(ev: 'update', choices: AnnouncementPollChoice[], choice: number): void;
}>();

const choices = ref<AnnouncementPollChoice[]>(props.choices.map(c => ({ ...c })));

watch(() => props.choices, (v) => {
	choices.value = v.map(c => ({ ...c }));
});

const now = useLowresTime();

const expiresAtTime = computed(() => props.expiresAt ? new Date(props.expiresAt).getTime() : null);

const remaining = computed(() => {
	if (expiresAtTime.value == null) return -1;
	return Math.floor(Math.max(expiresAtTime.value - now.value, 0) / 1000);
});

const total = computed(() => sum(choices.value.map(x => x.votes)));
const closed = computed(() => props.expiresAt != null && remaining.value <= 0);
const isVoted = computed(() => !props.multiple && choices.value.some(c => c.isVoted));
const timer = computed(() => i18n.tsx._poll[
	remaining.value >= 86400 ? 'remainingDays' :
	remaining.value >= 3600 ? 'remainingHours' :
	remaining.value >= 60 ? 'remainingMinutes' : 'remainingSeconds'
]({
	s: Math.floor(remaining.value % 60),
	m: Math.floor(remaining.value / 60) % 60,
	h: Math.floor(remaining.value / 3600) % 24,
	d: Math.floor(remaining.value / 86400),
}));

const showResult = ref(props.readOnly || isVoted.value || closed.value);

if (!closed.value) {
	const closedWatchStop = watch(closed, (isNowClosed) => {
		if (isNowClosed) {
			showResult.value = true;
			closedWatchStop();
		}
	});
}

const voting = ref(false);

/**
 * MkPoll.vueとは異なり、投票操作の起点はこのコンポーネント側にしかないため、
 * 投票成功時にローカルで件数を楽観的に更新する(MkAnnouncementReactions.vueと同じ方針)。
 * 失敗時は投票前の状態に巻き戻す。他ユーザーの投票は親コンポーネントがbroadcastストリームを
 * 購読して反映する。
 */
const vote = async (id: number) => {
	if (props.readOnly || voting.value || closed.value) return;
	if (props.multiple ? choices.value[id].isVoted : isVoted.value) return;

	// pleaseLogin/os.confirm はいずれもユーザー操作待ちで await するため、
	// ここでガードを立てないと確認ダイアログが開く前の連打で二重に投票フローへ入れてしまう
	voting.value = true;

	try {
		const isLoggedIn = await pleaseLogin();
		if (!isLoggedIn) return;

		const { canceled } = await os.confirm({
			type: 'question',
			text: i18n.tsx.voteConfirm({ choice: choices.value[id].text }),
		});
		if (canceled) return;

		const previous = choices.value.map(c => ({ ...c }));
		const next = choices.value.map((c, i) => i === id ? { ...c, votes: c.votes + 1, isVoted: true } : c);
		choices.value = next;
		if (!showResult.value) showResult.value = !props.multiple;
		emit('update', next, id);

		try {
			await misskeyApi('announcements/polls/vote', {
				announcementId: props.announcementId,
				choice: id,
			});
		} catch (err) {
			choices.value = previous;
			emit('update', previous, id);
			os.alert({
				type: 'error',
				text: i18n.ts.somethingHappened,
			});
		}
	} finally {
		voting.value = false;
	}
};
</script>

<style lang="scss" module>
.choices {
	display: block;
	margin: 0;
	padding: 0;
	list-style: none;
}

.choice {
	display: block;
	position: relative;
	margin: 4px 0;
	padding: 4px;
	background: var(--MI_THEME-accentedBg);
	border-radius: 4px;
	overflow: clip;
	cursor: pointer;
}

.bg {
	position: absolute;
	top: 0;
	left: 0;
	height: 100%;
	background: var(--MI_THEME-accent);
	background: linear-gradient(90deg,var(--MI_THEME-buttonGradateA),var(--MI_THEME-buttonGradateB));
	transition: width 1s ease;
}

.fg {
	position: relative;
	display: inline-block;
	padding: 3px 5px;
	background: var(--MI_THEME-panel);
	border-radius: 3px;
}

.info {
	color: var(--MI_THEME-fg);
}

.done {
	.choice {
		cursor: initial;
	}
}
</style>
