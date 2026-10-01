/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { type Config, FulltextSearchProvider } from '@/config.js';
import { bindThis } from '@/decorators.js';
import { MiNote } from '@/models/Note.js';
import type { MiMeta, NotesRepository } from '@/models/_.js';
import { MiUser } from '@/models/_.js';
import { sqlLikeEscape } from '@/misc/sql-like-escape.js';
import { isUserRelated } from '@/misc/is-user-related.js';
import { CacheService } from '@/core/CacheService.js';
import { QueryService } from '@/core/QueryService.js';
import { IdService } from '@/core/IdService.js';
import { LoggerService } from '@/core/LoggerService.js';
import { ReactionService } from '@/core/ReactionService.js';
import type { Index, Meilisearch } from 'meilisearch';

// JUICE: ReactionService.tsの同名定数と同じ定義。カスタム絵文字リアクション(`:name:`/`:name@host:`)の
// 判定に使う。自分のリアクションを検索する際、カスタム絵文字はnormalize()を通さず文字列そのままで
// 照合する必要があるため(normalize()はUnicode絵文字専用で、カスタム絵文字を渡すとFALLBACKになってしまう)
const isCustomEmojiRegexp = /^:([\w+-]+)(?:@\.)?:$/;

type K = string;
type V = string | number | boolean;
type Q =
	{ op: '=', k: K, v: V } |
	{ op: '!=', k: K, v: V } |
	{ op: '>', k: K, v: number } |
	{ op: '<', k: K, v: number } |
	{ op: '>=', k: K, v: number } |
	{ op: '<=', k: K, v: number } |
	{ op: 'is null', k: K } |
	{ op: 'is not null', k: K } |
	{ op: 'and', qs: Q[] } |
	{ op: 'or', qs: Q[] } |
	{ op: 'not', q: Q };

export type SearchOpts = {
	userId?: MiNote['userId'] | null;
	channelId?: MiNote['channelId'] | null;
	host?: string | null;
	rangeStartAt?: number | null;
	rangeEndAt?: number | null;
	// JUICE: misskey-tempuraの検索拡張(高度な検索周りの追加 / 検索の拡張)からチェリーピック。
	// ただしtempura本家はテキスト本文の検索に`&@~`(PGroongaのクエリ構文演算子、ユーザー入力を
	// そのままクエリとしてパースするため`-`や`(`混じりの語で構文エラーになりうる)を使っており、
	// それはこのフォームでは既に`&@`ベースの安全な方式に置き換え済み(buildPgroongaKeywordClauses
	// 参照)なので、フィルタ部分(パラメータ化されており安全)のみ移植し、OR検索・除外ワードは
	// `&@`ベースのまま対応させている。
	visibility?: MiNote['visibility'] | 'all';
	hasFiles?: 'all' | 'with' | 'without';
	hasCw?: 'all' | 'with' | 'without';
	hasReply?: 'all' | 'with' | 'without';
	hasPoll?: 'all' | 'with' | 'without';
	searchOperator?: 'and' | 'or';
	excludeWords?: string[];
	// JUICE: 自分が付けたリアクションでノートを絞り込む。`'any'`で「何かしらリアクションした
	// ノート」全体、それ以外は特定のリアクション文字列との完全一致。プライバシー上、
	// 自分自身のリアクションのみを対象とする(他人のリアクションでの検索は不可)
	myReaction?: string | null;
	// JUICE: ノートの言語(BCP 47言語タグ)での絞り込み。完全一致のみ(部分一致は行わない)
	lang?: string | null;
};

export type SearchPagination = {
	untilId?: MiNote['id'];
	sinceId?: MiNote['id'];
	limit: number;
};

// JUICE: `&@~`(PGroongaのクエリ構文演算子)はユーザー入力をそのままクエリ構文としてパースするため、
// 単語に`-`や`(`等の記号が混ざっただけで構文エラーになりうる。単純な「含む」判定の`&@`演算子を
// キーワードごとにAND連結することで、構文パースを経由せず(=構文エラーが起きえない)従来通りの
// 複数キーワードAND検索を実現する。
// JUICE: 除外ワード(NOT句)にも同じ関数を使い回せるよう、パラメータ名のプレフィックスを引数化できる
// ようにしてある。本文検索節と除外節を同じプレフィックスで呼ぶとバインドパラメータ名が衝突し、
// 片方の値がもう片方を上書きしてしまう(実際に踏んだ不具合)ため、呼び出し側で必ず別々のプレフィックスを渡すこと。
export function buildPgroongaKeywordClauses(q: string, paramPrefix = 'pgroongaKeyword'): { sql: string, param: Record<string, string> }[] {
	return q.split(/\s+/)
		.filter(keyword => keyword.length > 0)
		.map((keyword, i) => ({
			sql: `note.text &@ :${paramPrefix}${i}`,
			param: { [`${paramPrefix}${i}`]: keyword },
		}));
}

function compileValue(value: V): string {
	if (typeof value === 'string') {
		return `'${value.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'')}'`;
	} else if (typeof value === 'number') {
		return value.toString();
	} else if (typeof value === 'boolean') {
		return value.toString();
	}
	throw new Error('unrecognized value');
}

function compileQuery(q: Q): string {
	switch (q.op) {
		case '=': return `(${q.k} = ${compileValue(q.v)})`;
		case '!=': return `(${q.k} != ${compileValue(q.v)})`;
		case '>': return `(${q.k} > ${compileValue(q.v)})`;
		case '<': return `(${q.k} < ${compileValue(q.v)})`;
		case '>=': return `(${q.k} >= ${compileValue(q.v)})`;
		case '<=': return `(${q.k} <= ${compileValue(q.v)})`;
		case 'and': return q.qs.length === 0 ? '' : `(${ q.qs.map(_q => compileQuery(_q)).join(' AND ') })`;
		case 'or': return q.qs.length === 0 ? '' : `(${ q.qs.map(_q => compileQuery(_q)).join(' OR ') })`;
		case 'is null': return `(${q.k} IS NULL)`;
		case 'is not null': return `(${q.k} IS NOT NULL)`;
		case 'not': return `(NOT ${compileQuery(q.q)})`;
		default: throw new Error('unrecognized query operator');
	}
}

@Injectable()
export class SearchService {
	private readonly meilisearchIndexScope: 'local' | 'global' | string[] = 'local';
	private readonly meilisearchNoteIndex: Index | null = null;
	private readonly provider: FulltextSearchProvider;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meilisearch)
		private meilisearch: Meilisearch | null,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		private cacheService: CacheService,
		private queryService: QueryService,
		private idService: IdService,
		private loggerService: LoggerService,
		private reactionService: ReactionService,

		@Inject(DI.meta)
		private meta: MiMeta,
	) {
		if (meilisearch) {
			this.meilisearchNoteIndex = meilisearch.index(`${config.meilisearch!.index}---notes`);
			this.meilisearchNoteIndex.updateSettings({
				searchableAttributes: [
					'text',
					'cw',
				],
				sortableAttributes: [
					'createdAt',
				],
				filterableAttributes: [
					'createdAt',
					'userId',
					'userHost',
					'channelId',
					'tags',
					'lang', // JUICE
				],
				typoTolerance: {
					enabled: false,
				},
				pagination: {
					maxTotalHits: 10000,
				},
			});
		}

		if (config.meilisearch?.scope) {
			this.meilisearchIndexScope = config.meilisearch.scope;
		}

		this.provider = config.fulltextSearch?.provider ?? 'sqlLike';
		this.loggerService.getLogger('SearchService').info(`-- Provider: ${this.provider}`);
	}

	@bindThis
	public async indexNote(note: MiNote): Promise<void> {
		if (!this.meilisearch) return;
		if (note.text == null && note.cw == null) return;
		if (!['home', 'public'].includes(note.visibility)) return;

		switch (this.meilisearchIndexScope) {
			case 'global':
				break;

			case 'local':
				if (note.userHost == null) break;
				return;

			default: {
				if (note.userHost == null) break;
				if (this.meilisearchIndexScope.includes(note.userHost)) break;
				return;
			}
		}

		await this.meilisearchNoteIndex?.addDocuments([{
			id: note.id,
			createdAt: this.idService.parse(note.id).date.getTime(),
			userId: note.userId,
			userHost: note.userHost,
			channelId: note.channelId,
			cw: note.cw,
			text: note.text,
			tags: note.tags,
			lang: note.lang, // JUICE
		}], {
			primaryKey: 'id',
		});
	}

	@bindThis
	public async unindexNote(note: MiNote): Promise<void> {
		if (!this.meilisearch) return;
		if (!['home', 'public'].includes(note.visibility)) return;

		await this.meilisearchNoteIndex?.deleteDocument(note.id);
	}

	@bindThis
	public async searchNote(
		q: string,
		me: MiUser | null,
		opts: SearchOpts,
		pagination: SearchPagination,
	): Promise<MiNote[]> {
		switch (this.provider) {
			case 'sqlLike':
			case 'sqlPgroonga': {
				// ほとんど内容に差がないのでsqlLikeとsqlPgroongaを同じ処理にしている.
				// 今後の拡張で差が出る用であれば関数を分ける.
				return this.searchNoteByLike(q, me, opts, pagination);
			}
			case 'meilisearch': {
				return this.searchNoteByMeilisearch(q, me, opts, pagination);
			}
			default: {
				const _: never = this.provider;
				return [];
			}
		}
	}

	@bindThis
	private async searchNoteByLike(
		q: string,
		me: MiUser | null,
		opts: SearchOpts,
		pagination: SearchPagination,
	): Promise<MiNote[]> {
		const query = this.queryService.makePaginationQuery(this.notesRepository.createQueryBuilder('note'), pagination.sinceId, pagination.untilId);

		if (opts.userId) {
			query.andWhere('note.userId = :userId', { userId: opts.userId });
		} else if (opts.channelId) {
			query.andWhere('note.channelId = :channelId', { channelId: opts.channelId });
		}

		// JUICE: misskey-tempuraからチェリーピック。いずれもパラメータ化されており安全
		if (opts.visibility && opts.visibility !== 'all') {
			query.andWhere('note.visibility = :visibility', { visibility: opts.visibility });
		}

		if (opts.hasFiles === 'with') {
			query.andWhere('array_length(note."fileIds", 1) > 0');
		} else if (opts.hasFiles === 'without') {
			query.andWhere('note."fileIds" = :fileIds', { fileIds: [] });
		}

		if (opts.hasCw === 'with') {
			query.andWhere('note.cw IS NOT NULL AND note.cw != :emptyString', { emptyString: '' });
		} else if (opts.hasCw === 'without') {
			query.andWhere('(note.cw IS NULL OR note.cw = :emptyString)', { emptyString: '' });
		}

		if (opts.hasReply === 'with') {
			query.andWhere('note."replyId" IS NOT NULL');
		} else if (opts.hasReply === 'without') {
			query.andWhere('note."replyId" IS NULL');
		}

		if (opts.hasPoll === 'with') {
			query.andWhere('note."hasPoll" = TRUE');
		} else if (opts.hasPoll === 'without') {
			query.andWhere('note."hasPoll" = FALSE');
		}

		// JUICE: ノートの言語(BCP 47言語タグ)での絞り込み。完全一致のみ
		if (opts.lang) {
			query.andWhere('note.lang = :lang', { lang: opts.lang });
		}

		// JUICE: 自分が付けたリアクションでノートを絞り込む(プロジェクト項目「付けたリアクションで
		// ノートを検索できるようにする」)。プライバシー上、自分自身のリアクションのみが対象
		if (opts.myReaction) {
			if (me == null) {
				query.andWhere('1=0');
			} else {
				query.innerJoin('note_reaction', 'my_reaction', 'my_reaction."noteId" = note.id');
				query.andWhere('my_reaction."userId" = :myReactionUserId', { myReactionUserId: me.id });
				if (opts.myReaction !== 'any') {
					// JUICE: カスタム絵文字は`:name:`/`:name@.:`のどちらの形式で来ても`name`部分だけを
					// 取り出し、ローカルユーザー(=自分)がリアクションした際に実際に保存される形式
					// (`:name:`、ホスト無し)に正規化してから比較する。ReactionService.create()も
					// 同じ正規表現でカスタム絵文字判定をした上で、実際の保存形式はリアクションした
					// 本人(=自分)のホストだけで決まる(絵文字自体の出身ホストは無関係)ため、常に
					// ローカル形式に揃えるのが正しい
					const customMatch = opts.myReaction.match(isCustomEmojiRegexp);
					const reactionValue = customMatch ? `:${customMatch[1]}:` : this.reactionService.normalize(opts.myReaction);
					query.andWhere('my_reaction.reaction = :myReactionValue', { myReactionValue: reactionValue });
				}
			}
		}

		query
			.innerJoinAndSelect('note.user', 'user')
			.leftJoinAndSelect('note.reply', 'reply')
			.leftJoinAndSelect('note.renote', 'renote')
			.leftJoinAndSelect('reply.user', 'replyUser')
			.leftJoinAndSelect('renote.user', 'renoteUser');

		const excludeWords = (opts.excludeWords ?? []).filter(word => word.trim().length > 0);

		if (this.config.fulltextSearch?.provider === 'sqlPgroonga') {
			const pgroongaClauses = buildPgroongaKeywordClauses(q);
			// JUICE: `q`が意図的な空文字(フィルタのみでの検索)の場合は、本文条件を付けずに
			// 他のフィルタ(hasCw/visibility等)だけで絞り込ませる。`q`が空白のみ等で実質的な
			// キーワードが1つも得られなかった(かつ除外ワードも無い)場合のみ、検索条件が
			// 何も無いとみなして0件にする
			if (q !== '' && pgroongaClauses.length === 0 && excludeWords.length === 0) {
				query.andWhere('1=0');
			} else {
				if (pgroongaClauses.length > 0) {
					// JUICE: OR検索時は`&@`キーワード節をORで束ねる。個々の節は引き続き
					// パラメータバインドのみでクエリ構文を経由しないため安全
					if (opts.searchOperator === 'or') {
						const sql = pgroongaClauses.map(clause => clause.sql).join(' OR ');
						const params = Object.assign({}, ...pgroongaClauses.map(clause => clause.param));
						query.andWhere(`(${sql})`, params);
					} else {
						for (const clause of pgroongaClauses) {
							query.andWhere(clause.sql, clause.param);
						}
					}
				}
				// JUICE: 本文検索節と同じパラメータ名プレフィックスを使うと、TypeORMの
				// バインドパラメータが衝突して片方の値がもう片方を上書きしてしまうため、
				// 除外ワード側は別プレフィックスを使う
				for (const clause of buildPgroongaKeywordClauses(excludeWords.join(' '), 'pgroongaExcludeKeyword')) {
					query.andWhere(`NOT (${clause.sql})`, clause.param);
				}
			}
		} else if (q !== '' || excludeWords.length > 0) {
			if (q !== '') {
				const keywords = q.split(/\s+/).filter(keyword => keyword.length > 0);
				if (opts.searchOperator === 'or' && keywords.length > 0) {
					const params: Record<string, string> = {};
					const sql = keywords.map((keyword, i) => {
						params[`likeKeyword${i}`] = `%${sqlLikeEscape(keyword.toLowerCase())}%`;
						return `LOWER(note.text) LIKE :likeKeyword${i}`;
					}).join(' OR ');
					query.andWhere(`(${sql})`, params);
				} else {
					query.andWhere('LOWER(note.text) LIKE :q', { q: `%${ sqlLikeEscape(q.toLowerCase()) }%` });
				}
			}
			excludeWords.forEach((word, i) => {
				query.andWhere(`LOWER(note.text) NOT LIKE :excludeLikeKeyword${i}`, { [`excludeLikeKeyword${i}`]: `%${sqlLikeEscape(word.toLowerCase())}%` });
			});
		}

		if (opts.host) {
			if (opts.host === '.') {
				query.andWhere('note.userHost IS NULL');
			} else {
				query.andWhere('note.userHost = :host', { host: opts.host });
			}
		}

		if (opts.rangeStartAt != null) {
			const date = this.idService.gen(opts.rangeStartAt - 1);
			query.andWhere('note.id > :rangeStartAt', { rangeStartAt: date });
		}

		if (opts.rangeEndAt != null) {
			const date = this.idService.gen(opts.rangeEndAt + 1);
			query.andWhere('note.id < :rangeEndAt', { rangeEndAt: date });
		}

		this.queryService.generateVisibilityQuery(query, me);
		if (me == null) this.queryService.generateUgcVisibilityQueryForVisitor(query);
		this.queryService.generateBaseNoteFilteringQuery(query, me);

		return query.limit(pagination.limit).getMany();
	}

	@bindThis
	private async searchNoteByMeilisearch(
		q: string,
		me: MiUser | null,
		opts: SearchOpts,
		pagination: SearchPagination,
	): Promise<MiNote[]> {
		if (!this.meilisearch || !this.meilisearchNoteIndex) {
			throw new Error('Meilisearch is not available');
		}

		const filter: Q = {
			op: 'and',
			qs: [],
		};
		if (pagination.untilId) filter.qs.push({
			op: '<',
			k: 'createdAt',
			v: this.idService.parse(pagination.untilId).date.getTime(),
		});
		if (opts.rangeEndAt) filter.qs.push({
			op: '<=',
			k: 'createdAt',
			v: opts.rangeEndAt,
		});
		if (pagination.sinceId) filter.qs.push({
			op: '>',
			k: 'createdAt',
			v: this.idService.parse(pagination.sinceId).date.getTime(),
		});
		if (opts.rangeStartAt) filter.qs.push({
			op: '>=',
			k: 'createdAt',
			v: opts.rangeStartAt,
		});
		if (opts.userId) filter.qs.push({ op: '=', k: 'userId', v: opts.userId });
		if (opts.channelId) filter.qs.push({ op: '=', k: 'channelId', v: opts.channelId });
		if (opts.host) {
			if (opts.host === '.') {
				filter.qs.push({ op: 'is null', k: 'userHost' });
			} else {
				filter.qs.push({ op: '=', k: 'userHost', v: opts.host });
			}
		}
		// JUICE: ノートの言語(BCP 47言語タグ)での絞り込み。完全一致のみ
		if (opts.lang) filter.qs.push({ op: '=', k: 'lang', v: opts.lang });
		if (me == null) {
			if (this.meta.ugcVisibilityForVisitor === 'none') return [];
			if (this.meta.ugcVisibilityForVisitor === 'local') filter.qs.push({ op: 'is null', k: 'userHost' });
		}

		const res = await this.meilisearchNoteIndex.search(q, {
			sort: ['createdAt:desc'],
			matchingStrategy: 'all',
			attributesToRetrieve: ['id', 'createdAt'],
			filter: compileQuery(filter),
			limit: pagination.limit,
		});
		if (res.hits.length === 0) {
			return [];
		}

		const [
			userIdsWhoMeMuting,
			userIdsWhoBlockingMe,
		] = me
			? await Promise.all([
				this.cacheService.userMutingsCache.fetch(me.id),
				this.cacheService.userBlockedCache.fetch(me.id),
			])
			: [new Set<string>(), new Set<string>()];

		const query = this.notesRepository.createQueryBuilder('note')
			.innerJoinAndSelect('note.user', 'user')
			.leftJoinAndSelect('note.reply', 'reply')
			.leftJoinAndSelect('note.renote', 'renote')
			.leftJoinAndSelect('reply.user', 'replyUser')
			.leftJoinAndSelect('renote.user', 'renoteUser');

		query.where('note.id IN (:...noteIds)', { noteIds: res.hits.map(x => x.id) });

		this.queryService.generateBlockedHostQueryForNote(query);
		this.queryService.generateSuspendedUserQueryForNote(query);

		const notes = (await query.getMany()).filter(note => {
			if (me && isUserRelated(note, userIdsWhoBlockingMe)) return false;
			if (me && isUserRelated(note, userIdsWhoMeMuting)) return false;
			return true;
		});

		return notes.sort((a, b) => a.id > b.id ? -1 : 1);
	}
}
