/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { AnnouncementService } from '@/core/AnnouncementService.js';
import { ApiError } from '@/server/api/error.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';

export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:announcements',

	errors: {
		pollNotAllowed: {
			message: 'Polls are not allowed on announcements addressed to a specific user.',
			code: 'POLL_NOT_ALLOWED',
			id: 'f9335532-f6df-4c43-aadb-992c03bd5841',
		},
		invalidAutoArchiveAt: {
			message: 'Invalid auto archive date.',
			code: 'INVALID_AUTO_ARCHIVE_AT',
			id: '2a892bd5-487d-46a2-a5fe-3d85ad51defe',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			id: {
				type: 'string',
				optional: false, nullable: false,
				format: 'id',
				example: 'xxxxxxxxxx',
			},
			createdAt: {
				type: 'string',
				optional: false, nullable: false,
				format: 'date-time',
			},
			updatedAt: {
				type: 'string',
				optional: false, nullable: true,
				format: 'date-time',
			},
			title: {
				type: 'string',
				optional: false, nullable: false,
			},
			text: {
				type: 'string',
				optional: false, nullable: false,
			},
			imageUrl: {
				type: 'string',
				optional: false, nullable: true,
			},
			poll: {
				type: 'object',
				optional: false, nullable: true,
				properties: {
					expiresAt: {
						type: 'string',
						optional: false, nullable: true,
						format: 'date-time',
					},
					multiple: {
						type: 'boolean',
						optional: false, nullable: false,
					},
					choices: {
						type: 'array',
						optional: false, nullable: false,
						items: {
							type: 'object',
							optional: false, nullable: false,
							properties: {
								isVoted: {
									type: 'boolean',
									optional: false, nullable: false,
								},
								text: {
									type: 'string',
									optional: false, nullable: false,
								},
								votes: {
									type: 'number',
									optional: false, nullable: false,
								},
							},
						},
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		title: { type: 'string', minLength: 1 },
		text: { type: 'string', minLength: 1 },
		imageUrl: { type: 'string', nullable: true, minLength: 0 },
		icon: { type: 'string', enum: ['info', 'warning', 'error', 'success'], default: 'info' },
		display: { type: 'string', enum: ['normal', 'banner', 'dialog'], default: 'normal' },
		forExistingUsers: { type: 'boolean', default: false },
		silence: { type: 'boolean', default: false },
		needConfirmationToRead: { type: 'boolean', default: false },
		userId: { type: 'string', format: 'misskey:id', nullable: true, default: null },
		poll: {
			type: 'object', nullable: true, default: null,
			properties: {
				choices: {
					type: 'array',
					uniqueItems: true,
					minItems: 2,
					maxItems: 10,
					items: { type: 'string', minLength: 1, maxLength: 50 },
				},
				multiple: { type: 'boolean', default: false },
				expiresAt: { type: 'integer', nullable: true, default: null },
				expiredAfter: { type: 'integer', nullable: true, minimum: 1, default: null },
			},
			required: ['choices'],
		},
		autoArchiveAt: { type: 'integer', nullable: true, default: null },
	},
	required: ['title', 'text', 'imageUrl'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private announcementService: AnnouncementService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const autoArchiveAt = ps.autoArchiveAt != null ? new Date(ps.autoArchiveAt) : null;
			if (ps.autoArchiveAt != null && (ps.autoArchiveAt <= Date.now() || Number.isNaN(autoArchiveAt?.getTime()))) {
				throw new ApiError(meta.errors.invalidAutoArchiveAt);
			}

			const { packed } = await this.announcementService.create({
				updatedAt: null,
				title: ps.title,
				text: ps.text,
				/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- 空の文字列の場合、nullを渡すようにするため */
				imageUrl: ps.imageUrl || null,
				icon: ps.icon,
				display: ps.display,
				forExistingUsers: ps.forExistingUsers,
				silence: ps.silence,
				needConfirmationToRead: ps.needConfirmationToRead,
				userId: ps.userId,
				autoArchiveAt,
			}, me, ps.poll ? {
				choices: ps.poll.choices,
				multiple: ps.poll.multiple,
				expiresAt: ps.poll.expiresAt != null ? new Date(ps.poll.expiresAt)
					: ps.poll.expiredAfter != null ? new Date(Date.now() + ps.poll.expiredAfter)
					: null,
			} : null).catch(err => {
				if (err instanceof IdentifiableError && err.id === '7c5a15f4-6a91-4995-9030-fbe97b970a8e') throw new ApiError(meta.errors.pollNotAllowed);
				throw err;
			});

			return packed;
		});
	}
}
