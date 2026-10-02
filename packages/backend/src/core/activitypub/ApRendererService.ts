/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createPublicKey, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import * as mfm from 'mfm-js';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { MiPartialLocalUser, MiLocalUser, MiPartialRemoteUser, MiRemoteUser, MiUser } from '@/models/User.js';
import type { IMentionedRemoteUsers, MiNote } from '@/models/Note.js';
import type { MiBlocking } from '@/models/Blocking.js';
import type { MiRelay } from '@/models/Relay.js';
import type { MiDriveFile } from '@/models/DriveFile.js';
import type { MiNoteReaction } from '@/models/NoteReaction.js';
import type { MiEmoji } from '@/models/Emoji.js';
import type { MiPoll } from '@/models/Poll.js';
import type { MiPollVote } from '@/models/PollVote.js';
import { UserKeypairService } from '@/core/UserKeypairService.js';
import { MfmService } from '@/core/MfmService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { DriveFileEntityService } from '@/core/entities/DriveFileEntityService.js';
import type { MiUserKeypair } from '@/models/UserKeypair.js';
import type { UsersRepository, UserProfilesRepository, NotesRepository, DriveFilesRepository, PollsRepository, MiMeta, EmojisRepository } from '@/models/_.js';
import { bindThis } from '@/decorators.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { IdService } from '@/core/IdService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { JuiceSettingsService } from '@/core/JuiceSettingsService.js';
import { resolveAiGeneratedFallbackCwSettings, resolveNovelFallbackCwSettings } from '@/models/JuiceSettings.js';
import { canonicalizeLanguageTagForFederation } from '@/misc/is-language-filtered.js';
import { EmailI18nService } from '@/core/EmailI18nService.js';
import { escapeHtml } from '@/misc/escape-html.js';
import { JsonLdService } from './JsonLdService.js';
import { ApMfmService } from './ApMfmService.js';
import { CONTEXT } from './misc/contexts.js';
import { isNovelTextFile } from '@/misc/novel-text-file.js';
import type { IAccept, IActivity, IAdd, IAnnounce, IApDocument, IApEmoji, IApHashtag, IApImage, IApMention, IBlock, ICreate, IDelete, IFlag, IFollow, IKey, ILike, IMove, IObject, IPost, IQuestion, IReject, IRemove, ITombstone, IUndo, IUpdate } from './type.js';

// JUICE: ReactionService.decodeCustomEmojiRegexpと同一パターン
const decodeCustomEmojiRegexp = /^:([\w+-]+)(?:@([\w.-]+))?:$/;

// JUICE: 投稿の言語(BCP47。enやzh-Hantなど)を、文言のある言語(ja-JP・en-US・ko-KR・zh-CN・zh-TW)に寄せる。無ければ英語
function federationNoticeLang(lang: string): string {
	const lower = lang.toLowerCase();
	if (lower.startsWith('ja')) return 'ja-JP';
	if (lower.startsWith('ko')) return 'ko-KR';
	if (lower.startsWith('zh')) return /hant|tw|hk|mo/.test(lower) ? 'zh-TW' : 'zh-CN';
	return 'en-US';
}

@Injectable()
export class ApRendererService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userProfilesRepository)
		private userProfilesRepository: UserProfilesRepository,

		@Inject(DI.notesRepository)
		private notesRepository: NotesRepository,

		@Inject(DI.driveFilesRepository)
		private driveFilesRepository: DriveFilesRepository,

		@Inject(DI.pollsRepository)
		private pollsRepository: PollsRepository,

		@Inject(DI.emojisRepository)
		private emojisRepository: EmojisRepository,

		private customEmojiService: CustomEmojiService,
		private userEntityService: UserEntityService,
		private driveFileEntityService: DriveFileEntityService,
		private jsonLdService: JsonLdService,
		private userKeypairService: UserKeypairService,
		private apMfmService: ApMfmService,
		private mfmService: MfmService,
		private idService: IdService,
		private utilityService: UtilityService,
		private juiceSettingsService: JuiceSettingsService,
		private emailI18nService: EmailI18nService,
	) {
	}

	@bindThis
	public renderAccept(object: string | IObject, user: { id: MiUser['id']; host: null }): IAccept {
		return {
			type: 'Accept',
			actor: this.userEntityService.genLocalUserUri(user.id),
			object,
		};
	}

	@bindThis
	public renderAdd(user: MiLocalUser, target: string | IObject | undefined, object: string | IObject): IAdd {
		return {
			type: 'Add',
			actor: this.userEntityService.genLocalUserUri(user.id),
			target,
			object,
		};
	}

	@bindThis
	public renderAnnounce(object: string | IObject, note: MiNote): IAnnounce {
		const attributedTo = this.userEntityService.genLocalUserUri(note.userId);

		let to: string[] = [];
		let cc: string[] = [];

		if (note.visibility === 'public') {
			to = ['https://www.w3.org/ns/activitystreams#Public'];
			cc = [`${attributedTo}/followers`];
		} else if (note.visibility === 'home') {
			to = [`${attributedTo}/followers`];
			cc = ['https://www.w3.org/ns/activitystreams#Public'];
		} else if (note.visibility === 'followers') {
			to = [`${attributedTo}/followers`];
			cc = [];
		} else {
			throw new Error('renderAnnounce: cannot render non-public note');
		}

		return {
			id: `${this.config.url}/notes/${note.id}/activity`,
			actor: this.userEntityService.genLocalUserUri(note.userId),
			type: 'Announce',
			published: this.idService.parse(note.id).date.toISOString(),
			to,
			cc,
			object,
		};
	}

	/**
	 * Renders a block into its ActivityPub representation.
	 *
	 * @param block The block to be rendered. The blockee relation must be loaded.
	 */
	@bindThis
	public renderBlock(block: MiBlocking): IBlock {
		if (block.blockee?.uri == null) {
			throw new Error('renderBlock: missing blockee uri');
		}

		return {
			type: 'Block',
			id: `${this.config.url}/blocks/${block.id}`,
			actor: this.userEntityService.genLocalUserUri(block.blockerId),
			object: block.blockee.uri,
		};
	}

	@bindThis
	public renderCreate(object: IObject, note: MiNote): ICreate {
		const activity: ICreate = {
			id: `${this.config.url}/notes/${note.id}/activity`,
			actor: this.userEntityService.genLocalUserUri(note.userId),
			type: 'Create',
			published: this.idService.parse(note.id).date.toISOString(),
			object,
		};

		if (object.to) activity.to = object.to;
		if (object.cc) activity.cc = object.cc;

		return activity;
	}

	@bindThis
	public renderDelete(object: IObject | string, user: { id: MiUser['id']; host: null }): IDelete {
		return {
			type: 'Delete',
			actor: this.userEntityService.genLocalUserUri(user.id),
			object,
			published: new Date().toISOString(),
		};
	}

	@bindThis
	public renderDocument(file: MiDriveFile): IApDocument {
		return {
			type: 'Document',
			mediaType: file.webpublicType ?? file.type,
			url: this.driveFileEntityService.getPublicUrl(file),
			name: file.comment,
			width: file.properties?.width,
			height: file.properties?.height,
			sensitive: file.isSensitive,
			_juice_isAIGenerated: file.isAIGenerated, // JUICE
		};
	}

	@bindThis
	public renderEmoji(emoji: MiEmoji): IApEmoji {
		return {
			// JUICE: 相乗り等でローカル以外(リモートからキャッシュ済み)の絵文字を送信することがあるため、
			// 常に自インスタンスのURLを名乗らず、元のuriが分かっていればそちらを優先する
			id: emoji.uri || `${this.config.url}/emojis/${emoji.name}`,
			type: 'Emoji',
			name: `:${emoji.name}:`,
			host: emoji.host ?? this.config.host,
			updated: emoji.updatedAt != null ? emoji.updatedAt.toISOString() : new Date().toISOString(),
			keywords: emoji.aliases,
			icon: {
				type: 'Image',
				mediaType: emoji.type ?? 'image/png',
				// || emoji.originalUrl してるのは後方互換性のため（publicUrlはstringなので??はだめ）
				url: emoji.publicUrl || emoji.originalUrl,
			},
			_misskey_license: {
				freeText: emoji.license,
			},
		};
	}

	// to anonymise reporters, the reporting actor must be a system user
	@bindThis
	public renderFlag(user: MiLocalUser, object: IObject | string, content: string): IFlag {
		return {
			type: 'Flag',
			actor: this.userEntityService.genLocalUserUri(user.id),
			content,
			object,
		};
	}

	@bindThis
	public renderFollowRelay(relay: MiRelay, relayActor: MiLocalUser): IFollow {
		return {
			id: `${this.config.url}/activities/follow-relay/${relay.id}`,
			type: 'Follow',
			actor: this.userEntityService.genLocalUserUri(relayActor.id),
			object: 'https://www.w3.org/ns/activitystreams#Public',
		};
	}

	/**
	 * Convert (local|remote)(Follower|Followee)ID to URL
	 * @param id Follower|Followee ID
	 */
	@bindThis
	public async renderFollowUser(id: MiUser['id']): Promise<string> {
		const user = await this.usersRepository.findOneByOrFail({ id: id }) as MiPartialLocalUser | MiPartialRemoteUser;
		return this.userEntityService.getUserUri(user);
	}

	@bindThis
	public renderFollow(
		follower: MiPartialLocalUser | MiPartialRemoteUser,
		followee: MiPartialLocalUser | MiPartialRemoteUser,
		requestId?: string,
	): IFollow {
		return {
			id: requestId ?? `${this.config.url}/follows/${follower.id}/${followee.id}`,
			type: 'Follow',
			actor: this.userEntityService.getUserUri(follower),
			object: this.userEntityService.getUserUri(followee),
		};
	}

	@bindThis
	public renderHashtag(tag: string): IApHashtag {
		return {
			type: 'Hashtag',
			href: `${this.config.url}/tags/${encodeURIComponent(tag)}`,
			name: `#${tag}`,
		};
	}

	@bindThis
	public renderImage(file: MiDriveFile): IApImage {
		return {
			type: 'Image',
			url: this.driveFileEntityService.getPublicUrl(file),
			sensitive: file.isSensitive,
			name: file.comment,
		};
	}

	@bindThis
	public renderIdenticon(user: MiLocalUser): IApImage {
		return {
			type: 'Image',
			url: this.userEntityService.getIdenticonUrl(user),
			sensitive: false,
			name: null,
		};
	}

	@bindThis
	public renderSystemAvatar(user: MiLocalUser): IApImage {
		if (this.meta.iconUrl == null) return this.renderIdenticon(user);
		return {
			type: 'Image',
			url: this.meta.iconUrl,
			sensitive: false,
			name: null,
		};
	}

	@bindThis
	public renderSystemBanner(): IApImage | null {
		if (this.meta.bannerUrl == null) return null;
		return {
			type: 'Image',
			url: this.meta.bannerUrl,
			sensitive: false,
			name: null,
		};
	}

	@bindThis
	public renderKey(user: MiLocalUser, key: MiUserKeypair, postfix?: string): IKey {
		return {
			id: `${this.config.url}/users/${user.id}${postfix ?? '/publickey'}`,
			type: 'Key',
			owner: this.userEntityService.genLocalUserUri(user.id),
			publicKeyPem: createPublicKey(key.publicKey).export({
				type: 'spki',
				format: 'pem',
			}),
		};
	}

	@bindThis
	public async renderLike(noteReaction: MiNoteReaction, note: { uri: string | null }): Promise<ILike> {
		const reaction = noteReaction.reaction;

		// JUICE: リアクション相乗り(ReactionService.create参照)により、reactionが自インスタンスに
		// 存在しない絵文字(:name@host:形式、hostは相乗り元の絵文字の実際の提供元)になりうる。
		// name/hostを正しく分離し、host指定がある場合は(ローカル・相乗り元問わず)絵文字テーブル
		// 全体から検索してtagを付与する
		let sendReaction = reaction;
		let emoji: MiEmoji | null = null;

		const custom = reaction.match(decodeCustomEmojiRegexp);
		if (custom) {
			const name = custom[1];
			const host = custom[2] === '.' ? null : (custom[2] ?? null);
			emoji = host == null
				? (await this.customEmojiService.localEmojisCache.fetch()).get(name) ?? null
				: await this.emojisRepository.findOneBy({ host, name });

			// JUICE: 本家Misskey等の受信側は、絵文字リアクションの判定に`/^:([\w+-]+)(?:@\.)?:$/`
			// (ローカルの@.のみ許容)という正規表現を使っており、@に実ホスト名が付いた文字列は
			// そもそも絵文字として認識できず、tagを付けても意味が無いままハートにフォールバック
			// してしまう。相乗り(host !== null)の場合はcontent/_misskey_reactionを:name:の
			// ベア形式に落とし、あとはtagの画像で解決してもらう通常のリモート絵文字リアクションと
			// 同じ扱いにすることで、JUICE/tempura以外の一般的な受信側でも正しく表示されるようにする
			if (host != null) {
				sendReaction = `:${name}:`;
			}
		}

		const object: ILike = {
			type: 'Like',
			id: `${this.config.url}/likes/${noteReaction.id}`,
			actor: `${this.config.url}/users/${noteReaction.userId}`,
			object: note.uri ? note.uri : `${this.config.url}/notes/${noteReaction.noteId}`,
			content: sendReaction,
			_misskey_reaction: sendReaction,
		};

		if (emoji && !emoji.localOnly) object.tag = [this.renderEmoji(emoji)];

		return object;
	}

	@bindThis
	public renderMention(mention: MiPartialLocalUser | MiPartialRemoteUser): IApMention {
		return {
			type: 'Mention',
			href: this.userEntityService.getUserUri(mention),
			name: this.userEntityService.isRemoteUser(mention) ? `@${mention.username}@${mention.host}` : `@${(mention as MiLocalUser).username}`,
		};
	}

	@bindThis
	public renderMove(
		src: MiPartialLocalUser | MiPartialRemoteUser,
		dst: MiPartialLocalUser | MiPartialRemoteUser,
	): IMove {
		const actor = this.userEntityService.getUserUri(src);
		const target = this.userEntityService.getUserUri(dst);
		return {
			id: `${this.config.url}/moves/${src.id}/${dst.id}`,
			actor,
			type: 'Move',
			object: actor,
			target,
		};
	}

	@bindThis
	public async renderNote(note: MiNote, dive = true): Promise<IPost> {
		const getPromisedFiles = async (ids: string[]): Promise<MiDriveFile[]> => {
			if (ids.length === 0) return [];
			const items = await this.driveFilesRepository.findBy({ id: In(ids) });
			return ids.map(id => items.find(item => item.id === id)).filter(x => x != null);
		};

		let inReplyTo;
		let inReplyToNote: MiNote | null;

		if (note.replyId) {
			inReplyToNote = await this.notesRepository.findOneBy({ id: note.replyId });

			if (inReplyToNote != null) {
				const inReplyToUserExist = await this.usersRepository.exists({ where: { id: inReplyToNote.userId } });

				if (inReplyToUserExist) {
					if (inReplyToNote.uri) {
						inReplyTo = inReplyToNote.uri;
					} else {
						if (dive) {
							inReplyTo = await this.renderNote(inReplyToNote, false);
						} else {
							inReplyTo = `${this.config.url}/notes/${inReplyToNote.id}`;
						}
					}
				}
			}
		} else {
			inReplyTo = null;
		}

		let quote: string | undefined;

		if (note.renoteId) {
			const renote = await this.notesRepository.findOneBy({ id: note.renoteId });

			if (renote) {
				quote = renote.uri ? renote.uri : `${this.config.url}/notes/${renote.id}`;
			}
		}

		const attributedTo = this.userEntityService.genLocalUserUri(note.userId);

		const mentions = (JSON.parse(note.mentionedRemoteUsers) as IMentionedRemoteUsers).map(x => x.uri);

		let to: string[] = [];
		let cc: string[] = [];

		if (note.visibility === 'public') {
			to = ['https://www.w3.org/ns/activitystreams#Public'];
			cc = [`${attributedTo}/followers`].concat(mentions);
		} else if (note.visibility === 'home') {
			to = [`${attributedTo}/followers`];
			cc = ['https://www.w3.org/ns/activitystreams#Public'].concat(mentions);
		} else if (note.visibility === 'followers') {
			to = [`${attributedTo}/followers`];
			cc = mentions;
		} else {
			to = mentions;
		}

		const mentionedUsers = note.mentions.length > 0 ? await this.usersRepository.findBy({
			id: In(note.mentions),
		}) : [];

		const hashtagTags = note.tags.map(tag => this.renderHashtag(tag));
		const mentionTags = mentionedUsers.map(u => this.renderMention(u as MiLocalUser | MiRemoteUser));

		const allFiles = await getPromisedFiles(note.fileIds);
		// JUICE: 投稿者がダウンロードさせないことにした小説のtxtは、添付として送らない(ファイルのURLを渡さない)。
		// 代わりに、このサーバーの小説ビューワーへのリンクを本文の最後に付ける(連合先の人は、そこで読む)
		const files = allFiles.filter(file => !(file.novelDownloadDisabled && isNovelTextFile(file)));
		const novelViewerUrl = files.length !== allFiles.length ? `${this.config.url}/notes/${note.id}/novel-viewer` : null;
		// フォロワー限定・指定したユーザー限定の投稿は、ほかのサーバーの人はこのサーバーにログインしていないので、
		// リンクを開いても読めない。リンクの代わりに、このサーバーのアカウントでだけ読めることを知らせる
		let novelNotice: string | null = null;
		if (novelViewerUrl != null && (note.visibility === 'followers' || note.visibility === 'specified')) {
			const key = note.visibility === 'followers' ? '_juice.novelTextFederatedFollowersOnly' : '_juice.novelTextFederatedSpecified';
			const args = { host: this.config.host };
			const translate = (lang: string) => {
				const translated = this.emailI18nService.getI18n(lang).t(key, args);
				return typeof translated === 'string' && translated !== key ? translated : null;
			};
			novelNotice = translate(note.lang != null ? federationNoticeLang(note.lang) : await this.emailI18nService.resolveLang(null)) ?? translate('en-US') ?? translate('ja-JP');
		}
		const novelAppendix = novelViewerUrl == null ? null : novelNotice != null ? `📖 ${novelNotice}` : `📖 ${novelViewerUrl}`;

		const text = (note.text ?? '') + (novelAppendix != null ? `${note.text ? '\n\n' : ''}${novelAppendix}` : '');
		let poll: MiPoll | null = null;

		if (note.hasPoll) {
			poll = await this.pollsRepository.findOneBy({ noteId: note.id });
		}

		let extraHtml: string | null = null;

		// JUICE: 小説ビューワーへのリンク(ダウンロードさせない小説のtxtの代わり)
		if (novelViewerUrl != null) {
			const inner = novelNotice != null ? `📖 ${escapeHtml(novelNotice)}` : `📖 <a href="${escapeHtml(novelViewerUrl)}">${escapeHtml(novelViewerUrl)}</a>`;
			extraHtml = `${note.text ? '<br><br>' : ''}<span class="juice-novel-viewer">${inner}</span>`;
		}

		if (quote != null) {
			// Append quote link as `<br><br><span class="quote-inline">RE: <a href="...">...</a></span>`
			// the class name `quote-inline` is used in non-misskey clients for styling quote notes.
			// For compatibility, the span part should be kept as possible.
			extraHtml = `${extraHtml ?? ''}<br><br><span class="quote-inline">RE: <a href="${escapeHtml(quote)}">${escapeHtml(quote)}</a></span>`;
		}

		let summary = note.cw === '' ? String.fromCharCode(0x200B) : note.cw;

		// JUICE: _juice_isAIGeneratedを解釈できない非JUICE実装でも、AI生成物であることが
		// 一目でわかるよう、AI生成ノートのsummary(AS2標準のCW相当)にフォールバック文言を合成する。
		// 元々CWが無ければ文言のみ、既にCWがある場合は「AI生成 | 元のCW」の形で先頭に付け加える。
		// DB上のnote.cwは変更しないため、ローカル・JUICE間の表示は今まで通りバッジのみ
		// (_juice_summaryIsAIGeneratedFallbackを見て採用を抑制し、_juice_originalCwから元の
		// CWを復元する。合成後のsummaryをそのままCWとして採用すると、JUICE間の連合でも
		// 「AI生成 | 」が本来のCWの前に混入してしまうため)。
		// ノート本体のisAIGeneratedだけでなく、添付ファイルのうち1件でもAI生成フラグが
		// 立っていれば対象にする(ノート本体と添付ファイルは独立したフラグのため)
		// JUICE: 添付から外したファイル(ダウンロードさせないtxt)も、AI生成の印は見る
		const juiceSettings = (note.isAIGenerated || allFiles.some(f => f.isAIGenerated) || note.isNovel) ? await this.juiceSettingsService.fetch() : null;

		let summaryIsAIGeneratedFallback = false;
		if (note.isAIGenerated || allFiles.some(f => f.isAIGenerated)) {
			const { aiGeneratedFallbackCwEnabled } = resolveAiGeneratedFallbackCwSettings(juiceSettings!);
			if (aiGeneratedFallbackCwEnabled) {
				const lang = await this.emailI18nService.resolveLang(note.lang);
				const aiGeneratedLabel = this.emailI18nService.getI18n(lang).t('aiGenerated');
				summary = (note.cw != null && note.cw !== '') ? `${aiGeneratedLabel} | ${note.cw}` : aiGeneratedLabel;
				summaryIsAIGeneratedFallback = true;
			}
		}

		// JUICE: _juice_isNovelを解釈できない非JUICE実装でも、小説(長文フィクション)投稿で
		// あることが一目でわかるよう、summaryにフォールバック文言を合成する。仕組みはisAIGenerated
		// と同じ(_juice_summaryIsNovelFallback目印・_juice_originalCwでの復元、DB上のnote.cwは
		// 変更しない)。isAIGenerated側のフォールバックが既に適用されている場合は、summaryへの
		// 二重合成は行わず優先させる(_juice_isNovel自体はJUICE間連合用に引き続き個別に送出する)
		let summaryIsNovelFallback = false;
		if (note.isNovel && !summaryIsAIGeneratedFallback) {
			const { novelFallbackCwEnabled } = resolveNovelFallbackCwSettings(juiceSettings!);
			if (novelFallbackCwEnabled) {
				const lang = await this.emailI18nService.resolveLang(note.lang);
				const novelLabel = this.emailI18nService.getI18n(lang).t('novel');
				summary = (note.cw != null && note.cw !== '') ? `${novelLabel} | ${note.cw}` : novelLabel;
				summaryIsNovelFallback = true;
			}
		}

		const { content, noMisskeyContent } = this.apMfmService.getNoteHtml(note, extraHtml);

		const emojis = await this.getEmojis(note.emojis);
		const apemojis = emojis.filter(emoji => !emoji.localOnly).map(emoji => this.renderEmoji(emoji));

		const tag = [
			...hashtagTags,
			...mentionTags,
			...apemojis,
		];

		const asPoll = poll ? {
			type: 'Question',
			[poll.expiresAt && poll.expiresAt < new Date() ? 'closed' : 'endTime']: poll.expiresAt,
			[poll.multiple ? 'anyOf' : 'oneOf']: poll.choices.map((text, i) => ({
				type: 'Note',
				name: text,
				replies: {
					type: 'Collection',
					totalItems: poll!.votes[i],
				},
			})),
		} as const : {};

		return {
			id: `${this.config.url}/notes/${note.id}`,
			type: 'Note',
			attributedTo,
			summary: summary ?? undefined,
			content: content ?? undefined,
			// JUICE: 言語タグ付きノートをAS2標準のcontentMapでも連合する(Mastodon/Akkoma互換)。
			// Mastodon本体はcontentMapのキーをリージョン無しの主言語サブタグ(中国語除く)としてしか
			// 正規化・照合しないため、note.langをそのまま送るとMastodon側の言語フィルタで認識され
			// ない場合がある。そのため主言語サブタグへ切り詰めて送る(canonicalizeLanguageTagForFederation参照)
			...(note.lang && content != null ? { contentMap: { [canonicalizeLanguageTagForFederation(note.lang)]: content } } : {}),
			// JUICE: リージョン等を保持した本来のnote.langをJUICE間連合用に別途送出する
			// (受信側ApNoteServiceはこちらを優先して採用する)
			...(note.lang != null ? { _juice_lang: note.lang } : {}),
			...(noMisskeyContent ? {} : {
				_misskey_content: text,
				source: {
					content: text,
					mediaType: 'text/x.misskeymarkdown',
				},
			}),
			_misskey_quote: quote,
			quoteUrl: quote,
			_juice_isAIGenerated: note.isAIGenerated, // JUICE
			// JUICE: summaryIsAIGeneratedFallback時、summary自体は非JUICE向けの合成文言(フォールバック
			// 文言単独、または「フォールバック文言 | 元のCW」)になっているため、JUICE間の連合で
			// 元のCWをそのまま復元できるよう、DB上のnote.cwを別プロパティとして併せて連合する
			...(summaryIsAIGeneratedFallback ? { _juice_summaryIsAIGeneratedFallback: true, _juice_originalCw: note.cw } : {}), // JUICE
			_juice_isNovel: note.isNovel, // JUICE
			...(summaryIsNovelFallback ? { _juice_summaryIsNovelFallback: true, _juice_originalCw: note.cw } : {}), // JUICE
			published: this.idService.parse(note.id).date.toISOString(),
			to,
			cc,
			inReplyTo,
			attachment: files.map(x => this.renderDocument(x)),
			sensitive: note.cw != null || allFiles.some(file => file.isSensitive),
			tag,
			...asPoll,
		};
	}

	@bindThis
	public async renderPerson(user: MiLocalUser) {
		const id = this.userEntityService.genLocalUserUri(user.id);
		const isSystem = user.username.includes('.');

		const [avatar, banner, profile] = await Promise.all([
			user.avatarId ? this.driveFilesRepository.findOneBy({ id: user.avatarId }) : undefined,
			user.bannerId ? this.driveFilesRepository.findOneBy({ id: user.bannerId }) : undefined,
			this.userProfilesRepository.findOneByOrFail({ userId: user.id }),
		]);

		const tryRewriteUrl = (maybeUrl: string) => {
			const urlSafeRegex = /^(?:http[s]?:\/\/.)?(?:www\.)?[-a-zA-Z0-9@%._\+~#=]{2,256}\.[a-z]{2,6}\b(?:[-a-zA-Z0-9@:%_\+.~#?&\/\/=]*)/;
			try {
				const match = maybeUrl.match(urlSafeRegex);
				if (!match) {
					return maybeUrl;
				}
				const urlPart = match[0];
				const urlPartParsed = new URL(urlPart);
				const restPart = maybeUrl.slice(match[0].length);

				return `<a href="${urlPartParsed.href}" rel="me nofollow noopener" target="_blank">${urlPart}</a>${restPart}`;
			} catch (_) {
				return maybeUrl;
			}
		};

		const attachment = profile.fields.map(field => ({
			type: 'PropertyValue',
			name: field.name,
			value: (field.value.startsWith('http://') || field.value.startsWith('https://'))
				? tryRewriteUrl(field.value)
				: field.value,
		}));

		const emojis = await this.getEmojis(user.emojis);
		const apemojis = emojis.filter(emoji => !emoji.localOnly).map(emoji => this.renderEmoji(emoji));

		const hashtagTags = user.tags.map(tag => this.renderHashtag(tag));

		const tag = [
			...apemojis,
			...hashtagTags,
		];

		const keypair = await this.userKeypairService.getUserKeypair(user.id);

		const person: any = {
			type: isSystem ? 'Application' : user.isBot ? 'Service' : 'Person',
			id,
			inbox: `${id}/inbox`,
			outbox: `${id}/outbox`,
			followers: `${id}/followers`,
			following: `${id}/following`,
			featured: `${id}/collections/featured`,
			sharedInbox: `${this.config.url}/inbox`,
			endpoints: { sharedInbox: `${this.config.url}/inbox` },
			url: `${this.config.url}/@${user.username}`,
			preferredUsername: user.username,
			name: user.name,
			summary: profile.description ? this.mfmService.toHtml(mfm.parse(profile.description)) : null,
			_misskey_summary: profile.description,
			_misskey_followedMessage: profile.followedMessage,
			_misskey_requireSigninToViewContents: user.requireSigninToViewContents,
			_misskey_makeNotesFollowersOnlyBefore: user.makeNotesFollowersOnlyBefore,
			_misskey_makeNotesHiddenBefore: user.makeNotesHiddenBefore,
			icon: avatar ? this.renderImage(avatar) : isSystem ? this.renderSystemAvatar(user) : this.renderIdenticon(user),
			image: banner ? this.renderImage(banner) : isSystem ? this.renderSystemBanner() : null,
			tag,
			manuallyApprovesFollowers: user.isLocked,
			discoverable: user.isExplorable,
			publicKey: this.renderKey(user, keypair, '#main-key'),
			isCat: user.isCat,
			attachment: attachment.length ? attachment : undefined,
		};

		if (user.movedToUri) {
			person.movedTo = user.movedToUri;
		}

		if (user.alsoKnownAs) {
			person.alsoKnownAs = user.alsoKnownAs;
		}

		if (profile.birthday) {
			person['vcard:bday'] = profile.birthday;
		}

		if (profile.location) {
			person['vcard:Address'] = profile.location;
		}

		return person;
	}

	@bindThis
	public renderQuestion(user: { id: MiUser['id'] }, note: MiNote, poll: MiPoll): IQuestion {
		return {
			type: 'Question',
			id: `${this.config.url}/questions/${note.id}`,
			actor: this.userEntityService.genLocalUserUri(user.id),
			content: note.text ?? '',
			[poll.multiple ? 'anyOf' : 'oneOf']: poll.choices.map((text, i) => ({
				name: text,
				_misskey_votes: poll.votes[i],
				replies: {
					type: 'Collection',
					totalItems: poll.votes[i],
				},
			})),
		};
	}

	@bindThis
	public renderReject(object: string | IObject, user: { id: MiUser['id'] }): IReject {
		return {
			type: 'Reject',
			actor: this.userEntityService.genLocalUserUri(user.id),
			object,
		};
	}

	@bindThis
	public renderRemove(user: { id: MiUser['id'] }, target: string | IObject | undefined, object: string | IObject): IRemove {
		return {
			type: 'Remove',
			actor: this.userEntityService.genLocalUserUri(user.id),
			target,
			object,
		};
	}

	@bindThis
	public renderTombstone(id: string): ITombstone {
		return {
			id,
			type: 'Tombstone',
		};
	}

	@bindThis
	public renderUndo(object: string | IObject, user: { id: MiUser['id'] }): IUndo {
		const id = typeof object !== 'string' && typeof object.id === 'string' && this.utilityService.isUriLocal(object.id) ? `${object.id}/undo` : undefined;

		return {
			type: 'Undo',
			...(id ? { id } : {}),
			actor: this.userEntityService.genLocalUserUri(user.id),
			object,
			published: new Date().toISOString(),
		};
	}

	@bindThis
	public renderUpdate(object: string | IObject, user: { id: MiUser['id'] }): IUpdate {
		return {
			id: `${this.config.url}/users/${user.id}#updates/${new Date().getTime()}`,
			actor: this.userEntityService.genLocalUserUri(user.id),
			type: 'Update',
			to: ['https://www.w3.org/ns/activitystreams#Public'],
			object,
			published: new Date().toISOString(),
		};
	}

	@bindThis
	public renderVote(user: { id: MiUser['id'] }, vote: MiPollVote, note: MiNote, poll: MiPoll, pollOwner: MiRemoteUser): ICreate {
		return {
			id: `${this.config.url}/users/${user.id}#votes/${vote.id}/activity`,
			actor: this.userEntityService.genLocalUserUri(user.id),
			type: 'Create',
			to: [pollOwner.uri],
			published: new Date().toISOString(),
			object: {
				id: `${this.config.url}/users/${user.id}#votes/${vote.id}`,
				type: 'Note',
				attributedTo: this.userEntityService.genLocalUserUri(user.id),
				to: [pollOwner.uri],
				inReplyTo: note.uri,
				name: poll.choices[vote.choice],
			},
		};
	}

	@bindThis
	public addContext<T extends IObject>(x: T): T & { '@context': any; id: string; } {
		if (typeof x === 'object' && x.id == null) {
			x.id = `${this.config.url}/${randomUUID()}`;
		}

		return Object.assign({ '@context': CONTEXT }, x as T & { id: string });
	}

	@bindThis
	public async attachLdSignature(activity: any, user: { id: MiUser['id']; host: null; }): Promise<IActivity> {
		const keypair = await this.userKeypairService.getUserKeypair(user.id);

		const jsonLd = this.jsonLdService.use();
		jsonLd.debug = false;
		activity = await jsonLd.signRsaSignature2017(activity, keypair.privateKey, `${this.config.url}/users/${user.id}#main-key`);

		return activity;
	}

	/**
	 * Render OrderedCollectionPage
	 * @param id URL of self
	 * @param totalItems Number of total items
	 * @param orderedItems Items
	 * @param partOf URL of base
	 * @param prev URL of prev page (optional)
	 * @param next URL of next page (optional)
	 */
	@bindThis
	public renderOrderedCollectionPage(id: string, totalItems: any, orderedItems: any, partOf: string, prev?: string, next?: string) {
		const page: any = {
			id,
			partOf,
			type: 'OrderedCollectionPage',
			totalItems,
			orderedItems,
		};

		if (prev) page.prev = prev;
		if (next) page.next = next;

		return page;
	}

	/**
	 * Render OrderedCollection
	 * @param id URL of self
	 * @param totalItems Total number of items
	 * @param first URL of first page (optional)
	 * @param last URL of last page (optional)
	 * @param orderedItems attached objects (optional)
	 */
	@bindThis
	public renderOrderedCollection(id: string, totalItems: number, first?: string, last?: string, orderedItems?: IObject[]) {
		const page: any = {
			id,
			type: 'OrderedCollection',
			totalItems,
		};

		if (first) page.first = first;
		if (last) page.last = last;
		if (orderedItems) page.orderedItems = orderedItems;

		return page;
	}

	@bindThis
	private async getEmojis(names: string[]): Promise<MiEmoji[]> {
		if (names.length === 0) return [];

		const allEmojis = await this.customEmojiService.localEmojisCache.fetch();
		const emojis = names.map(name => allEmojis.get(name)).filter(x => x != null);

		return emojis;
	}
}
