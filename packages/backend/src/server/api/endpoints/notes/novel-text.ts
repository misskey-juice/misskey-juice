/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { GetterService } from '@/server/api/GetterService.js';
import { InternalStorageService } from '@/core/InternalStorageService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { DI } from '@/di-symbols.js';
import type { MiMeta } from '@/models/Meta.js';
import type { DriveFilesRepository } from '@/models/_.js';
import { pickNovelTextFile } from '@/misc/novel-text-file.js';
import { ApiError } from '../../error.js';

// JUICE: 小説の投稿に添付されたtxtの本文を返す(小説ビューワー用)。投稿者がダウンロードさせないことにしたtxtは、
// ほかの人にはファイルのURLを渡さないので、本文はここから読む。ノートを見られる人だけが読める
export const meta = {
	tags: ['notes'],

	requireCredential: false,

	res: {
		type: 'object',
		optional: false, nullable: false,
		properties: {
			name: {
				type: 'string',
				optional: false, nullable: false,
			},
			// ファイルの中身をbase64にしたもの(文字コードは受け取った側で判定する)
			data: {
				type: 'string',
				optional: false, nullable: false,
			},
		},
	},

	errors: {
		noSuchNote: {
			message: 'No such note.',
			code: 'NO_SUCH_NOTE',
			id: '30538e58-d6fa-437e-8715-71c7be73c609',
		},
		noNovelText: {
			message: 'This note has no novel text file.',
			code: 'NO_NOVEL_TEXT',
			id: 'f655a42b-d9dd-455c-9672-bb843bdf3494',
		},
		contentRestrictedByUser: {
			message: 'Content restricted by user. Please sign in to view.',
			code: 'CONTENT_RESTRICTED_BY_USER',
			id: '33c07b4e-a65f-43de-b328-4d22805820a2',
		},
		contentRestrictedByServer: {
			message: 'Content restricted by server settings. Please sign in to view.',
			code: 'CONTENT_RESTRICTED_BY_SERVER',
			id: 'fccb0a11-0ba8-4b43-88c5-bba2c31b1a69',
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		noteId: { type: 'string', format: 'misskey:id' },
	},
	required: ['noteId'],
} as const;

// 読み込むファイルの大きさの上限(小説のtxtとしては十分に大きい)
const MAX_NOVEL_TEXT_BYTES = 32 * 1024 * 1024;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.meta)
		private serverSettings: MiMeta,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		private noteEntityService: NoteEntityService,
		private getterService: GetterService,
		private internalStorageService: InternalStorageService,
		private httpRequestService: HttpRequestService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.getterService.getNoteWithRelations(ps.noteId).catch(err => {
				if (err.id === '9725d0ce-ba28-4dde-95a7-2cbb2c15de24') throw new ApiError(meta.errors.noSuchNote);
				throw err;
			});

			// notes/showと同じく、ログインしていない人に見せない設定を守る
			if (note.user!.requireSigninToViewContents && me == null) throw new ApiError(meta.errors.contentRestrictedByUser);
			if (this.serverSettings.ugcVisibilityForVisitor === 'none' && me == null) throw new ApiError(meta.errors.contentRestrictedByServer);
			if (this.serverSettings.ugcVisibilityForVisitor === 'local' && note.userHost != null && me == null) throw new ApiError(meta.errors.contentRestrictedByServer);

			// 公開範囲などで見られないノートは、見られないノートとして扱う
			const packed = await this.noteEntityService.pack(note, me, { detail: false });
			if (packed.isHidden) throw new ApiError(meta.errors.noSuchNote);

			if (!note.isNovel || note.fileIds.length === 0) throw new ApiError(meta.errors.noNovelText);
			const files = await this.driveFilesRepository.findBy({ id: In(note.fileIds) });
			const ordered = note.fileIds.map(id => files.find(file => file.id === id)).filter(file => file != null);
			const file = pickNovelTextFile(ordered);
			if (file == null || file.size > MAX_NOVEL_TEXT_BYTES) throw new ApiError(meta.errors.noNovelText);

			let data: Buffer;
			if (file.storedInternal && file.accessKey != null) {
				const chunks: Buffer[] = [];
				for await (const chunk of this.internalStorageService.read(file.accessKey)) chunks.push(chunk as Buffer);
				data = Buffer.concat(chunks);
			} else {
				const res = await this.httpRequestService.send(file.url, { timeout: 30 * 1000, size: MAX_NOVEL_TEXT_BYTES });
				data = Buffer.from(await res.arrayBuffer());
			}

			return { name: file.name, data: data.toString('base64') };
		});
	}
}
