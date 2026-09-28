/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// JUICE: タイムラインの「小説だけ」の絞り込み。小説フラグが付いた投稿と、その普通のリノート(本文などの無いリノート)を出す

import { Brackets } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import type { MiNote } from '@/models/Note.js';
import type { Packed } from '@/misc/json-schema.js';
import { isQuote, isQuotePacked, isRenote, isRenotePacked } from '@/misc/is-renote.js';

/**
 * DBから引くときの条件(投稿の別名はnote)。リノート元は、小説の投稿のidの中にあるかで見る(小説フラグの索引で速く引けるように)
 */
export function andWhereOnlyNovel(query: SelectQueryBuilder<MiNote>): void {
	query.andWhere(new Brackets(qb => {
		qb.orWhere('note.isNovel = TRUE');
		qb.orWhere(new Brackets(qb2 => {
			qb2.andWhere('note.renoteId IN (SELECT "novel"."id" FROM "note" "novel" WHERE "novel"."isNovel" = TRUE)');
			qb2.andWhere('note.text IS NULL');
			qb2.andWhere('note.cw IS NULL');
			qb2.andWhere('note.replyId IS NULL');
			qb2.andWhere('note.hasPoll = FALSE');
			qb2.andWhere('note.fileIds = \'{}\'');
		}));
	}));
}

/**
 * DBから引いた投稿が、小説か小説の普通のリノートか(リノート元が読み込まれていること)
 */
export function isNovelOrNovelRenote(note: MiNote): boolean {
	if (note.isNovel) return true;
	return isRenote(note) && !isQuote(note) && note.renote?.isNovel === true;
}

/**
 * ストリームで届いた(packした)投稿が、小説か小説の普通のリノートか
 */
export function isNovelOrNovelRenotePacked(note: Packed<'Note'>): boolean {
	if (note.isNovel) return true;
	return isRenotePacked(note) && !isQuotePacked(note) && note.renote?.isNovel === true;
}
