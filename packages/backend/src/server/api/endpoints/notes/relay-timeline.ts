/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Brackets } from 'typeorm';
import type { NotesRepository } from '@/models/_.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { QueryService } from '@/core/QueryService.js';
import { RoleService } from '@/core/RoleService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import ActiveUsersChart from '@/core/chart/charts/active-users.js';
import { DI } from '@/di-symbols.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { resolveRelayTimelineSettings } from '@/models/JuiceSettings.js';
import { ApiError } from '../../error.js';

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
		functionDisabled: {
			message: 'The relay timeline feature is currently disabled.',
			code: 'FUNCTION_DISABLED',
			id: 'f5c1e2f3-7d4d-4a3c-9b3e-3d5c7a3a5b1e',
		},

		gtlDisabled: {
			message: 'Global timeline has been disabled.',
			code: 'GTL_DISABLED',
			id: 'c820d67a-0b17-4fe0-a322-08a68e623c23',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		withFiles: { type: 'boolean', default: false },
		withRenotes: { type: 'boolean', default: true },
		relayIds: {
			type: 'array',
			nullable: true,
			default: null,
			uniqueItems: true,
			maxItems: 30,
			items: { type: 'string', format: 'misskey:id' },
		},
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
		sinceId: { type: 'string', format: 'misskey:id' },
		untilId: { type: 'string', format: 'misskey:id' },
		sinceDate: { type: 'integer' },
		untilDate: { type: 'integer' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private noteEntityService: NoteEntityService,
		private queryService: QueryService,
		private roleService: RoleService,
		private juiceSettingsService: JuiceSettingsService,
		private activeUsersChart: ActiveUsersChart,
	) {
		super(meta, paramDef, async (ps, me) => {
			const { relayTimelineEnabled } = resolveRelayTimelineSettings(await this.juiceSettingsService.fetch());
			if (!relayTimelineEnabled) throw new ApiError(meta.errors.functionDisabled);

			// 公開ノート閲覧経路の制限ポリシーはGTLと共通(gtlAvailable)
			const policies = await this.roleService.getUserPolicies(me ? me.id : null);
			if (!policies.gtlAvailable) throw new ApiError(meta.errors.gtlDisabled);

			//#region Construct query
			const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'),
				ps.sinceId, ps.untilId, ps.sinceDate, ps.untilDate)
				.andWhere('note.visibility = \'public\'')
				.andWhere('note.relayId IS NOT NULL')
				.innerJoinAndSelect('note.user', 'user')
				.leftJoinAndSelect('note.reply', 'reply')
				.leftJoinAndSelect('note.renote', 'renote')
				.leftJoinAndSelect('reply.user', 'replyUser')
				.leftJoinAndSelect('renote.user', 'renoteUser');

			if (ps.relayIds != null && ps.relayIds.length > 0) {
				query.andWhere('note.relayId IN (:...relayIds)', { relayIds: ps.relayIds });
			}

			this.queryService.generateBaseNoteFilteringQuery(query, me);
			// 本家2026.10.0でグローバルタイムラインに入った、ログインしていない人向けの公開範囲(ugcVisibilityForVisitor)をこちらにも
			if (me == null) this.queryService.generateUgcVisibilityQueryForVisitor(query);
			if (me) {
				this.queryService.generateMutedUserRenotesQueryForNotes(query, me);
				// JUICE: 表示言語の絞り込み
				this.queryService.generateLanguageFilterQuery(query, me);
			}

			if (ps.withFiles) {
				query.andWhere('note.fileIds != \'{}\'');
			}

			if (ps.withRenotes === false) {
				query.andWhere(new Brackets(qb => {
					qb.where('note.renoteId IS NULL');
					qb.orWhere(new Brackets(qb => {
						qb.where('note.text IS NOT NULL');
						qb.orWhere('note.fileIds != \'{}\'');
						qb.orWhere('0 < (SELECT COUNT(*) FROM poll WHERE poll."noteId" = note.id)');
					}));
				}));
			}
			//#endregion

			const timeline = await query.limit(ps.limit).getMany();

			process.nextTick(() => {
				if (me) {
					this.activeUsersChart.read(me);
				}
			});

			return await this.noteEntityService.packMany(timeline, me);
		});
	}
}
