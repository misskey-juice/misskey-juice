/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

export const drawRoomVisibilities = ['followers', 'local'] as const;
export type DrawRoomVisibility = typeof drawRoomVisibilities[number];

// JUICE: 絵チャの部屋のチャット1件(終了後も保存する部屋のみ、chatLogとしてDBに残す)
export type DrawRoomChatMessage = {
	id: string;
	userId: MiUser['id'];
	text: string;
	createdAt: number;
};

/**
 * JUICE: 絵チャ(お絵かきチャット)の部屋。
 * 線やチャットは開催中はRedisに置き(高頻度・一時的なため)、終了時にkeepAfterEndなら
 * 線をMiDrawRoomLayer・チャットをchatLogとしてDBへ移す。
 */
@Entity('draw_room')
export class MiDrawRoom {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column({
		...id(),
	})
	public ownerId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public owner: MiUser | null;

	@Column('varchar', {
		length: 64,
	})
	public title: string;

	@Column('varchar', {
		length: 16,
		comment: 'Who can see and join the room: followers of the owner, or all local users (JUICE).',
	})
	public visibility: DrawRoomVisibility;

	@Column('integer', {
		comment: 'Maximum number of members who can draw (spectators are not counted) (JUICE).',
	})
	public maxMembers: number;

	@Column('integer')
	public canvasWidth: number;

	@Column('integer')
	public canvasHeight: number;

	@Column('boolean', {
		default: false,
		comment: 'Whether to keep the drawing on the server after the room ends (JUICE).',
	})
	public keepAfterEnd: boolean;

	@Column('varchar', {
		length: 128,
		nullable: true,
		comment: 'Content warning shown before opening the room (JUICE).',
	})
	public cw: string | null;

	// JUICE: 部屋の説明(どんな絵を描く部屋か。一覧にも出す)。無ければnull
	@Column('varchar', {
		length: 512,
		nullable: true,
		comment: 'The description of the room shown in the room list (JUICE).',
	})
	public description: string | null;

	@Column('boolean', {
		default: false,
		comment: 'Whether the room contains sensitive (NSFW) drawings (JUICE).',
	})
	public isSensitive: boolean;

	@Index()
	@Column('boolean', {
		default: false,
	})
	public isEnded: boolean;

	@Column('timestamp with time zone', {
		nullable: true,
	})
	public endedAt: Date | null;

	@Column('jsonb', {
		default: [],
		comment: 'Chat messages saved when a kept room ends (JUICE).',
	})
	public chatLog: DrawRoomChatMessage[];
}
