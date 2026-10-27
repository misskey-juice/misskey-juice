<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithAnimBg>
	<div :class="$style.formContainer">
		<div :class="$style.form">
			<MkSigninTotp v-if="phase === 'totp'" @totpSubmitted="onTotpSubmitted"/>
			<div v-else-if="phase === 'error'" :class="$style.error">
				<i class="ti ti-alert-triangle" :class="$style.errorIcon"></i>
				<div>{{ errorText }}</div>
			</div>
			<MkLoading v-else/>
		</div>
	</div>
</PageWithAnimBg>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import MkSigninTotp from '@/components/MkSignin.totp.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { login } from '@/accounts.js';
import { definePage } from '@/page.js';

// JUICE: 連携ログイン。OAuthSigninCallbackApiServiceから発行されたcontextを消費して
// サインインを確定させる。2段階認証が有効なアカウントはTOTP入力(MkSignin.totp.vueを再利用)を挟む
const props = defineProps<{
	context?: string;
	error?: string;
}>();

const phase = ref<'loading' | 'totp' | 'error'>('loading');
const errorText = ref('');

async function proceed(token?: string) {
	if (props.context == null) return;

	const res = await misskeyApi('signin-with-oauth', {
		context: props.context,
		token,
	}).catch(() => null);

	if (res == null) {
		phase.value = 'error';
		errorText.value = i18n.ts._oauthLogin.signinFailed;
		return;
	}

	if (res.finished) {
		// 遷移先はURLクエリを信用せず、サーバーが検証して返した returnTo を使う
		await login(res.i, res.returnTo ?? '/');
		return;
	}

	if (res.next === 'totp') {
		phase.value = 'totp';
		return;
	}

	// このフローではtotp以外のnextは発生しない想定
	phase.value = 'error';
	errorText.value = i18n.ts._oauthLogin.signinFailed;
}

function onTotpSubmitted(token: string) {
	phase.value = 'loading';
	proceed(token);
}

onMounted(() => {
	if (props.error != null) {
		phase.value = 'error';
		errorText.value = props.error === 'stateExpired' ? i18n.ts._oauthLogin.signinExpired : i18n.ts._oauthLogin.signinFailed;
		return;
	}

	if (props.context == null) {
		phase.value = 'error';
		errorText.value = i18n.ts._oauthLogin.signinFailed;
		return;
	}

	proceed();
});

definePage(() => ({
	title: i18n.ts._oauthLogin.title,
}));
</script>

<style lang="scss" module>
.formContainer {
	min-height: 100svh;
	padding: 32px 32px 64px;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
}

.form {
	position: relative;
	z-index: 10;
	border-radius: var(--MI-radius);
	background-color: var(--MI_THEME-panel);
	background-clip: padding-box;
	border: solid 1px var(--MI_THEME-panel);
	box-shadow: 0px 4px 32px rgba(0, 0, 0, 0.1);
	padding: 32px;
	width: 100%;
	max-width: 400px;
	box-sizing: border-box;
}

.error {
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 12px;
	text-align: center;
}

.errorIcon {
	font-size: 32px;
	color: var(--MI_THEME-error);
}
</style>
