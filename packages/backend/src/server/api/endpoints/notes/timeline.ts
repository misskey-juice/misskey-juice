/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Brackets } from 'typeorm';
import { Inject, Injectable } from '@nestjs/common';
import type { NotesRepository, MiMeta } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import ActiveUsersChart from '@/core/chart/charts/active-users.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { CacheService } from '@/core/CacheService.js';
import { UserFollowingService } from '@/core/UserFollowingService.js';
import { MiLocalUser } from '@/models/User.js';
import { FanoutTimelineEndpointService } from '@/core/FanoutTimelineEndpointService.js';
import { ChannelMutingService } from '@/core/ChannelMutingService.js';
import { ChannelFollowingService } from '@/core/ChannelFollowingService.js';
import { isLanguageFiltered } from '@/misc/is-language-filtered.js';
import { andWhereOnlyNovel, isNovelOrNovelRenote } from '@/misc/novel-filter.js';

export const meta = {
	tags: ['notes'],

	requireCredential: true,
	kind: 'read:account',

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Note',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
		allowPartial: { type: 'boolean', default: false }, // true is recommended but for compatibility false by default
		includeMyRenotes: { type: 'boolean', default: true },
		includeRenotedMyNotes: { type: 'boolean', default: true },
		includeLocalRenotes: { type: 'boolean', default: true },
		withFiles: { type: 'boolean', default: false },
		withRenotes: { type: 'boolean', default: true },
		// JUICE: ホームタイムラインをローカルユーザーの投稿だけに絞り込む
		localOnly: { type: 'boolean', default: false },
		// JUICE: 「小説」フラグが付いた投稿だけに絞り込む
		onlyNovel: { type: 'boolean', default: false },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private noteEntityService: NoteEntityService,
		private activeUsersChart: ActiveUsersChart,
		private idService: IdService,
		private cacheService: CacheService,
		private fanoutTimelineEndpointService: FanoutTimelineEndpointService,
		private userFollowingService: UserFollowingService,
		private channelMutingService: ChannelMutingService,
		private channelFollowingService: ChannelFollowingService,
		private queryService: QueryService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const untilId = ps.untilId ?? (ps.untilDate ? this.idService.gen(ps.untilDate!) : null);
			const sinceId = ps.sinceId ?? (ps.sinceDate ? this.idService.gen(ps.sinceDate!) : null);

			// JUICE: 「小説」だけに絞り込むときは、Redisのタイムライン(作ったときに入れた投稿だけ)ではなくDBから引く
			// (後から小説フラグを付けた投稿も出るように。小説の投稿だけの索引で速く引ける)
			if (!this.serverSettings.enableFanoutTimeline || ps.onlyNovel) {
				const timeline = await this.getFromDb({
					untilId,
					sinceId,
					limit: ps.limit,
					includeMyRenotes: ps.includeMyRenotes,
					includeRenotedMyNotes: ps.includeRenotedMyNotes,
					includeLocalRenotes: ps.includeLocalRenotes,
					withFiles: ps.withFiles,
					withRenotes: ps.withRenotes,
					localOnly: ps.localOnly,
					onlyNovel: ps.onlyNovel,
				}, me);

				process.nextTick(() => {
					this.activeUsersChart.read(me);
				});

				return await this.noteEntityService.packMany(timeline, me);
			}

			const [
				followings,
				profile,
			] = await Promise.all([
				this.cacheService.userFollowingsCache.fetch(me.id),
				this.cacheService.userProfileCache.fetch(me.id),
			]);
			// JUICE
			const filteredLanguages = new Set(profile.filteredLanguages);

			const timeline = this.fanoutTimelineEndpointService.timeline({
				untilId,
				sinceId,
				limit: ps.limit,
				allowPartial: ps.allowPartial,
				me,
				useDbFallback: this.serverSettings.enableFanoutTimelineDbFallback,
				redisTimelines: ps.withFiles ? [`homeTimelineWithFiles:${me.id}`] : [`homeTimeline:${me.id}`],
				// JUICE: 表示言語の絞り込みが有効でも自分自身の投稿を常に表示するか(ユーザー設定)
				alwaysIncludeMyNotes: profile.excludeOwnNotesFromLanguageFilter,
				excludePureRenotes: !ps.withRenotes,
				noteFilter: note => {
					if (note.reply && note.reply.visibility === 'followers') {
						if (!Object.hasOwn(followings, note.reply.userId) && note.reply.userId !== me.id) return false;
					}

					// JUICE: 表示言語の絞り込み
					if (isLanguageFiltered(note, filteredLanguages)) return false;

					// JUICE: ホームタイムラインをローカルユーザーの投稿だけに絞り込む
					if (ps.localOnly && note.userHost != null) return false;

					// JUICE: 「小説」フラグが付いた投稿だけに絞り込む
					if (ps.onlyNovel && !isNovelOrNovelRenote(note)) return false;

					return true;
				},
				dbFallback: async (untilId, sinceId, limit) => await this.getFromDb({
					untilId,
					sinceId,
					limit,
					includeMyRenotes: ps.includeMyRenotes,
					includeRenotedMyNotes: ps.includeRenotedMyNotes,
					includeLocalRenotes: ps.includeLocalRenotes,
					withFiles: ps.withFiles,
					withRenotes: ps.withRenotes,
					localOnly: ps.localOnly,
					onlyNovel: ps.onlyNovel,
				}, me),
			});

			process.nextTick(() => {
				this.activeUsersChart.read(me);
			});

			return timeline;
		});
	}

	private async getFromDb(ps: { untilId: string | null; sinceId: string | null; limit: number; includeMyRenotes: boolean; includeRenotedMyNotes: boolean; includeLocalRenotes: boolean; withFiles: boolean; withRenotes: boolean; localOnly: boolean; onlyNovel: boolean; }, me: MiLocalUser) {
		const followees = await this.userFollowingService.getFollowees(me.id);

		const mutingChannelIds = await this.channelMutingService
			.list({ requestUserId: me.id }, { idOnly: true })
			.then(x => x.map(x => x.id));
		const followingChannelIds = await this.channelFollowingService
			.list({ requestUserId: me.id }, { idOnly: true })
			.then(x => x.map(x => x.id).filter(x => !mutingChannelIds.includes(x)));

		//#region Construct query
		const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'), ps.sinceId, ps.untilId)
			.innerJoinAndSelect('note.user', 'user')
			.leftJoinAndSelect('note.reply', 'reply')
			.leftJoinAndSelect('note.renote', 'renote')
			.leftJoinAndSelect('reply.user', 'replyUser')
			.leftJoinAndSelect('renote.user', 'renoteUser');

		if (followees.length > 0 && followingChannelIds.length > 0) {
			// ユーザー・チャンネルともにフォローあり
			const meOrFolloweeIds = [me.id, ...followees.map(f => f.followeeId)];
			query.andWhere(new Brackets(qb => {
				qb
					.where(new Brackets(qb2 => {
						qb2
							.andWhere('note.userId IN (:...meOrFolloweeIds)', { meOrFolloweeIds: meOrFolloweeIds })
							.andWhere('note.channelId IS NULL');
					}))
					.orWhere('note.channelId IN (:...followingChannelIds)', { followingChannelIds });
			}));
		} else if (followees.length > 0) {
			// ユーザーフォローのみ（チャンネルフォローなし）
			const meOrFolloweeIds = [me.id, ...followees.map(f => f.followeeId)];
			query.andWhere(new Brackets(qb => {
				qb
					.andWhere('note.channelId IS NULL')
					.andWhere('note.userId IN (:...meOrFolloweeIds)', { meOrFolloweeIds: meOrFolloweeIds });
				if (mutingChannelIds.length > 0) {
					qb.andWhere(new Brackets(qb2 => {
						qb2.orWhere('note.renoteChannelId IS NULL');
						qb2.orWhere('note.renoteChannelId NOT IN (:...mutingChannelIds)', { mutingChannelIds });
					}));
				}
			}));
		} else if (followingChannelIds.length > 0) {
			// チャンネルフォローのみ（ユーザーフォローなし）
			query.andWhere(new Brackets(qb => {
				qb
					// renoteChannelIdは見る必要が無い
					// ・HTLに流れてくるチャンネル＝フォローしているチャンネル
					// ・HTLにフォロー外のチャンネルが流れるのは、フォローしているユーザがそのチャンネル投稿をリノートした場合のみ
					// つまり、ユーザフォローしてない前提のこのブロックでは見る必要が無い
					.where('note.channelId IN (:...followingChannelIds)', { followingChannelIds })
					.orWhere('note.userId = :meId', { meId: me.id });
			}));
		} else {
			// フォローなし
			query.andWhere(new Brackets(qb => {
				qb
					.andWhere('note.channelId IS NULL')
					.andWhere('note.userId = :meId', { meId: me.id });
			}));
		}

		query.andWhere(new Brackets(qb => {
			qb
				.where('note.replyId IS NULL') // 返信ではない
				.orWhere(new Brackets(qb => {
					qb // 返信だけど投稿者自身への返信
						.where('note.replyId IS NOT NULL')
						.andWhere('note.replyUserId = note.userId');
				}));
		}));

		this.queryService.generateVisibilityQuery(query, me);
		this.queryService.generateBaseNoteFilteringQuery(query, me);
		this.queryService.generateMutedUserRenotesQueryForNotes(query, me);
		// JUICE: 表示言語の絞り込み(自分自身の投稿を常に表示するかはユーザー設定に従う)
		const profile = await this.cacheService.userProfileCache.fetch(me.id);
		this.queryService.generateLanguageFilterQuery(query, me, profile.excludeOwnNotesFromLanguageFilter);

		if (ps.includeMyRenotes === false) {
			query.andWhere(new Brackets(qb => {
				qb.orWhere('note.userId != :meId', { meId: me.id });
				qb.orWhere('note.renoteId IS NULL');
				qb.orWhere('note.text IS NOT NULL');
				qb.orWhere('note.fileIds != \'{}\'');
				qb.orWhere('0 < (SELECT COUNT(*) FROM poll WHERE poll."noteId" = note.id)');
			}));
		}

		if (ps.includeRenotedMyNotes === false) {
			query.andWhere(new Brackets(qb => {
				qb.orWhere('note.renoteUserId != :meId', { meId: me.id });
				qb.orWhere('note.renoteId IS NULL');
				qb.orWhere('note.text IS NOT NULL');
				qb.orWhere('note.fileIds != \'{}\'');
				qb.orWhere('0 < (SELECT COUNT(*) FROM poll WHERE poll."noteId" = note.id)');
			}));
		}

		if (ps.includeLocalRenotes === false) {
			query.andWhere(new Brackets(qb => {
				qb.orWhere('note.renoteUserHost IS NOT NULL');
				qb.orWhere('note.renoteId IS NULL');
				qb.orWhere('note.text IS NOT NULL');
				qb.orWhere('note.fileIds != \'{}\'');
				qb.orWhere('0 < (SELECT COUNT(*) FROM poll WHERE poll."noteId" = note.id)');
			}));
		}

		if (ps.withFiles) {
			// JUICE: 純粋なリノート(本文・自身のファイルを持たない)は、リノート元の投稿にファイルが
			// あればメディアタイムラインの対象に含める。hideFromMediaTimelineは実際にファイルを
			// 提供している側(自身、またはリノート元)の投稿の設定を見る。
			// 「小説」フラグが付いた投稿は添付ファイルの有無にかかわらず対象に含める
			query.andWhere(new Brackets(qb => {
				qb.orWhere(new Brackets(qb2 => {
					qb2.andWhere('note.fileIds != \'{}\'');
					qb2.andWhere('note.hideFromMediaTimeline = FALSE');
				}));
				qb.orWhere(new Brackets(qb2 => {
					qb2.andWhere('note.renoteId IS NOT NULL');
					qb2.andWhere('renote.fileIds != \'{}\'');
					qb2.andWhere('renote.hideFromMediaTimeline = FALSE');
				}));
				qb.orWhere('note.isNovel = TRUE');
			}));
		}

		// JUICE: ホームタイムラインをローカルユーザーの投稿だけに絞り込む
		if (ps.localOnly) {
			query.andWhere('note.userHost IS NULL');
		}

		// JUICE: 「小説」フラグが付いた投稿だけに絞り込む
		if (ps.onlyNovel) {
			andWhereOnlyNovel(query);
		}

		if (ps.withRenotes === false) {
			query.andWhere(new Brackets(qb => {
				qb.orWhere('note.renoteId IS NULL');
				qb.orWhere(new Brackets(qb => {
					qb.orWhere('note.text IS NOT NULL');
					qb.orWhere('note.fileIds != \'{}\'');
					qb.orWhere('0 < (SELECT COUNT(*) FROM poll WHERE poll."noteId" = note.id)');
				}));
			}));
		}
		//#endregion

		return await query.limit(ps.limit).getMany();
	}
}
