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
import { isRenotePacked, isQuotePacked } from '@/misc/is-renote.js';
import { isLanguageFiltered } from '@/misc/is-language-filtered.js';
import type { JsonObject } from '@/misc/json-value.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { REQUEST } from '@nestjs/core';
import { isNovelOrNovelRenotePacked } from '@/misc/novel-filter.js';

@Injectable({ scope: Scope.TRANSIENT })
export class HybridTimelineChannel extends Channel {
	public readonly chName = 'hybridTimeline';
	public static shouldShare = false;
	public static requireCredential = true as const;
	public static kind = 'read:account';
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
	public async init(params: JsonObject): Promise<void> {
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
		const isMe = this.user!.id === note.userId;

		// JUICE: 純粋なリノート(本文・自身のファイルを持たない)は、リノート元の投稿にファイルが
		// あればメディアタイムラインの対象に含める。hideFromMediaTimelineは実際にファイルを
		// 提供している側(自身、またはリノート元)の投稿の設定を見る。
		// 「小説」フラグが付いた投稿は添付ファイルの有無にかかわらず対象に含める
		if (this.withFiles) {
			const hasOwnMedia = note.fileIds != null && note.fileIds.length > 0 && !note.hideFromMediaTimeline;
			const hasRenotedMedia = note.renote != null && note.renote.fileIds != null && note.renote.fileIds.length > 0 && !note.renote.hideFromMediaTimeline;
			if (!hasOwnMedia && !hasRenotedMedia && !note.isNovel) return;
		}

		if (!note.channelId) {
			// 以下の条件に該当するノートのみ後続処理に通す（ので、以下のif文は該当しないノートをすべて弾くようにする）
			// - 自分自身の投稿
			// - その投稿のユーザーをフォローしている
			// - 全体公開のローカルの投稿
			if (!(
				isMe ||
				Object.hasOwn(this.following, note.userId) ||
				(note.user.host == null && note.visibility === 'public')
			)) {
				return;
			}
		} else {
			// 以下の条件に該当するノートのみ後続処理に通す（ので、以下のif文は該当しないノートをすべて弾くようにする）
			// - フォローしているチャンネルの投稿
			if (!this.followingChannels.has(note.channelId)) {
				return;
			}
		}

		if (!this.isNoteVisibleForMe(note)) return;
		if (this.isNoteMutedOrBlocked(note)) return;

		// JUICE: 「小説」フラグが付いた投稿だけに絞り込む
		// JUICE: 小説の普通のリノートも出す
		if (this.onlyNovel && !isNovelOrNovelRenotePacked(note)) return;

		// JUICE: 表示言語の絞り込み(自分自身の投稿を常に表示するかはユーザー設定に従う)
		if ((!isMe || !(this.userProfile?.excludeOwnNotesFromLanguageFilter ?? true)) && isLanguageFiltered(note, new Set(this.userProfile?.filteredLanguages ?? []))) return;

		if (note.reply) {
			const reply = note.reply;
			if ((this.following[note.userId]?.withReplies ?? false) || this.withReplies) {
				// 自分のフォローしていないユーザーの visibility: followers な投稿への返信は弾く
				if (reply.visibility === 'followers' && !Object.hasOwn(this.following, reply.userId) && reply.userId !== this.user!.id) return;
			} else {
				// 「チャンネル接続主への返信」でもなければ、「チャンネル接続主が行った返信」でもなければ、「投稿者の投稿者自身への返信」でもない場合
				if (reply.userId !== this.user!.id && !isMe && reply.userId !== note.userId) return;
			}
		}

		// 純粋なリノート（引用リノートでないリノート）の場合
		if (isRenotePacked(note) && !isQuotePacked(note) && note.renote) {
			if (!this.withRenotes) return;
			if (note.renote.reply) {
				const reply = note.renote.reply;
				// 自分のフォローしていないユーザーの visibility: followers な投稿への返信のリノートは弾く
				if (reply.visibility === 'followers' && !Object.hasOwn(this.following, reply.userId) && reply.userId !== this.user!.id) return;
			}
		}

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
	public dispose(): void {
		// Unsubscribe events
		this.subscriber.off('notesStream', this.onNote);
	}
}
