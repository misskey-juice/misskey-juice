/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Index, JoinColumn, Column, PrimaryColumn, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiDriveFile } from './DriveFile.js';

// JUICE: 承認式にしたアカウントのデータのインポート(設定 → アカウントのデータ)の申請。
// 運営(モデレーター・canApproveImportRequestsロールポリシーを持つ人)が中身を確かめて承認したら、元のインポートを行う。
// pending: 審査待ち、approved: 承認済み(インポートを始めた)、rejected: 却下済み、cancelled: 申請した本人による取り下げ
export const importRequestStatuses = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type ImportRequestStatus = typeof importRequestStatuses[number];

// インポートの種類(設定のアカウントのデータにある5つ)
export const importRequestTypes = ['following', 'muting', 'blocking', 'userLists', 'antennas'] as const;
export type ImportRequestType = typeof importRequestTypes[number];

@Entity('import_request')
@Index(['userId', 'type', 'status'])
export class MiImportRequest {
	@PrimaryColumn(id())
	public id: string;

	@Column({
		...id(),
		comment: 'The ID of the requester (JUICE).',
	})
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public user: MiUser | null;

	@Column('varchar', {
		length: 32,
		comment: 'The kind of import: following, muting, blocking, userLists or antennas (JUICE).',
	})
	public type: ImportRequestType;

	// インポートするファイル。申請した本人が消したらnullになり、そのときは承認できない
	@Index()
	@Column({
		...id(),
		nullable: true,
		comment: 'The ID of the drive file to import (JUICE).',
	})
	public fileId: MiDriveFile['id'] | null;

	@ManyToOne(() => MiDriveFile, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public file: MiDriveFile | null;

	// 申請したときのファイルの名前と大きさ(ファイルが消えても、何の申請だったか分かるように)
	@Column('varchar', {
		length: 256,
		comment: 'The name of the drive file at the time of the request (JUICE).',
	})
	public fileName: string;

	@Column('integer', {
		comment: 'The size of the drive file in bytes at the time of the request (JUICE).',
	})
	public fileSize: number;

	// フォローのインポートの「返信も含める」(ほかの種類ではnull)
	@Column('boolean', {
		nullable: true,
		comment: 'The withReplies option of a following import (JUICE).',
	})
	public withReplies: boolean | null;

	@Index()
	@Column('varchar', {
		length: 16,
		default: 'pending',
		comment: 'The review status (JUICE).',
	})
	public status: ImportRequestStatus;

	@Column('text', {
		nullable: true,
		comment: 'The reason for the rejection (JUICE).',
	})
	public rejectReason: string | null;

	@Index()
	@Column({
		...id(),
		nullable: true,
		comment: 'The ID of the reviewer (JUICE).',
	})
	public reviewerId: MiUser['id'] | null;

	@ManyToOne(() => MiUser, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public reviewer: MiUser | null;

	@Column('timestamp with time zone', {
		nullable: true,
		comment: 'The date of the review (JUICE).',
	})
	public reviewedAt: Date | null;
}
