<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="500"
	:height="600"
	@close="onClose"
	@closed="emit('closed')"
>
	<template #header>{{ headerText }}</template>

	<div style="overflow-x: clip;">
		<Transition
			mode="out-in"
			:enterActiveClass="$style.transition_x_enterActive"
			:leaveActiveClass="$style.transition_x_leaveActive"
			:enterFromClass="$style.transition_x_enterFrom"
			:leaveToClass="$style.transition_x_leaveTo"
		>
			<template v-if="!isAcceptedServerRule">
				<XServerRules :mode="mode" :juicePublicSettings="juicePublicSettings" @done="isAcceptedServerRule = true" @cancel="onClose"/>
			</template>
			<template v-else>
				<XSignup :autoSet="autoSet" :mode="mode" :juicePublicSettings="juicePublicSettings" @signup="onSignup" @signupEmailPending="onSignupEmailPending" @signupPendingApproval="onSignupPendingApproval"/>
			</template>
		</Transition>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { useTemplateRef, ref, computed } from 'vue';
import * as Misskey from 'misskey-js';
import XSignup from '@/components/MkSignupDialog.form.vue';
import XServerRules from '@/components/MkSignupDialog.rules.vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';

const juicePublicSettings = ref<Misskey.entities.JuicePublicSettingsResponse>({
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
});
misskeyApi('juice/public-settings').then(res => {
	juicePublicSettings.value = res;
});

const props = withDefaults(defineProps<{
	autoSet?: boolean;
	mode?: 'invitation' | 'application';
}>(), {
	autoSet: false,
	mode: undefined,
});

const headerText = computed(() => {
	if (props.mode === 'application') return i18n.ts._juice.applicationTitle;
	if (props.mode === 'invitation') return i18n.ts.signup;
	return juicePublicSettings.value.approvalRequiredForSignup ? i18n.ts._juice.applicationTitle : i18n.ts.signup;
});

const emit = defineEmits<{
	(ev: 'done', res: Misskey.entities.SignupSuccessResponse): void;
	(ev: 'cancelled'): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');

const isAcceptedServerRule = ref(false);

function onClose() {
	emit('cancelled');
	dialog.value?.close();
}

function onSignup(res: Misskey.entities.SignupSuccessResponse) {
	emit('done', res);
	dialog.value?.close();
}

function onSignupEmailPending() {
	emit('cancelled');
	dialog.value?.close();
}

function onSignupPendingApproval() {
	emit('cancelled');
	dialog.value?.close();
}
</script>

<style lang="scss" module>
.transition_x_enterActive,
.transition_x_leaveActive {
	transition: opacity 0.3s cubic-bezier(0,0,.35,1), transform 0.3s cubic-bezier(0,0,.35,1);
}
.transition_x_enterFrom {
	opacity: 0;
	transform: translateX(50px);
}
.transition_x_leaveTo {
	opacity: 0;
	transform: translateX(-50px);
}
</style>
