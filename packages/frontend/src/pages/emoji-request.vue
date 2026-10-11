<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<MkInfo v-if="!enabled">{{ i18n.ts._emojiRequestPage.disabled }}</MkInfo>
		<template v-else>
			<div v-if="tab === 'form'" class="_gaps_m">
				<MkButton rounded style="margin: 0 auto;" :disabled="maxAddable <= 0" @click="chooseFile">{{ i18n.ts.selectFile }}</MkButton>
				<!-- JUICE: 審査待ちの残り件数・1日あたりの残り送信回数・今回選択中の件数を、1枚のカードに
				まとめて表示する(件数が増えるとインフォカードが積み重なって画面を圧迫するため、
				送信前に把握しておきたい状態はここに集約する) -->
				<MkInfo :warn="limitsWarning">
					{{ remaining <= 0 ? i18n.tsx._emojiRequestPage.limitReached({ limit: requestLimit }) : i18n.tsx._emojiRequestPage.remainingCount({ pending: pendingCount, limit: requestLimit, remaining }) }}<br/>
					<template v-if="dailyRemaining != null">
						{{ dailyRemaining === 0 ? i18n.ts._emojiRequestPage.dailyLimitReached : i18n.tsx._emojiRequestPage.dailyRemainingCount({ remaining: dailyRemaining }) }}
						<!-- JUICE: 1日あたりの送信回数は日付ではなく直近24時間のスライディングウィンドウで
						カウントしているため、ユーザーが実際に次に送信できるようになる時刻(ETA)を
						MkTimeの相対表示で案内する(実績が無ければdailyResetAtはnullなので表示しない) -->
						<template v-if="dailyResetAt != null">({{ i18n.ts._emojiRequestPage.dailyResetLabel }}: <MkTime :time="dailyResetAt" mode="relative"/>)</template><br/>
					</template>
					{{ i18n.tsx._emojiRequestPage.selectedCount({ selected: drafts.length, cap: batchCap }) }}
				</MkInfo>
				<!-- JUICE: 複数の画像をまとめて選択すると、同じ画面から複数件をまとめて申請できる(まだ
				何も選んでいない最初のうちだけ案内し、選択が始まったら消えて画面をすっきりさせる) -->
				<MkInfo v-if="drafts.length === 0">
					{{ i18n.ts._emojiRequestPage.multipleRequestsHint }}<br/>
					{{ i18n.tsx._emojiRequestPage.maxItemsPerSubmission({ max: MAX_BATCH_ITEMS }) }}
				</MkInfo>

				<div v-for="(draft, i) in drafts" :key="draft.key" class="_gaps_s" :class="$style.draftCard">
					<!-- JUICE: 複数件申請時の番号表示は不要でも、選び直したい場合の削除ボタンは
					1件だけの場合でも必要なため、ヘッダー自体はdrafts.length>1で出し分けない -->
					<div :class="$style.draftHeader">
						<span v-if="drafts.length > 1">{{ i18n.tsx._emojiRequestPage.requestNumber({ n: i + 1 }) }}</span>
						<!-- JUICE: まとめて複数件申請しようとしている時、どのカードの何が未入力か
						一目で分かるように、必須項目が未入力のカードにはヘッダーへ警告バッジを出す -->
						<span v-if="draftMissingRequiredFields(draft)" :class="$style.draftMissingRequiredBadge">
							<i class="ti ti-alert-triangle"></i> {{ i18n.ts._emojiRequestPage.requiredFieldsMissing }}
						</span>
						<button class="_button" :class="$style.draftRemoveButton" @click="removeDraft(draft.key)">
							<i class="ti ti-x"></i>
						</button>
					</div>

					<div :class="$style.imgs">
						<div style="background: #000;" :class="$style.imgContainer">
							<img :src="draft.previewUrl" :class="$style.img"/>
						</div>
						<div style="background: #222;" :class="$style.imgContainer">
							<img :src="draft.previewUrl" :class="$style.img"/>
						</div>
						<div style="background: #ddd;" :class="$style.imgContainer">
							<img :src="draft.previewUrl" :class="$style.img"/>
						</div>
						<div style="background: #fff;" :class="$style.imgContainer">
							<img :src="draft.previewUrl" :class="$style.img"/>
						</div>
					</div>

					<!-- JUICE: この絵文字をノートにリアクションした場合の見た目のサンプルをMkNote(mockモード)で表示する -->
					<div :class="$style.reactionPreview">
						<div :class="$style.previewLabel">{{ i18n.ts._emojiRequestPage.preview }}</div>
						<div :class="$style.previewCaption">{{ i18n.ts._emojiRequestPage.previewCaption }}</div>
						<MkNote :mock="true" :note="exampleNoteFor(draft)" :class="$style.previewNote"/>
					</div>

					<!-- JUICE: 差し替え申請(既存の絵文字の画像だけを差し替える) -->
					<div class="_gaps_s">
						<MkSwitch :modelValue="draft.targetEmojiId != null" @update:modelValue="(v) => onToggleReplacement(draft, v)">
							<template #label>{{ i18n.ts._emojiRequestPage.replacementRequest }}</template>
							<template #caption>{{ i18n.ts._emojiRequestPage.replacementRequestCaption }}</template>
						</MkSwitch>
						<MkInfo v-if="draft.targetEmojiId != null">
							{{ i18n.ts._emojiRequestPage.replacementTarget }}: <b>{{ draft.name }}</b>
							<button class="_textButton" @click="pickReplacementTarget(draft)">{{ i18n.ts._emojiRequestPage.changeTarget }}</button>
						</MkInfo>
					</div>

					<MkInput v-model="draft.name" pattern="[a-z0-9_]" autocapitalize="off" :readonly="draft.targetEmojiId != null">
						<template #label>{{ i18n.ts.name }}</template>
					</MkInput>

					<template v-if="draft.targetEmojiId == null">
						<MkInput v-model="draft.category" :required="requireCategory" :datalist="customEmojiCategories.filter(x => x != null)">
							<template #label>{{ i18n.ts.category }}{{ requireCategory ? ` ${i18n.ts.requiredFieldSuffix}` : '' }}</template>
						</MkInput>

						<MkInput v-model="draft.aliases" :required="requireTags" autocapitalize="off">
							<template #label>{{ i18n.ts.tags }}{{ requireTags ? ` ${i18n.ts.requiredFieldSuffix}` : '' }}</template>
							<template #caption>
								{{ i18n.ts.theKeywordWhenSearchingForCustomEmoji }}<br/>
								{{ i18n.ts.setMultipleBySeparatingWithSpace }}
							</template>
						</MkInput>

						<MkInput v-model="draft.license" :required="requireLicense" :mfmAutocomplete="true">
							<template #label>{{ i18n.ts.license }}{{ requireLicense ? ` ${i18n.ts.requiredFieldSuffix}` : '' }}</template>
						</MkInput>

						<MkSwitch v-model="draft.isSensitive">{{ i18n.ts.sensitive }}</MkSwitch>
						<MkSwitch v-model="draft.localOnly">{{ i18n.ts.localOnly }}</MkSwitch>
					</template>
					<MkSwitch v-model="draft.deleteFileAfterReview">
						<template #label>{{ i18n.ts._emojiRequestPage.deleteFileAfterReview }}</template>
					</MkSwitch>
				</div>

				<MkCaptcha v-if="instance.enableHcaptcha" ref="hcaptcha" v-model="hCaptchaResponse" provider="hcaptcha" :sitekey="instance.hcaptchaSiteKey"/>
				<MkCaptcha v-if="instance.enableMcaptcha" ref="mcaptcha" v-model="mCaptchaResponse" provider="mcaptcha" :sitekey="instance.mcaptchaSiteKey" :instanceUrl="instance.mcaptchaInstanceUrl"/>
				<MkCaptcha v-if="instance.enableRecaptcha" ref="recaptcha" v-model="reCaptchaResponse" provider="recaptcha" :sitekey="instance.recaptchaSiteKey"/>
				<MkCaptcha v-if="instance.enableTurnstile" ref="turnstile" v-model="turnstileResponse" provider="turnstile" :sitekey="instance.turnstileSiteKey"/>
				<MkCaptcha v-if="instance.enableTestcaptcha" ref="testcaptcha" v-model="testcaptchaResponse" provider="testcaptcha" :sitekey="null"/>

				<MkButton primary rounded :disabled="shouldDisableSubmitting" @click="submit"><i class="ti ti-check"></i> {{ i18n.ts._emojiRequestPage.submit }}</MkButton>
			</div>
			<div v-else-if="tab === 'pending'" class="_gaps">
				<MkInfo v-if="pendingPaginator.items.value.length === 0 && !pendingPaginator.fetching.value">{{ i18n.ts._emojiRequestPage.noPendingRequests }}</MkInfo>
				<MkPagination v-slot="{items}" :paginator="pendingPaginator">
					<div class="_gaps">
						<MkEmojiRequestItem v-for="request in items" :key="request.id" :request="request" cancelable @cancelled="onCancelled"/>
					</div>
				</MkPagination>
			</div>
			<div v-else-if="tab === 'result'" class="_gaps">
				<MkSelect v-model="resultStatus" style="margin: 0;" :items="resultStatusDef">
					<template #label>{{ i18n.ts.state }}</template>
				</MkSelect>
				<MkInfo v-if="resultPaginator.items.value.length === 0 && !resultPaginator.fetching.value">{{ i18n.ts._emojiRequestPage.noRequests }}</MkInfo>
				<MkPagination v-slot="{items}" :paginator="resultPaginator">
					<div class="_gaps">
						<MkEmojiRequestItem v-for="request in items" :key="request.id" :request="request"/>
					</div>
				</MkPagination>
			</div>
		</template>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, markRaw, onUnmounted, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkInfo from '@/components/MkInfo.vue';
import MkInput from '@/components/MkInput.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkButton from '@/components/MkButton.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkPagination from '@/components/MkPagination.vue';
import MkEmojiRequestItem from '@/components/MkEmojiRequestItem.vue';
import MkNote from '@/components/MkNote.vue';
import type { Captcha } from '@/components/MkCaptcha.vue';
import MkCaptcha from '@/components/MkCaptcha.vue';
import * as os from '@/os.js';
import { selectFileDeferred, uploadFile } from '@/utility/drive.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { customEmojiCategories } from '@/custom-emojis.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { Paginator } from '@/utility/paginator.js';
import { ensureSignin } from '@/i.js';
import { instance } from '@/instance.js';
import { genId } from '@/utility/id.js';
import { buildMockLocalCustomEmojiReaction } from '@/utility/mock-note-reaction.js';
import { splitEmojiTags } from '@/utility/emoji-tags.js';

const $i = ensureSignin();

const enabled = ref(true);
// JUICE: 名前以外にどの入力を必須にするかは管理者設定で切り替えられる(既定はすべて任意)
const requireCategory = ref(false);
const requireTags = ref(false);
const requireLicense = ref(false);
misskeyApi('juice/public-settings').then(res => {
	enabled.value = res.emojiRequestEnabled;
	requireCategory.value = res.emojiRequestRequireCategory;
	requireTags.value = res.emojiRequestRequireTags;
	requireLicense.value = res.emojiRequestRequireLicense;
});

// JUICE: 「あと何件申請できるか」「1回でまとめて申請できる上限」を送信前に表示するための状態。
// 上限自体はロールポリシー(i.policies.emojiRequestLimit)から、現在の審査待ち件数は専用の
// emoji-requests/countから取得する。MAX_BATCH_ITEMSはemoji-requests/create-manyのparamDefの
// maxItemsと合わせている
const pendingCount = ref(0);
// JUICE: 審査待ち件数の上限(emojiRequestLimit)とは別に、emoji-requests/create-manyの
// 1日あたりの送信回数上限(emojiRequestDailyLimit、API呼び出し頻度)の残り回数。
// nullは開発環境等レートリミットが無効な場合を表し、この場合は表示しない
const dailyRemaining = ref<number | null>(null);
// JUICE: 1日あたりの送信回数上限が次に回復する日時(ETA)。今回の集計期間に送信実績が
// 無い場合はnull(表示しない)
const dailyResetAt = ref<string | null>(null);
misskeyApi('emoji-requests/count').then(res => {
	pendingCount.value = res.pending;
	dailyRemaining.value = res.dailyRemaining;
	dailyResetAt.value = res.dailyResetAt;
});
const requestLimit = computed(() => $i.policies.emojiRequestLimit);
const remaining = computed(() => Math.max(0, requestLimit.value - pendingCount.value));
// JUICE: 審査待ち件数・1日あたりの送信回数のどちらかが上限に達している場合、まとめた
// インフォカード全体をwarn表示にする
const limitsWarning = computed(() => remaining.value <= 0 || dailyRemaining.value === 0);
const MAX_BATCH_ITEMS = 10;

const tab = ref('form');

// JUICE: 複数の画像をまとめて選択すると、同じ画面から複数件をまとめて申請できる。
// 1件だけ選んだ場合も内部的には要素数1のdraftsとして扱う(見た目は従来通り単一フォーム)
type EmojiRequestDraft = {
	key: string;
	// JUICE: 「PCからアップロード」の場合はこの時点ではまだDriveにアップロードしておらず、
	// 生のFileのまま保持する(申請の送信時にuploadFile()する)。「ドライブから選択」
	// 「URLから」は従来通り、選択した時点で既にアップロード済みのDriveFile
	file: File | Misskey.entities.DriveFile;
	// JUICE: プレビュー表示用のURL。fileが生のFileの場合はURL.createObjectURLで作った
	// ローカルURLなので、ドラフトを破棄する際は必ずrevokeDraftPreview()で解放すること
	previewUrl: string;
	name: string;
	category: string;
	aliases: string;
	license: string;
	isSensitive: boolean;
	localOnly: boolean;
	deleteFileAfterReview: boolean;
	// JUICE: 差し替え申請(既存の絵文字の画像だけを差し替える)の対象。nullなら通常の新規申請
	targetEmojiId: string | null;
};

const drafts = ref<EmojiRequestDraft[]>([]);

// JUICE: 今回のバッチで選択できる上限(審査待ちの残り枠と1回の申請上限のうち小さい方)
const batchCap = computed(() => Math.min(remaining.value, MAX_BATCH_ITEMS));
// JUICE: 現在のドラフト数を踏まえて、これ以上あと何件ドラフトを追加できるか
const maxAddable = computed(() => Math.max(0, batchCap.value - drafts.value.length));

// JUICE: 差し替え申請の対象選択用。自分の承認済み申請(絵文字が実際に作られたもの)のみを候補にする。
// 初回に選択を試みたタイミングで一度だけ取得する
let myApprovedEmojiRequests: Misskey.entities.EmojiRequestEntry[] | null = null;

async function fetchMyApprovedEmojiRequests(): Promise<Misskey.entities.EmojiRequestEntry[]> {
	if (myApprovedEmojiRequests == null) {
		const fetched = await misskeyApi('emoji-requests/list', { status: 'approved', limit: 100 });
		myApprovedEmojiRequests = fetched;
		return fetched;
	}
	return myApprovedEmojiRequests;
}

async function pickReplacementTarget(draft: EmojiRequestDraft) {
	const requests = await fetchMyApprovedEmojiRequests();
	const eligible = requests.filter(r => r.resultEmojiId != null);
	if (eligible.length === 0) {
		os.alert({ type: 'info', text: i18n.ts._emojiRequestPage.noReplaceableEmojis });
		draft.targetEmojiId = null;
		return;
	}

	const { canceled, result } = await os.select({
		title: i18n.ts._emojiRequestPage.selectTargetEmoji,
		items: eligible.map(r => ({ value: r.resultEmojiId!, label: r.name })),
	});
	if (canceled || result == null) {
		if (draft.targetEmojiId == null) return;
	} else {
		draft.targetEmojiId = result;
		draft.name = eligible.find(r => r.resultEmojiId === result)?.name ?? draft.name;
	}
}

function onToggleReplacement(draft: EmojiRequestDraft, enabled: boolean) {
	if (enabled) {
		pickReplacementTarget(draft);
	} else {
		draft.targetEmojiId = null;
	}
}

// JUICE
const hcaptcha = ref<Captcha | undefined>();
const mcaptcha = ref<Captcha | undefined>();
const recaptcha = ref<Captcha | undefined>();
const turnstile = ref<Captcha | undefined>();
const testcaptcha = ref<Captcha | undefined>();
const hCaptchaResponse = ref<string | null>(null);
const mCaptchaResponse = ref<string | null>(null);
const reCaptchaResponse = ref<string | null>(null);
const turnstileResponse = ref<string | null>(null);
const testcaptchaResponse = ref<string | null>(null);

// JUICE: 申請中の絵文字をリアクションとして使った場合の見た目のプレビュー用。
// まだ承認されていない(=正式な絵文字として登録されていない)画像のため、
// note.reactionEmojisでプレビュー用URL(draft.previewUrl。PCから選択した場合はまだ
// Driveにアップロードしていないローカルなblob URL)を直接差し込んで表示する
// (MkReactionsViewer.reaction.vue参照。既存のアバターデコレーション申請の
// プレビュー(MkAvatarのdecorations上書き)と同じ考え方)
function exampleNoteFor(draft: EmojiRequestDraft): Misskey.entities.Note {
	const previewName = draft.name || 'preview';
	return {
		id: '0000000000',
		createdAt: new Date().toISOString(),
		userId: $i.id,
		user: $i,
		text: i18n.ts._emojiRequestPage.previewSampleNoteText,
		cw: null,
		visibility: 'public',
		localOnly: false,
		isAIGenerated: false,
		hideFromMediaTimeline: false,
		isNovel: false,
		reactionAcceptance: null,
		renoteCount: 0,
		repliesCount: 0,
		reactionCount: 1,
		...buildMockLocalCustomEmojiReaction(previewName, draft.previewUrl),
		fileIds: [],
		files: [],
		replyId: null,
		renoteId: null,
	};
}

// JUICE: 名前以外の入力を管理者設定で必須にできる。差し替え申請(targetEmojiId指定時)は
// これらのフィールド自体を使わないため対象外にする(フォーム側も入力欄自体を隠している)
function draftMissingRequiredFields(d: EmojiRequestDraft): boolean {
	if (d.targetEmojiId != null) return false;
	if (requireCategory.value && !d.category) return true;
	if (requireTags.value && splitEmojiTags(d.aliases).length === 0) return true;
	if (requireLicense.value && !d.license) return true;
	return false;
}

const shouldDisableSubmitting = computed((): boolean => {
	return drafts.value.length === 0 || drafts.value.some(d => !d.name) ||
		drafts.value.some(draftMissingRequiredFields) ||
		drafts.value.length > remaining.value ||
		instance.enableHcaptcha && !hCaptchaResponse.value ||
		instance.enableMcaptcha && !mCaptchaResponse.value ||
		instance.enableRecaptcha && !reCaptchaResponse.value ||
		instance.enableTurnstile && !turnstileResponse.value ||
		instance.enableTestcaptcha && !testcaptchaResponse.value;
});

// JUICE: 「自分の申請」を審査待ち/結果の2タブに分割し、それぞれ別のPaginatorで絞り込んで取得する
const pendingPaginator = markRaw(new Paginator('emoji-requests/list', {
	limit: 10,
	params: { status: 'pending' },
}));

const resultStatus = ref<'approved' | 'rejected' | 'cancelled'>('approved');
const resultStatusDef = [
	{ value: 'approved', label: i18n.ts._emojiRequestPage.statusApproved },
	{ value: 'rejected', label: i18n.ts._emojiRequestPage.statusRejected },
	{ value: 'cancelled', label: i18n.ts._emojiRequestPage.statusCancelled },
];
const resultPaginator = markRaw(new Paginator('emoji-requests/list', {
	limit: 10,
	computedParams: computed(() => ({ status: resultStatus.value })),
}));

// JUICE: 審査待ちの申請を申請者自身がキャンセルした場合、審査待ち一覧から即座に取り除き、
// 残り申請可能数の表示にも反映する
function onCancelled(requestId: string) {
	pendingPaginator.removeItem(requestId);
	pendingCount.value = Math.max(0, pendingCount.value - 1);
}

function chooseFile(ev: PointerEvent) {
	selectFileDeferred({
		anchorElement: ev.currentTarget ?? ev.target,
		multiple: true,
	}).then(files => {
		// JUICE: 審査待ち上限・1回の申請上限を超える分は追加しない。黙って切り捨てると
		// 気づけないため、切り捨てが発生した場合はトーストで知らせる
		const accepted = files.slice(0, maxAddable.value);
		if (files.length > accepted.length) {
			os.toast(i18n.tsx._emojiRequestPage.tooManyFilesSelected({ skipped: files.length - accepted.length }));
		}
		for (const f of accepted) {
			const candidate = f.name.replace(/\.(.+)$/, '');
			drafts.value.push({
				key: genId(),
				file: f,
				previewUrl: f instanceof File ? URL.createObjectURL(f) : f.url,
				name: candidate.match(/^[a-z0-9_]+$/) ? candidate : '',
				category: '',
				aliases: '',
				license: '',
				isSensitive: false,
				localOnly: false,
				deleteFileAfterReview: false,
				targetEmojiId: null,
			});
		}
	});
}

// JUICE: PCから選択した生のFileのプレビュー用に作ったURL.createObjectURLは、
// 使い終わったら必ず解放する(ドライブ/URL経由のDriveFileのurlはそのままなので対象外)
function revokeDraftPreview(draft: EmojiRequestDraft) {
	if (!(draft.file instanceof File)) return;
	URL.revokeObjectURL(draft.previewUrl);
}

function removeDraft(key: string) {
	const draft = drafts.value.find(d => d.key === key);
	if (draft) revokeDraftPreview(draft);
	drafts.value = drafts.value.filter(d => d.key !== key);
}

// JUICE: 「PCからアップロード」を選んだドラフトはこの時点まだDriveに上がっていないため、
// 申請の送信直前にここでアップロードしてfileIdを確定する
async function resolveFileId(file: File | Misskey.entities.DriveFile): Promise<string> {
	if (file instanceof File) {
		const { filePromise } = uploadFile(file, { name: file.name });
		const driveFile = await filePromise;
		return driveFile.id;
	}
	return file.id;
}

// JUICE: 「PCからアップロード」を選んだドラフトは、この関数が呼ばれた時点で初めてDriveに
// アップロードされる(resolveFileId参照)。申請自体が失敗・キャンセルされた場合、この時
// 新規にアップロードされた分だけをDriveから削除して孤立させない(「ドライブから選択」
// 「URLから」等、元々Driveにあったファイルは削除しない)
function deleteFreshlyUploadedFiles(fileIds: string[], isFreshUpload: boolean[]) {
	for (let i = 0; i < fileIds.length; i++) {
		if (isFreshUpload[i]) {
			misskeyApi('drive/files/delete', { fileId: fileIds[i] }).catch(() => {});
		}
	}
}

async function submit() {
	if (drafts.value.length === 0 || drafts.value.some(d => !d.name)) return;

	const done = os.waiting();
	const isFreshUpload = drafts.value.map(d => d.file instanceof File);

	// JUICE: Promise.allで一括await すると、一部の draft のアップロードが失敗した場合に
	// 既に成功した他の draft のアップロード結果(fileId)が失われ、孤立ファイルとして
	// Driveに残ってしまう。allSettledで個別の成否を確認し、失敗時は成功分だけ削除する
	const uploadResults = await Promise.allSettled(drafts.value.map(d => resolveFileId(d.file)));
	const uploadFailed = uploadResults.some(r => r.status === 'rejected');
	if (uploadFailed) {
		done();
		const uploadedFileIds = uploadResults
			.map((r, i) => (r.status === 'fulfilled' ? { fileId: r.value, isFreshUpload: isFreshUpload[i] } : null))
			.filter(x => x != null);
		deleteFreshlyUploadedFiles(uploadedFileIds.map(x => x.fileId), uploadedFileIds.map(x => x.isFreshUpload));
		return;
	}
	const fileIds = uploadResults.map(r => (r as PromiseFulfilledResult<string>).value);
	done({ success: true });

	os.apiWithDialog('emoji-requests/create-many', {
		requests: drafts.value.map((d, i) => ({
			fileId: fileIds[i],
			name: d.name,
			category: d.category || null,
			aliases: splitEmojiTags(d.aliases),
			license: d.license || null,
			isSensitive: d.isSensitive,
			localOnly: d.localOnly,
			deleteFileAfterReview: d.deleteFileAfterReview,
			targetEmojiId: d.targetEmojiId,
		})),
		'hcaptcha-response': hCaptchaResponse.value,
		'm-captcha-response': mCaptchaResponse.value,
		'g-recaptcha-response': reCaptchaResponse.value,
		'turnstile-response': turnstileResponse.value,
		'testcaptcha-response': testcaptchaResponse.value,
	}, undefined, {
		// JUICE: RATE_LIMIT_EXCEEDEDはApiCallServiceが全エンドポイント共通で使う固定id(何に対する
		// 制限かがメッセージに出ない)のため、このエンドポイント固有の文言に差し替える
		'd5826d14-3982-4d2e-8011-b9e9f02499ef': {
			title: i18n.ts._emojiRequestPage.dailyLimitExceededTitle,
			text: i18n.ts._emojiRequestPage.dailyLimitExceededDescription,
		},
	}).then(requests => {
		for (const request of requests) {
			pendingPaginator.prepend(request);
		}
		pendingCount.value += requests.length;
		drafts.value.forEach(revokeDraftPreview);
		drafts.value = [];
		tab.value = 'pending';
		// JUICE: 1回のcreate-many呼び出しで1日あたりの送信回数上限を1消費するため、次にいつ
		// 回復するか(dailyResetAt)も含めて実際の値を取り直す(楽観的な差分計算だとETAの
		// 正確な算出ができない)
		misskeyApi('emoji-requests/count').then(res => {
			dailyRemaining.value = res.dailyRemaining;
			dailyResetAt.value = res.dailyResetAt;
		});
	}).catch(() => {
		// JUICE: captcha検証失敗時などにウィジェットをリセットし、再送信できるようにする
		hcaptcha.value?.reset?.();
		mcaptcha.value?.reset?.();
		recaptcha.value?.reset?.();
		turnstile.value?.reset?.();
		testcaptcha.value?.reset?.();

		// JUICE: 送信失敗時(他タブでの同時送信・承認/却下等により審査待ち件数が実際とズレて
		// いる可能性がある)は、表示中の残り申請可能数を実際の値に合わせ直す。レート制限に
		// 引っかかった試行自体も1日あたりの送信回数を消費するため、dailyRemaining/dailyResetAtも
		// 合わせて取り直す
		misskeyApi('emoji-requests/count').then(res => {
			pendingCount.value = res.pending;
			dailyRemaining.value = res.dailyRemaining;
			dailyResetAt.value = res.dailyResetAt;
		});

		// JUICE: create-many自体が失敗した場合(captcha失敗・レート制限等)も、今回新規に
		// アップロードした分をDriveに残さず削除する
		deleteFreshlyUploadedFiles(fileIds, isFreshUpload);
	});
}

const headerActions = computed(() => []);

const headerTabs = computed(() => [{
	key: 'form',
	title: i18n.ts._emojiRequestPage.newRequest,
	icon: 'ti ti-plus',
}, {
	key: 'pending',
	title: i18n.ts._emojiRequestPage.pendingRequests,
	icon: 'ti ti-clock',
}, {
	key: 'result',
	title: i18n.ts._emojiRequestPage.requestResults,
	icon: 'ti ti-list-check',
}]);

// JUICE: 送信せずにページを離れた場合、PC選択分の未使用プレビューURLを解放しておく
onUnmounted(() => {
	drafts.value.forEach(revokeDraftPreview);
});

definePage(() => ({
	title: i18n.ts._juice.emojiRequest,
	icon: 'ti ti-mood-plus',
}));
</script>

<style lang="scss" module>
.draftCard {
	padding: 16px;
	border-radius: var(--MI-radius);
	border: var(--MI_THEME-panelBorder);
	background: var(--MI_THEME-panel);
}

.draftHeader {
	display: flex;
	align-items: center;
	font-weight: bold;
}

.draftMissingRequiredBadge {
	margin-left: 8px;
	font-size: 85%;
	font-weight: normal;
	color: var(--MI_THEME-infoWarnFg);
}

.draftRemoveButton {
	width: 32px;
	height: 32px;
	// JUICE: 番号ラベル(複数件申請時のみ)が無い1件だけの場合でも、削除ボタンを
	// justify-content: space-betweenに頼らず常に右端へ寄せる
	margin-left: auto;
	color: #ff2a2a;
}

.imgs {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	justify-content: center;
}

.imgContainer {
	padding: 8px;
	border-radius: 6px;
}

.img {
	display: block;
	height: 64px;
	width: 64px;
	object-fit: contain;
}

.reactionPreview {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 4px;
}

.previewLabel {
	font-size: 0.85em;
	opacity: 0.7;
}

.previewCaption {
	font-size: 0.85em;
	opacity: 0.7;
	text-align: center;
}

.previewNote {
	width: 100%;
	border-radius: var(--MI-radius);
	border: var(--MI_THEME-panelBorder);
	background: var(--MI_THEME-panel);
	pointer-events: none;
}
</style>
