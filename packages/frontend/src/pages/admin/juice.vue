<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px; --MI_SPACER-min: 16px; --MI_SPACER-max: 32px;">
		<SearchMarker path="/admin/juice" :label="i18n.ts.juice" :keywords="['juice']" icon="ti ti-droplet">
			<div class="_gaps_m">
				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.approvalSignup }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="approvalRequiredForSignup">
									<template #label><SearchLabel>{{ i18n.ts._juice.approvalRequiredForSignup }}</SearchLabel></template>
								</MkSwitch>
							</SearchMarker>

							<SearchMarker>
								<MkSwitch v-model="signupReasonRequired" :disabled="!approvalRequiredForSignup">
									<template #label><SearchLabel>{{ i18n.ts._juice.signupReasonRequired }}</SearchLabel></template>
								</MkSwitch>
							</SearchMarker>

							<SearchMarker>
								<MkInput v-model="signupReasonMaxLength" type="number" :min="1" :disabled="!approvalRequiredForSignup">
									<template #label><SearchLabel>{{ i18n.ts._juice.signupReasonMaxLength }}</SearchLabel></template>
								</MkInput>
							</SearchMarker>

							<SearchMarker>
								<MkSwitch v-model="invitationRegistrationEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.invitationRegistrationEnabled }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.invitationRegistrationEnabledCaption }}</template>
								</MkSwitch>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.newAccountFollowRequest }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="newAccountFollowRequestEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.newAccountFollowRequestEnabled }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.newAccountFollowRequestEnabledCaption }}</template>
								</MkSwitch>
							</SearchMarker>

							<SearchMarker>
								<MkInput v-model="newAccountFollowRequestThresholdValue" type="number" :min="1" :disabled="!newAccountFollowRequestEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.newAccountFollowRequestThresholdValue }}</SearchLabel></template>
								</MkInput>
							</SearchMarker>

							<SearchMarker>
								<MkSelect v-model="newAccountFollowRequestThresholdUnit" :items="newAccountFollowRequestThresholdUnitDef" :disabled="!newAccountFollowRequestEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.newAccountFollowRequestThresholdUnit }}</SearchLabel></template>
								</MkSelect>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.exploreOtherServers }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="exploreOtherServersEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.exploreOtherServersEnabled }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.exploreOtherServersEnabledCaption }}</template>
								</MkSwitch>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.emailSettings }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSelect v-model="defaultEmailLang" :items="langs.map(x => ({ label: x[1], value: x[0] }))">
									<template #label><SearchLabel>{{ i18n.ts._juice.defaultEmailLang }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.defaultEmailLangCaption }}</template>
								</MkSelect>
							</SearchMarker>

							<SearchMarker>
								<MkSwitch v-model="blockEmailDotAliasRegistration">
									<template #label><SearchLabel>{{ i18n.ts._juice.blockEmailDotAliasRegistration }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.blockEmailDotAliasRegistrationCaption }}</template>
								</MkSwitch>
							</SearchMarker>

							<SearchMarker>
								<MkSwitch v-model="blockEmailPlusAliasRegistration">
									<template #label><SearchLabel>{{ i18n.ts._juice.blockEmailPlusAliasRegistration }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.blockEmailPlusAliasRegistrationCaption }}</template>
								</MkSwitch>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.emojiRequest }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="emojiRequestEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.emojiRequestEnabled }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.emojiRequestEnabledCaption }}</template>
								</MkSwitch>
							</SearchMarker>
							<!-- JUICE: 申請フォームでカテゴリ・タグ・ライセンスの入力を必須にするか(既定は任意) -->
							<SearchMarker>
								<MkSwitch v-model="emojiRequestRequireCategory">
									<template #label><SearchLabel>{{ i18n.ts._juice.emojiRequestRequireCategory }}</SearchLabel></template>
								</MkSwitch>
							</SearchMarker>
							<SearchMarker>
								<MkSwitch v-model="emojiRequestRequireTags">
									<template #label><SearchLabel>{{ i18n.ts._juice.emojiRequestRequireTags }}</SearchLabel></template>
								</MkSwitch>
							</SearchMarker>
							<SearchMarker>
								<MkSwitch v-model="emojiRequestRequireLicense">
									<template #label><SearchLabel>{{ i18n.ts._juice.emojiRequestRequireLicense }}</SearchLabel></template>
								</MkSwitch>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.avatarDecorationRequest }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="avatarDecorationRequestEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.avatarDecorationRequestEnabled }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.avatarDecorationRequestEnabledCaption }}</template>
								</MkSwitch>
							</SearchMarker>
							<!-- JUICE: 申請フォームでカテゴリ・説明の入力を必須にするか(既定は任意) -->
							<SearchMarker>
								<MkSwitch v-model="avatarDecorationRequestRequireCategory">
									<template #label><SearchLabel>{{ i18n.ts._juice.avatarDecorationRequestRequireCategory }}</SearchLabel></template>
								</MkSwitch>
							</SearchMarker>
							<SearchMarker>
								<MkSwitch v-model="avatarDecorationRequestRequireDescription">
									<template #label><SearchLabel>{{ i18n.ts._juice.avatarDecorationRequestRequireDescription }}</SearchLabel></template>
								</MkSwitch>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<!-- JUICE: リモートのユーザーのアイコンのデコレーション(Misskey系のサーバーのユーザーだけ) -->
				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.remoteAvatarDecorations }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="remoteAvatarDecorationsEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.remoteAvatarDecorationsEnabled }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.remoteAvatarDecorationsEnabledCaption }}</template>
								</MkSwitch>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.ranking }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkInput v-model="rankingAggregationPeriodHours" type="number" :min="1">
									<template #label><SearchLabel>{{ i18n.ts._juice.rankingPeriodHours }}</SearchLabel></template>
								</MkInput>
							</SearchMarker>
							<SearchMarker>
								<MkInput v-model="rankingDisplayCount" type="number" :min="1" :max="100">
									<template #label><SearchLabel>{{ i18n.ts._juice.rankingDisplayCount }}</SearchLabel></template>
								</MkInput>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.relayTimeline }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="relayTimelineEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.relayTimelineEnabled }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.relayTimelineEnabledCaption }}</template>
								</MkSwitch>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.mediaTimeline }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="mediaTimelineEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.mediaTimelineEnabled }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.mediaTimelineEnabledCaption }}</template>
								</MkSwitch>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.midiPlayer }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkInput v-model="midiPlayerMaxSizeKb" type="number" :min="1">
									<template #label><SearchLabel>{{ i18n.ts._juice.midiPlayerMaxSize }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.midiPlayerMaxSizeCaption }}</template>
								</MkInput>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._drawRoom.title }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="drawRoomEnabled">
									<template #label><SearchLabel>{{ i18n.ts._drawRoom.enabled }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._drawRoom.enabledCaption }}</template>
								</MkSwitch>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.latex }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="latexEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.latexEnabled }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.latexEnabledCaption }}</template>
								</MkSwitch>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.reactionPiggyback }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="reactionPiggybackOnRemoteEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.reactionPiggybackOnRemoteEnabled }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.reactionPiggybackOnRemoteEnabledCaption }}</template>
								</MkSwitch>
							</SearchMarker>

							<MkInfo v-if="reactionPiggybackOnRemoteEnabled" warn>
								<div class="_gaps_s">
									<div>{{ i18n.ts._aboutJuice.reactionPiggybackOnRemoteWarningLicense }}</div>
									<I18n :src="i18n.ts._aboutJuice.reactionPiggybackOnRemoteWarningTestNotice" tag="div">
										<template #juiceServer>
											<a href="https://mk-juice.dev" target="_blank" rel="noopener" class="_link">{{ i18n.ts._aboutJuice.reactionPiggybackOnRemoteWarningTestNoticeLinkText }}</a>
										</template>
									</I18n>
								</div>
							</MkInfo>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.aiGeneratedFallbackCw }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="aiGeneratedFallbackCwEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.aiGeneratedFallbackCwEnabled }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.aiGeneratedFallbackCwEnabledCaption }}</template>
								</MkSwitch>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.novelFallbackCw }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="novelFallbackCwEnabled">
									<template #label><SearchLabel>{{ i18n.ts._juice.novelFallbackCwEnabled }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.novelFallbackCwEnabledCaption }}</template>
								</MkSwitch>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.oauthLogin }}</SearchLabel></template>
						<template #caption><SearchText>{{ i18n.ts._juice.oauthLoginCaption }}</SearchText></template>

						<div class="_gaps_m">
							<MkInfo>
								{{ i18n.ts._juice.oauthLoginRedirectUriInfo }}
								<div class="_monospace" :class="$style.redirectUri">{{ oauthRedirectUris.link }}</div>
								<div class="_monospace" :class="$style.redirectUri">{{ oauthRedirectUris.signin }}</div>
							</MkInfo>

							<SearchMarker v-for="provider in oauthProviders" :key="provider" :keywords="[provider]">
								<MkFolder>
									<template #icon><i :class="oauthProviderIcon(provider)"></i></template>
									<template #label>{{ oauthProviderLabel(provider) }}</template>
									<template #suffix><i v-if="oauthSettings[provider].enabled.value" class="ti ti-check" style="color: var(--MI_THEME-success)"></i></template>

									<div class="_gaps_m">
										<MkInfo>{{ oauthProviderScopeInfo(provider) }}</MkInfo>
										<MkSwitch v-model="oauthSettings[provider].enabled.value">
											<template #label>{{ i18n.tsx._juice.oauthLoginProviderEnabled({ provider: oauthProviderLabel(provider) }) }}</template>
										</MkSwitch>
										<MkInput v-model="oauthSettings[provider].clientId.value" :disabled="!oauthSettings[provider].enabled.value">
											<template #prefix><i class="ti ti-key"></i></template>
											<template #label>{{ i18n.ts._juice.oauthClientId }}</template>
										</MkInput>
										<MkInput v-model="oauthSettings[provider].clientSecret.value" :disabled="!oauthSettings[provider].enabled.value">
											<template #prefix><i class="ti ti-key"></i></template>
											<template #label>{{ i18n.ts._juice.oauthClientSecret }}</template>
										</MkInput>
									</div>
								</MkFolder>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._contactForm._settings.title }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkSwitch v-model="contactFormEnabled">
									<template #label><SearchLabel>{{ i18n.ts._contactForm._settings.enable }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._contactForm._settings.enableDescription }}</template>
								</MkSwitch>
							</SearchMarker>

							<SearchMarker>
								<MkInput v-model="contactFormLimit" type="number" :min="1" :max="100" :disabled="!contactFormEnabled">
									<template #label><SearchLabel>{{ i18n.ts._contactForm._settings.limit }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._contactForm._settings.limitDescription }}</template>
								</MkInput>
							</SearchMarker>

							<SearchMarker>
								<MkSwitch v-model="contactFormRequireAuth" :disabled="!contactFormEnabled">
									<template #label><SearchLabel>{{ i18n.ts._contactForm._settings.requireAuth }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._contactForm._settings.requireAuthDescription }}</template>
								</MkSwitch>
							</SearchMarker>

							<SearchMarker>
								<MkInput v-model="contactFormContentMaxLength" type="number" :min="20" :max="10000" :disabled="!contactFormEnabled">
									<template #label><SearchLabel>{{ i18n.ts._contactForm._settings.contentMaxLength }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._contactForm._settings.contentMaxLengthDescription }}</template>
								</MkInput>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<SearchMarker v-slot="slotProps">
					<MkFolder :defaultOpen="slotProps.isParentOfTarget">
						<template #label><SearchLabel>{{ i18n.ts._juice.splashSettingsTitle }}</SearchLabel></template>

						<div class="_gaps_m">
							<SearchMarker>
								<MkTextarea v-model="customSplashTextInput">
									<template #label><SearchLabel>{{ i18n.ts._juice.customSplashText }}</SearchLabel></template>
									<template #caption>{{ i18n.ts._juice.customSplashTextDescription }} {{ i18n.tsx._juice.customSplashTextLineCountCaption({ current: customSplashTextLines.length, max: CUSTOM_SPLASH_TEXT_MAX_ITEMS }) }}</template>
								</MkTextarea>
								<div v-if="customSplashTextTooManyLines" :class="$style.fieldError">
									<i class="ti ti-exclamation-triangle" style="margin-right: 4px;"></i>
									{{ i18n.ts._juice.customSplashTextTooManyLines }}
								</div>
								<div v-if="customSplashTextTooLongLineCount > 0" :class="$style.fieldError">
									<i class="ti ti-exclamation-triangle" style="margin-right: 4px;"></i>
									{{ i18n.tsx._juice.customSplashTextLineTooLong({ n: customSplashTextTooLongLineCount }) }}
								</div>
							</SearchMarker>
						</div>
					</MkFolder>
				</SearchMarker>

				<MkButton primary :disabled="customSplashTextTooManyLines || customSplashTextTooLongLineCount > 0" @click="save">{{ i18n.ts.save }}</MkButton>
			</div>
		</SearchMarker>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue';
import { langs, apiUrl } from '@@/js/config.js';
import { useMkSelect } from '@/composables/use-mkselect.js';
import MkFolder from '@/components/MkFolder.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkSelect from '@/components/MkSelect.vue';
import MkButton from '@/components/MkButton.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';

const settings = await misskeyApi('admin/juice/settings');

const approvalRequiredForSignup = ref(settings.approvalRequiredForSignup);
const signupReasonRequired = ref(settings.signupReasonRequired);
const signupReasonMaxLength = ref(settings.signupReasonMaxLength);
const invitationRegistrationEnabled = ref(settings.invitationRegistrationEnabled);
const exploreOtherServersEnabled = ref(settings.exploreOtherServersEnabled);
const defaultEmailLang = ref(settings.defaultEmailLang);
const emojiRequestEnabled = ref(settings.emojiRequestEnabled);
const emojiRequestRequireCategory = ref(settings.emojiRequestRequireCategory);
const emojiRequestRequireTags = ref(settings.emojiRequestRequireTags);
const emojiRequestRequireLicense = ref(settings.emojiRequestRequireLicense);
const avatarDecorationRequestEnabled = ref(settings.avatarDecorationRequestEnabled);
const avatarDecorationRequestRequireCategory = ref(settings.avatarDecorationRequestRequireCategory);
const avatarDecorationRequestRequireDescription = ref(settings.avatarDecorationRequestRequireDescription);
const remoteAvatarDecorationsEnabled = ref(settings.remoteAvatarDecorationsEnabled);
const rankingAggregationPeriodHours = ref(settings.rankingAggregationPeriodHours);
const rankingDisplayCount = ref(settings.rankingDisplayCount);
const relayTimelineEnabled = ref(settings.relayTimelineEnabled);
const mediaTimelineEnabled = ref(settings.mediaTimelineEnabled);
const midiPlayerMaxSizeKb = ref(settings.midiPlayerMaxSize / 1024);
const midiPlayerMaxSize = computed(() => Math.round(midiPlayerMaxSizeKb.value * 1024));
const latexEnabled = ref(settings.latexEnabled);
const drawRoomEnabled = ref(settings.drawRoomEnabled);
const reactionPiggybackOnRemoteEnabled = ref(settings.reactionPiggybackOnRemoteEnabled);
const contactFormEnabled = ref(settings.contactFormEnabled);
const contactFormLimit = ref(settings.contactFormLimit);
const contactFormRequireAuth = ref(settings.contactFormRequireAuth);
const contactFormContentMaxLength = ref(settings.contactFormContentMaxLength);
const newAccountFollowRequestEnabled = ref(settings.newAccountFollowRequestEnabled);
// JUICE: しきい値はミリ秒でやり取りするが、入力しやすいよう数値+単位(投票の期限指定と同じ構成)で編集する。
// 単位変換は保存時にのみ行い、MkPollEditorのafter/unitと同様、読み込み時は常に時間単位で表示する
const newAccountFollowRequestThresholdValue = ref(settings.newAccountFollowRequestThresholdMs / (60 * 60 * 1000));
const {
	model: newAccountFollowRequestThresholdUnit,
	def: newAccountFollowRequestThresholdUnitDef,
} = useMkSelect({
	items: [
		{ label: i18n.ts._time.minute, value: 'minute' },
		{ label: i18n.ts._time.hour, value: 'hour' },
		{ label: i18n.ts._time.day, value: 'day' },
	],
	initialValue: 'hour',
});
const newAccountFollowRequestThresholdUnitMs: Record<'minute' | 'hour' | 'day', number> = {
	minute: 60 * 1000,
	hour: 60 * 60 * 1000,
	day: 24 * 60 * 60 * 1000,
};
const newAccountFollowRequestThresholdMs = computed(() => Math.round(
	newAccountFollowRequestThresholdValue.value * newAccountFollowRequestThresholdUnitMs[newAccountFollowRequestThresholdUnit.value],
));
// JUICE: 配列を1行1件のテキストエリアとして編集する(空行は無視する)。
// 上限(行数・1行あたりの文字数)はadmin/juice/update-settingsのparamDefと合わせている
const customSplashTextInput = ref(settings.customSplashText.join('\n'));
const CUSTOM_SPLASH_TEXT_MAX_ITEMS = 20;
const CUSTOM_SPLASH_TEXT_MAX_LENGTH = 256;
const customSplashTextLines = computed(() => customSplashTextInput.value.split('\n').map(x => x.trim()).filter(x => x.length > 0));
const customSplashTextTooManyLines = computed(() => customSplashTextLines.value.length > CUSTOM_SPLASH_TEXT_MAX_ITEMS);
const customSplashTextTooLongLineCount = computed(() => customSplashTextLines.value.filter(x => x.length > CUSTOM_SPLASH_TEXT_MAX_LENGTH).length);
const blockEmailDotAliasRegistration = ref(settings.blockEmailDotAliasRegistration);
const blockEmailPlusAliasRegistration = ref(settings.blockEmailPlusAliasRegistration);
const aiGeneratedFallbackCwEnabled = ref(settings.aiGeneratedFallbackCwEnabled);
const novelFallbackCwEnabled = ref(settings.novelFallbackCwEnabled);

// JUICE: 連携ログイン(Discord/Google/GitHub/GitLab/Microsoft)。プロバイダとも設定項目の形が同じなので、
// providerごとの入力refをまとめたオブジェクトとして管理する
const oauthProviders = ['discord', 'google', 'github', 'gitlab', 'microsoft'] as const;
type OauthProvider = typeof oauthProviders[number];
const oauthProviderLabels: Record<OauthProvider, string> = {
	discord: 'Discord',
	google: 'Google',
	github: 'GitHub',
	gitlab: 'GitLab',
	microsoft: 'Microsoft',
};
const oauthProviderIcons: Record<OauthProvider, string> = {
	discord: 'ti ti-brand-discord',
	google: 'ti ti-brand-google',
	github: 'ti ti-brand-github',
	gitlab: 'ti ti-brand-gitlab',
	microsoft: 'ti ti-brand-windows',
};

function oauthProviderLabel(provider: OauthProvider): string {
	return oauthProviderLabels[provider];
}

function oauthProviderIcon(provider: OauthProvider): string {
	return oauthProviderIcons[provider];
}

// JUICE: 各プロバイダの開発者サイトでOAuthアプリを作る際に必要なscope・手順は文章の構造ごと違うため、
// (provider名を埋め込むだけの)i18n.tsxではなくプロバイダごとに個別のi18nキーを用意する
function oauthProviderScopeInfo(provider: OauthProvider): string {
	switch (provider) {
		case 'discord': return i18n.ts._juice.oauthScopeInfoDiscord;
		case 'google': return i18n.ts._juice.oauthScopeInfoGoogle;
		case 'github': return i18n.ts._juice.oauthScopeInfoGithub;
		case 'gitlab': return i18n.ts._juice.oauthScopeInfoGitlab;
		case 'microsoft': return i18n.ts._juice.oauthScopeInfoMicrosoft;
	}
}

const oauthSettings = {
	discord: {
		enabled: ref(settings.discordOauthEnabled),
		clientId: ref(settings.discordOauthClientId ?? ''),
		clientSecret: ref(settings.discordOauthClientSecret ?? ''),
	},
	google: {
		enabled: ref(settings.googleOauthEnabled),
		clientId: ref(settings.googleOauthClientId ?? ''),
		clientSecret: ref(settings.googleOauthClientSecret ?? ''),
	},
	github: {
		enabled: ref(settings.githubOauthEnabled),
		clientId: ref(settings.githubOauthClientId ?? ''),
		clientSecret: ref(settings.githubOauthClientSecret ?? ''),
	},
	gitlab: {
		enabled: ref(settings.gitlabOauthEnabled),
		clientId: ref(settings.gitlabOauthClientId ?? ''),
		clientSecret: ref(settings.gitlabOauthClientSecret ?? ''),
	},
	microsoft: {
		enabled: ref(settings.microsoftOauthEnabled),
		clientId: ref(settings.microsoftOauthClientId ?? ''),
		clientSecret: ref(settings.microsoftOauthClientSecret ?? ''),
	},
};
// JUICE: プロバイダ共通のコールバックURL(プロバイダとも同じ2つを各サービスのOAuthアプリに
// 登録してもらう必要があるため、管理画面にそのまま表示して手作業でのタイプミスを防ぐ)
const oauthRedirectUris = {
	link: `${apiUrl}/oauth-login/link-callback`,
	signin: `${apiUrl}/oauth-login/signin-callback`,
};

function save() {
	os.apiWithDialog('admin/juice/update-settings', {
		approvalRequiredForSignup: approvalRequiredForSignup.value,
		signupReasonRequired: signupReasonRequired.value,
		signupReasonMaxLength: signupReasonMaxLength.value,
		invitationRegistrationEnabled: invitationRegistrationEnabled.value,
		exploreOtherServersEnabled: exploreOtherServersEnabled.value,
		defaultEmailLang: defaultEmailLang.value,
		emojiRequestEnabled: emojiRequestEnabled.value,
		emojiRequestRequireCategory: emojiRequestRequireCategory.value,
		emojiRequestRequireTags: emojiRequestRequireTags.value,
		emojiRequestRequireLicense: emojiRequestRequireLicense.value,
		avatarDecorationRequestEnabled: avatarDecorationRequestEnabled.value,
		avatarDecorationRequestRequireCategory: avatarDecorationRequestRequireCategory.value,
		avatarDecorationRequestRequireDescription: avatarDecorationRequestRequireDescription.value,
		remoteAvatarDecorationsEnabled: remoteAvatarDecorationsEnabled.value,
		rankingAggregationPeriodHours: rankingAggregationPeriodHours.value,
		rankingDisplayCount: rankingDisplayCount.value,
		relayTimelineEnabled: relayTimelineEnabled.value,
		mediaTimelineEnabled: mediaTimelineEnabled.value,
		midiPlayerMaxSize: midiPlayerMaxSize.value,
		latexEnabled: latexEnabled.value,
		drawRoomEnabled: drawRoomEnabled.value,
		reactionPiggybackOnRemoteEnabled: reactionPiggybackOnRemoteEnabled.value,
		contactFormEnabled: contactFormEnabled.value,
		contactFormLimit: contactFormLimit.value,
		contactFormRequireAuth: contactFormRequireAuth.value,
		contactFormContentMaxLength: contactFormContentMaxLength.value,
		customSplashText: customSplashTextLines.value,
		newAccountFollowRequestEnabled: newAccountFollowRequestEnabled.value,
		newAccountFollowRequestThresholdMs: newAccountFollowRequestThresholdMs.value,
		blockEmailDotAliasRegistration: blockEmailDotAliasRegistration.value,
		blockEmailPlusAliasRegistration: blockEmailPlusAliasRegistration.value,
		aiGeneratedFallbackCwEnabled: aiGeneratedFallbackCwEnabled.value,
		novelFallbackCwEnabled: novelFallbackCwEnabled.value,
		discordOauthEnabled: oauthSettings.discord.enabled.value,
		discordOauthClientId: oauthSettings.discord.clientId.value || null,
		discordOauthClientSecret: oauthSettings.discord.clientSecret.value || null,
		googleOauthEnabled: oauthSettings.google.enabled.value,
		googleOauthClientId: oauthSettings.google.clientId.value || null,
		googleOauthClientSecret: oauthSettings.google.clientSecret.value || null,
		githubOauthEnabled: oauthSettings.github.enabled.value,
		githubOauthClientId: oauthSettings.github.clientId.value || null,
		githubOauthClientSecret: oauthSettings.github.clientSecret.value || null,
		gitlabOauthEnabled: oauthSettings.gitlab.enabled.value,
		gitlabOauthClientId: oauthSettings.gitlab.clientId.value || null,
		gitlabOauthClientSecret: oauthSettings.gitlab.clientSecret.value || null,
		microsoftOauthEnabled: oauthSettings.microsoft.enabled.value,
		microsoftOauthClientId: oauthSettings.microsoft.clientId.value || null,
		microsoftOauthClientSecret: oauthSettings.microsoft.clientSecret.value || null,
	});
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: i18n.ts.juice,
	icon: 'ti ti-droplet',
}));
</script>

<style lang="scss" module>
.fieldError {
	margin-top: 8px;
	color: var(--MI_THEME-error);
	font-size: 0.9em;
}

.redirectUri {
	margin-top: 8px;
	padding: 8px;
	border-radius: var(--MI-radius);
	background: color-mix(in srgb, var(--MI_THEME-fg), transparent 92%);
	word-break: break-all;
}
</style>
