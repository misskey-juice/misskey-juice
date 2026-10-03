<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<!-- JUICE: 落書き(1人で描く絵チャ)の一覧。作品はこのブラウザに保存する -->
<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 800px;">
		<div class="_gaps">
			<MkInfo>{{ i18n.ts._juice.doodleDescription }}</MkInfo>
			<MkButton primary rounded :class="$style.createButton" @click="create"><i class="ti ti-plus"></i> {{ i18n.ts._juice.doodleNew }}</MkButton>

			<MkLoading v-if="doodles == null"/>
			<div v-else-if="doodles.length === 0" :class="$style.empty">{{ i18n.ts._juice.doodleEmpty }}</div>
			<div v-else :class="$style.grid">
				<div v-for="doodle in doodles" :key="doodle.id" class="_panel" :class="$style.item">
					<MkA :to="`/doodle/${doodle.id}`" :class="$style.link">
						<div :class="$style.thumbnail" :style="{ aspectRatio: `${doodle.width} / ${doodle.height}` }">
							<img v-if="doodle.thumbnail != null" :src="doodle.thumbnail" alt="" :class="$style.thumbnailImage"/>
						</div>
						<div :class="$style.body">
							<div :class="$style.title">{{ doodleTitle(doodle) }}</div>
							<div :class="$style.meta">{{ doodle.width }}×{{ doodle.height }} · <MkTime :time="doodle.updatedAt"/></div>
						</div>
					</MkA>
					<button v-tooltip="i18n.ts.menu" class="_button" :class="$style.menuButton" :aria-label="i18n.ts.menu" @click="openMenu(doodle, $event)"><i class="ti ti-dots"></i></button>
				</div>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { onActivated, onMounted, ref } from 'vue';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import { deleteDoodle, listDoodles, updateDoodleMeta } from '@/utility/doodle-storage.js';
import type { DoodleMeta } from '@/utility/doodle-storage.js';
import { createDoodleWithDialog, doodleTitle } from '@/utility/doodle.js';

const router = useRouter();
const doodles = ref<DoodleMeta[] | null>(null);

async function fetchDoodles(): Promise<void> {
	doodles.value = await listDoodles();
}

async function create(): Promise<void> {
	const meta = await createDoodleWithDialog();
	if (meta == null) return;
	router.push('/doodle/:doodleId', { params: { doodleId: meta.id } });
}

function openMenu(doodle: DoodleMeta, ev: MouseEvent): void {
	os.popupMenu([{
		text: i18n.ts._juice.doodleRename,
		icon: 'ti ti-pencil',
		action: async () => {
			const { canceled, result } = await os.inputText({
				title: i18n.ts._juice.doodleRename,
				default: doodle.title,
				maxLength: 64,
			});
			if (canceled || result == null) return;
			await updateDoodleMeta(doodle.id, { title: result.trim() });
			await fetchDoodles();
		},
	}, { type: 'divider' }, {
		text: i18n.ts.delete,
		icon: 'ti ti-trash',
		danger: true,
		action: async () => {
			const { canceled } = await os.confirm({ type: 'warning', text: i18n.tsx._juice.doodleDeleteConfirm({ name: doodleTitle(doodle) }) });
			if (canceled) return;
			await deleteDoodle(doodle.id);
			await fetchDoodles();
		},
	}], (ev.currentTarget ?? ev.target) as HTMLElement);
}

// ページはKeepAliveで残るので、戻ってきたときは一覧を読み直す(描いた絵の小さな絵・日時が変わっているため)
let activatedOnce = false;
onActivated(() => {
	if (activatedOnce) fetchDoodles();
	activatedOnce = true;
});

onMounted(() => {
	fetchDoodles();
});

definePage(() => ({
	title: i18n.ts._juice.doodle,
	icon: 'ti ti-scribble',
}));
</script>

<style lang="scss" module>
.createButton {
	margin: 0 auto;
}

.empty {
	padding: 32px 0;
	text-align: center;
	opacity: 0.7;
}

.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
	gap: 12px;
}

.item {
	position: relative;
	overflow: clip;
}

.link {
	display: block;

	&:hover {
		text-decoration: none;
		background: var(--MI_THEME-panelHighlight);
	}
}

.thumbnail {
	display: flex;
	align-items: center;
	justify-content: center;
	max-height: 200px;
	width: 100%;
	// 描いていない部分は白(落書きの絵と同じ)
	background: #fff;
}

.thumbnailImage {
	display: block;
	max-width: 100%;
	max-height: 100%;
	object-fit: contain;
}

.body {
	padding: 8px 12px;
	padding-right: 36px;
}

.title {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: bold;
}

.meta {
	font-size: 0.85em;
	opacity: 0.7;
}

.menuButton {
	position: absolute;
	right: 4px;
	bottom: 8px;
	padding: 6px 8px;
	border-radius: 6px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}
}
</style>
