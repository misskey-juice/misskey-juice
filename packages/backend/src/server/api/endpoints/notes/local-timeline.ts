/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Brackets } from 'typeorm';
import { Inject, Injectable } from '@nestjs/common';
import type { MiMeta, NotesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import ActiveUsersChart from '@/core/chart/charts/active-users.js';
import { DI } from '@/di-symbols.js';
import { RoleService } from '@/core/RoleService.js';
import { IdService } from '@/core/IdService.js';
import { QueryService } from '@/core/QueryService.js';
import { MiLocalUser } from '@/models/User.js';
import { FanoutTimelineEndpointService } from '@/core/FanoutTimelineEndpointService.js';
import { ChannelMutingService } from '@/core/ChannelMutingService.js';
import { CacheService } from '@/core/CacheService.js';
import { isLanguageFiltered } from '@/misc/is-language-filtered.js';
import { ApiError } from '../../error.js';
import { andWhereOnlyNovel, isNovelOrNovelRenote } from '@/misc/novel-filter.js';

export const meta = {
	tags: ['notes'],

	res: {
		type: 'array',
		optional: false, nullable: false,
		items: {
			type: 'object',
			optional: false, nullable: false,
			ref: 'Note',
		},
	},

	errors: {
		ltlDisabled: {
			message: 'Local timeline has been disabled.',
			code: 'LTL_DISABLED',
			id: '45a6eb02-7695-4393-b023-dd3be9aaaefd',
		},

		bothWithRepliesAndWithFiles: {
			message: 'Specifying both withReplies and withFiles is not supported',
			code: 'BOTH_WITH_REPLIES_AND_WITH_FILES',
			id: 'dd9c8400-1cb5-4eef-8a31-200c5f933793',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		withFiles: { type: 'boolean', default: false },
		withRenotes: { type: 'boolean', default: true },
		withReplies: { type: 'boolean', default: false },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		allowPartial: { type: 'boolean', default: false }, // true is recommended but for compatibility false by default
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
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
		private roleService: RoleService,
		private activeUsersChart: ActiveUsersChart,
		private idService: IdService,
		private fanoutTimelineEndpointService: FanoutTimelineEndpointService,
		private queryService: QueryService,
		private channelMutingService: ChannelMutingService,
		private cacheService: CacheService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const untilId = ps.untilId ?? (ps.untilDate ? this.idService.gen(ps.untilDate!) : null);
			const sinceId = ps.sinceId ?? (ps.sinceDate ? this.idService.gen(ps.sinceDate!) : null);

			const policies = await this.roleService.getUserPolicies(me ? me.id : null);
			if (!policies.ltlAvailable) {
				throw new ApiError(meta.errors.ltlDisabled);
			}

			if (ps.withReplies && ps.withFiles) throw new ApiError(meta.errors.bothWithRepliesAndWithFiles);

			// JUICE: 「小説」だけに絞り込むときは、Redisのタイムライン(作ったときに入れた投稿だけ)ではなくDBから引く
			// (後から小説フラグを付けた投稿も出るように。小説の投稿だけの索引で速く引ける)
			if (!this.serverSettings.enableFanoutTimeline || ps.onlyNovel) {
				const timeline = await this.getFromDb({
					untilId,
					sinceId,
					limit: ps.limit,
					withFiles: ps.withFiles,
					withReplies: ps.withReplies,
					onlyNovel: ps.onlyNovel,
				}, me);

				process.nextTick(() => {
					if (me) {
						this.activeUsersChart.read(me);
					}
				});

				return await this.noteEntityService.packMany(timeline, me);
			}

			// JUICE: 表示言語の絞り込み(未ログインなら絞り込み無し)
			const profile = me ? await this.cacheService.userProfileCache.fetch(me.id) : null;
			const filteredLanguages = new Set(profile?.filteredLanguages ?? []);

			const timeline = await this.fanoutTimelineEndpointService.timeline({
				untilId,
				sinceId,
				limit: ps.limit,
				allowPartial: ps.allowPartial,
				me,
				useDbFallback: this.serverSettings.enableFanoutTimelineDbFallback,
				redisTimelines:
					ps.withFiles ? ['localTimelineWithFiles']
					: ps.withReplies ? ['localTimeline', 'localTimelineWithReplies']
					: me ? ['localTimeline', `localTimelineWithReplyTo:${me.id}`]
					: ['localTimeline'],
				// JUICE: 表示言語の絞り込みが有効でも自分自身の投稿を常に表示するか(ユーザー設定)
				alwaysIncludeMyNotes: profile?.excludeOwnNotesFromLanguageFilter ?? true,
				excludePureRenotes: !ps.withRenotes,
				noteFilter: note => {
					if (isLanguageFiltered(note, filteredLanguages)) return false;
					// JUICE: 「小説」フラグが付いた投稿だけに絞り込む
					if (ps.onlyNovel && !isNovelOrNovelRenote(note)) return false;
					return true;
				},
				dbFallback: async (untilId, sinceId, limit) => await this.getFromDb({
					untilId,
					sinceId,
					limit,
					withFiles: ps.withFiles,
					withReplies: ps.withReplies,
					onlyNovel: ps.onlyNovel,
				}, me),
			});

			process.nextTick(() => {
				if (me) {
					this.activeUsersChart.read(me);
				}
			});

			return timeline;
		});
	}

	private async getFromDb(ps: {
		sinceId: string | null,
		untilId: string | null,
		limit: number,
		withFiles: boolean,
		withReplies: boolean,
		onlyNovel: boolean,
	}, me: MiLocalUser | null) {
		const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'),
			ps.sinceId, ps.untilId)
			.andWhere('(note.visibility = \'public\') AND (note.userHost IS NULL) AND (note.channelId IS NULL)')
			.innerJoinAndSelect('note.user', 'user')
			.leftJoinAndSelect('note.reply', 'reply')
			.leftJoinAndSelect('note.renote', 'renote')
			.leftJoinAndSelect('reply.user', 'replyUser')
			.leftJoinAndSelect('renote.user', 'renoteUser');

		this.queryService.generateVisibilityQuery(query, me);
		this.queryService.generateBaseNoteFilteringQuery(query, me);
		if (me) {
			this.queryService.generateMutedUserRenotesQueryForNotes(query, me);
			// JUICE: 表示言語の絞り込み(自分自身の投稿を常に表示するかはユーザー設定に従う)
			const profile = await this.cacheService.userProfileCache.fetch(me.id);
			this.queryService.generateLanguageFilterQuery(query, me, profile.excludeOwnNotesFromLanguageFilter);

			const mutedChannelIds = await this.channelMutingService
				.list({ requestUserId: me.id }, { idOnly: true })
				.then(x => x.map(x => x.id));
			if (mutedChannelIds.length > 0) {
				query.andWhere(new Brackets(qb => {
					qb.orWhere('note.renoteChannelId IS NULL')
						.orWhere('note.renoteChannelId NOT IN (:...mutedChannelIds)', { mutedChannelIds });
				}));
			}
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

		if (!ps.withReplies) {
			query.andWhere(new Brackets(qb => {
				qb
					.where('note.replyId IS NULL') // 返信ではない
					.orWhere(new Brackets(qb => {
						qb // 返信だけど投稿者自身への返信
							.where('note.replyId IS NOT NULL')
							.andWhere('note.replyUserId = note.userId');
					}));
			}));
		}

		// JUICE: 「小説」フラグが付いた投稿だけに絞り込む
		if (ps.onlyNovel) {
			andWhereOnlyNovel(query);
		}

		return await query.limit(ps.limit).getMany();
	}
}
