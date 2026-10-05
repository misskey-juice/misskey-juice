<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div>
	<div :class="$style.banner">
		<i class="ti ti-user-edit"></i>
	</div>
	<div class="_spacer" style="--MI_SPACER-min: 20px; --MI_SPACER-max: 32px;">
		<form class="_gaps_m" autocomplete="new-password" @submit.prevent="onSubmit">
			<MkInfo v-if="showReasonField" warn data-testid="signup-approval-notice">{{ i18n.ts._juice.approvalSignupNotice }}</MkInfo>
			<MkInput v-if="showInvitationField" v-model="invitationCode" type="text" :spellcheck="false" required data-testid="signup-invitation-code">
				<template #label>{{ i18n.ts.invitationCode }}</template>
				<template #prefix><i class="ti ti-key"></i></template>
			</MkInput>
			<MkInput v-model="username" type="text" pattern="^[a-zA-Z0-9_]{1,20}$" :spellcheck="false" autocomplete="username" required data-testid="signup-username" @update:modelValue="onChangeUsername">
				<template #label>{{ i18n.ts.username }} <div v-tooltip:dialog="i18n.ts.usernameInfo" class="_button _help"><i class="ti ti-help-circle"></i></div></template>
				<template #prefix>@</template>
				<template #suffix>@{{ host }}</template>
				<template #caption>
					<div><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.cannotBeChangedLater }}</div>
					<span v-if="usernameState === 'wait'" style="color:#999"><MkLoading :em="true"/> {{ i18n.ts.checking }}</span>
					<span v-else-if="usernameState === 'ok'" style="color: var(--MI_THEME-success)"><i class="ti ti-check ti-fw"></i> {{ i18n.ts.available }}</span>
					<span v-else-if="usernameState === 'unavailable'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.unavailable }}</span>
					<span v-else-if="usernameState === 'error'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.error }}</span>
					<span v-else-if="usernameState === 'invalid-format'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.usernameInvalidFormat }}</span>
					<span v-else-if="usernameState === 'min-range'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.tooShort }}</span>
					<span v-else-if="usernameState === 'max-range'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.tooLong }}</span>
				</template>
			</MkInput>
			<MkTextarea v-if="showReasonField" v-model="reason" :required="props.juicePublicSettings.signupReasonRequired" data-testid="signup-reason">
				<template #label>{{ i18n.ts._signup.reason }}</template>
				<template #caption>{{ i18n.tsx._signup.reasonCaption({ max: props.juicePublicSettings.signupReasonMaxLength }) }}</template>
			</MkTextarea>
			<MkInput v-if="showEmailField" v-model="email" :debounce="true" type="email" :spellcheck="false" required data-testid="signup-email" @update:modelValue="onChangeEmail">
				<template #label>{{ i18n.ts.emailAddress }} <div v-tooltip:dialog="i18n.ts._signup.emailAddressInfo" class="_button _help"><i class="ti ti-help-circle"></i></div></template>
				<template #prefix><i class="ti ti-mail"></i></template>
				<template #caption>
					<span v-if="emailState === 'wait'" style="color:#999"><MkLoading :em="true"/> {{ i18n.ts.checking }}</span>
					<span v-else-if="emailState === 'ok'" style="color: var(--MI_THEME-success)"><i class="ti ti-check ti-fw"></i> {{ i18n.ts.available }}</span>
					<span v-else-if="emailState === 'unavailable:used'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.used }}</span>
					<span v-else-if="emailState === 'unavailable:format'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.format }}</span>
					<span v-else-if="emailState === 'unavailable:disposable'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.disposable }}</span>
					<span v-else-if="emailState === 'unavailable:banned'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.banned }}</span>
					<span v-else-if="emailState === 'unavailable:mx'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.mx }}</span>
					<span v-else-if="emailState === 'unavailable:smtp'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.smtp }}</span>
					<span v-else-if="emailState === 'unavailable:plusTag'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.plusTag }}</span>
					<span v-else-if="emailState === 'unavailable:gmailDot'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts._emailUnavailable.gmailDot }}</span>
					<span v-else-if="emailState === 'unavailable'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.unavailable }}</span>
					<span v-else-if="emailState === 'error'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.error }}</span>
				</template>
			</MkInput>
			<MkSelect v-if="showEmailField" v-model="emailLang" :items="langs.map(x => ({ label: x[1], value: x[0] }))" data-testid="signup-email-lang">
				<template #label>{{ i18n.ts._juice.emailLanguage }}</template>
				<template #caption>{{ i18n.ts._juice.emailLanguageCaption }}</template>
			</MkSelect>
			<MkInput v-model="password" type="password" autocomplete="new-password" required data-testid="signup-password" @update:modelValue="onChangePassword">
				<template #label>{{ i18n.ts.password }}</template>
				<template #prefix><i class="ti ti-lock"></i></template>
				<template #caption>
					<span v-if="passwordStrength == 'low'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.weakPassword }}</span>
					<span v-if="passwordStrength == 'medium'" style="color: var(--MI_THEME-warn)"><i class="ti ti-check ti-fw"></i> {{ i18n.ts.normalPassword }}</span>
					<span v-if="passwordStrength == 'high'" style="color: var(--MI_THEME-success)"><i class="ti ti-check ti-fw"></i> {{ i18n.ts.strongPassword }}</span>
				</template>
			</MkInput>
			<MkInput v-model="retypedPassword" type="password" autocomplete="new-password" required data-testid="signup-password-retype" @update:modelValue="onChangePasswordRetype">
				<template #label>{{ i18n.ts.password }} ({{ i18n.ts.retype }})</template>
				<template #prefix><i class="ti ti-lock"></i></template>
				<template #caption>
					<span v-if="passwordRetypeState == 'match'" style="color: var(--MI_THEME-success)"><i class="ti ti-check ti-fw"></i> {{ i18n.ts.passwordMatched }}</span>
					<span v-if="passwordRetypeState == 'not-match'" style="color: var(--MI_THEME-error)"><i class="ti ti-alert-triangle ti-fw"></i> {{ i18n.ts.passwordNotMatched }}</span>
				</template>
			</MkInput>
			<MkCaptcha v-if="instance.enableHcaptcha" ref="hcaptcha" v-model="hCaptchaResponse" :class="$style.captcha" provider="hcaptcha" :sitekey="instance.hcaptchaSiteKey"/>
			<MkCaptcha v-if="instance.enableMcaptcha" ref="mcaptcha" v-model="mCaptchaResponse" :class="$style.captcha" provider="mcaptcha" :sitekey="instance.mcaptchaSiteKey" :instanceUrl="instance.mcaptchaInstanceUrl"/>
			<MkCaptcha v-if="instance.enableRecaptcha" ref="recaptcha" v-model="reCaptchaResponse" :class="$style.captcha" provider="recaptcha" :sitekey="instance.recaptchaSiteKey"/>
			<MkCaptcha v-if="instance.enableTurnstile" ref="turnstile" v-model="turnstileResponse" :class="$style.captcha" provider="turnstile" :sitekey="instance.turnstileSiteKey"/>
			<MkCaptcha v-if="instance.enableTestcaptcha" ref="testcaptcha" v-model="testcaptchaResponse" :class="$style.captcha" provider="testcaptcha" :sitekey="null"/>
			<MkButton type="submit" :disabled="shouldDisableSubmitting" large gradate rounded data-testid="signup-submit" style="margin: 0 auto;">
				<template v-if="submitting">
					<MkLoading :em="true" :colored="false"/>
				</template>
				<template v-else>{{ showReasonField ? i18n.ts._juice.apply : i18n.ts.start }}</template>
			</MkButton>
		</form>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref, computed, defineAsyncComponent } from 'vue';
import { toUnicode } from 'punycode.js';
import * as Misskey from 'misskey-js';
import * as config from '@@/js/config.js';
import { langs } from '@@/js/config.js';
import MkButton from './MkButton.vue';
import MkInput from './MkInput.vue';
import MkTextarea from './MkTextarea.vue';
import MkInfo from './MkInfo.vue';
import MkSelect from './MkSelect.vue';
import type { Captcha } from '@/components/MkCaptcha.vue';
import MkCaptcha from '@/components/MkCaptcha.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { instance } from '@/instance.js';
import { i18n } from '@/i18n.js';
import { login } from '@/accounts.js';
import { addSignupApprovalCheckCode } from '@/utility/signup-approval-check-codes.js';

const props = withDefaults(defineProps<{
	autoSet?: boolean;
	// 招待コード登録・参加申請のボタンが分かれている場合に、どちらの入口から開かれたかを示す。
	// 未指定時は従来通り単一フォームの動的出し分け(招待コード欄の有無/入力有無で判定)を行う。
	mode?: 'invitation' | 'application';
	juicePublicSettings?: Misskey.entities.JuicePublicSettingsResponse;
}>(), {
	autoSet: false,
	mode: undefined,
	juicePublicSettings: () => ({
		approvalRequiredForSignup: false,
		signupReasonRequired: true,
		signupReasonMaxLength: 4096,
		invitationRegistrationEnabled: true,
		exploreOtherServersEnabled: true,
		emojiRequestEnabled: false,
		emojiRequestRequireCategory: false,
		emojiRequestRequireTags: false,
		emojiRequestRequireLicense: false,
		avatarDecorationRequestEnabled: false,
		avatarDecorationRequestRequireCategory: false,
		avatarDecorationRequestRequireDescription: false,
		relayTimelineEnabled: false,
		mediaTimelineEnabled: false,
		latexEnabled: true,
		reactionPiggybackOnRemoteEnabled: false,
		contactFormEnabled: true,
		contactFormRequireAuth: false,
		contactFormContentMaxLength: 10000,
		contactFormCategories: [],
		reportCategories: [],
		discordOauthEnabled: false,
		googleOauthEnabled: false,
		githubOauthEnabled: false,
		gitlabOauthEnabled: false,
		microsoftOauthEnabled: false,
		midiPlayerMaxSize: 500 * 1024,
		drawRoomEnabled: true,
		drawRoomMaxRoomMegabytes: 256,
		importApprovalRequiredTypes: [],
	}),
});

const emit = defineEmits<{
	(ev: 'signup', user: Misskey.entities.SignupSuccessResponse): void;
	(ev: 'signupEmailPending'): void;
	(ev: 'signupPendingApproval'): void;
}>();

const host = toUnicode(config.host);

const hcaptcha = ref<Captcha | undefined>();
const mcaptcha = ref<Captcha | undefined>();
const recaptcha = ref<Captcha | undefined>();
const turnstile = ref<Captcha | undefined>();
const testcaptcha = ref<Captcha | undefined>();

const username = ref<string>('');
const password = ref<string>('');
const retypedPassword = ref<string>('');
const invitationCode = ref<string>('');
const email = ref('');
const reason = ref('');

// ブラウザの優先言語リスト(navigator.languages)を優先度順に見て、完全一致する翻訳があればそれを使う。
// 無ければ次に優先度順で主言語一致を探す。最後まで何も無ければ ja-JP にフォールバックする
function pickDefaultEmailLang(): string {
	const preferred = navigator.languages && navigator.languages.length > 0 ? navigator.languages : [navigator.language];

	for (const pref of preferred) {
		const exact = langs.find(([code]) => code === pref)?.[0];
		if (exact) return exact;
	}

	for (const pref of preferred) {
		const primary = langs.find(([code]) => code.split('-')[0] === pref.split('-')[0])?.[0];
		if (primary) return primary;
	}

	return 'ja-JP';
}

const emailLang = ref<string>(pickDefaultEmailLang());
const usernameState = ref<null | 'wait' | 'ok' | 'unavailable' | 'error' | 'invalid-format' | 'min-range' | 'max-range'>(null);
const emailState = ref<null | 'wait' | 'ok' | 'unavailable:used' | 'unavailable:format' | 'unavailable:disposable' | 'unavailable:banned' | 'unavailable:mx' | 'unavailable:smtp' | 'unavailable:plusTag' | 'unavailable:gmailDot' | 'unavailable' | 'error'>(null);
const passwordStrength = ref<'' | 'low' | 'medium' | 'high'>('');
const passwordRetypeState = ref<null | 'match' | 'not-match'>(null);
const submitting = ref<boolean>(false);
const hCaptchaResponse = ref<string | null>(null);
const mCaptchaResponse = ref<string | null>(null);
const reCaptchaResponse = ref<string | null>(null);
const turnstileResponse = ref<string | null>(null);
const testcaptchaResponse = ref<string | null>(null);
const usernameAbortController = ref<null | AbortController>(null);
const emailAbortController = ref<null | AbortController>(null);

// 招待コードでの登録は、招待した時点でモデレーターの信任があるため承認式登録をバイパスする
// (mode 未指定時、単一フォームでの動的出し分けに使う)
const approvalBypassedByInvitation = computed((): boolean => instance.disableRegistration && invitationCode.value !== '');

// 招待コード欄を表示するか・必須にするか(このフォームでは常に同値: 表示する場合は必ず必須)。
// mode="application" では常に隠す(申請ボタンから開いた=コードを持たない選択なので)。
// mode="invitation" は明示的に招待コード登録を選んでいるため常に表示・必須にする。
// JUICE: invitationRegistrationEnabledは、mode未指定の単一フォーム(通常の入り口)で
// 招待コード欄を出すかどうかだけを制御する。mode="invitation"を明示的に指定して開いた
// 場合(URLを直接共有された等)は、この設定に関わらず常に表示する
const showInvitationField = computed((): boolean => {
	if (props.mode === 'application') return false;
	if (props.mode === 'invitation') return true;
	if (!props.juicePublicSettings.invitationRegistrationEnabled) return false;
	return instance.disableRegistration;
});

// 理由欄を表示するか。mode="invitation" では常に隠す(招待コード登録は理由不要のため)
const showReasonField = computed((): boolean => {
	if (props.mode === 'invitation') return false;
	if (props.mode === 'application') return props.juicePublicSettings.approvalRequiredForSignup;
	return props.juicePublicSettings.approvalRequiredForSignup && !approvalBypassedByInvitation.value;
});

// メールアドレス欄・メール受信言語欄を表示するか
const showEmailField = computed((): boolean => instance.emailRequiredForSignup);

const shouldDisableSubmitting = computed((): boolean => {
	return submitting.value ||
		instance.enableHcaptcha && !hCaptchaResponse.value ||
		instance.enableMcaptcha && !mCaptchaResponse.value ||
		instance.enableRecaptcha && !reCaptchaResponse.value ||
		instance.enableTurnstile && !turnstileResponse.value ||
		instance.enableTestcaptcha && !testcaptchaResponse.value ||
		showEmailField.value && emailState.value !== 'ok' ||
		showInvitationField.value && invitationCode.value === '' ||
		showReasonField.value && props.juicePublicSettings.signupReasonRequired && reason.value.trim() === '' ||
		showReasonField.value && reason.value.length > props.juicePublicSettings.signupReasonMaxLength ||
		usernameState.value !== 'ok' ||
		passwordRetypeState.value !== 'match';
});

function getPasswordStrength(source: string): number {
	let strength = 0;
	let power = 0.018;

	// 英数字
	if (/[a-zA-Z]/.test(source) && /[0-9]/.test(source)) {
		power += 0.020;
	}

	// 大文字と小文字が混ざってたら
	if (/[a-z]/.test(source) && /[A-Z]/.test(source)) {
		power += 0.015;
	}

	// 記号が混ざってたら
	if (/[!\x22\#$%&@'()*+,-./_]/.test(source)) {
		power += 0.02;
	}

	strength = power * source.length;

	return Math.max(0, Math.min(1, strength));
}

function onChangeUsername(): void {
	if (username.value === '') {
		usernameState.value = null;
		return;
	}

	{
		const err =
			!username.value.match(/^[a-zA-Z0-9_]+$/) ? 'invalid-format' :
			username.value.length < 1 ? 'min-range' :
			username.value.length > 20 ? 'max-range' :
			null;

		if (err) {
			usernameState.value = err;
			return;
		}
	}

	if (usernameAbortController.value != null) {
		usernameAbortController.value.abort();
	}
	usernameState.value = 'wait';
	usernameAbortController.value = new AbortController();

	misskeyApi('username/available', {
		username: username.value,
	}, undefined, usernameAbortController.value.signal).then(result => {
		usernameState.value = result.available ? 'ok' : 'unavailable';
	}).catch((err) => {
		if (err.name !== 'AbortError') {
			usernameState.value = 'error';
		}
	});
}

function onChangeEmail(): void {
	if (email.value === '') {
		emailState.value = null;
		return;
	}

	if (emailAbortController.value != null) {
		emailAbortController.value.abort();
	}
	emailState.value = 'wait';
	emailAbortController.value = new AbortController();

	misskeyApi('email-address/available', {
		emailAddress: email.value,
	}, undefined, emailAbortController.value.signal).then(result => {
		emailState.value = result.available ? 'ok' :
			result.reason === 'used' ? 'unavailable:used' :
			result.reason === 'format' ? 'unavailable:format' :
			result.reason === 'disposable' ? 'unavailable:disposable' :
			result.reason === 'banned' ? 'unavailable:banned' :
			result.reason === 'mx' ? 'unavailable:mx' :
			result.reason === 'smtp' ? 'unavailable:smtp' :
			result.reason === 'plusTag' ? 'unavailable:plusTag' :
			result.reason === 'gmailDot' ? 'unavailable:gmailDot' :
			'unavailable';
	}).catch((err) => {
		if (err.name !== 'AbortError') {
			emailState.value = 'error';
		}
	});
}

function onChangePassword(): void {
	if (password.value === '') {
		passwordStrength.value = '';
		return;
	}

	const strength = getPasswordStrength(password.value);
	passwordStrength.value = strength > 0.7 ? 'high' : strength > 0.3 ? 'medium' : 'low';
}

function onChangePasswordRetype(): void {
	if (retypedPassword.value === '') {
		passwordRetypeState.value = null;
		return;
	}

	passwordRetypeState.value = password.value === retypedPassword.value ? 'match' : 'not-match';
}

async function onSubmit(): Promise<void> {
	if (submitting.value) return;
	submitting.value = true;

	const signupPayload: Misskey.entities.SignupRequest = {
		username: username.value,
		password: password.value,
		emailAddress: email.value,
		invitationCode: showInvitationField.value ? invitationCode.value : undefined,
		reason: showReasonField.value ? reason.value : undefined,
		emailLang: showEmailField.value ? emailLang.value : undefined,
		'hcaptcha-response': hCaptchaResponse.value,
		'm-captcha-response': mCaptchaResponse.value,
		'g-recaptcha-response': reCaptchaResponse.value,
		'turnstile-response': turnstileResponse.value,
		'testcaptcha-response': testcaptchaResponse.value,
	};

	const res = await window.fetch(`${config.apiUrl}/signup`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(signupPayload),
	}).catch(() => {
		onSignupApiError();
		return null;
	});

	if (res && res.ok) {
		if (res.status === 204 || instance.emailRequiredForSignup) {
			os.alert({
				type: 'success',
				title: i18n.ts._signup.almostThere,
				text: i18n.tsx._signup.emailSent({ email: email.value }),
			});
			emit('signupEmailPending');
		} else {
			const resJson = (await res.json()) as Misskey.entities.SignupResponse;
			if (_DEV_) console.log(resJson);

			if ('pendingApproval' in resJson) {
				// この分岐に来る時点で instance.emailRequiredForSignup は必ず false
				// (true の場合は上の if で email 確認フローに分岐済み)なので、
				// メールアドレスは収集していない。承認結果をメールで知らせる旨は案内しない。
				// 代わりに確認コードをこの端末へ保存し、/signup-check でいつでも審査状況を確認できるようにする(JUICE)。
				addSignupApprovalCheckCode(resJson.checkCode);
				const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkSignupApprovalPendingDialog.vue')), {
					text: i18n.ts._signup.pendingApprovalNoEmail,
					code: resJson.checkCode,
				}, {
					closed: () => dispose(),
				});
				emit('signupPendingApproval');
			} else {
				emit('signup', resJson);

				if (props.autoSet) {
					await login(resJson.token);
				}
			}
		}
	} else {
		onSignupApiError();
	}

	submitting.value = false;
}

function onSignupApiError() {
	submitting.value = false;
	hcaptcha.value?.reset?.();
	mcaptcha.value?.reset?.();
	recaptcha.value?.reset?.();
	turnstile.value?.reset?.();
	testcaptcha.value?.reset?.();

	os.alert({
		type: 'error',
		text: i18n.ts.somethingHappened,
	});
}
</script>

<style lang="scss" module>
.banner {
	padding: 16px;
	text-align: center;
	font-size: 26px;
	background-color: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
}

.captcha {
	margin: 16px 0;
}
</style>
