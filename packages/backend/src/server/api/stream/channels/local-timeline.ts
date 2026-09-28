/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import type { Packed } from '@/misc/json-schema.js';
import { MetaService } from '@/core/MetaService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { NoteStreamingHidingService } from '../NoteStreamingHidingService.js';
import { bindThis } from '@/decorators.js';
import { RoleService } from '@/core/RoleService.js';
import { isQuotePacked, isRenotePacked } from '@/misc/is-renote.js';
import { isLanguageFiltered } from '@/misc/is-language-filtered.js';
import type { JsonObject } from '@/misc/json-value.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { REQUEST } from '@nestjs/core';
import { isNovelOrNovelRenotePacked } from '@/misc/novel-filter.js';

@Injectable({ scope: Scope.TRANSIENT })
export class LocalTimelineChannel extends Channel {
	public readonly chName = 'localTimeline';
	public static shouldShare = false as const;
	public static requireCredential = false as const;
	private withRenotes: boolean;
	private withReplies: boolean;
	private withFiles: boolean;
	// JUICE: 「小説」フラグが付いた投稿だけに絞り込む
	private onlyNovel: boolean;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		private metaService: MetaService,
		private roleService: RoleService,
		private noteEntityService: NoteEntityService,
		private noteStreamingHidingService: NoteStreamingHidingService,
	) {
		super(request);
		//this.onNote = this.onNote.bind(this);
	}

	@bindThis
	public async init(params: JsonObject) {
		const policies = await this.roleService.getUserPolicies(this.user ? this.user.id : null);
		if (!policies.ltlAvailable) return;

		this.withRenotes = !!(params.withRenotes ?? true);
		this.withReplies = !!(params.withReplies ?? false);
		this.withFiles = !!(params.withFiles ?? false);
		this.onlyNovel = !!(params.onlyNovel ?? false);

		// Subscribe events
		this.subscriber.on('notesStream', this.onNote);
	}

	@bindThis
	private async onNote(note: Packed<'Note'>) {
		// JUICE: 純粋なリノート(本文・自身のファイルを持たない)は、リノート元の投稿にファイルが
		// あればメディアタイムラインの対象に含める。hideFromMediaTimelineは実際にファイルを
		// 提供している側(自身、またはリノート元)の投稿の設定を見る。
		// 「小説」フラグが付いた投稿は添付ファイルの有無にかかわらず対象に含める
		if (this.withFiles) {
			const hasOwnMedia = note.fileIds != null && note.fileIds.length > 0 && !note.hideFromMediaTimeline;
			const hasRenotedMedia = note.renote != null && note.renote.fileIds != null && note.renote.fileIds.length > 0 && !note.renote.hideFromMediaTimeline;
			if (!hasOwnMedia && !hasRenotedMedia && !note.isNovel) return;
		}

		// JUICE: 「小説」フラグが付いた投稿だけに絞り込む
		// JUICE: 小説の普通のリノートも出す
		if (this.onlyNovel && !isNovelOrNovelRenotePacked(note)) return;

		if (note.user.host !== null) return;
		if (note.visibility !== 'public') return;
		if (note.channelId != null) return;
		if (note.user.requireSigninToViewContents && this.user == null) return;
		if (note.renote && note.renote.user.requireSigninToViewContents && this.user == null) return;
		if (note.reply && note.reply.user.requireSigninToViewContents && this.user == null) return;

		// 関係ない返信は除外
		if (note.reply && this.user && !this.following[note.userId]?.withReplies && !this.withReplies) {
			const reply = note.reply;
			// 「チャンネル接続主への返信」でもなければ、「チャンネル接続主が行った返信」でもなければ、「投稿者の投稿者自身への返信」でもない場合
			if (reply.userId !== this.user.id && note.userId !== this.user.id && reply.userId !== note.userId) return;
		}

		if (isRenotePacked(note) && !isQuotePacked(note) && !this.withRenotes) return;

		if (this.isNoteMutedOrBlocked(note)) return;

		// JUICE: 表示言語の絞り込み(自分自身の投稿を常に表示するかはユーザー設定に従う)
		const isMe = note.userId === this.user?.id;
		if ((!isMe || !(this.userProfile?.excludeOwnNotesFromLanguageFilter ?? true)) && isLanguageFiltered(note, new Set(this.userProfile?.filteredLanguages ?? []))) return;

		const filtered = await this.noteStreamingHidingService.filter(note, this.user?.id ?? null);
		if (!filtered) return;
		// eslint-disable-next-line no-param-reassign -- これ以降元の Note オブジェクトは見てはいけないので、いっそ再代入した方が安全
		note = filtered;

		if (this.user) {
			if (isRenotePacked(note) && !isQuotePacked(note)) {
				if (note.renote && Object.keys(note.renote.reactions).length > 0) {
					const myRenoteReaction = await this.noteEntityService.populateMyReaction(note.renote, this.user.id);
					note.renote.myReaction = myRenoteReaction;
				}
			}
		}

		this.send('note', note);
	}

	@bindThis
	public dispose() {
		// Unsubscribe events
		this.subscriber.off('notesStream', this.onNote);
	}
}
