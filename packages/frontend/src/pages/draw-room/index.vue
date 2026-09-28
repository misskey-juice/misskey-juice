<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: 絵チャ(お絵かきチャット)の部屋一覧・部屋作成 -->
<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<MkInfo>{{ i18n.ts._drawRoom.description }}</MkInfo>
			<!-- JUICE: 部屋を作れるのはロールで許されている人だけ。作れない人も見学・参加はできる -->
			<MkButton v-if="$i.policies.canCreateDrawRoom" primary rounded :class="$style.createButton" @click="createRoom"><i class="ti ti-plus"></i> {{ i18n.ts._drawRoom.createRoom }}</MkButton>
			<MkInfo v-else warn>{{ i18n.ts._drawRoom.cannotCreate }}</MkInfo>

			<MkFoldableSection>
				<template #header>{{ i18n.ts._drawRoom.openRooms }}</template>
				<MkError v-if="error != null" @retry="fetchRooms()"/>
				<MkLoading v-else-if="openRooms == null"/>
				<div v-else-if="openRooms.length === 0" :class="$style.empty">{{ i18n.ts._drawRoom.noRooms }}</div>
				<div v-else class="_gaps_s">
					<XRoomCard v-for="room in openRooms" :key="room.id" :room="room"/>
				</div>
			</MkFoldableSection>

			<!-- JUICE: 保存しないで終了し、まだ削除されていない部屋(削除されるまでに画像を保存・投稿できる) -->
			<MkFoldableSection v-if="endingRooms.length > 0">
				<template #header>{{ i18n.ts._drawRoom.endingRooms }}</template>
				<div class="_gaps_s">
					<XRoomCard v-for="room in endingRooms" :key="room.id" :room="room"/>
				</div>
			</MkFoldableSection>

			<MkFoldableSection v-if="myRooms != null && myRooms.length > 0">
				<template #header>{{ i18n.ts._drawRoom.savedRooms }}</template>
				<div class="_gaps_s">
					<XRoomCard v-for="room in myRooms" :key="room.id" :room="room"/>
				</div>
			</MkFoldableSection>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onActivated, onMounted, ref } from 'vue';
import type * as Misskey from 'misskey-js';
import XRoomCard from './room-card.vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import { ensureSignin } from '@/i.js';
import { clampCanvasSize, clampMaxMembers, DRAW_ROOM_CANVAS_MAX_SIZE, DRAW_ROOM_CANVAS_MIN_SIZE } from '@/utility/draw-canvas.js';

const $i = ensureSignin();
const router = useRouter();

const openRooms = ref<Misskey.entities.DrawRoom[] | null>(null);
// JUICE: 保存しないで終了し、まだ削除されていない部屋(一覧のAPIは開催中の部屋と一緒に返す)
const endingRooms = ref<Misskey.entities.DrawRoom[]>([]);
// JUICE: 自分が部屋主の部屋(開催中+保存した終了済み)。保存した部屋だけを別枠で見せる
const myRooms = ref<Misskey.entities.DrawRoom[] | null>(null);
const error = ref<unknown>(null);

async function fetchRooms(): Promise<void> {
	error.value = null;
	try {
		const [open, mine] = await Promise.all([
			misskeyApi('draw-rooms/list', { limit: 30 }),
			misskeyApi('draw-rooms/list', { userId: $i.id, limit: 30 }),
		]);
		openRooms.value = open.filter(room => !room.isEnded);
		endingRooms.value = open.filter(room => room.isEnded && room.deletesAt != null);
		myRooms.value = mine.filter(room => room.isEnded);
	} catch (err) {
		error.value = err;
	}
}

// JUICE: キャンバスの幅と高さを自由に指定してもらう(範囲外は収める)
async function askCanvasSize(defaultWidth: number, defaultHeight: number): Promise<{ width: number; height: number } | null> {
	const { canceled, result } = await os.form(i18n.ts._drawRoom.canvasCustom, {
		width: {
			type: 'number',
			label: i18n.ts._drawRoom.canvasWidth,
			description: i18n.tsx._drawRoom.canvasSizeRange({ min: DRAW_ROOM_CANVAS_MIN_SIZE, max: Math.min(DRAW_ROOM_CANVAS_MAX_SIZE, maxCanvasSize.value) }),
			default: defaultWidth,
			step: 1,
		},
		height: {
			type: 'number',
			label: i18n.ts._drawRoom.canvasHeight,
			default: defaultHeight,
			step: 1,
		},
	});
	if (canceled) return null;
	return {
		width: clampCanvasSize(result.width, defaultWidth, maxCanvasSize.value),
		height: clampCanvasSize(result.height, defaultHeight, maxCanvasSize.value),
	};
}

// JUICE: ロールで決まっているキャンバスの大きさの上限。これを超える選択肢は出さない
const maxCanvasSize = computed(() => $i.policies.drawRoomMaxCanvasSize);
const CANVAS_PRESETS = [
	{ value: 'landscape', size: 1600, label: () => i18n.ts._drawRoom.canvasLandscape },
	{ value: 'portrait', size: 1600, label: () => i18n.ts._drawRoom.canvasPortrait },
	{ value: 'square', size: 1200, label: () => i18n.ts._drawRoom.canvasSquare },
	{ value: 'square2048', size: 2048, label: () => i18n.ts._drawRoom.canvasSquare2048 },
	{ value: 'square3840', size: 3840, label: () => i18n.ts._drawRoom.canvasSquare3840 },
] as const;

async function createRoom(): Promise<void> {
	const canvasOptions = [
		...CANVAS_PRESETS.filter(preset => preset.size <= maxCanvasSize.value).map(preset => ({ label: preset.label(), value: preset.value as string })),
		{ label: i18n.ts._drawRoom.canvasCustom, value: 'custom' },
	];
	const { canceled, result } = await os.form(i18n.ts._drawRoom.createRoom, {
		title: {
			type: 'string',
			label: i18n.ts._drawRoom.roomTitle,
			required: true,
			default: '',
		},
		visibility: {
			type: 'radio',
			label: i18n.ts._drawRoom.visibility,
			default: 'followers',
			options: [
				{ label: i18n.ts._drawRoom.visibilityFollowers, value: 'followers' },
				{ label: i18n.ts._drawRoom.visibilityLocal, value: 'local' },
			],
		},
		maxMembers: {
			type: 'number',
			label: i18n.ts._drawRoom.maxMembers,
			description: i18n.ts._drawRoom.maxMembersCaption,
			default: 4,
			step: 1,
		},
		canvasPreset: {
			type: 'radio',
			label: i18n.ts._drawRoom.canvasSize,
			default: canvasOptions[0].value,
			options: canvasOptions,
		},
		keepAfterEnd: {
			type: 'boolean',
			label: i18n.ts._drawRoom.keepAfterEnd,
			description: i18n.ts._drawRoom.keepAfterEndCaption,
			default: false,
		},
		// JUICE: 注意書き(CW)とセンシティブ(NSFW)
		cw: {
			type: 'string',
			label: i18n.ts._drawRoom.roomCw,
			description: i18n.ts._drawRoom.roomCwCaption,
			required: false,
			default: '',
		},
		isSensitive: {
			type: 'boolean',
			label: i18n.ts._drawRoom.roomSensitive,
			description: i18n.ts._drawRoom.roomSensitiveCaption,
			default: false,
		},
	});
	if (canceled || !result.title) return;

	// JUICE: 「自由に指定」を選んだら、続けて幅と高さを聞く
	let canvas: Pick<Misskey.entities.DrawRoomsCreateRequest, 'canvasPreset' | 'canvasWidth' | 'canvasHeight'>;
	if (result.canvasPreset === 'custom') {
		const size = await askCanvasSize(Math.min(1600, maxCanvasSize.value), Math.min(900, maxCanvasSize.value));
		if (size == null) return;
		canvas = { canvasWidth: size.width, canvasHeight: size.height };
	} else {
		canvas = { canvasPreset: result.canvasPreset as Misskey.entities.DrawRoomsCreateRequest['canvasPreset'] };
	}

	const room = await os.apiWithDialog('draw-rooms/create', {
		title: result.title,
		visibility: result.visibility as Misskey.entities.DrawRoom['visibility'],
		maxMembers: clampMaxMembers(result.maxMembers, 4),
		...canvas,
		keepAfterEnd: result.keepAfterEnd,
		cw: result.cw?.trim() ? result.cw.trim().slice(0, 128) : null,
		isSensitive: result.isSensitive,
	});
	router.push('/draw/:roomId', { params: { roomId: room.id } });
}

// JUICE: ページはKeepAliveで残るので、戻ってきたときは一覧を取り直す(最初の表示はonMountedで取る)
let activatedOnce = false;
onActivated(() => {
	if (activatedOnce) fetchRooms();
	activatedOnce = true;
});

onMounted(() => {
	fetchRooms();
});

definePage(() => ({
	title: i18n.ts._drawRoom.title,
	icon: 'ti ti-palette',
}));
</script>

<style lang="scss" module>
.createButton {
	margin: 0 auto;
}

.empty {
	padding: 16px;
	text-align: center;
	opacity: 0.7;
}
</style>
