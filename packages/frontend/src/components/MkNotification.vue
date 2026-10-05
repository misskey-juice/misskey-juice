<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.contentVisibilityAuto]: contentVisibilityAuto }]">
	<div :class="$style.head">
		<MkAvatar v-if="['pollEnded', 'note'].includes(notification.type) && 'note' in notification" :class="$style.icon" :user="notification.note.user" link preview/>
		<MkAvatar v-else-if="['roleAssigned', 'achievementEarned', 'exportCompleted', 'login', 'loginFailed', 'emojiRequestApproved', 'emojiRequestRejected', 'avatarDecorationRequestApproved', 'avatarDecorationRequestRejected', 'importRequestApproved', 'importRequestRejected', 'createToken', 'scheduledNotePosted', 'scheduledNotePostFailed'].includes(notification.type)" :class="$style.icon" :user="$i" link preview/>
		<div v-else-if="notification.type === 'reaction:grouped' && notification.note.reactionAcceptance === 'likeOnly'" :class="[$style.icon, $style.icon_reactionGroupHeart]"><i class="ti ti-heart" style="line-height: 1;"></i></div>
		<div v-else-if="notification.type === 'reaction:grouped'" :class="[$style.icon, $style.icon_reactionGroup]"><i class="ti ti-plus" style="line-height: 1;"></i></div>
		<div v-else-if="notification.type === 'renote:grouped'" :class="[$style.icon, $style.icon_renoteGroup]"><i class="ti ti-repeat" style="line-height: 1;"></i></div>
		<!-- JUICE: お問い合わせは送信者を特定できる情報を一切持たないため、専用のアイコンで表示する -->
		<div v-else-if="notification.type === 'newContactForm'" :class="[$style.icon, $style.icon_contactForm]"><i class="ti ti-mail" style="line-height: 1;"></i></div>
		<!-- JUICE: 絵文字申請等の申請者はミュートフィルタを迂回するためnotifierIdではなくrequesterで持つ -->
		<MkAvatar v-else-if="'requester' in notification" :class="$style.icon" :user="notification.requester" link preview/>
		<!-- JUICE: 通報対象ユーザーをアイコンとして表示する -->
		<MkAvatar v-else-if="notification.type === 'newAbuseUserReport'" :class="$style.icon" :user="notification.targetUser" link preview/>
		<MkAvatar v-else-if="'user' in notification" :class="$style.icon" :user="notification.user" link preview/>
		<img v-else-if="'icon' in notification && notification.icon != null" :class="[$style.icon, $style.icon_app]" :src="notification.icon" alt=""/>
		<div
			:class="[$style.subIcon, {
				[$style.t_follow]: notification.type === 'follow',
				[$style.t_followRequestAccepted]: notification.type === 'followRequestAccepted',
				[$style.t_receiveFollowRequest]: notification.type === 'receiveFollowRequest',
				[$style.t_renote]: notification.type === 'renote',
				[$style.t_reply]: notification.type === 'reply',
				[$style.t_mention]: notification.type === 'mention',
				[$style.t_quote]: notification.type === 'quote',
				[$style.t_pollEnded]: notification.type === 'pollEnded',
				[$style.t_scheduledNotePosted]: notification.type === 'scheduledNotePosted',
				[$style.t_scheduledNotePostFailed]: notification.type === 'scheduledNotePostFailed',
				[$style.t_achievementEarned]: notification.type === 'achievementEarned',
				[$style.t_exportCompleted]: notification.type === 'exportCompleted',
				[$style.t_login]: notification.type === 'login',
				[$style.t_loginFailed]: notification.type === 'loginFailed',
				[$style.t_emojiRequestApproved]: notification.type === 'emojiRequestApproved',
				[$style.t_emojiRequestRejected]: notification.type === 'emojiRequestRejected',
				[$style.t_avatarDecorationRequestApproved]: notification.type === 'avatarDecorationRequestApproved',
				[$style.t_avatarDecorationRequestRejected]: notification.type === 'avatarDecorationRequestRejected',
				[$style.t_importRequestApproved]: notification.type === 'importRequestApproved',
				[$style.t_importRequestRejected]: notification.type === 'importRequestRejected',
				[$style.t_newEmojiRequest]: notification.type === 'newEmojiRequest',
				[$style.t_newAvatarDecorationRequest]: notification.type === 'newAvatarDecorationRequest',
				[$style.t_newImportRequest]: notification.type === 'newImportRequest',
				[$style.t_newSignupApplication]: notification.type === 'newSignupApplication',
				[$style.t_newAbuseUserReport]: notification.type === 'newAbuseUserReport',
				[$style.t_createToken]: notification.type === 'createToken',
				[$style.t_chatRoomInvitationReceived]: notification.type === 'chatRoomInvitationReceived',
				[$style.t_roleAssigned]: notification.type === 'roleAssigned' && notification.role.iconUrl == null,
			}]"
		>
			<i v-if="notification.type === 'follow'" class="ti ti-plus"></i>
			<i v-else-if="notification.type === 'receiveFollowRequest'" class="ti ti-clock"></i>
			<i v-else-if="notification.type === 'followRequestAccepted'" class="ti ti-check"></i>
			<i v-else-if="notification.type === 'renote'" class="ti ti-repeat"></i>
			<i v-else-if="notification.type === 'reply'" class="ti ti-arrow-back-up"></i>
			<i v-else-if="notification.type === 'mention'" class="ti ti-at"></i>
			<i v-else-if="notification.type === 'quote'" class="ti ti-quote"></i>
			<i v-else-if="notification.type === 'pollEnded'" class="ti ti-chart-arrows"></i>
			<i v-else-if="notification.type === 'scheduledNotePosted'" class="ti ti-send"></i>
			<i v-else-if="notification.type === 'scheduledNotePostFailed'" class="ti ti-alert-triangle"></i>
			<i v-else-if="notification.type === 'achievementEarned'" class="ti ti-medal"></i>
			<i v-else-if="notification.type === 'exportCompleted'" class="ti ti-archive"></i>
			<i v-else-if="notification.type === 'login'" class="ti ti-login-2"></i>
			<i v-else-if="notification.type === 'loginFailed'" class="ti ti-alert-triangle"></i>
			<i v-else-if="notification.type === 'emojiRequestApproved' || notification.type === 'avatarDecorationRequestApproved' || notification.type === 'importRequestApproved'" class="ti ti-check"></i>
			<i v-else-if="notification.type === 'emojiRequestRejected' || notification.type === 'avatarDecorationRequestRejected' || notification.type === 'importRequestRejected'" class="ti ti-x"></i>
			<i v-else-if="notification.type === 'newEmojiRequest'" class="ti ti-mood-plus"></i>
			<i v-else-if="notification.type === 'newAvatarDecorationRequest'" class="ti ti-sparkles"></i>
			<i v-else-if="notification.type === 'newImportRequest'" class="ti ti-file-import"></i>
			<i v-else-if="notification.type === 'newSignupApplication'" class="ti ti-user-question"></i>
			<i v-else-if="notification.type === 'newAbuseUserReport'" class="ti ti-flag"></i>
			<i v-else-if="notification.type === 'createToken'" class="ti ti-key"></i>
			<i v-else-if="notification.type === 'chatRoomInvitationReceived'" class="ti ti-messages"></i>
			<template v-else-if="notification.type === 'roleAssigned'">
				<img v-if="notification.role.iconUrl" style="height: 1.3em; vertical-align: -22%;" :src="notification.role.iconUrl" alt=""/>
				<i v-else class="ti ti-badges"></i>
			</template>
			<MkReactionIcon
				v-else-if="notification.type === 'reaction'"
				:withTooltip="true"
				:reaction="notification.reaction.replace(/^:(\w+):$/, ':$1@.:')"
				:noStyle="true"
				style="width: 100%; height: 100% !important; object-fit: contain;"
			/>
		</div>
	</div>
	<div :class="$style.tail">
		<header :class="$style.header">
			<span v-if="notification.type === 'pollEnded'">{{ i18n.ts._notification.pollEnded }}</span>
			<span v-else-if="notification.type === 'scheduledNotePosted'">{{ i18n.ts._notification.scheduledNotePosted }}</span>
			<span v-else-if="notification.type === 'scheduledNotePostFailed'">{{ i18n.ts._notification.scheduledNotePostFailed }}</span>
			<span v-else-if="notification.type === 'note'">{{ i18n.ts._notification.newNote }}: <MkUserName :user="notification.note.user"/></span>
			<span v-else-if="notification.type === 'roleAssigned'">{{ i18n.ts._notification.roleAssigned }}</span>
			<span v-else-if="notification.type === 'chatRoomInvitationReceived'">{{ i18n.ts._notification.chatRoomInvitationReceived }}</span>
			<span v-else-if="notification.type === 'achievementEarned'">{{ i18n.ts._notification.achievementEarned }}</span>
			<span v-else-if="notification.type === 'login'">{{ i18n.ts._notification.login }}</span>
			<span v-else-if="notification.type === 'loginFailed'">{{ i18n.ts._notification.loginFailed }}</span>
			<span v-else-if="notification.type === 'emojiRequestApproved'">{{ i18n.tsx._notification.emojiRequestApproved({ name: notification.name }) }}</span>
			<span v-else-if="notification.type === 'emojiRequestRejected'">{{ i18n.tsx._notification.emojiRequestRejected({ name: notification.name }) }}</span>
			<span v-else-if="notification.type === 'avatarDecorationRequestApproved'">{{ i18n.tsx._notification.avatarDecorationRequestApproved({ name: notification.name }) }}</span>
			<span v-else-if="notification.type === 'avatarDecorationRequestRejected'">{{ i18n.tsx._notification.avatarDecorationRequestRejected({ name: notification.name }) }}</span>
			<span v-else-if="notification.type === 'importRequestApproved'">{{ i18n.tsx._notification.importRequestApproved({ type: i18n.ts._importRequest._types[notification.importType] }) }}</span>
			<span v-else-if="notification.type === 'importRequestRejected'">{{ i18n.tsx._notification.importRequestRejected({ type: i18n.ts._importRequest._types[notification.importType] }) }}</span>
			<span v-else-if="notification.type === 'createToken'">{{ i18n.ts._notification.createToken }}</span>
			<span v-else-if="notification.type === 'test'">{{ i18n.ts._notification.testNotification }}</span>
			<span v-else-if="notification.type === 'exportCompleted'">{{ i18n.tsx._notification.exportOfXCompleted({ x: exportEntityName[notification.exportedEntity] }) }}</span>
			<span v-else-if="notification.type === 'newContactForm'">{{ i18n.ts._notification.newContactForm }}</span>
			<!-- JUICE: 「何が届いたか」を明示した上で、誰からかも併記する(noteタイプの見出しと同じ構成) -->
			<!-- JUICE: _notification.newEmojiRequest等は完結文(「〜が届きました」)なので、noteタイプ
			(85行目)と同じ「名詞句+コロン+ユーザー名」構成にするため、名詞句のみの専用キー(Header接尾辞)を使う -->
			<!-- JUICE: 後方互換のガード。requester解決前(あるいはユーザー削除等)でnotification.requesterが
			無い場合にMkUserNameをクラッシュさせないよう、名前部分だけ省略して表示を継続する -->
			<!-- JUICE: 1回の送信でまとめて作られた申請は「ほかN件」を付ける -->
			<span v-else-if="notification.type === 'newEmojiRequest'">{{ notification.count > 1 ? i18n.tsx._notification.newEmojiRequestsHeader({ name: notification.name, n: notification.count - 1 }) : i18n.tsx._notification.newEmojiRequestHeader({ name: notification.name }) }}<template v-if="notification.requester">: <MkUserName :user="notification.requester"/></template></span>
			<span v-else-if="notification.type === 'newImportRequest'">{{ i18n.tsx._notification.newImportRequestHeader({ type: i18n.ts._importRequest._types[notification.importType] }) }}<template v-if="notification.requester">: <MkUserName :user="notification.requester"/></template></span>
			<span v-else-if="notification.type === 'newAvatarDecorationRequest'">{{ notification.count > 1 ? i18n.tsx._notification.newAvatarDecorationRequestsHeader({ name: notification.name, n: notification.count - 1 }) : i18n.tsx._notification.newAvatarDecorationRequestHeader({ name: notification.name }) }}<template v-if="notification.requester">: <MkUserName :user="notification.requester"/></template></span>
			<span v-else-if="notification.type === 'newSignupApplication'">{{ i18n.ts._notification.newSignupApplicationHeader }}<template v-if="notification.requester">: <MkUserName :user="notification.requester"/></template></span>
			<span v-else-if="notification.type === 'newAbuseUserReport'">{{ i18n.ts._notification.newAbuseUserReportHeader }}<template v-if="notification.targetUser">: <MkUserName :user="notification.targetUser"/></template></span>
			<MkA v-else-if="notification.type === 'follow' || notification.type === 'mention' || notification.type === 'reply' || notification.type === 'renote' || notification.type === 'quote' || notification.type === 'reaction' || notification.type === 'receiveFollowRequest' || notification.type === 'followRequestAccepted'" v-user-preview="notification.user.id" :class="$style.headerName" :to="userPage(notification.user)"><MkUserName :user="notification.user"/></MkA>
			<span v-else-if="notification.type === 'reaction:grouped' && notification.note.reactionAcceptance === 'likeOnly'">{{ i18n.tsx._notification.likedBySomeUsers({ n: getActualReactedUsersCount(notification) }) }}</span>
			<span v-else-if="notification.type === 'reaction:grouped'">{{ i18n.tsx._notification.reactedBySomeUsers({ n: getActualReactedUsersCount(notification) }) }}</span>
			<span v-else-if="notification.type === 'renote:grouped'">{{ i18n.tsx._notification.renotedBySomeUsers({ n: notification.users.length }) }}</span>
			<span v-else-if="notification.type === 'app'">{{ notification.header }}</span>
			<MkTime v-if="withTime" :time="notification.createdAt" :class="$style.headerTime"/>
		</header>
		<div>
			<MkA v-if="notification.type === 'reaction' || notification.type === 'reaction:grouped'" :class="$style.text" :to="notePage(notification.note)" :title="getNoteSummary(notification.note)">
				<i class="ti ti-quote" :class="$style.quote"></i>
				<Mfm :text="getNoteSummary(notification.note)" :plain="true" :nowrap="true" :author="notification.note.user"/>
				<i class="ti ti-quote" :class="$style.quote"></i>
			</MkA>
			<MkA v-else-if="notification.type === 'renote' || notification.type === 'renote:grouped'" :class="$style.text" :to="notePage(notification.note)" :title="getNoteSummary(notification.note.renote)">
				<i class="ti ti-quote" :class="$style.quote"></i>
				<Mfm :text="getNoteSummary(notification.note.renote)" :plain="true" :nowrap="true" :author="notification.note.renote?.user"/>
				<i class="ti ti-quote" :class="$style.quote"></i>
			</MkA>
			<MkA v-else-if="notification.type === 'reply'" :class="$style.text" :to="notePage(notification.note)" :title="getNoteSummary(notification.note)">
				<Mfm :text="getNoteSummary(notification.note)" :plain="true" :nowrap="true" :author="notification.note.user"/>
			</MkA>
			<MkA v-else-if="notification.type === 'mention'" :class="$style.text" :to="notePage(notification.note)" :title="getNoteSummary(notification.note)">
				<Mfm :text="getNoteSummary(notification.note)" :plain="true" :nowrap="true" :author="notification.note.user"/>
			</MkA>
			<MkA v-else-if="notification.type === 'quote'" :class="$style.text" :to="notePage(notification.note)" :title="getNoteSummary(notification.note)">
				<Mfm :text="getNoteSummary(notification.note)" :plain="true" :nowrap="true" :author="notification.note.user"/>
			</MkA>
			<MkA v-else-if="notification.type === 'note'" :class="$style.text" :to="notePage(notification.note)" :title="getNoteSummary(notification.note)">
				<Mfm :text="getNoteSummary(notification.note)" :plain="true" :nowrap="true" :author="notification.note.user"/>
			</MkA>
			<MkA v-else-if="notification.type === 'pollEnded'" :class="$style.text" :to="notePage(notification.note)" :title="getNoteSummary(notification.note)">
				<i class="ti ti-quote" :class="$style.quote"></i>
				<Mfm :text="getNoteSummary(notification.note)" :plain="true" :nowrap="true" :author="notification.note.user"/>
				<i class="ti ti-quote" :class="$style.quote"></i>
			</MkA>
			<MkA v-else-if="notification.type === 'scheduledNotePosted'" :class="$style.text" :to="notePage(notification.note)" :title="getNoteSummary(notification.note)">
				<i class="ti ti-quote" :class="$style.quote"></i>
				<Mfm :text="getNoteSummary(notification.note)" :plain="true" :nowrap="true" :author="notification.note.user"/>
				<i class="ti ti-quote" :class="$style.quote"></i>
			</MkA>
			<div v-else-if="notification.type === 'roleAssigned'" :class="$style.text">
				{{ notification.role.name }}
			</div>
			<div v-else-if="notification.type === 'chatRoomInvitationReceived'" :class="$style.text">
				{{ notification.invitation.room.name }}
			</div>
			<MkA v-else-if="notification.type === 'achievementEarned'" :class="$style.text" to="/my/achievements">
				{{ i18n.ts._achievements._types[`_${notification.achievement}`].title }}
			</MkA>
			<MkA v-else-if="notification.type === 'exportCompleted'" :class="$style.text" :to="`/my/drive/file/${notification.fileId}`">
				{{ i18n.ts.showFile }}
			</MkA>
			<MkA v-else-if="notification.type === 'createToken'" :class="$style.text" to="/settings/apps">
				<Mfm :text="i18n.tsx._notification.createTokenDescription({ text: i18n.ts.manageAccessTokens })"/>
			</MkA>
			<!-- JUICE: 申請者向けの承認・却下の通知も、モデレーター向けの新着通知と同じ「確認」ボタンにする(却下なら理由も表示) -->
			<template v-else-if="notification.type === 'emojiRequestApproved' || notification.type === 'emojiRequestRejected' || notification.type === 'avatarDecorationRequestApproved' || notification.type === 'avatarDecorationRequestRejected'">
				<div v-if="(notification.type === 'emojiRequestRejected' || notification.type === 'avatarDecorationRequestRejected') && notification.reason" :class="$style.text" style="opacity: 0.6;">{{ notification.reason }}</div>
				<div :class="$style.requestActions">
					<MkButton small rounded type="routerLink" :to="notification.type === 'emojiRequestApproved' || notification.type === 'emojiRequestRejected' ? '/emoji-request' : '/avatar-decoration-request'">{{ i18n.ts.check }}</MkButton>
				</div>
			</template>
			<!-- JUICE: ヘッダーで既に名前(絵文字名等)や申請者名を表示しているため、本文は理由/件名等の
			補足情報と、「確認」への導線(Misskeyの標準ボタン見た目=MkButton)のみにする。
			リンク先はモデレーターでなくても到達できる"-manager"側のルート(custom-emojis-managerと同じ方式) -->
			<!-- JUICE: 承認式にしたインポートの結果(却下なら理由も)。確認はアカウントのデータの設定で -->
			<template v-else-if="notification.type === 'importRequestApproved' || notification.type === 'importRequestRejected'">
				<div v-if="notification.type === 'importRequestRejected' && notification.reason" :class="$style.text" style="opacity: 0.6;">{{ notification.reason }}</div>
				<div :class="$style.requestActions">
					<MkButton small rounded type="routerLink" to="/settings/account-data">{{ i18n.ts.check }}</MkButton>
				</div>
			</template>
			<template v-else-if="notification.type === 'newImportRequest'">
				<div :class="$style.requestActions">
					<MkButton small rounded type="routerLink" to="/import-requests-manager">{{ i18n.ts.check }}</MkButton>
				</div>
			</template>
			<template v-else-if="notification.type === 'newEmojiRequest' || notification.type === 'newAvatarDecorationRequest'">
				<div :class="$style.requestActions">
					<MkButton small rounded type="routerLink" :to="notification.type === 'newEmojiRequest' ? '/emoji-requests-manager' : '/avatar-decoration-requests-manager'">{{ i18n.ts.check }}</MkButton>
				</div>
			</template>
			<template v-else-if="notification.type === 'newSignupApplication'">
				<div v-if="notification.reason" :class="$style.text" style="opacity: 0.6;">{{ notification.reason }}</div>
				<div :class="$style.requestActions">
					<MkButton small rounded type="routerLink" to="/signup-approvals-manager">{{ i18n.ts.check }}</MkButton>
				</div>
			</template>
			<template v-else-if="notification.type === 'newContactForm'">
				<div :class="$style.text" style="opacity: 0.6;">{{ notification.subject }}</div>
				<div :class="$style.requestActions">
					<MkButton small rounded type="routerLink" to="/contact-form-manager">{{ i18n.ts.check }}</MkButton>
				</div>
			</template>
			<!-- JUICE: カテゴリは管理者が自由に設定できるキー文字列のため、固定の翻訳ラベルを持たずそのまま表示する -->
			<template v-else-if="notification.type === 'newAbuseUserReport'">
				<div v-if="notification.category" :class="$style.text" style="opacity: 0.6;">{{ notification.category }}</div>
				<div :class="$style.requestActions">
					<MkButton small rounded type="routerLink" to="/abuses-manager">{{ i18n.ts.check }}</MkButton>
				</div>
			</template>
			<template v-else-if="notification.type === 'follow'">
				<span :class="$style.text" style="opacity: 0.6;">{{ i18n.ts.youGotNewFollower }}</span>
			</template>
			<template v-else-if="notification.type === 'followRequestAccepted'">
				<div :class="$style.text" style="opacity: 0.6;">{{ i18n.ts.followRequestAccepted }}</div>
				<div v-if="notification.message" :class="$style.text" style="opacity: 0.6; font-style: oblique;">
					<i class="ti ti-quote" :class="$style.quote"></i>
					<Mfm :text="notification.message" :author="notification.user" :plain="true" :nowrap="true"/>
					<i class="ti ti-quote" :class="$style.quote"></i>
				</div>
			</template>
			<template v-else-if="notification.type === 'receiveFollowRequest'">
				<span :class="$style.text" style="opacity: 0.6;">{{ i18n.ts.receiveFollowRequest }}</span>
				<div v-if="full && !followRequestDone" :class="$style.followRequestCommands">
					<MkButton :class="$style.followRequestCommandButton" rounded primary @click="acceptFollowRequest()"><i class="ti ti-check"></i> {{ i18n.ts.accept }}</MkButton>
					<MkButton :class="$style.followRequestCommandButton" rounded danger @click="rejectFollowRequest()"><i class="ti ti-x"></i> {{ i18n.ts.reject }}</MkButton>
				</div>
			</template>
			<span v-else-if="notification.type === 'test'" :class="$style.text">{{ i18n.ts._notification.notificationWillBeDisplayedLikeThis }}</span>
			<span v-else-if="notification.type === 'app'" :class="$style.text">
				<Mfm :text="notification.body" :nowrap="false"/>
			</span>

			<div v-if="notification.type === 'reaction:grouped'">
				<div v-for="reaction of notification.reactions" :key="reaction.user.id + reaction.reaction" :class="$style.reactionsItem">
					<MkAvatar :class="$style.reactionsItemAvatar" :user="reaction.user" link preview/>
					<div :class="$style.reactionsItemReaction">
						<MkReactionIcon
							:withTooltip="true"
							:reaction="reaction.reaction.replace(/^:(\w+):$/, ':$1@.:')"
							:noStyle="true"
							style="width: 100%; height: 100% !important; object-fit: contain;"
						/>
					</div>
				</div>
			</div>
			<div v-else-if="notification.type === 'renote:grouped'">
				<div v-for="user of notification.users" :key="user.id" :class="$style.reactionsItem">
					<MkAvatar :class="$style.reactionsItemAvatar" :user="user" link preview/>
				</div>
			</div>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import * as Misskey from 'misskey-js';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import MkButton from '@/components/MkButton.vue';
import { getNoteSummary } from '@/utility/get-note-summary.js';
import { notePage } from '@/filters/note.js';
import { userPage } from '@/filters/user.js';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { ensureSignin } from '@/i.js';

const $i = ensureSignin();

const props = withDefaults(defineProps<{
	notification: Misskey.entities.Notification;
	withTime?: boolean;
	full?: boolean;
	contentVisibilityAuto?: boolean;
}>(), {
	withTime: false,
	full: false,
	contentVisibilityAuto: true,
});

type ExportCompletedNotification = Misskey.entities.Notification & { type: 'exportCompleted' };

const exportEntityName = {
	antenna: i18n.ts.antennas,
	blocking: i18n.ts.blockedUsers,
	clip: i18n.ts.clips,
	customEmoji: i18n.ts.customEmojis,
	favorite: i18n.ts.favorites,
	following: i18n.ts.following,
	muting: i18n.ts.mutedUsers,
	note: i18n.ts.notes,
	userList: i18n.ts.lists,
} as const satisfies Record<ExportCompletedNotification['exportedEntity'], string>;

const followRequestDone = ref(false);

const acceptFollowRequest = () => {
	if (!('user' in props.notification)) return;
	followRequestDone.value = true;
	misskeyApi('following/requests/accept', { userId: props.notification.user.id });
};

const rejectFollowRequest = () => {
	if (!('user' in props.notification)) return;
	followRequestDone.value = true;
	misskeyApi('following/requests/reject', { userId: props.notification.user.id });
};

function getActualReactedUsersCount(notification: Misskey.entities.Notification) {
	if (notification.type !== 'reaction:grouped') return 0;
	return new Set(notification.reactions.map((reaction) => reaction.user.id)).size;
}
</script>

<style lang="scss" module>
.root {
	position: relative;
	box-sizing: border-box;
	padding: 24px 32px;
	font-size: 0.9em;
	overflow-wrap: break-word;
	display: flex;
	contain: content;

	&.contentVisibilityAuto {
		content-visibility: auto;
		contain-intrinsic-size: 0 100px;
	}

	--eventFollow: #36aed2;
	--eventRenote: #36d298;
	--eventReply: #007aff;
	--eventReactionHeart: var(--MI_THEME-love);
	--eventReaction: #e99a0b;
	--eventAchievement: #cb9a11;
	--eventLogin: #007aff;
	--eventOther: #88a6b7;
}

.head {
	position: sticky;
	top: 0;
	flex-shrink: 0;
	width: 42px;
	height: 42px;
	margin-right: 8px;
}

.icon {
	display: block;
	width: 100%;
	height: 100%;
}

.icon_reactionGroup,
.icon_reactionGroupHeart,
.icon_renoteGroup,
.icon_contactForm {
	display: grid;
	align-items: center;
	justify-items: center;
	width: 80%;
	height: 80%;
	font-size: 15px;
	border-radius: 100%;
	color: #fff;
}

.icon_reactionGroup {
	background: var(--eventReaction);
}

.icon_reactionGroupHeart {
	background: var(--eventReactionHeart);
}

.icon_renoteGroup {
	background: var(--eventRenote);
}

.icon_contactForm {
	background: var(--eventOther);
}

.icon_app {
	border-radius: 6px;
}

.subIcon {
	position: absolute;
	z-index: 1;
	bottom: -2px;
	right: -2px;
	width: 20px;
	height: 20px;
	line-height: 20px;
	box-sizing: border-box;
	border-radius: 100%;
	background: var(--MI_THEME-panel);
	box-shadow: 0 0 0 3px var(--MI_THEME-panel);
	font-size: 11px;
	text-align: center;
	color: #fff;

	&:empty {
		display: none;
	}
}

.t_follow, .t_followRequestAccepted, .t_receiveFollowRequest {
	background: var(--eventFollow);
	pointer-events: none;
}

.t_renote {
	background: var(--eventRenote);
	pointer-events: none;
}

.t_quote {
	background: var(--eventRenote);
	pointer-events: none;
}

.t_reply {
	background: var(--eventReply);
	pointer-events: none;
}

.t_mention {
	background: var(--eventOther);
	pointer-events: none;
}

.t_pollEnded {
	background: var(--eventOther);
	pointer-events: none;
}

.t_scheduledNotePosted {
	background: var(--eventOther);
	pointer-events: none;
}

.t_scheduledNotePostFailed {
	background: var(--eventOther);
	pointer-events: none;
}

.t_achievementEarned {
	background: var(--eventAchievement);
	pointer-events: none;
}

.t_exportCompleted {
	background: var(--eventOther);
	pointer-events: none;
}

.t_roleAssigned {
	background: var(--eventOther);
	pointer-events: none;
}

.t_login {
	background: var(--eventLogin);
	pointer-events: none;
}

.t_loginFailed {
	background: var(--eventOther);
	pointer-events: none;
}

.t_emojiRequestApproved, .t_avatarDecorationRequestApproved, .t_emojiRequestRejected, .t_avatarDecorationRequestRejected, .t_importRequestApproved, .t_importRequestRejected {
	background: var(--eventOther);
	pointer-events: none;
}

.t_newEmojiRequest, .t_newAvatarDecorationRequest, .t_newImportRequest, .t_newSignupApplication, .t_newAbuseUserReport {
	background: var(--eventOther);
	pointer-events: none;
}

.t_createToken {
	background: var(--eventOther);
	pointer-events: none;
}

.t_chatRoomInvitationReceived {
	background: var(--eventOther);
	pointer-events: none;
}

.tail {
	flex: 1;
	min-width: 0;
}

.header {
	display: flex;
	align-items: baseline;
	white-space: nowrap;
}

.headerName {
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
	overflow: hidden;
}

.headerTime {
	margin-left: auto;
	font-size: 0.9em;
}

.text {
	display: flex;
	width: 100%;
	overflow: clip;
}

.quote {
	vertical-align: super;
	font-size: 50%;
	opacity: 0.5;
}

.quote:first-child {
	margin-right: 4px;
	position: relative;

	&::before {
		position: absolute;
		transform: rotate(180deg);
	}
}

.quote:last-child {
	margin-left: 4px;
}

.followRequestCommands {
	display: flex;
	gap: 8px;
	max-width: 300px;
	margin-top: 8px;
}

.requestActions {
	margin-top: 8px;
}
.followRequestCommandButton {
	flex: 1;
}

.reactionsItem {
	display: inline-block;
	position: relative;
	width: 38px;
	height: 38px;
	margin-top: 8px;
	margin-right: 8px;
}

.reactionsItemAvatar {
	width: 100%;
	height: 100%;
}

.reactionsItemReaction {
	position: absolute;
	z-index: 1;
	bottom: -2px;
	right: -2px;
	width: 20px;
	height: 20px;
	box-sizing: border-box;
	border-radius: 100%;
	background: var(--MI_THEME-panel);
	box-shadow: 0 0 0 3px var(--MI_THEME-panel);
	font-size: 11px;
	text-align: center;
	color: #fff;
}

@container (max-width: 600px) {
	.root {
		padding: 16px;
		font-size: 0.9em;
	}
}

@container (max-width: 500px) {
	.root {
		padding: 12px;
		font-size: 0.85em;
	}
}
</style>
