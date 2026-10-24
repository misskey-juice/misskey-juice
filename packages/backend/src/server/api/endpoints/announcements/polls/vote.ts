/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { DI } from '@/di-symbols.js';
import type { AnnouncementsRepository } from '@/models/_.js';
import { AnnouncementPollService } from '@/core/AnnouncementPollService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { ApiError } from '../../../error.js';

export const meta = {
	tags: ['announcements'],

	requireCredential: true,

	prohibitMoved: true,

	kind: 'write:votes',

	errors: {
		noSuchAnnouncement: {
			message: 'No such announcement.',
			code: 'NO_SUCH_ANNOUNCEMENT',
			id: 'c2c58db1-8db5-4b6d-a232-5743c3fe16ce',
		},

		pollNotAllowed: {
			message: 'Voting is not allowed on announcements addressed to a specific user.',
			code: 'POLL_NOT_ALLOWED',
			id: 'fbac3590-fe4a-40db-81af-483edf00919b',
		},

		noPoll: {
			message: 'This announcement does not have a poll.',
			code: 'NO_POLL',
			id: 'b0ee5217-746f-4946-bbed-ab4674c3b608',
		},

		invalidChoice: {
			message: 'Choice ID is invalid.',
			code: 'INVALID_CHOICE',
			id: 'ac7c1f1c-6a15-43cf-8440-e8be1169db19',
		},

		alreadyVoted: {
			message: 'You have already voted.',
			code: 'ALREADY_VOTED',
			id: '79f88939-4ef7-4bde-88d3-5f6dd202ebc0',
		},

		alreadyExpired: {
			message: 'The poll is already expired.',
			code: 'ALREADY_EXPIRED',
			id: '94f9b976-3e36-4818-969f-f3719ecff904',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		announcementId: { type: 'string', format: 'misskey:id' },
		choice: { type: 'integer' },
	},
	required: ['announcementId', 'choice'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.announcementsRepository)
		private announcementsRepository: AnnouncementsRepository,

		private announcementPollService: AnnouncementPollService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const announcement = await this.announcementsRepository.findOneBy({
				id: ps.announcementId,
				isActive: true,
			});

			// 自動アーカイブ日時を過ぎたものは、アーカイブのジョブが動く前でもアーカイブ済みとして扱う
			if (announcement == null || (announcement.autoArchiveAt != null && announcement.autoArchiveAt <= new Date())) {
				throw new ApiError(meta.errors.noSuchAnnouncement);
			}

			if (announcement.userId != null) {
				// ユーザー宛てのお知らせには投票自体を許可しない。本人以外には存在も知られてはいけないため404として扱う
				if (announcement.userId !== me.id) {
					throw new ApiError(meta.errors.noSuchAnnouncement);
				}
				throw new ApiError(meta.errors.pollNotAllowed);
			}

			await this.announcementPollService.vote(me, announcement, ps.choice).catch(err => {
				if (err instanceof IdentifiableError) {
					if (err.id === '02ebd85f-1ce2-4afc-a5bc-b7559ef37ddd') throw new ApiError(meta.errors.noPoll);
					if (err.id === '82a4344d-0c50-4a7b-bad2-1accc93a9307') throw new ApiError(meta.errors.invalidChoice);
					if (err.id === '0ac3fb2f-30f2-4642-b2ed-e57e0790679d') throw new ApiError(meta.errors.alreadyVoted);
					if (err.id === '34b96600-a1d0-4157-a4dd-df82f5c7b971') throw new ApiError(meta.errors.alreadyExpired);
				}
				throw err;
			});
		});
	}
}
