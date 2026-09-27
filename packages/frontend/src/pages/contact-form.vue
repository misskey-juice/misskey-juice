<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" :class="$style.container">
		<div v-if="!contactFormEnabled" class="_gaps_m" :class="$style.disabledContainer">
			<div>
				<i class="ti ti-ban" :class="$style.disabledIcon"></i>
			</div>
			<div>
				<h2 :class="$style.disabledTitle">{{ i18n.ts._contactForm._userForm.contactFormDisabled }}</h2>
				<p :class="$style.disabledDescription">{{ i18n.ts._contactForm._userForm.contactFormDisabledDescription }}</p>
			</div>
		</div>

		<div v-else-if="!isSubmitted" class="_gaps_m">
			<div class="_gaps">
				<div>
					<h1><i class="ti ti-mail"></i> {{ i18n.ts._contactForm._userForm.contactUs }}</h1>
					<p>{{ i18n.ts._contactForm._userForm.contactDescription }}</p>
				</div>
			</div>

			<div class="_gaps_m">
				<FormSection>
					<template #label><i class="ti ti-forms"></i> {{ i18n.ts._contactForm._userForm.category }}</template>
					<MkSelect v-model="category" :items="categoryOptions" :required="true"/>
				</FormSection>

				<FormSection>
					<template #label><i class="ti ti-pencil"></i> {{ i18n.ts._contactForm._userForm.subject }} *</template>
					<MkInput
						v-model="subject"
						:required="true"
						:placeholder="i18n.ts._contactForm._userForm.subjectPlaceholder"
						:max="256"
					/>
				</FormSection>

				<FormSection>
					<template #label><i class="ti ti-message-2"></i> {{ i18n.ts._contactForm._userForm.content }} *</template>
					<MkTextarea
						v-model="content"
						:required="true"
						:tall="true"
						:placeholder="i18n.ts._contactForm._userForm.contentPlaceholder"
					>
						<template #caption>{{ i18n.tsx._contactForm._validation.contentLengthCaption({ current: content.length, max: contactFormContentMaxLength }) }}</template>
					</MkTextarea>
					<div v-if="content.length > contactFormContentMaxLength" :class="$style.fieldError">
						<i class="ti ti-exclamation-triangle" style="margin-right: 4px;"></i>
						{{ i18n.ts._contactForm._validation.contentTooLong }}
					</div>
				</FormSection>

				<FormSection>
					<template #label><i class="ti ti-user"></i> {{ i18n.ts._contactForm._userForm.name }}</template>
					<template #caption>{{ i18n.ts._contactForm._userForm.nameCaption }}</template>
					<MkInput
						v-model="name"
						:placeholder="i18n.ts._contactForm._userForm.namePlaceholder"
						:max="256"
					/>
				</FormSection>

				<FormSection>
					<template #label><i class="ti ti-mail-forward"></i> {{ i18n.ts._contactForm._userForm.replyMethod }} *</template>
					<MkRadios
						v-model="replyMethod"
						:required="true"
						:options="[
							{ value: 'email', label: i18n.ts._contactForm._userForm.replyByEmail },
							{ value: 'misskey', label: i18n.ts._contactForm._userForm.replyByMisskey },
						]"
					/>
				</FormSection>

				<FormSection v-if="replyMethod === 'email'">
					<template #label><i class="ti ti-mail"></i> {{ i18n.ts._contactForm._userForm.email }} *</template>
					<MkInput
						v-model="email"
						:debounce="true"
						type="email"
						:required="replyMethod === 'email'"
						:placeholder="i18n.ts._contactForm._userForm.emailPlaceholder"
						:max="320"
						@update:modelValue="onChangeEmail"
					>
						<template v-if="emailState === 'wait'" #suffix><i class="ti ti-loader" style="animation: spin 1s linear infinite;"></i></template>
						<template v-else-if="emailState === 'ok'" #suffix><i class="ti ti-check" style="color: var(--MI_THEME-success);"></i></template>
						<template v-else-if="emailState && emailState.startsWith('unavailable')" #suffix><i class="ti ti-exclamation-triangle" style="color: var(--MI_THEME-error);"></i></template>
						<template v-else-if="emailState === 'error'" #suffix><i class="ti ti-alert-circle" style="color: var(--MI_THEME-error);"></i></template>
					</MkInput>
					<div v-if="emailState && emailState !== 'wait' && emailState !== 'ok'" :class="$style.fieldError">
						<i class="ti ti-exclamation-triangle" style="margin-right: 4px;"></i>
						<span v-if="emailState === 'unavailable:format'">{{ i18n.ts._emailUnavailable.format }}</span>
						<span v-else-if="emailState === 'unavailable:disposable'">{{ i18n.ts._emailUnavailable.disposable }}</span>
						<span v-else-if="emailState === 'unavailable:banned'">{{ i18n.ts._emailUnavailable.banned }}</span>
						<span v-else-if="emailState === 'unavailable:mx'">{{ i18n.ts._emailUnavailable.mx }}</span>
						<span v-else-if="emailState === 'unavailable:smtp'">{{ i18n.ts._emailUnavailable.smtp }}</span>
						<span v-else-if="emailState === 'unavailable'">{{ i18n.ts.unavailable }}</span>
						<span v-else-if="emailState === 'error'">{{ i18n.ts.error }}</span>
					</div>
				</FormSection>

				<FormSection v-if="replyMethod === 'misskey'">
					<template #label><i class="ti ti-at"></i> {{ i18n.ts._contactForm._userForm.misskeyUsername }} *</template>
					<template #caption>{{ i18n.ts._contactForm._userForm.misskeyUsernameCaption }}</template>
					<MkInput
						v-model="misskeyUsername"
						:required="replyMethod === 'misskey'"
						:placeholder="i18n.ts._contactForm._userForm.misskeyUsernamePlaceholder"
						:max="128"
						@input="onChangeMisskeyUsername"
					/>
					<div v-if="misskeyUsernameError" :class="$style.fieldError">
						<i class="ti ti-exclamation-triangle" style="margin-right: 4px;"></i>
						{{ misskeyUsernameError }}
					</div>
				</FormSection>

				<FormSection>
					<MkSwitch v-model="includeDeviceInfo">
						<template #label>{{ i18n.ts._contactForm._userForm.includeDeviceInfo }}</template>
						<template #caption>{{ i18n.ts._contactForm._userForm.includeDeviceInfoCaption }}</template>
					</MkSwitch>
					<MkFolder v-if="includeDeviceInfo" :defaultOpen="false" style="margin-top: 8px;">
						<template #icon><i class="ti ti-report-search"></i></template>
						<template #label>{{ i18n.ts.deviceInfo }}</template>
						<MkCode lang="json" :code="deviceInfoText" style="max-height: 300px; overflow: auto;"/>
					</MkFolder>
				</FormSection>

				<FormSection v-if="instance.enableHcaptcha">
					<MkCaptcha ref="hcaptcha" v-model="captchaToken" provider="hcaptcha" :sitekey="instance.hcaptchaSiteKey"/>
				</FormSection>
				<FormSection v-else-if="instance.enableRecaptcha">
					<MkCaptcha ref="recaptcha" v-model="captchaToken" provider="recaptcha" :sitekey="instance.recaptchaSiteKey"/>
				</FormSection>
				<FormSection v-else-if="instance.enableTurnstile">
					<MkCaptcha ref="turnstile" v-model="captchaToken" provider="turnstile" :sitekey="instance.turnstileSiteKey"/>
				</FormSection>
				<FormSection v-else-if="instance.enableMcaptcha">
					<MkCaptcha ref="mcaptcha" v-model="captchaToken" provider="mcaptcha" :sitekey="instance.mcaptchaSiteKey" :instanceUrl="instance.mcaptchaInstanceUrl"/>
				</FormSection>
				<FormSection v-else-if="instance.enableTestcaptcha">
					<MkCaptcha ref="testcaptcha" v-model="captchaToken" provider="testcaptcha" :sitekey="null"/>
				</FormSection>

				<div class="_buttons">
					<MkButton :disabled="submitting || !canSubmit" primary rounded style="margin: 0 auto;" @click="submit">
						<template v-if="submitting"><i class="ti ti-loader" style="animation: spin 1s linear infinite;"></i></template>
						<template v-else><i class="ti ti-send"></i> {{ i18n.ts._contactForm._userForm.submit }}</template>
					</MkButton>
				</div>
			</div>
		</div>

		<div v-else class="_gaps_m" style="text-align: center;">
			<div>
				<i class="ti ti-check" style="color: var(--MI_THEME-success); font-size: 3em;"></i>
			</div>
			<div>
				<h2>{{ i18n.ts._contactForm._submitComplete.complete }}</h2>
				<p>{{ i18n.ts._contactForm._submitComplete.completeDescription }}</p>
			</div>

			<div class="_gaps_m" :class="$style.previewContainer">
				<div :class="$style.previewCard">
					<h3 :class="$style.previewTitle">
						<i class="ti ti-mail-opened"></i> {{ i18n.ts._contactForm._adminDetail.submittedContent }}
					</h3>

					<div class="_gaps_s">
						<div :class="$style.previewField">
							<strong>{{ i18n.ts._contactForm._userForm.category }}:</strong>
							<span :class="$style.previewValue">{{ getCategoryLabel(submittedData.category) }}</span>
						</div>

						<div :class="$style.previewField">
							<strong>{{ i18n.ts._contactForm._userForm.subject }}:</strong>
							<div :class="$style.previewContent">
								{{ submittedData.subject }}
							</div>
						</div>

						<div :class="$style.previewField">
							<strong>{{ i18n.ts._contactForm._userForm.content }}:</strong>
							<div :class="[$style.previewContent, $style.previewContentText]">
								{{ submittedData.content }}
							</div>
						</div>

						<div v-if="submittedData.name" :class="$style.previewField">
							<strong>{{ i18n.ts._contactForm._userForm.name }}:</strong>
							<span :class="$style.previewValue">{{ submittedData.name }}</span>
						</div>

						<div :class="$style.previewField">
							<strong>{{ i18n.ts._contactForm._userForm.replyMethod }}:</strong>
							<span :class="$style.previewValue">{{ getReplyMethodText(submittedData.replyMethod) }}</span>
						</div>

						<div v-if="submittedData.replyMethod === 'email'" :class="$style.previewField">
							<strong>{{ i18n.ts._contactForm._userForm.email }}:</strong>
							<span :class="$style.previewValue">{{ submittedData.email }}</span>
						</div>

						<div v-if="submittedData.replyMethod === 'misskey'" :class="$style.previewField">
							<strong>{{ i18n.ts._contactForm._userForm.misskeyUsername }}:</strong>
							<span :class="$style.previewValue">
								<Mfm :text="`@${submittedData.misskeyUsername}`" :linkNavigationBehavior="'window'"/>
							</span>
						</div>

						<div :class="$style.previewTimestamp">
							<i class="ti ti-clock"></i>
							{{ i18n.ts._contactForm._adminDetail.submittedAt }}: {{ submittedAt }}
						</div>
					</div>
				</div>
			</div>

			<div>
				<MkButton inline @click="reset">{{ i18n.ts._contactForm._submitComplete.goToTop }}</MkButton>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkRadios from '@/components/MkRadios.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkCode from '@/components/MkCode.vue';
import MkCaptcha from '@/components/MkCaptcha.vue';
import type { Captcha } from '@/components/MkCaptcha.vue';
import FormSection from '@/components/form/section.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import { definePage } from '@/page.js';
import { juicePublicSettingsCache } from '@/cache.js';
import { useContactFormCategories } from '@/composables/useContactFormCategories.js';
import { getUserEnvironment } from '@/utility/get-user-environment.js';
import type { UserEnvironment } from '@/utility/get-user-environment.js';

// JUICE: misskey-tempuraのコンタクトフォームを参考に追加
const { fetchCategories, getCategoryLabel, getDefaultCategory, categoryOptions } = useContactFormCategories();

// JUICE: 設定取得に失敗した場合にフォームが開けなくなるのを避けるため、フェイルオープン(common.tsのメニュー表示と同じ方針)にする
const contactFormEnabled = ref(true);
// JUICE: JUICE設定で変更可能。取得できるまではサーバー側の絶対上限と同じ既定値を使う
const contactFormContentMaxLength = ref(10000);

const category = ref('other');
const subject = ref('');
const content = ref('');
const name = ref('');
const replyMethod = ref<'email' | 'misskey'>('email');
const email = ref('');
const misskeyUsername = ref('');

const emailState = ref<null | 'wait' | 'ok' | 'unavailable:format' | 'unavailable:disposable' | 'unavailable:banned' | 'unavailable:mx' | 'unavailable:smtp' | 'unavailable' | 'error'>(null);
let emailAbortController: AbortController | null = null;

const misskeyUsernameError = ref<string | null>(null);

const submitting = ref(false);
const isSubmitted = ref(false);
const submittedData = ref<{
	category: string;
	subject: string;
	content: string;
	name: string;
	replyMethod: 'email' | 'misskey';
	email: string | null;
	misskeyUsername: string | null;
}>({
	category: 'other',
	subject: '',
	content: '',
	name: '',
	replyMethod: 'email',
	email: null,
	misskeyUsername: null,
});
const submittedAt = ref('');

const captchaToken = ref<string | null>(null);
const hcaptcha = ref<Captcha | undefined>();
const recaptcha = ref<Captcha | undefined>();
const turnstile = ref<Captcha | undefined>();
const mcaptcha = ref<Captcha | undefined>();
const testcaptcha = ref<Captcha | undefined>();

// JUICE: 技術的な不具合報告に役立つよう、既存の「お問い合わせ」ページ(contact.vue)にある
// デバイス情報表示と同じ情報を、任意でこのフォームの送信内容に含められるようにする
const includeDeviceInfo = ref(false);
const userEnv = ref<UserEnvironment | null>(null);
const deviceInfoText = computed(() => userEnv.value ? JSON.stringify(userEnv.value, null, 2) : '');

watch(includeDeviceInfo, async (v) => {
	if (v && userEnv.value == null) {
		userEnv.value = await getUserEnvironment();
	}
});

function resetCaptcha() {
	captchaToken.value = null;
	hcaptcha.value?.reset?.();
	recaptcha.value?.reset?.();
	turnstile.value?.reset?.();
	mcaptcha.value?.reset?.();
	testcaptcha.value?.reset?.();
}

onMounted(async () => {
	try {
		const settings = await juicePublicSettingsCache.fetch();
		contactFormEnabled.value = settings.contactFormEnabled;
		contactFormContentMaxLength.value = settings.contactFormContentMaxLength;
	} catch (err) {
		console.error('Failed to fetch juice public settings', err);
	}

	await fetchCategories();
	category.value = getDefaultCategory();

	if ($i) {
		name.value = $i.name || $i.username;
		replyMethod.value = 'misskey';
		// JUICE: $iは常にこのサーバー自身のローカルユーザーなので、ホストの付与は不要
		// (付けるとインスタンスのURLがIPアドレス・ポート番号を含む場合等にドメイン形式の
		// バリデーションへ引っかかっていた)。プレースホルダー・キャプションと表示を合わせるため先頭に@を付ける
		misskeyUsername.value = `@${$i.username}`;
		email.value = $i.email || '';
	}
});

function onChangeMisskeyUsername(): void {
	if (misskeyUsername.value === '') {
		misskeyUsernameError.value = null;
		return;
	}

	const username = misskeyUsername.value.trim().replace(/^@/, '');

	// JUICE: ローカルユーザーはこのサーバーのドメインを付与しなくても@usernameのみで通す
	if (!username.includes('@')) {
		misskeyUsernameError.value = /^[a-zA-Z0-9_-]+$/.test(username)
			? null
			: i18n.ts._contactForm._validation.misskeyUsernameCharacterError;
		return;
	}

	const parts = username.split('@');
	if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
		misskeyUsernameError.value = i18n.ts._contactForm._validation.misskeyUsernameFormatError;
		return;
	}

	const [user, domain] = parts;

	if (!/^[a-zA-Z0-9_-]+$/.test(user)) {
		misskeyUsernameError.value = i18n.ts._contactForm._validation.misskeyUsernameCharacterError;
		return;
	}

	if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain)) {
		misskeyUsernameError.value = i18n.ts._contactForm._validation.misskeyUsernameDomainError;
		return;
	}

	misskeyUsernameError.value = null;
}

function onChangeEmail(): void {
	if (email.value === '') {
		emailState.value = null;
		return;
	}

	const basicEmailFormat = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	if (!basicEmailFormat.test(email.value)) {
		emailState.value = 'unavailable:format';
		return;
	}

	if (emailAbortController != null) {
		emailAbortController.abort();
	}
	emailState.value = 'wait';
	emailAbortController = new AbortController();

	misskeyApi('email-address/available', {
		emailAddress: email.value,
	}, undefined, emailAbortController.signal).then(result => {
		// JUICE: +タグ・Gmailのドットの禁止はアカウント向けの設定なので、お問い合わせでは使えるものとして扱う
		emailState.value = result.available || result.reason === 'plusTag' || result.reason === 'gmailDot' ? 'ok' :
			result.reason === 'format' ? 'unavailable:format' :
			result.reason === 'disposable' ? 'unavailable:disposable' :
			result.reason === 'banned' ? 'unavailable:banned' :
			result.reason === 'mx' ? 'unavailable:mx' :
			result.reason === 'smtp' ? 'unavailable:smtp' :
			'unavailable';
	}).catch((err) => {
		if (err.name !== 'AbortError') {
			emailState.value = 'error';
		}
	});
}

const canSubmit = computed(() => {
	if (!subject.value.trim()) return false;
	if (!content.value.trim() || content.value.length < 20 || content.value.length > contactFormContentMaxLength.value) return false;
	if (replyMethod.value === 'email') {
		if (!email.value.trim()) return false;
		if (emailState.value && emailState.value !== 'ok' && emailState.value !== 'wait') return false;
	}
	if (replyMethod.value === 'misskey') {
		if (!misskeyUsername.value.trim()) return false;
		if (misskeyUsernameError.value) return false;
	}

	const captchaRequired = instance.enableHcaptcha || instance.enableRecaptcha ||
		instance.enableTurnstile || instance.enableMcaptcha || instance.enableTestcaptcha;
	if (captchaRequired && !captchaToken.value) return false;

	return true;
});

async function submit() {
	if (!canSubmit.value) return;

	submitting.value = true;

	try {
		// JUICE: デバイス情報を含める場合、本文の末尾に付記する(サーバー側にデバイス情報専用の
		// 項目は無いため)。文字数上限を超える場合は付記せず、本文の内容を優先する
		let finalContent = content.value.trim();
		if (includeDeviceInfo.value && userEnv.value != null) {
			const withDeviceInfo = `${finalContent}\n\n--- ${i18n.ts.deviceInfo} ---\n${deviceInfoText.value}`;
			if (withDeviceInfo.length <= contactFormContentMaxLength.value) finalContent = withDeviceInfo;
		}

		const payload: Misskey.entities.ContactFormSubmitRequest = {
			subject: subject.value.trim(),
			content: finalContent,
			category: category.value,
			replyMethod: replyMethod.value,
			name: name.value.trim() || undefined,
			email: replyMethod.value === 'email' ? email.value.trim() : undefined,
			misskeyUsername: replyMethod.value === 'misskey' ? misskeyUsername.value.trim().replace(/^@/, '') : undefined,
			'hcaptcha-response': instance.enableHcaptcha ? captchaToken.value : undefined,
			'g-recaptcha-response': instance.enableRecaptcha ? captchaToken.value : undefined,
			'turnstile-response': instance.enableTurnstile ? captchaToken.value : undefined,
			'm-captcha-response': instance.enableMcaptcha ? captchaToken.value : undefined,
			'testcaptcha-response': instance.enableTestcaptcha ? captchaToken.value : undefined,
		};

		await misskeyApi('contact-form/submit', payload);

		submittedData.value = {
			category: category.value,
			subject: subject.value,
			content: content.value,
			name: name.value,
			replyMethod: replyMethod.value,
			email: replyMethod.value === 'email' ? email.value : null,
			misskeyUsername: replyMethod.value === 'misskey' ? misskeyUsername.value.trim().replace(/^@/, '') : null,
		};
		submittedAt.value = new Date().toLocaleString();

		isSubmitted.value = true;
	} catch (err) {
		// JUICE: captchaのトークンは使い捨てのため、送信失敗時(captcha自体とは無関係な理由でも)は必ずリセットして再送信可能にする
		resetCaptcha();

		os.alert({
			type: 'error',
			text: i18n.ts.somethingHappened,
		});
	} finally {
		submitting.value = false;
	}
}

function getReplyMethodText(replyMethod: string): string {
	return replyMethod === 'email' ? i18n.ts._contactForm._userForm.replyByEmail : i18n.ts._contactForm._userForm.replyByMisskey;
}

function reset() {
	category.value = getDefaultCategory();
	subject.value = '';
	content.value = '';
	name.value = '';
	replyMethod.value = 'email';
	email.value = '';
	misskeyUsername.value = '';
	resetCaptcha();
	isSubmitted.value = false;
	submitting.value = false;
}

definePage(() => ({
	title: i18n.ts._contactForm._userForm.contactUs,
	icon: 'ti ti-mail',
}));
</script>

<style lang="scss" module>
.container {
	--MI_SPACER-w: 600px;
	--MI_SPACER-min: 20px;
}

.fieldError {
	margin-top: 8px;
	color: var(--MI_THEME-error);
	font-size: 0.9em;
}

.previewContainer {
	max-width: 700px;
	margin: 24px auto;
	text-align: left;
}

.previewCard {
	padding: 20px;
	background: var(--MI_THEME-panel);
	border-radius: 12px;
	border: 1px solid var(--MI_THEME-divider);
}

.previewTitle {
	margin: 0 0 20px 0;
	text-align: center;
	color: var(--MI_THEME-fg);
	font-size: 1.2em;
	font-weight: 600;
}

.previewField {
	margin-bottom: 12px;

	&:last-child {
		margin-bottom: 0;
	}

	strong {
		color: var(--MI_THEME-fg);
		font-weight: 600;
	}
}

.previewValue {
	margin-left: 8px;
	color: var(--MI_THEME-fg);
}

.previewContent {
	margin-top: 6px;
	padding: 12px;
	background: var(--MI_THEME-bg);
	border-radius: 6px;
	word-break: break-word;
	color: var(--MI_THEME-fg);
	border: 1px solid var(--MI_THEME-divider);
}

.previewContentText {
	white-space: pre-wrap;
	max-height: 300px;
	overflow-y: auto;
	line-height: 1.5;
}

.previewTimestamp {
	font-size: 0.9em;
	color: var(--MI_THEME-fgTransparentWeak);
	margin-top: 16px;
	padding-top: 12px;
	border-top: 1px solid var(--MI_THEME-divider);

	i {
		margin-right: 4px;
	}
}

.disabledContainer {
	text-align: center;
	padding: 40px 20px;
}

.disabledIcon {
	color: var(--MI_THEME-error);
	font-size: 3em;
	margin-bottom: 20px;
}

.disabledTitle {
	color: var(--MI_THEME-fg);
	font-size: 1.4em;
	font-weight: 600;
	margin: 0 0 16px 0;
}

.disabledDescription {
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 1em;
	line-height: 1.5;
	margin: 0;
	white-space: pre-line;
}
</style>
