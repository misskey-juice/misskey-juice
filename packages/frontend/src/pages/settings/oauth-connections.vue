<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<SearchMarker markerId="oauth-connections" :keywords="['oauth', 'discord', 'google', 'github', 'gitlab', 'microsoft', 'login', 'signin', 'connect']">
	<FormSection>
		<template #label><SearchLabel>{{ i18n.ts._oauthLogin.title }}</SearchLabel><span class="_juice">JUICE</span></template>
		<template #caption><SearchText>{{ i18n.ts._oauthLogin.description }}</SearchText></template>

		<div v-if="$i" class="_gaps_s">
			<MkLoading v-if="fetching"/>
			<template v-else>
				<SearchMarker v-for="provider in availableProviders" :key="provider" :keywords="[provider]">
					<MkFolder>
						<template #icon><i :class="providerIcon(provider)"></i></template>
						<template #label>{{ providerLabel(provider) }}</template>
						<template #suffix><i v-if="connectionFor(provider)" class="ti ti-check" style="color: var(--MI_THEME-success)"></i></template>

						<div class="_gaps_s">
							<template v-if="connectionFor(provider)">
								<div>{{ i18n.tsx._oauthLogin.connectedAs({ username: connectionFor(provider)!.providerUsername }) }}</div>
								<MkButton danger @click="unlink(provider)"><i class="ti ti-trash"></i> {{ i18n.ts.unregister }}</MkButton>
							</template>
							<MkButton v-else primary @click="link(provider)">{{ i18n.ts._oauthLogin.connect }}</MkButton>
						</div>
					</MkFolder>
				</SearchMarker>

				<MkInfo v-if="availableProviders.length === 0">{{ i18n.ts.none }}</MkInfo>

				<SearchMarker :keywords="['signin', 'login']">
					<div class="_gaps_s">
						<MkInfo v-if="!$i.twoFactorEnabled" warn>{{ i18n.ts._oauthLogin.twoFactorRequiredWarning }}</MkInfo>
						<MkSwitch :disabled="!$i.twoFactorEnabled || connections.length === 0" :modelValue="useOauthLogin" @update:modelValue="v => updateUseOauthLogin(v)">
							<template #label><SearchLabel>{{ i18n.ts._oauthLogin.useAsSigninMethod }}</SearchLabel></template>
							<template #caption><SearchText>{{ i18n.ts._oauthLogin.useAsSigninMethodDescription }}</SearchText></template>
						</MkSwitch>
					</div>
				</SearchMarker>
			</template>
		</div>
	</FormSection>
</SearchMarker>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkFolder from '@/components/MkFolder.vue';
import MkLoading from '@/components/global/MkLoading.vue';
import FormSection from '@/components/form/section.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { ensureSignin } from '@/i.js';
import { i18n } from '@/i18n.js';
import { updateCurrentAccount } from '@/accounts.js';
import { juicePublicSettingsCache } from '@/cache.js';

const $i = ensureSignin();

type OauthProvider = 'discord' | 'google' | 'github' | 'gitlab' | 'microsoft';

const providerLabels: Record<OauthProvider, string> = {
	discord: 'Discord',
	google: 'Google',
	github: 'GitHub',
	gitlab: 'GitLab',
	microsoft: 'Microsoft',
};

const providerIcons: Record<OauthProvider, string> = {
	discord: 'ti ti-brand-discord',
	google: 'ti ti-brand-google',
	github: 'ti ti-brand-github',
	gitlab: 'ti ti-brand-gitlab',
	microsoft: 'ti ti-brand-windows',
};

function providerLabel(provider: OauthProvider): string {
	return providerLabels[provider];
}

function providerIcon(provider: OauthProvider): string {
	return providerIcons[provider];
}

const fetching = ref(true);
const availableProviders = ref<OauthProvider[]>([]);
const connections = ref<Misskey.entities.OauthLoginListConnectionsResponse>([]);

function connectionFor(provider: OauthProvider) {
	return connections.value.find(c => c.provider === provider);
}

const useOauthLogin = computed(() => $i.useOauthLogin ?? false);

async function load() {
	fetching.value = true;
	const [publicSettings, list] = await Promise.all([
		juicePublicSettingsCache.fetch(),
		misskeyApi('oauth-login/list-connections'),
	]);
	availableProviders.value = (['discord', 'google', 'github', 'gitlab', 'microsoft'] as const).filter(p => publicSettings[`${p}OauthEnabled`]);
	connections.value = list;
	fetching.value = false;
}

onMounted(() => {
	load();

	// JUICE: oauth-login/link-callbackからのリダイレクト結果を表示する
	const params = new URLSearchParams(window.location.search);
	const linked = params.get('oauthLinked');
	const linkError = params.get('oauthLinkError');
	if (linked != null || linkError != null) {
		if (linkError != null) {
			os.alert({ type: 'error', text: i18n.ts._oauthLogin.signinFailed });
		} else {
			os.success();
		}
		const url = new URL(window.location.href);
		url.searchParams.delete('oauthLinked');
		url.searchParams.delete('oauthLinkError');
		window.history.replaceState(null, '', url.toString());
	}
});

async function link(provider: OauthProvider) {
	const res = await os.apiWithDialog('oauth-login/link-start', {
		provider,
		returnTo: window.location.pathname,
	});
	window.location.href = res.url;
}

async function unlink(provider: OauthProvider) {
	const confirm = await os.confirm({
		type: 'warning',
		text: i18n.tsx._oauthLogin.unlinkConfirm({ provider: providerLabel(provider) }),
	});
	if (confirm.canceled) return;

	await os.apiWithDialog('oauth-login/unlink', { provider });
	await load();
	if (connections.value.length === 0) {
		updateCurrentAccount({ useOauthLogin: false });
	}
}

async function updateUseOauthLogin(value: boolean) {
	await os.apiWithDialog('i/oauth/set-login-enabled', { value });
}
</script>
