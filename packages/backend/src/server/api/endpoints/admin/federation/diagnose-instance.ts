/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import ms from 'ms';
import { Endpoint } from '@/server/api/endpoint-base.js';
import type { InstancesRepository } from '@/models/_.js';
import { UtilityService } from '@/core/UtilityService.js';
import { FederationDiagnosisService, FEDERATION_DIAGNOSIS_CHECK_IDS } from '@/core/FederationDiagnosisService.js';
import { DI } from '@/di-symbols.js';
import { ApiError } from '../../../error.js';

// JUICE: 連合しているサーバーとの連合の診断(どこで連合が止まっているかを確かめる)。
// 相手のサーバーへ実際に問い合わせるので、モデレーター以上だけが使え、このサーバーが知っているサーバーだけを対象にする
export const meta = {
	tags: ['admin'],

	requireCredential: true,
	requireModerator: true,
	kind: 'write:admin:federation',

	limit: {
		duration: ms('1minute'),
		max: 10,
	},

	errors: {
		noSuchInstance: {
			message: 'No such instance.',
			code: 'NO_SUCH_INSTANCE',
			id: '7edea866-993d-4866-9023-caba84533606',
		},
	},

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			host: { type: 'string', optional: false, nullable: false },
			checkedAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
			checks: {
				type: 'array',
				optional: false, nullable: false,
				items: {
					type: 'object',
					optional: false, nullable: false,
					properties: {
						id: { type: 'string', optional: false, nullable: false, enum: FEDERATION_DIAGNOSIS_CHECK_IDS },
						status: { type: 'string', optional: false, nullable: false, enum: ['ok', 'warn', 'error', 'skipped'] },
						code: { type: 'string', optional: false, nullable: true },
						detail: { type: 'string', optional: false, nullable: true },
						elapsedMs: { type: 'number', optional: false, nullable: true },
					},
				},
			},
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		host: { type: 'string', minLength: 1, maxLength: 253 },
	},
	required: ['host'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.instancesRepository)
		private instancesRepository: InstancesRepository,

		private utilityService: UtilityService,
		private federationDiagnosisService: FederationDiagnosisService,
	) {
		super(meta, paramDef, async (ps) => {
			const instance = await this.instancesRepository.findOneBy({ host: this.utilityService.toPuny(ps.host) });
			if (instance == null) throw new ApiError(meta.errors.noSuchInstance);

			return {
				host: instance.host,
				checkedAt: new Date().toISOString(),
				checks: await this.federationDiagnosisService.diagnose(instance),
			};
		});
	}
}
