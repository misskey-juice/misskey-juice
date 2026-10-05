/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import type { AntennasRepository, DriveFilesRepository, ImportRequestsRepository, MiAntenna, MiDriveFile, MiUser, UsersRepository } from '@/models/_.js';
import type { ImportRequestType, MiImportRequest } from '@/models/ImportRequest.js';
import { resolveImportApprovalSettings } from '@/models/JuiceSettings.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { IdService } from '@/core/IdService.js';
import { QueueService } from '@/core/QueueService.js';
import { RoleService } from '@/core/RoleService.js';
import { DownloadService } from '@/core/DownloadService.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { JuiceAdminNotificationService } from '@/core/JuiceAdminNotificationService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import type { Packed } from '@/misc/json-schema.js';

type ImportedAntenna = MiAntenna & { userListAccts: string[] | null };

// 下書き(プレビュー)に出す行数の上限
const PREVIEW_LINES = 100;
// ホストごとの件数を出す数の上限
const PREVIEW_HOSTS = 10;

/**
 * JUICE: 承認式にしたアカウントのデータのインポート(設定 → アカウントのデータ)。
 * JUICE設定で選んだ種類のインポートは、すぐには行わず申請にし、運営(モデレーター・canApproveImportRequestsロールポリシーを持つ人)が
 * 中身を確かめて承認したら、元のインポートを行う
 */
@Injectable()
export class ImportRequestService {
	public static readonly NO_SUCH_FILE = 'e1f3b9a4-5d1c-4f0e-9d3a-6c2b1e8a4f70';
	public static readonly ALREADY_REQUESTED = 'b6d2c4e8-1a3f-4b7e-8c9d-2e4f6a8b0c13';
	public static readonly TOO_MANY_ANTENNAS = 'c8e0a2f4-3b5d-4c7e-9f1a-4b6d8e0f2a35';
	public static readonly INVALID_FILE = 'd0a2c4e6-5f7b-4e9d-8b1c-6d8f0a2c4e57';
	public static readonly REQUESTER_UNAVAILABLE = 'e2b4d6f8-7a9c-4b1d-9e3f-8a0c2e4b6d79';

	constructor(
		@Inject(DI.importRequestsRepository)
		private importRequestsRepository: ImportRequestsRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		@Inject(DI.antennasRepository)
		private antennasRepository: AntennasRepository,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		private idService: IdService,
		private queueService: QueueService,
		private roleService: RoleService,
		private downloadService: DownloadService,
		private juiceSettingsService: JuiceSettingsService,
		private juiceAdminNotificationService: JuiceAdminNotificationService,
		private userEntityService: UserEntityService,
	) {
	}

	/**
	 * このユーザーのこの種類のインポートに、運営の承認が要るか。
	 * 審査できる人(モデレーター・canApproveImportRequestsロールポリシーを持つ人)のインポートは、自分で通せるので承認は要らない
	 */
	@bindThis
	public async requiresApproval(user: { id: MiUser['id'] }, type: ImportRequestType): Promise<boolean> {
		const { importApprovalRequiredTypes } = resolveImportApprovalSettings(await this.juiceSettingsService.fetch());
		if (!importApprovalRequiredTypes.includes(type)) return false;
		if (await this.roleService.isModerator(user)) return false;
		const policies = await this.roleService.getUserPolicies(user.id);
		return !policies.canApproveImportRequests;
	}

	/**
	 * インポートを申請にする(同じ種類の審査待ちの申請があれば断る)。審査できる人に知らせる
	 */
	@bindThis
	public async createRequest(user: MiUser, type: ImportRequestType, file: MiDriveFile, options: { withReplies?: boolean } = {}): Promise<MiImportRequest> {
		const pending = await this.importRequestsRepository.existsBy({ userId: user.id, type, status: 'pending' });
		if (pending) throw new IdentifiableError(ImportRequestService.ALREADY_REQUESTED, 'There is already a pending import request of this kind.');

		const request = await this.importRequestsRepository.insertOne({
			id: this.idService.gen(),
			userId: user.id,
			type,
			fileId: file.id,
			fileName: file.name.slice(0, 256),
			fileSize: file.size,
			withReplies: type === 'following' ? (options.withReplies ?? null) : null,
			status: 'pending',
		});

		const requester = await this.userEntityService.pack(user, null, { schema: 'UserLite' });
		this.juiceAdminNotificationService.notifyNewImportRequest(requester, { id: request.id, importType: type });

		return request;
	}

	/**
	 * ファイルの中身から、antennasのインポートの中身を作る(数の上限も確かめる)。元のi/import-antennasと同じ確かめ方
	 */
	@bindThis
	public async parseAntennas(user: { id: MiUser['id'] }, file: MiDriveFile): Promise<ImportedAntenna[]> {
		let antennas: unknown;
		try {
			antennas = JSON.parse(await this.downloadService.downloadTextFile(file.url));
		} catch {
			throw new IdentifiableError(ImportRequestService.INVALID_FILE, 'The file is not a valid antenna export.');
		}
		if (!Array.isArray(antennas)) throw new IdentifiableError(ImportRequestService.INVALID_FILE, 'The file is not a valid antenna export.');
		const currentAntennasCount = await this.antennasRepository.countBy({ userId: user.id });
		if (currentAntennasCount + antennas.length >= (await this.roleService.getUserPolicies(user.id)).antennaLimit) {
			throw new IdentifiableError(ImportRequestService.TOO_MANY_ANTENNAS, 'You cannot create antenna any more.');
		}
		return antennas as ImportedAntenna[];
	}

	/**
	 * 元のインポートを行う(承認したとき)。ファイルが無くなっていたら断る
	 */
	@bindThis
	public async startImport(request: MiImportRequest): Promise<void> {
		// 申請した後に、凍結・削除された、アカウントを引っ越した、インポートできるロールではなくなった人のインポートは行わない
		// (元のi/import-*では、凍結・削除・引っ越し(prohibitMoved)とロールポリシー(canImportXxx)で断っている)
		const requester = await this.usersRepository.findOneBy({ id: request.userId });
		if (requester == null || requester.isSuspended || requester.isDeleted || requester.movedToUri != null) {
			throw new IdentifiableError(ImportRequestService.REQUESTER_UNAVAILABLE, 'The requester cannot import now.');
		}
		const policies = await this.roleService.getUserPolicies(request.userId);
		const allowed = {
			following: policies.canImportFollowing,
			muting: policies.canImportMuting,
			blocking: policies.canImportBlocking,
			userLists: policies.canImportUserLists,
			antennas: policies.canImportAntennas,
		}[request.type];
		if (!allowed) throw new IdentifiableError(ImportRequestService.REQUESTER_UNAVAILABLE, 'The requester cannot import now.');

		const file = request.fileId == null ? null : await this.driveFilesRepository.findOneBy({ id: request.fileId, userId: request.userId });
		if (file == null) throw new IdentifiableError(ImportRequestService.NO_SUCH_FILE, 'The file to import has been deleted.');
		const user = { id: request.userId };
		switch (request.type) {
			case 'following':
				await this.queueService.createImportFollowingJob(user, file.id, request.withReplies ?? undefined);
				break;
			case 'muting':
				await this.queueService.createImportMutingJob(user, file.id);
				break;
			case 'blocking':
				await this.queueService.createImportBlockingJob(user, file.id);
				break;
			case 'userLists':
				await this.queueService.createImportUserListsJob(user, file.id);
				break;
			case 'antennas':
				await this.queueService.createImportAntennasJob(user, await this.parseAntennas(user, file));
				break;
		}
	}

	/** 申請した本人にも見せる形 */
	@bindThis
	public pack(request: MiImportRequest): Packed<'ImportRequest'> {
		return {
			id: request.id,
			createdAt: this.idService.parse(request.id).date.toISOString(),
			type: request.type,
			fileId: request.fileId,
			fileName: request.fileName,
			fileSize: request.fileSize,
			withReplies: request.withReplies,
			status: request.status,
			rejectReason: request.rejectReason,
			reviewedAt: request.reviewedAt?.toISOString() ?? null,
		};
	}

	/** 審査する人に見せる形(申請した人・審査した人を付ける。審査した人は、申請した本人には見せない) */
	@bindThis
	public async packDetailed(request: MiImportRequest, me: { id: MiUser['id'] } | null): Promise<Packed<'ImportRequestDetailedAdmin'>> {
		return {
			...this.pack(request),
			user: await this.userEntityService.pack(request.user ?? request.userId, me, { schema: 'UserLite' }),
			reviewer: request.reviewerId != null ? await this.userEntityService.pack(request.reviewer ?? request.reviewerId, me, { schema: 'UserLite' }) : null,
		};
	}

	/**
	 * 審査する人に見せる、ファイルの中身の一部。CSVは先頭の行と行数・ホストごとの件数、アンテナは名前の一覧。
	 * 読めなければnull
	 */
	@bindThis
	public async preview(request: MiImportRequest): Promise<{ lines: string[]; totalLines: number; hosts: { host: string; count: number }[] } | null> {
		const file = request.fileId == null ? null : await this.driveFilesRepository.findOneBy({ id: request.fileId, userId: request.userId });
		if (file == null) return null;
		let text: string;
		try {
			text = await this.downloadService.downloadTextFile(file.url);
		} catch {
			return null;
		}

		if (request.type === 'antennas') {
			try {
				const antennas = JSON.parse(text);
				if (!Array.isArray(antennas)) return null;
				return {
					lines: antennas.slice(0, PREVIEW_LINES).map(antenna => String(antenna?.name ?? '')),
					totalLines: antennas.length,
					hosts: [],
				};
			} catch {
				return null;
			}
		}

		const lines = text.trim().split('\n').map(line => line.trim()).filter(line => line !== '');
		// アカウントの列(リストは2列目、ほかは1列目)のホストごとに数える(同じサーバーのアカウントばかり、などに気付けるように)
		const column = request.type === 'userLists' ? 1 : 0;
		const hostCounts = new Map<string, number>();
		for (const line of lines) {
			const acct = (line.split(',')[column] ?? '').trim().replace(/^@/, '');
			const at = acct.indexOf('@');
			const host = at === -1 ? '' : acct.slice(at + 1).toLowerCase();
			hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
		}
		return {
			lines: lines.slice(0, PREVIEW_LINES),
			totalLines: lines.length,
			hosts: [...hostCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, PREVIEW_HOSTS).map(([host, count]) => ({ host, count })),
		};
	}
}
