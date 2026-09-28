<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<!-- JUICE: MIDIは<audio>で直接再生できないため、独自の軽量プレイヤー(XMidi)を
	     プレビュー可能なメディアのグリッドとは別枠で表示する。拡大表示は画像/動画と同じく
	     ライトボックス(openGallery)を開く。ref経由でプレイヤーの状態を捕まえておき、
	     拡大時にそのまま渡して再生状態を同期させる -->
	<XMidi
		v-for="media in medias.midi"
		:key="media.id"
		:ref="(comp) => { midiComponents.set(media.id, comp as InstanceType<typeof XMidi> | null); }"
		:midi="media"
		:class="$style.midiPlayer"
		@mediaClick="onMediaClick(media)"
	/>
	<XBanner v-for="media in medias.nonPreviewable" :key="media.id" :media="media" :novelNoteId="novelNoteId"/>
	<div v-if="count > 0" :class="$style.container">
		<div
			ref="gallery"
			:class="[
				$style.medias,
				...(prefer.s.showMediaListByGridInWideArea ? [$style.gridInWideArea] : []),
				count === 1 ? [$style.n1, {
					[$style.n116_9]: prefer.s.mediaListWithOneImageAppearance === '16_9',
					[$style.n11_1]: prefer.s.mediaListWithOneImageAppearance === '1_1',
					[$style.n12_3]: prefer.s.mediaListWithOneImageAppearance === '2_3',
				}] : count === 2 ? $style.n2 : count === 3 ? $style.n3 : count === 4 ? $style.n4 : $style.nMany,
			]"
		>
			<template v-for="media in medias.previewable">
				<XAudio
					v-if="media.type.startsWith('audio')"
					:key="`audio:${media.id}`"
					:ref="(comp) => { mediaComponents.set(media.id, comp as InstanceType<typeof XAudio> | null); }"
					:class="$style.media"
					:audio="media"
					:user="user"
					:inlinePlayable="inlinePlayableAudio"
					@mediaClick="onMediaClick(media)"
				/>
				<XVideo
					v-if="media.type.startsWith('video')"
					:key="`video:${media.id}`"
					:ref="(comp) => { mediaComponents.set(media.id, comp as InstanceType<typeof XVideo> | null); }"
					:class="$style.media"
					:video="media"
					:inlinePlayable="inlinePlayableVideo"
					@mediaClick="onMediaClick(media)"
				/>
				<XImage
					v-else-if="media.type.startsWith('image')"
					:key="`image:${media.id}`"
					:ref="(comp) => { mediaComponents.set(media.id, comp as InstanceType<typeof XImage> | null); }"
					:marker="`${markerId}:${media.id}`"
					:disableImageLink="true"
					:class="$style.media"
					:image="media"
					:raw="raw"
					@mediaClick="onMediaClick(media)"
				/>
			</template>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, onMounted, onUnmounted, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
import type { Content } from '@/components/MkLightbox.item.vue';
import type { MediaComponentExposes } from '@/types/media-component.js';
import XBanner from '@/components/MkMediaBanner.vue';
import XAudio from '@/components/MkMediaAudio.vue';
import XImage from '@/components/MkMediaImage.vue';
import XVideo from '@/components/MkMediaVideo.vue';
import XMidi from '@/components/MkMediaMidi.vue';
import * as os from '@/os.js';
import { prefer } from '@/preferences.js';
import { isPreviewable, getType } from '@/utility/lightbox.js';
import { genId } from '@/utility/id.js';

const props = withDefaults(defineProps<{
	mediaList: Misskey.entities.DriveFile[];
	user?: Misskey.entities.User | null; // DriveFileのuserはnullになることがある。その場合に使用する所有者情報
	raw?: boolean;
	// JUICE: メディアタイムラインでは動画を拡大せずその場で再生できるようにする
	inlinePlayableVideo?: boolean;
	// JUICE: メディアタイムラインでは音声も動画と同様に拡大せずその場で再生できるようにする
	inlinePlayableAudio?: boolean;
	// JUICE: 小説の投稿なら、その投稿のid(添付のテキストファイルを、保存ではなく小説ビューワーで開けるようにする)
	novelNoteId?: string | null;
}>(), {
	inlinePlayableVideo: false,
	inlinePlayableAudio: false,
});

const gallery = useTemplateRef('gallery');
const medias = computed(() => {
	const previewable: Misskey.entities.DriveFile[] = [];
	const nonPreviewable: Misskey.entities.DriveFile[] = [];
	const midi: Misskey.entities.DriveFile[] = []; // JUICE
	for (const file of props.mediaList) {
		if (file.type === 'audio/midi') { // JUICE: 独自プレイヤー(XMidi)で扱う
			midi.push(file);
		} else if (isPreviewable(file.type)) {
			previewable.push(file);
		} else {
			nonPreviewable.push(file);
		}
	}

	return {
		previewable,
		nonPreviewable,
		midi,
	};
});
const mediaComponents = new Map<string, MediaComponentExposes | null>();
// JUICE: 拡大時に再生状態を同期させるため、XMidiのインスタンス(defineExposeしたmidiPlayerを持つ)を捕まえておく
const midiComponents = new Map<string, InstanceType<typeof XMidi> | null>();
const count = computed(() => medias.value.previewable.length);
const markerId = genId();

async function calcAspectRatio() {
	if (!gallery.value) return;

	const img = props.mediaList[0];

	if (props.mediaList.length !== 1 || !(img.properties.width && img.properties.height)) {
		gallery.value.style.aspectRatio = '';
		return;
	}

	const ratioMax = (ratio: number) => {
		if (img.properties.width == null || img.properties.height == null) return '';
		return `${Math.max(ratio, img.properties.width / img.properties.height).toString()} / 1`;
	};

	switch (prefer.s.mediaListWithOneImageAppearance) {
		case '16_9':
			gallery.value.style.aspectRatio = ratioMax(16 / 9);
			break;
		case '1_1':
			gallery.value.style.aspectRatio = ratioMax(1 / 1);
			break;
		case '2_3':
			gallery.value.style.aspectRatio = ratioMax(2 / 3);
			break;
		default:
			gallery.value.style.aspectRatio = '';
			break;
	}
}

onMounted(() => {
	calcAspectRatio();

	if (gallery.value == null) return; // TSを黙らすため
});

onUnmounted(() => {
	mediaComponents.clear();
	midiComponents.clear();
});

function onMediaClick(file: Misskey.entities.DriveFile) {
	if (prefer.s.imageNewTab) {
		window.open(file.url, '_blank');
		return;
	}
	openGallery(file.id);
}

async function openGallery(id?: string) {
	if (id == null) {
		// JUICE: 添付がMIDIのみの投稿では、previewableに何も無くてもmidiにはあるため
		// フォールバックしないと「oキー」等のid省略呼び出しでギャラリーが開かなくなる
		const first = medias.value.previewable[0] ?? medias.value.midi[0];
		if (first == null) return;
		id = first.id;
	}

	const getElementByMarker = (marker: string) => {
		if (gallery.value == null) return null;
		const found = gallery.value.querySelector(`[data-marker="${marker}"]`) as HTMLElement | null;
		if (found == null) return null;
		return markRaw(found);
	};

	const contents = medias.value.previewable.map<Content>(media => ({
		id: media.id,
		type: getType(media.type),
		url: media.url,
		thumbnailUrl: media.thumbnailUrl,
		width: media.properties.width,
		height: media.properties.height,
		filename: media.name,
		file: media,
		sourceElement: getElementByMarker(`${markerId}:${media.id}`),
	}));

	// JUICE: MIDIはisPreviewable/getType(他の添付ファイルプレビュー全般で使う汎用の判定)の
	// 対象には含めず、ここでライトボックス表示専用に個別マッピングする(XMidiはグリッドの外に
	// 表示されるため、sourceElementは取得できずアニメーション無しでの表示になる)。
	// sharedMidiPlayerに拡大元のプレイヤーを渡すことで、拡大時も再生状態を同期させる。
	// os.popupAsyncWithDialog()に渡るprops(contents)はos.popups(ref)経由でreactive化されるため、
	// markRaw()しないとsharedMidiPlayer内部のRefが「reactiveオブジェクト内のref自動アンラップ」で
	// 生の値に化けてしまい(sourceElementと同じ理由でmarkRaw済みなのと同じ扱いが必要)、
	// テンプレート側の`.value`アクセスが壊れる
	contents.push(...medias.value.midi.map<Content>(media => {
		const sharedMidiPlayer = midiComponents.get(media.id)?.midiPlayer;
		return {
			id: media.id,
			type: 'midi',
			url: media.url,
			filename: media.name,
			file: media,
			sharedMidiPlayer: sharedMidiPlayer != null ? markRaw(sharedMidiPlayer) : null,
		};
	}));

	const initiallyRevealedContentIds = contents
		.filter(content => mediaComponents.get(content.id)?.isRevealed() === true)
		.map(content => content.id);

	// JUICE: センシティブフラグが無くても手動で隠されていたファイルは、ライトボックスでも隠した状態を維持する
	const initiallyHiddenContentIds = contents
		.filter(content => mediaComponents.get(content.id)?.isRevealed() === false)
		.map(content => content.id);

	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkLightbox.vue').then(x => x.default), {
		defaultIndex: contents.findIndex(conten => conten.id === id),
		contents: contents,
		initiallyRevealedContentIds,
		initiallyHiddenContentIds,
		user: props.user,
	}, {
		closed: () => dispose(),
	});
}

defineExpose({
	openGallery,
});
</script>

<style lang="scss" module>
.root {
	container-type: inline-size;
}

.midiPlayer {
	width: 100%;
	margin-top: 4px;
}

.container {
	position: relative;
	width: 100%;
}

.medias {
	display: grid;
	grid-gap: 8px;

	height: 100%;
	width: 100%;

	&.n1 {
		grid-template-rows: 1fr;

		// default but fallback (expand)
		min-height: 64px;
		max-height: clamp(
			64px,
			50cqh,
			min(360px, 50vh)
		);

		&.n116_9 {
			min-height: initial;
			max-height: initial;
			aspect-ratio: 16 / 9; // fallback
		}

		&.n11_1{
			min-height: initial;
			max-height: initial;
			aspect-ratio: 1 / 1; // fallback
		}

		&.n12_3 {
			min-height: initial;
			max-height: initial;
			aspect-ratio: 2 / 3; // fallback
		}
	}

	&.n2 {
		aspect-ratio: 16/9;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr;
	}

	&.n3 {
		aspect-ratio: 16/9;
		grid-template-columns: 1fr 0.5fr;
		grid-template-rows: 1fr 1fr;

		> .media:nth-child(1) {
			grid-row: 1 / 3;
		}

		> .media:nth-child(3) {
			grid-column: 2 / 3;
			grid-row: 2 / 3;
		}
	}

	&.n4 {
		aspect-ratio: 16/9;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
	}

	&.nMany {
		grid-template-columns: 1fr 1fr;

		> .media {
			aspect-ratio: 16/9;
		}
	}
}

.media {
	overflow: hidden; // clipにするとバグる
	border-radius: 8px;
	cursor: zoom-in;
}

@container (min-width: 500px) {
	.medias.gridInWideArea {
		display: grid;
		aspect-ratio: auto;
		grid-template-columns: repeat(4, 1fr);
		grid-template-rows: auto;
		grid-gap: 8px;

		> .media {
			aspect-ratio: 1 / 1;
		}
	}
}
</style>
