<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkFolder>
	<template #label>
		<b
			:class="{
				[$style.logGreen]: [
					'createRole',
					'addCustomEmoji',
					'createGlobalAnnouncement',
					'createUserAnnouncement',
					'createAd',
					'createInvitation',
					'createAvatarDecoration',
					'createSystemWebhook',
					'createAbuseReportNotificationRecipient',
					// JUICE
					'approveSignup',
					'approveEmojiRequest',
					'approveAvatarDecorationRequest',
					'approveImportRequest',
				].includes(log.type),
				[$style.logYellow]: [
					'markSensitiveDriveFile',
					'resetPassword',
					'unsetMfa',
					'suspendRemoteInstance',
					// JUICE
					'cleanupOrphanedObjectStorageFiles',
				].includes(log.type),
				[$style.logRed]: [
					'suspend',
					'deleteRole',
					'deleteGlobalAnnouncement',
					'deleteUserAnnouncement',
					'deleteCustomEmoji',
					'deleteNote',
					'deleteDriveFile',
					'deleteAd',
					'deleteAvatarDecoration',
					'deleteSystemWebhook',
					'deleteAbuseReportNotificationRecipient',
					'deleteAccount',
					'deletePage',
					'deleteFlash',
					'deleteGalleryPost',
					'deleteChatRoom',
					// JUICE
					'deleteDrawRoom',
					'declineSignup',
					'rejectEmojiRequest',
					'rejectAvatarDecorationRequest',
					'rejectImportRequest',
				].includes(log.type)
			}"
		>{{ i18n.ts._moderationLogTypes[log.type] }}</b>
		<span v-if="isJuiceLogType" class="_juice">JUICE</span>
		<span v-if="log.type === 'updateUserNote'">: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</span>
		<span v-else-if="log.type === 'suspend'">: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</span>
		<span v-else-if="log.type === 'unsuspend'">: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</span>
		<span v-else-if="log.type === 'resetPassword'">: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</span>
		<span v-else-if="log.type === 'assignRole'">: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }} <i class="ti ti-arrow-right"></i> {{ log.info.roleName }}</span>
		<span v-else-if="log.type === 'unassignRole'">: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }} <i class="ti ti-equal-not"></i> {{ log.info.roleName }}</span>
		<span v-else-if="log.type === 'createRole'">: {{ log.info.role.name }}</span>
		<span v-else-if="log.type === 'updateRole'">: {{ log.info.before.name }}</span>
		<span v-else-if="log.type === 'deleteRole'">: {{ log.info.role.name }}</span>
		<span v-else-if="log.type === 'addCustomEmoji'">: {{ log.info.emoji.name }}</span>
		<span v-else-if="log.type === 'updateCustomEmoji'">: {{ log.info.before.name }}</span>
		<span v-else-if="log.type === 'deleteCustomEmoji'">: {{ log.info.emoji.name }}</span>
		<span v-else-if="log.type === 'markSensitiveDriveFile'">: @{{ log.info.fileUserUsername }}{{ log.info.fileUserHost ? '@' + log.info.fileUserHost : '' }}</span>
		<span v-else-if="log.type === 'unmarkSensitiveDriveFile'">: @{{ log.info.fileUserUsername }}{{ log.info.fileUserHost ? '@' + log.info.fileUserHost : '' }}</span>
		<span v-else-if="log.type === 'suspendRemoteInstance'">: {{ log.info.host }}</span>
		<span v-else-if="log.type === 'unsuspendRemoteInstance'">: {{ log.info.host }}</span>
		<span v-else-if="log.type === 'createGlobalAnnouncement'">: {{ log.info.announcement.title }}</span>
		<span v-else-if="log.type === 'updateGlobalAnnouncement'">: {{ log.info.before.title }}</span>
		<span v-else-if="log.type === 'deleteGlobalAnnouncement'">: {{ log.info.announcement.title }}</span>
		<span v-else-if="log.type === 'createUserAnnouncement'">: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</span>
		<span v-else-if="log.type === 'updateUserAnnouncement'">: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</span>
		<span v-else-if="log.type === 'deleteUserAnnouncement'">: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</span>
		<span v-else-if="log.type === 'deleteNote'">: @{{ log.info.noteUserUsername }}{{ log.info.noteUserHost ? '@' + log.info.noteUserHost : '' }}</span>
		<span v-else-if="log.type === 'deleteDriveFile'">: @{{ log.info.fileUserUsername }}{{ log.info.fileUserHost ? '@' + log.info.fileUserHost : '' }}</span>
		<span v-else-if="log.type === 'unsetMfa'">: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</span>
		<span v-else-if="log.type === 'createAvatarDecoration'">: {{ log.info.avatarDecoration.name }}</span>
		<span v-else-if="log.type === 'updateAvatarDecoration'">: {{ log.info.before.name }}</span>
		<span v-else-if="log.type === 'deleteAvatarDecoration'">: {{ log.info.avatarDecoration.name }}</span>
		<span v-else-if="log.type === 'createSystemWebhook'">: {{ log.info.webhook.name }}</span>
		<span v-else-if="log.type === 'updateSystemWebhook'">: {{ log.info.before.name }}</span>
		<span v-else-if="log.type === 'deleteSystemWebhook'">: {{ log.info.webhook.name }}</span>
		<span v-else-if="log.type === 'createAbuseReportNotificationRecipient'">: {{ log.info.recipient.name }}</span>
		<span v-else-if="log.type === 'updateAbuseReportNotificationRecipient'">: {{ log.info.before.name }}</span>
		<span v-else-if="log.type === 'deleteAbuseReportNotificationRecipient'">: {{ log.info.recipient.name }}</span>
		<span v-else-if="log.type === 'deleteAccount'">: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</span>
		<span v-else-if="log.type === 'deletePage'">: @{{ log.info.pageUserUsername }}</span>
		<span v-else-if="log.type === 'deleteFlash'">: @{{ log.info.flashUserUsername }}</span>
		<span v-else-if="log.type === 'deleteGalleryPost'">: @{{ log.info.postUserUsername }}</span>
		<span v-else-if="log.type === 'deleteChatRoom'">: @{{ log.info.room.name }}</span>
		<!-- JUICE -->
		<span v-else-if="log.type === 'approveSignup'">: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</span>
		<span v-else-if="log.type === 'declineSignup'">: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</span>
		<span v-else-if="log.type === 'approveEmojiRequest'">: {{ log.info.emojiName }}</span>
		<span v-else-if="log.type === 'rejectEmojiRequest'">: {{ log.info.requestedName }}</span>
		<span v-else-if="log.type === 'approveAvatarDecorationRequest'">: {{ log.info.avatarDecorationName }}</span>
		<span v-else-if="log.type === 'rejectAvatarDecorationRequest'">: {{ log.info.requestedName }}</span>
		<span v-else-if="log.type === 'approveImportRequest' || log.type === 'rejectImportRequest'">: @{{ log.info.requesterUsername }}{{ log.info.requesterHost ? '@' + log.info.requesterHost : '' }}</span>
		<span v-else-if="log.type === 'deleteDrawRoom'">: {{ log.info.room.title }}</span>
		<span v-else-if="log.type === 'cleanupOrphanedObjectStorageFiles'">: {{ log.info.deletedCount }} / {{ log.info.scanned }}{{ log.info.dryRun ? ` (${i18n.ts._moderationLogTypes.cleanupDryRunSuffix})` : '' }}</span>
	</template>
	<template #icon>
		<i v-if="log.type === 'updateServerSettings'" class="ti ti-settings"></i>
		<i v-else-if="log.type === 'updateUserNote'" class="ti ti-pencil"></i>
		<i v-else-if="log.type === 'suspend'" class="ti ti-user-x"></i>
		<i v-else-if="log.type === 'unsuspend'" class="ti ti-user-check"></i>
		<i v-else-if="log.type === 'resetPassword'" class="ti ti-key"></i>
		<i v-else-if="log.type === 'assignRole'" class="ti ti-user-plus"></i>
		<i v-else-if="log.type === 'unassignRole'" class="ti ti-user-minus"></i>
		<i v-else-if="log.type === 'createRole'" class="ti ti-plus"></i>
		<i v-else-if="log.type === 'updateRole'" class="ti ti-pencil"></i>
		<i v-else-if="log.type === 'deleteRole'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'addCustomEmoji'" class="ti ti-plus"></i>
		<i v-else-if="log.type === 'updateCustomEmoji'" class="ti ti-pencil"></i>
		<i v-else-if="log.type === 'deleteCustomEmoji'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'markSensitiveDriveFile'" class="ti ti-eye-exclamation"></i>
		<i v-else-if="log.type === 'unmarkSensitiveDriveFile'" class="ti ti-eye"></i>
		<i v-else-if="log.type === 'suspendRemoteInstance'" class="ti ti-x"></i>
		<i v-else-if="log.type === 'unsuspendRemoteInstance'" class="ti ti-check"></i>
		<i v-else-if="log.type === 'createGlobalAnnouncement'" class="ti ti-plus"></i>
		<i v-else-if="log.type === 'updateGlobalAnnouncement'" class="ti ti-pencil"></i>
		<i v-else-if="log.type === 'deleteGlobalAnnouncement'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'createUserAnnouncement'" class="ti ti-plus"></i>
		<i v-else-if="log.type === 'updateUserAnnouncement'" class="ti ti-pencil"></i>
		<i v-else-if="log.type === 'deleteUserAnnouncement'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'deleteNote'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'deleteDriveFile'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'createAd'" class="ti ti-plus"></i>
		<i v-else-if="log.type === 'updateAd'" class="ti ti-pencil"></i>
		<i v-else-if="log.type === 'deleteAd'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'unsetMfa'" class="ti ti-shield"></i>
		<i v-else-if="log.type === 'createAvatarDecoration'" class="ti ti-plus"></i>
		<i v-else-if="log.type === 'updateAvatarDecoration'" class="ti ti-pencil"></i>
		<i v-else-if="log.type === 'deleteAvatarDecoration'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'createSystemWebhook'" class="ti ti-plus"></i>
		<i v-else-if="log.type === 'updateSystemWebhook'" class="ti ti-pencil"></i>
		<i v-else-if="log.type === 'deleteSystemWebhook'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'createAbuseReportNotificationRecipient'" class="ti ti-plus"></i>
		<i v-else-if="log.type === 'updateAbuseReportNotificationRecipient'" class="ti ti-pencil"></i>
		<i v-else-if="log.type === 'deleteAbuseReportNotificationRecipient'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'deleteAccount'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'deletePage'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'deleteFlash'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'deleteGalleryPost'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'deleteChatRoom'" class="ti ti-trash"></i>
		<!-- JUICE -->
		<i v-else-if="log.type === 'approveSignup'" class="ti ti-user-check"></i>
		<i v-else-if="log.type === 'declineSignup'" class="ti ti-user-x"></i>
		<i v-else-if="log.type === 'approveEmojiRequest'" class="ti ti-check"></i>
		<i v-else-if="log.type === 'rejectEmojiRequest'" class="ti ti-x"></i>
		<i v-else-if="log.type === 'approveAvatarDecorationRequest'" class="ti ti-check"></i>
		<i v-else-if="log.type === 'rejectAvatarDecorationRequest'" class="ti ti-x"></i>
		<i v-else-if="log.type === 'approveImportRequest'" class="ti ti-check"></i>
		<i v-else-if="log.type === 'rejectImportRequest'" class="ti ti-x"></i>
		<i v-else-if="log.type === 'deleteDrawRoom'" class="ti ti-trash"></i>
		<i v-else-if="log.type === 'updateJuiceSettings'" class="ti ti-settings"></i>
		<i v-else-if="log.type === 'cleanupOrphanedObjectStorageFiles'" class="ti ti-trash"></i>
	</template>
	<template #suffix>
		<MkTime :time="log.createdAt"/>
	</template>

	<div>
		<div style="display: flex; gap: var(--MI-margin); flex-wrap: wrap;">
			<div style="flex: 1;">{{ i18n.ts.moderator }}: <MkA :to="`/admin/user/${log.userId}`" class="_link">@{{ log.user?.username }}</MkA></div>
			<div style="flex: 1;">{{ i18n.ts.dateAndTime }}: <MkTime :time="log.createdAt" mode="detail"/></div>
		</div>

		<template v-if="log.type === 'updateServerSettings'">
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="JSON5.stringify(log.info.before, null, '\t')" :newString="JSON5.stringify(log.info.after, null, '\t')" language="javascript" maxHeight="300px"/>
			</div>
		</template>
		<template v-else-if="log.type === 'updateUserNote'">
			<div>{{ i18n.ts.user }}: {{ log.info.userId }}</div>
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="log.info.before ?? ''" :newString="log.info.after ?? ''" maxHeight="300px"/>
			</div>
		</template>
		<template v-else-if="log.type === 'suspend'">
			<div>{{ i18n.ts.user }}: <MkA :to="`/admin/user/${log.info.userId}`" class="_link">@{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</MkA></div>
		</template>
		<template v-else-if="log.type === 'unsuspend'">
			<div>{{ i18n.ts.user }}: <MkA :to="`/admin/user/${log.info.userId}`" class="_link">@{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</MkA></div>
		</template>
		<template v-else-if="log.type === 'updateRole'">
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="JSON5.stringify(log.info.before, null, '\t')" :newString="JSON5.stringify(log.info.after, null, '\t')" language="javascript" maxHeight="300px"/>
			</div>
		</template>
		<template v-else-if="log.type === 'assignRole'">
			<div>{{ i18n.ts.user }}: {{ log.info.userId }}</div>
			<div>{{ i18n.ts.role }}: {{ log.info.roleName }} [{{ log.info.roleId }}]</div>
		</template>
		<template v-else-if="log.type === 'unassignRole'">
			<div>{{ i18n.ts.user }}: {{ log.info.userId }}</div>
			<div>{{ i18n.ts.role }}: {{ log.info.roleName }} [{{ log.info.roleId }}]</div>
		</template>
		<template v-else-if="log.type === 'updateCustomEmoji'">
			<div>{{ i18n.ts.emoji }}: {{ log.info.emojiId }}</div>
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="JSON5.stringify(log.info.before, null, '\t')" :newString="JSON5.stringify(log.info.after, null, '\t')" language="javascript" maxHeight="300px"/>
			</div>
		</template>
		<template v-else-if="log.type === 'updateAd'">
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="JSON5.stringify(log.info.before, null, '\t')" :newString="JSON5.stringify(log.info.after, null, '\t')" language="javascript" maxHeight="300px"/>
			</div>
		</template>
		<template v-else-if="log.type === 'updateGlobalAnnouncement'">
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="JSON5.stringify(log.info.before, null, '\t')" :newString="JSON5.stringify(log.info.after, null, '\t')" language="javascript" maxHeight="300px"/>
			</div>
		</template>
		<template v-else-if="log.type === 'updateUserAnnouncement'">
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="JSON5.stringify(log.info.before, null, '\t')" :newString="JSON5.stringify(log.info.after, null, '\t')" language="javascript" maxHeight="300px"/>
			</div>
		</template>
		<template v-else-if="log.type === 'updateAvatarDecoration'">
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="JSON5.stringify(log.info.before, null, '\t')" :newString="JSON5.stringify(log.info.after, null, '\t')" language="javascript" maxHeight="300px"/>
			</div>
		</template>
		<template v-else-if="log.type === 'updateRemoteInstanceNote'">
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="log.info.before ?? ''" :newString="log.info.after ?? ''" maxHeight="300px"/>
			</div>
		</template>
		<template v-else-if="log.type === 'updateSystemWebhook'">
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="JSON5.stringify(log.info.before, null, '\t')" :newString="JSON5.stringify(log.info.after, null, '\t')" language="javascript" maxHeight="300px"/>
			</div>
		</template>
		<template v-else-if="log.type === 'updateAbuseReportNotificationRecipient'">
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="JSON5.stringify(log.info.before, null, '\t')" :newString="JSON5.stringify(log.info.after, null, '\t')" language="javascript" maxHeight="300px"/>
			</div>
		</template>
		<template v-else-if="log.type === 'updateAbuseReportNote'">
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="log.info.before ?? ''" :newString="log.info.after ?? ''" maxHeight="300px"/>
			</div>
		</template>
		<template v-else-if="log.type === 'updateProxyAccountDescription'">
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="log.info.before ?? ''" :newString="log.info.after ?? ''" maxHeight="300px"/>
			</div>
		</template>
		<!-- JUICE -->
		<template v-else-if="log.type === 'approveSignup'">
			<div>{{ i18n.ts.user }}: <MkA :to="`/admin/user/${log.info.userId}`" class="_link">@{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</MkA></div>
		</template>
		<template v-else-if="log.type === 'declineSignup'">
			<!-- 却下されたアカウントは物理削除されるため、リンクは張らない -->
			<div>{{ i18n.ts.user }}: @{{ log.info.userUsername }}{{ log.info.userHost ? '@' + log.info.userHost : '' }}</div>
			<div class="_selectable">{{ i18n.ts._emojiRequestPage.rejectReason }}: {{ log.info.reason }}</div>
		</template>
		<template v-else-if="log.type === 'approveEmojiRequest'">
			<div>{{ i18n.ts.user }}: <MkA :to="`/admin/user/${log.info.requesterId}`" class="_link">@{{ log.info.requesterUsername }}{{ log.info.requesterHost ? '@' + log.info.requesterHost : '' }}</MkA></div>
			<!-- JUICE: 承認時に申請内容が編集された場合、編集理由と編集前の値を表示する -->
			<template v-if="log.info.edited">
				<div class="_selectable">{{ i18n.ts._emojiRequestApprovals.editReason }}: {{ log.info.editReason }}</div>
				<div class="_selectable">{{ i18n.ts._emojiRequestApprovals.beforeEdit }}: {{ log.info.originalName }} / {{ log.info.originalCategory }} / {{ (log.info.originalAliases ?? []).join(' ') }} / {{ log.info.originalLicense }}<template v-if="log.info.originalIsSensitive"> / {{ i18n.ts.sensitive }}</template><template v-if="log.info.originalLocalOnly"> / {{ i18n.ts.localOnly }}</template></div>
			</template>
		</template>
		<template v-else-if="log.type === 'rejectEmojiRequest'">
			<div>{{ i18n.ts.user }}: <MkA :to="`/admin/user/${log.info.requesterId}`" class="_link">@{{ log.info.requesterUsername }}{{ log.info.requesterHost ? '@' + log.info.requesterHost : '' }}</MkA></div>
			<div class="_selectable">{{ i18n.ts._emojiRequestPage.rejectReason }}: {{ log.info.reason }}</div>
		</template>
		<template v-else-if="log.type === 'approveAvatarDecorationRequest'">
			<div>{{ i18n.ts.user }}: <MkA :to="`/admin/user/${log.info.requesterId}`" class="_link">@{{ log.info.requesterUsername }}{{ log.info.requesterHost ? '@' + log.info.requesterHost : '' }}</MkA></div>
			<!-- JUICE: 承認時に申請内容が編集された場合、編集理由と編集前の値を表示する -->
			<template v-if="log.info.edited">
				<div class="_selectable">{{ i18n.ts._avatarDecorationRequestApprovals.editReason }}: {{ log.info.editReason }}</div>
				<div class="_selectable">{{ i18n.ts._avatarDecorationRequestApprovals.beforeEdit }}: {{ log.info.originalName }} / {{ log.info.originalDescription }} / {{ log.info.originalCategory }}</div>
			</template>
		</template>
		<template v-else-if="log.type === 'rejectAvatarDecorationRequest'">
			<div>{{ i18n.ts.user }}: <MkA :to="`/admin/user/${log.info.requesterId}`" class="_link">@{{ log.info.requesterUsername }}{{ log.info.requesterHost ? '@' + log.info.requesterHost : '' }}</MkA></div>
			<div class="_selectable">{{ i18n.ts._emojiRequestPage.rejectReason }}: {{ log.info.reason }}</div>
		</template>
		<!-- JUICE: 承認式にしたインポートの承認・却下 -->
		<template v-else-if="log.type === 'approveImportRequest' || log.type === 'rejectImportRequest'">
			<div>{{ i18n.ts.user }}: <MkA :to="`/admin/user/${log.info.requesterId}`" class="_link">@{{ log.info.requesterUsername }}{{ log.info.requesterHost ? '@' + log.info.requesterHost : '' }}</MkA></div>
			<div>{{ i18n.ts._importRequest.type }}: {{ (i18n.ts._importRequest._types as Record<string, string>)[log.info.importType] ?? log.info.importType }}</div>
			<div class="_selectable">{{ i18n.ts._importRequest.file }}: {{ log.info.fileName }}</div>
			<div v-if="log.type === 'rejectImportRequest'" class="_selectable">{{ i18n.ts._importRequest.rejectReason }}: {{ log.info.reason }}</div>
		</template>
		<template v-else-if="log.type === 'deleteDrawRoom'">
			<div>{{ i18n.ts._drawRoom.owner }}: <MkA :to="`/admin/user/${log.info.room.ownerId}`" class="_link">@{{ log.info.room.ownerUsername }}{{ log.info.room.ownerHost ? '@' + log.info.room.ownerHost : '' }}</MkA></div>
			<div class="_selectable">{{ i18n.ts._drawRoom.roomTitle }}: {{ log.info.room.title }}</div>
		</template>
		<template v-else-if="log.type === 'updateJuiceSettings'">
			<div :class="$style.diff">
				<CodeDiff :context="5" :hideHeader="true" :oldString="JSON5.stringify(log.info.before, null, '\t')" :newString="JSON5.stringify(log.info.after, null, '\t')" language="javascript" maxHeight="300px"/>
			</div>
		</template>
		<template v-else-if="log.type === 'cleanupOrphanedObjectStorageFiles'">
			<div>{{ i18n.ts._moderationLogTypes.cleanupScanned }}: {{ log.info.scanned }}</div>
			<div>{{ i18n.ts._moderationLogTypes.cleanupDeleted }}: {{ log.info.deletedCount }}</div>
			<div v-if="log.info.failedKeys.length > 0" class="_selectable">{{ i18n.ts._moderationLogTypes.cleanupFailed }}: {{ log.info.failedKeys.join(', ') }}</div>
		</template>

		<details>
			<summary>raw</summary>
			<pre>{{ JSON5.stringify(log, null, '\t') }}</pre>
		</details>
	</div>
</MkFolder>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import * as Misskey from 'misskey-js';
import { CodeDiff } from 'v-code-diff';
import JSON5 from 'json5';
import { i18n } from '@/i18n.js';
import MkFolder from '@/components/MkFolder.vue';

const props = defineProps<{
	log: Misskey.entities.ModerationLog;
}>();

// JUICE
const juiceLogTypes: readonly string[] = [
	'approveSignup',
	'declineSignup',
	'approveEmojiRequest',
	'rejectEmojiRequest',
	'approveAvatarDecorationRequest',
	'rejectAvatarDecorationRequest',
	'approveImportRequest',
	'rejectImportRequest',
	'updateJuiceSettings',
	'cleanupOrphanedObjectStorageFiles',
	'deleteDrawRoom',
];
const isJuiceLogType = computed(() => juiceLogTypes.includes(props.log.type));
</script>

<style lang="scss" module>
.diff {
	background: #fff;
	color: #000;
	border-radius: 6px;
	overflow: clip;
}

.logYellow {
	color: var(--MI_THEME-warn);
}

.logRed {
	color: var(--MI_THEME-error);
}

.logGreen {
	color: var(--MI_THEME-success);
}
</style>
