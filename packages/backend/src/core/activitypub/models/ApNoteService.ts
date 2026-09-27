/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { PollsRepository, EmojisRepository, MiMeta, NotesRepository, UserProfilesRepository } from '@/models/_.js';
import type { IMentionedRemoteUsers } from '@/models/Note.js';
import type { Config } from '@/config.js';
import type { MiRemoteUser } from '@/models/User.js';
import type { MiNote } from '@/models/Note.js';
import { acquireApObjectLock } from '@/misc/distributed-lock.js';
import { toArray, toSingle, unique } from '@/misc/prelude/array.js';
import type { MiEmoji } from '@/models/Emoji.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import { NoteCreateService } from '@/core/NoteCreateService.js';
import type Logger from '@/logger.js';
import { IdService } from '@/core/IdService.js';
import { PollService } from '@/core/PollService.js';
import { StatusError } from '@/misc/status-error.js';
import { UtilityService } from '@/core/UtilityService.js';
import { bindThis } from '@/decorators.js';
import { checkHttps } from '@/misc/check-https.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { SearchService } from '@/core/SearchService.js';
import { normalizeForSearch } from '@/misc/normalize-for-search.js';
import { getOneApId, getApId, getOneApHrefNullable, validPost, isEmoji, getApType } from '../type.js';
import { ApLoggerService } from '../ApLoggerService.js';
import { ApMfmService } from '../ApMfmService.js';
import { ApDbResolverService } from '../ApDbResolverService.js';
import { ApResolverService } from '../ApResolverService.js';
import { ApAudienceService } from '../ApAudienceService.js';
import { ApPersonService } from './ApPersonService.js';
import { extractApHashtags } from './tag.js';
import { ApMentionService } from './ApMentionService.js';
import { ApQuestionService } from './ApQuestionService.js';
import { ApImageService } from './ApImageService.js';
import type { Resolver } from '../ApResolverService.js';
import type { IObject, IPost } from '../type.js';

@Injectable()
export class ApNoteService {
	private logger: Logger;

	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.pollsRepository)
		private pollsRepository: PollsRepository,

		@Inject(DI.emojisRepository)
		private emojisRepository: EmojisRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		private idService: IdService,
		private apMfmService: ApMfmService,
		private apResolverService: ApResolverService,

		// 循環参照のため / for circular dependency
		@Inject(forwardRef(() => ApPersonService))
		private apPersonService: ApPersonService,

		private utilityService: UtilityService,
		private apAudienceService: ApAudienceService,
		private apMentionService: ApMentionService,
		private apImageService: ApImageService,
		private apQuestionService: ApQuestionService,
		private pollService: PollService,
		private noteCreateService: NoteCreateService,
		private apDbResolverService: ApDbResolverService,
		private apLoggerService: ApLoggerService,
		private globalEventService: GlobalEventService,
		private noteEntityService: NoteEntityService,
		private searchService: SearchService,
	) {
		this.logger = this.apLoggerService.logger;
	}

	@bindThis
	public validateNote(object: IObject, uri: string, actor?: MiRemoteUser): Error | null {
		const expectHost = this.utilityService.extractDbHost(uri);
		const apType = getApType(object);

		if (apType == null || !validPost.includes(apType)) {
			return new IdentifiableError('d450b8a9-48e4-4dab-ae36-f4db763fda7c', `invalid Note: invalid object type ${apType ?? 'undefined'}`);
		}

		if (object.id && this.utilityService.extractDbHost(object.id) !== expectHost) {
			return new IdentifiableError('d450b8a9-48e4-4dab-ae36-f4db763fda7c', `invalid Note: id has different host. expected: ${expectHost}, actual: ${this.utilityService.extractDbHost(object.id)}`);
		}

		const actualHost = object.attributedTo && this.utilityService.extractDbHost(getOneApId(object.attributedTo));
		if (object.attributedTo && actualHost !== expectHost) {
			return new IdentifiableError('d450b8a9-48e4-4dab-ae36-f4db763fda7c', `invalid Note: attributedTo has different host. expected: ${expectHost}, actual: ${actualHost}`);
		}

		if (object.published && !this.idService.isSafeT(new Date(object.published).valueOf())) {
			return new IdentifiableError('d450b8a9-48e4-4dab-ae36-f4db763fda7c', 'invalid Note: published timestamp is malformed');
		}

		if (actor) {
			const attribution = (object.attributedTo) ? getOneApId(object.attributedTo) : actor.uri;

			if (attribution !== actor.uri) {
				return new IdentifiableError('d450b8a9-48e4-4dab-ae36-f4db763fda7c', `invalid Note: attribution does not match the actor that send it. attribution: ${attribution}, actor: ${actor.uri}`);
			}
		}

		return null;
	}

	/**
	 * Noteをフェッチします。
	 *
	 * Misskeyに対象のNoteが登録されていればそれを返します。
	 */
	@bindThis
	public async fetchNote(object: string | IObject): Promise<MiNote | null> {
		return await this.apDbResolverService.getNoteFromApId(object);
	}

	/**
	 * Noteを作成します。
	 */
	@bindThis
	public async createNote(value: string | IObject, actor?: MiRemoteUser, resolver?: Resolver, silent = false): Promise<MiNote | null> {
		// eslint-disable-next-line no-param-reassign
		if (resolver == null) resolver = await this.apResolverService.createResolver();

		const object = await resolver.resolve(value);

		const entryUri = getApId(value);
		const err = this.validateNote(object, entryUri, actor);
		if (err) {
			this.logger.error(err.message, {
				resolver: { history: resolver.getHistory() },
				value,
				object,
			});
			throw err;
		}

		const note = object as IPost;

		this.logger.debug(`Note fetched: ${JSON.stringify(note, null, 2)}`);

		if (note.id == null) {
			throw new Error('Refusing to create note without id');
		}

		if (!checkHttps(note.id)) {
			throw new Error('unexpected schema of note.id: ' + note.id);
		}

		const url = getOneApHrefNullable(note.url);

		if (url && !checkHttps(url)) {
			throw new Error('unexpected schema of note url: ' + url);
		}

		this.logger.info(`Creating the Note: ${note.id}`);

		// 投稿者をフェッチ
		if (note.attributedTo == null) {
			throw new Error('invalid note.attributedTo: ' + note.attributedTo);
		}

		const uri = getOneApId(note.attributedTo);

		// ローカルで投稿者を検索し、もし凍結されていたらスキップ
		// eslint-disable-next-line no-param-reassign
		actor ??= await this.apPersonService.fetchPerson(uri) as MiRemoteUser | undefined;
		if (actor && actor.isSuspended) {
			throw new IdentifiableError('85ab9bd7-3a41-4530-959d-f07073900109', 'actor has been suspended');
		}

		const apMentionRawCount = new Set(this.apMentionService.extractApMentionObjects(note.tag).map(x => x.href)).size;
		const apMentions = await this.apMentionService.extractApMentions(note.tag, resolver);
		const apHashtags = extractApHashtags(note.tag);

		const { cw, text, lang } = this.parseNoteContent(note);

		const poll = await this.apQuestionService.extractPollFromQuestion(note, resolver).catch(() => undefined);

		//#region Contents Check
		// 添付ファイルとユーザーをこのサーバーで登録する前に内容をチェックする
		/**
		 * 禁止ワードチェック
		 */
		const hasProhibitedWords = this.noteCreateService.checkProhibitedWordsContain({ cw, text, pollChoices: poll?.choices });
		if (hasProhibitedWords) {
			throw new IdentifiableError('689ee33f-f97c-479a-ac49-1b9f8140af99', 'Note contains prohibited words');
		}
		//#endregion

		// eslint-disable-next-line no-param-reassign
		actor ??= await this.apPersonService.resolvePerson(uri, resolver) as MiRemoteUser;

		// 解決した投稿者が凍結されていたらスキップ
		if (actor.isSuspended) {
			throw new IdentifiableError('85ab9bd7-3a41-4530-959d-f07073900109', 'actor has been suspended');
		}

		const noteAudience = await this.apAudienceService.parseAudience(actor, note.to, note.cc, resolver);
		let visibility = noteAudience.visibility;
		const visibleUsers = noteAudience.visibleUsers;

		// Audience (to, cc) が指定されてなかった場合
		if (visibility === 'specified' && visibleUsers.length === 0) {
			if (typeof value === 'string') {	// 入力がstringならばresolverでGETが発生している
				// こちらから匿名GET出来たものならばpublic
				visibility = 'public';
			}
		}

		// 添付ファイル
		const files: MiDriveFile[] = [];

		for (const attach of toArray(note.attachment)) {
			attach.sensitive ??= note.sensitive;
			const file = await this.apImageService.resolveImage(actor, attach);
			if (file) files.push(file);
		}

		// リプライ
		const reply: MiNote | null = note.inReplyTo
			? await this.resolveNote(note.inReplyTo, { resolver })
				.then(x => {
					if (x == null) {
						this.logger.warn('Specified inReplyTo, but not found');
						throw new Error('inReplyTo not found');
					}

					return x;
				})
				.catch(async err => {
					this.logger.warn(`Error in inReplyTo ${note.inReplyTo} - ${err.statusCode ?? err}`);
					throw err;
				})
			: null;

		// 引用
		let quote: MiNote | undefined | null = null;

		if (note._misskey_quote ?? note.quoteUrl) {
			const tryResolveNote = async (uri: string): Promise<
				| { status: 'ok'; res: MiNote }
				| { status: 'permerror' | 'temperror' }
			> => {
				if (!/^https?:/.test(uri)) return { status: 'permerror' };
				try {
					const res = await this.resolveNote(uri);
					if (res == null) return { status: 'permerror' };
					return { status: 'ok', res };
				} catch (e) {
					return {
						status: (e instanceof StatusError && !e.isRetryable) ? 'permerror' : 'temperror',
					};
				}
			};

			const uris = unique([note._misskey_quote, note.quoteUrl].filter(x => x != null));
			const results = await Promise.all(uris.map(tryResolveNote));

			quote = results.filter((x): x is { status: 'ok', res: MiNote } => x.status === 'ok').map(x => x.res).at(0);
			if (!quote) {
				if (results.some(x => x.status === 'temperror')) {
					throw new Error('quote resolve failed');
				}
			}
		}

		// vote
		if (reply && reply.hasPoll) {
			const poll = await this.pollsRepository.findOneByOrFail({ noteId: reply.id });

			const tryCreateVote = async (name: string, index: number): Promise<null> => {
				if (poll.expiresAt && Date.now() > new Date(poll.expiresAt).getTime()) {
					this.logger.warn(`vote to expired poll from AP: actor=${actor.username}@${actor.host}, note=${note.id}, choice=${name}`);
				} else if (index >= 0) {
					this.logger.info(`vote from AP: actor=${actor.username}@${actor.host}, note=${note.id}, choice=${name}`);
					await this.pollService.vote(actor, reply, index);

					// リモートフォロワーにUpdate配信
					this.pollService.deliverQuestionUpdate(reply.id);
				}
				return null;
			};

			if (note.name) {
				return await tryCreateVote(note.name, poll.choices.findIndex(x => x === note.name));
			}
		}

		const emojis = await this.extractEmojis(note.tag ?? [], actor.host).catch(e => {
			this.logger.info(`extractEmojis: ${e}`);
			return [];
		});

		const apEmojis = emojis.map(emoji => emoji.name);

		try {
			return await this.noteCreateService.create(actor, {
				createdAt: note.published ? new Date(note.published) : null,
				files,
				reply,
				renote: quote,
				name: note.name,
				cw,
				lang,
				text,
				localOnly: false,
				isAIGenerated: !!note._juice_isAIGenerated, // JUICE
				isNovel: !!note._juice_isNovel, // JUICE
				visibility,
				visibleUsers,
				apMentions,
				apMentionRawCount,
				apHashtags,
				apEmojis,
				poll,
				uri: note.id,
				url: url,
			}, silent);
		} catch (err: any) {
			if (err.name !== 'duplicated') {
				throw err;
			}
			this.logger.info('The note is already inserted while creating itself, reading again');
			const duplicate = await this.fetchNote(value);
			if (!duplicate) {
				throw new Error('The note creation failed with duplication error even when there is no duplication');
			}
			return duplicate;
		}
	}

	/**
	 * JUICE: リモートで編集された投稿(ActivityPubのUpdate)を反映する。
	 * - このサーバーに既にある、送ってきた本人の投稿だけを更新する(知らない投稿は作らない)
	 * - 本文・CW・言語・添付ファイル・カスタム絵文字・メンション・ハッシュタグ・JUICEのフラグを差し替える。
	 *   公開範囲・返信先・引用は変えない(Mastodon等でも編集では変わらない)
	 * - 編集日時(updated)が今の編集日時より新しいときだけ反映する(遅れて届いた古い編集で戻さないように)
	 */
	@bindThis
	public async updateNote(value: IObject, actor: MiRemoteUser, resolver: Resolver): Promise<string> {
		const uri = getApId(value);
		const exists = await this.fetchNote(uri);
		if (exists == null) return 'skip: note not found';
		if (exists.userId !== actor.id) return 'skip: actor is not the author';

		const err = this.validateNote(value, uri, actor);
		if (err) return `skip: ${err.message}`;

		const note = value as IPost;
		const updatedAt = note.updated != null ? new Date(note.updated) : null;
		// 編集日時の無いUpdateは、編集ではない(アンケートの集計の更新など)
		if (updatedAt == null || Number.isNaN(updatedAt.getTime())) return 'skip: not an edit (no updated)';
		// 未来の日時で、以後の編集を受け付けなくされないよう、今より先は今にする
		const editedAt = updatedAt.getTime() > Date.now() ? new Date() : updatedAt;
		if (exists.updatedAt != null && editedAt.getTime() <= exists.updatedAt.getTime()) return 'skip: older or same edit';

		const { cw, text, lang } = this.parseNoteContent(note);
		if (this.noteCreateService.checkProhibitedWordsContain({ cw, text })) {
			return 'skip: note contains prohibited words';
		}

		const files: MiDriveFile[] = [];
		for (const attach of toArray(note.attachment)) {
			attach.sensitive ??= note.sensitive;
			const file = await this.apImageService.resolveImage(actor, attach);
			if (file) files.push(file);
		}

		const emojis = await this.extractEmojis(note.tag ?? [], actor.host).catch(e => {
			this.logger.info(`extractEmojis: ${e}`);
			return [];
		});
		const mentionedUsers = await this.apMentionService.extractApMentions(note.tag, resolver);
		const tags = extractApHashtags(note.tag).map(tag => normalizeForSearch(tag));

		// メンションしたリモートの人(本文のリンクを表示するため)。NoteCreateServiceの作成時と同じ形
		const profiles = mentionedUsers.length > 0 ? await this.userProfilesRepository.findBy({ userId: In(mentionedUsers.map(u => u.id)) }) : [];
		const mentionedRemoteUsers: IMentionedRemoteUsers = mentionedUsers.filter(u => u.host != null).map(u => ({
			uri: u.uri!,
			url: profiles.find(p => p.userId === u.id)?.url ?? undefined,
			username: u.username,
			host: u.host!,
		}));

		await this.notesRepository.update(exists.id, {
			text,
			cw,
			lang,
			fileIds: files.map(file => file.id),
			attachedFileTypes: files.map(file => file.type),
			emojis: emojis.map(emoji => emoji.name),
			tags,
			mentions: mentionedUsers.map(u => u.id),
			mentionedRemoteUsers: JSON.stringify(mentionedRemoteUsers),
			isAIGenerated: !!note._juice_isAIGenerated,
			isNovel: !!note._juice_isNovel,
			updatedAt: editedAt,
		});

		const updated = await this.notesRepository.findOneByOrFail({ id: exists.id });
		// 検索の索引も差し替える(全文検索のエンジンを使っている場合)
		await this.searchService.unindexNote(exists).catch(() => {});
		await this.searchService.indexNote(updated).catch(() => {});

		// 開いている人の画面の表示を差し替える(見られるかは配るときに確かめている)
		const packed = await this.noteEntityService.pack(updated, null, { skipHide: true });
		this.globalEventService.publishNoteStream(updated, 'edited', {
			text: packed.text,
			cw: packed.cw,
			lang: packed.lang,
			fileIds: packed.fileIds,
			files: packed.files,
			emojis: packed.emojis,
			tags: packed.tags,
			mentions: packed.mentions,
			isAIGenerated: packed.isAIGenerated,
			isNovel: packed.isNovel,
			updatedAt: packed.updatedAt,
		});

		return 'ok: Note updated';
	}

	/**
	 * JUICE: 投稿のCW・本文・言語を読み取る(作成時と、編集されたときの両方で使う)
	 */
	@bindThis
	private parseNoteContent(note: IPost): { cw: string | null; text: string | null; lang: string | null } {
		// JUICE: _juice_summaryIsAIGeneratedFallback(またはisNovel版)が立っている場合、summaryは
		// 著者が設定した本来のCWそのものではなく、_juice_isAIGenerated/_juice_isNovelを解釈できない
		// 非JUICE実装向けに送信側が合成した文言(フォールバック文言単独、または「フォールバック文言 |
		// 元のCW」、ApRendererService参照)。受信側はJUICEとして_juice_isAIGenerated/_juice_isNovel
		// (下記)を直接解釈できるため、このsummaryをそのままローカルのCWとして採用せず、
		// _juice_originalCw(著者が実際に設定していた本来のCW、無ければnull)から復元する
		const cw = (note._juice_summaryIsAIGeneratedFallback || note._juice_summaryIsNovelFallback)
			? (note._juice_originalCw ?? null)
			: (note.summary === '' ? null : note.summary);

		// テキストのパース
		let text: string | null = null;
		if (note.source?.mediaType === 'text/x.misskeymarkdown' && typeof note.source.content === 'string') {
			text = note.source.content;
		} else if (typeof note._misskey_content !== 'undefined') {
			text = note._misskey_content;
		} else if (typeof note.content === 'string') {
			text = this.apMfmService.htmlToMfm(note.content, note.tag);
		}

		// JUICE: ノートの言語(BCP 47言語タグ)。JUICE間連合では_juice_lang(送信側のnote.langを
		// リージョン等そのまま保持したもの)を優先し、無ければAS2標準のcontentMapのキーから取得する
		// (Mastodon/Akkoma互換。ただしMastodon側はcontentMap送出時にリージョンを主言語サブタグへ
		// 切り詰めているため、こちらは切り詰め後の値になる)。複数言語が指定されていた場合は
		// contentMapの先頭の1つのみを採用する。指定が無ければnull(未タグ付け扱い)
		// リモートから届く値は信用できないため、DBカラム長(varchar(32))を超える・空文字の場合は
		// 不正な値として扱い、タグ付け自体を諦める(insertエラーで受信処理全体を失敗させないため)
		const contentMapLang = note.contentMap && typeof note.contentMap === 'object'
			? Object.keys(note.contentMap)[0]
			: undefined;
		const rawLang = typeof note._juice_lang === 'string' ? note._juice_lang : contentMapLang;
		const lang = rawLang && rawLang.length > 0 && rawLang.length <= 32
			? rawLang
			: null;

		return { cw: cw ?? null, text, lang };
	}

	/**
	 * Noteを解決します。
	 *
	 * Misskeyに対象のNoteが登録されていればそれを返し、そうでなければ
	 * リモートサーバーからフェッチしてMisskeyに登録しそれを返します。
	 */
	@bindThis
	public async resolveNote(value: string | IObject, options: { sentFrom?: URL, resolver?: Resolver } = {}): Promise<MiNote | null> {
		const uri = getApId(value);

		if (!this.utilityService.isFederationAllowedUri(uri)) {
			throw new StatusError('blocked host', 451);
		}

		const unlock = await acquireApObjectLock(this.redisClient, uri);

		try {
			//#region このサーバーに既に登録されていたらそれを返す
			const exist = await this.fetchNote(uri);
			if (exist) return exist;
			//#endregion

			if (this.utilityService.isUriLocal(uri)) {
				throw new StatusError('cannot resolve local note', 400, 'cannot resolve local note');
			}

			// リモートサーバーからフェッチしてきて登録
			// ここでuriの代わりに添付されてきたNote Objectが指定されていると、サーバーフェッチを経ずにノートが生成されるが
			// 添付されてきたNote Objectは偽装されている可能性があるため、常にuriを指定してサーバーフェッチを行う。
			const createFrom = options.sentFrom?.origin === new URL(uri).origin ? value : uri;
			return await this.createNote(createFrom, undefined, options.resolver, true);
		} finally {
			unlock();
		}
	}

	@bindThis
	public async extractEmojis(tags: IObject | IObject[], host: string): Promise<MiEmoji[]> {
		// eslint-disable-next-line no-param-reassign
		host = this.utilityService.toPuny(host);

		const eomjiTags = toArray(tags).filter(isEmoji);

		const existingEmojis = await this.emojisRepository.findBy({
			host,
			name: In(eomjiTags.map(tag => tag.name.replaceAll(':', ''))),
		});

		return await Promise.all(eomjiTags.map(async tag => {
			const name = tag.name.replaceAll(':', '');
			tag.icon = toSingle(tag.icon);

			const exists = existingEmojis.find(x => x.name === name);

			if (exists) {
				if ((exists.updatedAt == null)
					|| (tag.id != null && exists.uri == null)
					|| (new Date(tag.updated) > exists.updatedAt)
					|| (tag.icon.url !== exists.originalUrl)
				) {
					await this.emojisRepository.update({
						host,
						name,
					}, {
						uri: tag.id,
						originalUrl: tag.icon.url,
						publicUrl: tag.icon.url,
						updatedAt: new Date(),
						// _misskey_license が存在しなければ `null`
						license: (tag._misskey_license?.freeText ?? null)
					});

					const emoji = await this.emojisRepository.findOneBy({ host, name });
					if (emoji == null) throw new Error('emoji update failed');
					return emoji;
				}

				return exists;
			}

			this.logger.info(`register emoji host=${host}, name=${name}`);

			return await this.emojisRepository.insertOne({
				id: this.idService.gen(),
				host,
				name,
				uri: tag.id,
				originalUrl: tag.icon.url,
				publicUrl: tag.icon.url,
				updatedAt: new Date(),
				aliases: [],
				// _misskey_license が存在しなければ `null`
				license: (tag._misskey_license?.freeText ?? null)
			});
		}));
	}
}
