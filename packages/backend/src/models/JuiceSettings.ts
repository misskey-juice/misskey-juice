/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, PrimaryColumn, Column } from 'typeorm';

// JUICE 独自機能の設定はここに集約する。各機能を実装するたびにフィールドを追加していく。
// 個別のマイグレーションを増やさないよう、単一の jsonb カラムにまとめている。
export interface JuiceSettingsValue {
	/** 承認式新規登録を有効にするか */
	approvalRequiredForSignup?: boolean;
	/** 承認式新規登録が有効な場合、登録理由の入力を必須にするか */
	signupReasonRequired?: boolean;
	/** 登録理由の最大文字数 */
	signupReasonMaxLength?: number;
	/**
	 * 招待コードでの登録の入り口(ウェルカムページ・アカウント追加メニューのボタン)を
	 * 一般に表示するか。無効化しても招待コード自体による登録機能(承認式登録のバイパスを
	 * 含む)は無効にならず、招待コードを知っている人はURLを直接開けば引き続き利用できる
	 */
	invitationRegistrationEnabled?: boolean;
	/** ウェルカムページ(未ログイン時のトップページ)に「他のサーバーを探す」ボタンを表示するか */
	exploreOtherServersEnabled?: boolean;
	/** ユーザーがメール言語を選択・保存していない場合に、システムメールで使う既定の言語 */
	defaultEmailLang?: string;
	/** 絵文字申請機能を有効にするか */
	emojiRequestEnabled?: boolean;
	/** 絵文字申請フォームでカテゴリの入力を必須にするか(既定は任意) */
	emojiRequestRequireCategory?: boolean;
	/** 絵文字申請フォームでタグ(別名)の入力を必須にするか(既定は任意) */
	emojiRequestRequireTags?: boolean;
	/** 絵文字申請フォームでライセンスの入力を必須にするか(既定は任意) */
	emojiRequestRequireLicense?: boolean;
	/** アバターデコレーション申請機能を有効にするか */
	avatarDecorationRequestEnabled?: boolean;
	/** アバターデコレーション申請フォームでカテゴリの入力を必須にするか(既定は任意) */
	avatarDecorationRequestRequireCategory?: boolean;
	/** アバターデコレーション申請フォームで説明の入力を必須にするか(既定は任意) */
	avatarDecorationRequestRequireDescription?: boolean;
	/** ユーザーランキングの集計期間(時間単位) */
	rankingAggregationPeriodHours?: number;
	/** ユーザーランキングに表示する人数 */
	rankingDisplayCount?: number;
	/** リレーTL機能を有効にするか */
	relayTimelineEnabled?: boolean;
	/** メディアタイムライン(添付ファイル付きノートのグリッド表示)機能を有効にするか */
	mediaTimelineEnabled?: boolean;
	/** LaTeX(数式)表示機能を有効にするか */
	latexEnabled?: boolean;
	/** リモートのカスタム絵文字を使ったリアクションへの相乗り(既存リアクションをクリックして同じリアクションを付けること)を許可するか */
	reactionPiggybackOnRemoteEnabled?: boolean;
	/** コンタクトフォーム(お問い合わせ)機能を有効にするか */
	contactFormEnabled?: boolean;
	/** コンタクトフォームの送信回数制限(1時間あたり) */
	contactFormLimit?: number;
	/** コンタクトフォームの送信にログインを必須にするか */
	contactFormRequireAuth?: boolean;
	/** コンタクトフォームのカテゴリ一覧 */
	contactFormCategories?: ContactFormCategory[];
	/** コンタクトフォーム本文の最大文字数 */
	contactFormContentMaxLength?: number;
	/** 起動時のスプラッシュ画面にロゴの下へランダム表示する文言一覧(misskey-tempuraのcustomSplashTextを参考) */
	customSplashText?: string[];
	/** 作成から一定時間経過していないアカウントからのフォローを、フォロー先の鍵設定に関わらずフォローリクエスト化するか */
	newAccountFollowRequestEnabled?: boolean;
	/** 上記が有効な場合の、フォローリクエスト化の対象となるアカウント年齢のしきい値(ミリ秒) */
	newAccountFollowRequestThresholdMs?: number;
	/** 運営の承認が要るインポートの種類(設定 → アカウントのデータ)。following・muting・blocking・userLists・antennas */
	importApprovalRequiredTypes?: string[];
	/** 通報(ユーザー通報)時に選べるカテゴリ一覧 */
	reportCategories?: ReportCategory[];
	/**
	 * Gmail/Googlemailのドット無視(example@gmail.com / ex.ample@gmail.com は同一)を使った
	 * 複数アカウント登録を防ぐため、新規登録・メールアドレス変更時の重複チェックで正規化するか。
	 * 対象ドメインが限定されているため、+タグ側と異なり誤検知のリスクはほぼ無い
	 */
	blockEmailDotAliasRegistration?: boolean;
	/**
	 * +タグ(サブアドレッシング、example+1@gmail.com)を使った複数アカウント登録を防ぐため、
	 * 新規登録・メールアドレス変更時の重複チェックで正規化するか。ドメインを問わず適用するため、
	 * +をサブアドレッシングとして扱わないメールプロバイダでは誤検知(false positive)のリスクがある
	 */
	blockEmailPlusAliasRegistration?: boolean;
	/**
	 * 使い捨てメールアドレスのドメインの一覧(disposable-email-domains)で、新規登録・メールアドレス変更を断るか。
	 * メールの検証方式(verifymail.io・Truemail・deep-email-validator)とは別に動く
	 */
	disposableEmailBlocklistEnabled?: boolean;
	/**
	 * 一覧に載っていても受け付けるドメイン(誤って載っているドメインを外すため)。サブドメインも受け付ける
	 */
	disposableEmailAllowDomains?: string[];
	/**
	 * AI生成物フラグ(isAIGenerated)が、ノート本体か添付ファイルのいずれか1つにでも立っている
	 * ノートを連合する際、ActivityPubのsummary(CW相当)にフォールバック文言を合成して送出するか。
	 * CWが未設定なら文言のみ、既にCWがある場合は「フォールバック文言 | 元のCW」の形で先頭に
	 * 付け加える。_juice_isAIGeneratedを解釈できない非JUICE実装でも、通報を促せるように内容の
	 * 手前にワンクッション入るための機能。ローカル・JUICE間の表示は
	 * _juice_summaryIsAIGeneratedFallback目印により引き続きバッジ表示のみ(DB上のnote.cwは
	 * 変更しない。元のCWは_juice_originalCwとして別途連合し、JUICE間ではそれを使って復元する)
	 */
	aiGeneratedFallbackCwEnabled?: boolean;
	/**
	 * 「小説」フラグ(isNovel)が立っているノートを連合する際、ActivityPubのsummary
	 * (CW相当)にフォールバック文言を合成して送出するか。CWが未設定なら文言のみ、既に
	 * CWがある場合は「フォールバック文言 | 元のCW」の形で先頭に付け加える。
	 * aiGeneratedFallbackCwEnabledと同じ仕組み(_juice_summaryIsNovelFallback目印・
	 * _juice_originalCwでの復元)。AI生成物フォールバックが既に適用されている場合は
	 * 二重合成せず、そちらを優先する
	 */
	novelFallbackCwEnabled?: boolean;
	/** 連携ログイン(Discord)を有効にするか */
	discordOauthEnabled?: boolean;
	/** 連携ログイン(Discord)のOAuthアプリのクライアントID */
	discordOauthClientId?: string | null;
	/** 連携ログイン(Discord)のOAuthアプリのクライアントシークレット */
	discordOauthClientSecret?: string | null;
	/** 連携ログイン(Google)を有効にするか */
	googleOauthEnabled?: boolean;
	/** 連携ログイン(Google)のOAuthアプリのクライアントID */
	googleOauthClientId?: string | null;
	/** 連携ログイン(Google)のOAuthアプリのクライアントシークレット */
	googleOauthClientSecret?: string | null;
	/** 連携ログイン(GitHub)を有効にするか */
	githubOauthEnabled?: boolean;
	/** 連携ログイン(GitHub)のOAuthアプリのクライアントID */
	githubOauthClientId?: string | null;
	/** 連携ログイン(GitHub)のOAuthアプリのクライアントシークレット */
	githubOauthClientSecret?: string | null;
	/** 連携ログイン(GitLab)を有効にするか */
	gitlabOauthEnabled?: boolean;
	/** 連携ログイン(GitLab)のOAuthアプリのクライアントID */
	gitlabOauthClientId?: string | null;
	/** 連携ログイン(GitLab)のOAuthアプリのクライアントシークレット */
	gitlabOauthClientSecret?: string | null;
	/** 連携ログイン(Microsoft)を有効にするか */
	microsoftOauthEnabled?: boolean;
	/** 連携ログイン(Microsoft)のOAuthアプリのクライアントID */
	microsoftOauthClientId?: string | null;
	/** 連携ログイン(Microsoft)のOAuthアプリのクライアントシークレット */
	microsoftOauthClientSecret?: string | null;
	/**
	 * ノート添付のMIDIファイルプレイヤーで再生を許可する最大ファイルサイズ(バイト単位)。
	 * 黒MIDI等、ノートイベント数が極端に多いファイルを解析・再生してブラウザが
	 * 固まることを防ぐための安全装置。これを超えるファイルは再生ボタン自体を出さない
	 */
	midiPlayerMaxSize?: number;

	/**
	 * 絵チャ(お絵かきチャット)機能を使えるようにするか。既定は有効
	 */
	drawRoomEnabled?: boolean;
	// JUICE: 絵チャの1つの部屋の全員の線のデータ量の合計の上限(MB)
	drawRoomMaxRoomMegabytes?: number;

	/**
	 * リモートのユーザー(Misskey系)のアイコンのデコレーションを表示するか。既定は有効
	 */
	remoteAvatarDecorationsEnabled?: boolean;
}

// JUICE: misskey-tempuraのコンタクトフォームを参考に追加
export type ContactFormCategory = {
	key: string;
	text: string;
	enabled: boolean;
	order: number;
	isDefault: boolean;
};

// JUICE: 通報(ユーザー通報)のカテゴリ。ContactFormCategoryと同じ形にして
// 管理画面での編集パターンを揃える(通報とお問い合わせは別々の設定として独立管理する)
export type ReportCategory = {
	key: string;
	text: string;
	enabled: boolean;
	order: number;
	isDefault: boolean;
};

// JUICE: 承認式にできるインポートの種類(ImportRequest.tsのimportRequestTypesと同じ)
const IMPORT_APPROVAL_TYPES = ['following', 'muting', 'blocking', 'userLists', 'antennas'] as const;

/** 運営の承認が要るインポートの種類。設定が無ければ、フォローだけ */
export function resolveImportApprovalSettings(settings: JuiceSettingsValue): {
	importApprovalRequiredTypes: (typeof IMPORT_APPROVAL_TYPES)[number][];
} {
	const types = settings.importApprovalRequiredTypes ?? ['following'];
	return {
		importApprovalRequiredTypes: IMPORT_APPROVAL_TYPES.filter(type => types.includes(type)),
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・juice/public-settings・SignupApiService の3箇所で共通利用する。
 */
export function resolveSignupApprovalSettings(settings: JuiceSettingsValue): {
	approvalRequiredForSignup: boolean;
	signupReasonRequired: boolean;
	signupReasonMaxLength: number;
	invitationRegistrationEnabled: boolean;
} {
	return {
		approvalRequiredForSignup: settings.approvalRequiredForSignup ?? false,
		signupReasonRequired: settings.signupReasonRequired ?? true,
		signupReasonMaxLength: settings.signupReasonMaxLength ?? 4096,
		invitationRegistrationEnabled: settings.invitationRegistrationEnabled ?? true,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・juice/public-settingsの2箇所で共通利用する。
 */
export function resolveExploreOtherServersSettings(settings: JuiceSettingsValue): {
	exploreOtherServersEnabled: boolean;
} {
	return {
		exploreOtherServersEnabled: settings.exploreOtherServersEnabled ?? true,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・EmailI18nService の2箇所で共通利用する。
 */
export function resolveEmailSettings(settings: JuiceSettingsValue): {
	defaultEmailLang: string;
} {
	return {
		defaultEmailLang: settings.defaultEmailLang ?? 'ja-JP',
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・juice/public-settings・emoji-requests/*の4箇所で共通利用する。
 */
export function resolveEmojiRequestSettings(settings: JuiceSettingsValue): {
	emojiRequestEnabled: boolean;
	emojiRequestRequireCategory: boolean;
	emojiRequestRequireTags: boolean;
	emojiRequestRequireLicense: boolean;
} {
	return {
		emojiRequestEnabled: settings.emojiRequestEnabled ?? false,
		emojiRequestRequireCategory: settings.emojiRequestRequireCategory ?? false,
		emojiRequestRequireTags: settings.emojiRequestRequireTags ?? false,
		emojiRequestRequireLicense: settings.emojiRequestRequireLicense ?? false,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・juice/public-settings・avatar-decoration-requests/*の4箇所で共通利用する。
 */
export function resolveAvatarDecorationRequestSettings(settings: JuiceSettingsValue): {
	avatarDecorationRequestEnabled: boolean;
	avatarDecorationRequestRequireCategory: boolean;
	avatarDecorationRequestRequireDescription: boolean;
} {
	return {
		avatarDecorationRequestEnabled: settings.avatarDecorationRequestEnabled ?? false,
		avatarDecorationRequestRequireCategory: settings.avatarDecorationRequestRequireCategory ?? false,
		avatarDecorationRequestRequireDescription: settings.avatarDecorationRequestRequireDescription ?? false,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・JuiceUserRankingService・juice/rankingの3箇所で共通利用する。
 */
export function resolveRankingSettings(settings: JuiceSettingsValue): {
	rankingAggregationPeriodHours: number;
	rankingDisplayCount: number;
} {
	return {
		rankingAggregationPeriodHours: settings.rankingAggregationPeriodHours ?? 12,
		rankingDisplayCount: settings.rankingDisplayCount ?? 3,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・juice/public-settings・notes/relay-timeline・stream/relay-timelineの4箇所で共通利用する。
 */
export function resolveRelayTimelineSettings(settings: JuiceSettingsValue): {
	relayTimelineEnabled: boolean;
} {
	return {
		relayTimelineEnabled: settings.relayTimelineEnabled ?? false,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・juice/public-settingsの2箇所で共通利用する。
 */
export function resolveMediaTimelineSettings(settings: JuiceSettingsValue): {
	mediaTimelineEnabled: boolean;
} {
	return {
		mediaTimelineEnabled: settings.mediaTimelineEnabled ?? false,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・juice/public-settings・MkFormula.vue(フロント、utility/juice-latex.js経由)の3箇所で共通利用する。
 */
export function resolveLatexSettings(settings: JuiceSettingsValue): {
	latexEnabled: boolean;
} {
	return {
		latexEnabled: settings.latexEnabled ?? true,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * HtmlTemplateService(起動時スプラッシュ画面)・admin/juice/settingsの2箇所で共通利用する。
 */
export function resolveCustomSplashTextSettings(settings: JuiceSettingsValue): {
	customSplashText: string[];
} {
	return {
		customSplashText: settings.customSplashText ?? [],
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・juice/public-settingsの2箇所で共通利用する。
 */
export function resolveReactionPiggybackSettings(settings: JuiceSettingsValue): {
	reactionPiggybackOnRemoteEnabled: boolean;
} {
	return {
		// JUICE: リモートの絵文字画像を著作権者の許諾なく表示・使用することになりうるため、
		// 既定は無効(サーバー管理者の自己責任でのオプトイン)とする
		reactionPiggybackOnRemoteEnabled: settings.reactionPiggybackOnRemoteEnabled ?? false,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・juice/public-settings・contact-form/submit・ContactFormService等で共通利用する。
 * カテゴリの既定値7種はmisskey-tempuraの初期値を踏襲する。
 */
export function resolveContactFormSettings(settings: JuiceSettingsValue): {
	contactFormEnabled: boolean;
	contactFormLimit: number;
	contactFormRequireAuth: boolean;
	contactFormCategories: ContactFormCategory[];
	contactFormContentMaxLength: number;
} {
	return {
		contactFormEnabled: settings.contactFormEnabled ?? true,
		contactFormLimit: settings.contactFormLimit ?? 3,
		contactFormRequireAuth: settings.contactFormRequireAuth ?? false,
		contactFormContentMaxLength: settings.contactFormContentMaxLength ?? 10000,
		contactFormCategories: settings.contactFormCategories ?? [
			{ key: 'general', text: '一般', enabled: true, order: 1, isDefault: true },
			{ key: 'bug_report', text: 'バグ報告', enabled: true, order: 2, isDefault: false },
			{ key: 'feature_request', text: '機能要望', enabled: true, order: 3, isDefault: false },
			{ key: 'account_issue', text: 'アカウント関連', enabled: true, order: 4, isDefault: false },
			{ key: 'technical_issue', text: '技術的な問題', enabled: true, order: 5, isDefault: false },
			{ key: 'content_issue', text: 'コンテンツ関連', enabled: true, order: 6, isDefault: false },
			{ key: 'other', text: 'その他', enabled: true, order: 7, isDefault: false },
		],
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・UserFollowingServiceの2箇所で共通利用する。
 */
export function resolveNewAccountFollowRequestSettings(settings: JuiceSettingsValue): {
	newAccountFollowRequestEnabled: boolean;
	newAccountFollowRequestThresholdMs: number;
} {
	return {
		newAccountFollowRequestEnabled: settings.newAccountFollowRequestEnabled ?? false,
		newAccountFollowRequestThresholdMs: settings.newAccountFollowRequestThresholdMs ?? 24 * 60 * 60 * 1000,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・juice/public-settingsの2箇所で共通利用する。
 */
export function resolveReportCategorySettings(settings: JuiceSettingsValue): {
	reportCategories: ReportCategory[];
} {
	return {
		reportCategories: settings.reportCategories ?? [
			{ key: 'spam', text: 'スパム', enabled: true, order: 1, isDefault: false },
			{ key: 'harassment', text: '嫌がらせ・迷惑行為', enabled: true, order: 2, isDefault: false },
			{ key: 'inappropriate_content', text: '不適切なコンテンツ', enabled: true, order: 3, isDefault: false },
			{ key: 'impersonation', text: 'なりすまし', enabled: true, order: 4, isDefault: false },
			{ key: 'copyright', text: '著作権侵害', enabled: true, order: 5, isDefault: false },
			{ key: 'personal_info', text: '個人情報の晒し', enabled: true, order: 6, isDefault: false },
			{ key: 'other', text: 'その他', enabled: true, order: 7, isDefault: true },
		],
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・EmailServiceの2箇所で共通利用する。
 */
export function resolveEmailAliasSettings(settings: JuiceSettingsValue): {
	blockEmailDotAliasRegistration: boolean;
	blockEmailPlusAliasRegistration: boolean;
} {
	return {
		blockEmailDotAliasRegistration: settings.blockEmailDotAliasRegistration ?? false,
		blockEmailPlusAliasRegistration: settings.blockEmailPlusAliasRegistration ?? false,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・DisposableEmailDomainServiceの2箇所で共通利用する。
 */
export function resolveDisposableEmailSettings(settings: JuiceSettingsValue): {
	disposableEmailBlocklistEnabled: boolean;
	disposableEmailAllowDomains: string[];
} {
	return {
		disposableEmailBlocklistEnabled: settings.disposableEmailBlocklistEnabled ?? false,
		disposableEmailAllowDomains: settings.disposableEmailAllowDomains ?? [],
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・ApRendererServiceの2箇所で共通利用する。
 */
export function resolveAiGeneratedFallbackCwSettings(settings: JuiceSettingsValue): {
	aiGeneratedFallbackCwEnabled: boolean;
} {
	return {
		aiGeneratedFallbackCwEnabled: settings.aiGeneratedFallbackCwEnabled ?? false,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・admin/juice/update-settings・ApRendererServiceの3箇所で共通利用する。
 */
export function resolveNovelFallbackCwSettings(settings: JuiceSettingsValue): {
	novelFallbackCwEnabled: boolean;
} {
	return {
		novelFallbackCwEnabled: settings.novelFallbackCwEnabled ?? false,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・admin/juice/update-settings・juice/public-settings・
 * OAuthLoginServiceの4箇所で共通利用する。既定はすべて無効/null(admin未設定の間は
 * OAuthログイン機能自体が一切動作しない)
 */
export function resolveOauthLoginSettings(settings: JuiceSettingsValue): {
	discordOauthEnabled: boolean;
	discordOauthClientId: string | null;
	discordOauthClientSecret: string | null;
	googleOauthEnabled: boolean;
	googleOauthClientId: string | null;
	googleOauthClientSecret: string | null;
	githubOauthEnabled: boolean;
	githubOauthClientId: string | null;
	githubOauthClientSecret: string | null;
	gitlabOauthEnabled: boolean;
	gitlabOauthClientId: string | null;
	gitlabOauthClientSecret: string | null;
	microsoftOauthEnabled: boolean;
	microsoftOauthClientId: string | null;
	microsoftOauthClientSecret: string | null;
} {
	return {
		discordOauthEnabled: settings.discordOauthEnabled ?? false,
		discordOauthClientId: settings.discordOauthClientId ?? null,
		discordOauthClientSecret: settings.discordOauthClientSecret ?? null,
		googleOauthEnabled: settings.googleOauthEnabled ?? false,
		googleOauthClientId: settings.googleOauthClientId ?? null,
		googleOauthClientSecret: settings.googleOauthClientSecret ?? null,
		githubOauthEnabled: settings.githubOauthEnabled ?? false,
		githubOauthClientId: settings.githubOauthClientId ?? null,
		githubOauthClientSecret: settings.githubOauthClientSecret ?? null,
		gitlabOauthEnabled: settings.gitlabOauthEnabled ?? false,
		gitlabOauthClientId: settings.gitlabOauthClientId ?? null,
		gitlabOauthClientSecret: settings.gitlabOauthClientSecret ?? null,
		microsoftOauthEnabled: settings.microsoftOauthEnabled ?? false,
		microsoftOauthClientId: settings.microsoftOauthClientId ?? null,
		microsoftOauthClientSecret: settings.microsoftOauthClientSecret ?? null,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・admin/juice/update-settings・juice/public-settingsの3箇所で共通利用する。
 */
export function resolveMidiPlayerSettings(settings: JuiceSettingsValue): {
	midiPlayerMaxSize: number;
} {
	return {
		midiPlayerMaxSize: settings.midiPlayerMaxSize ?? 500 * 1024,
	};
}

/**
 * jsonb には存在しないキーがありうるため、デフォルト値を解決してから返す。
 * admin/juice/settings・admin/juice/update-settings・juice/public-settingsの3箇所で共通利用する。
 */
export function resolveDrawRoomSettings(settings: JuiceSettingsValue): {
	drawRoomEnabled: boolean;
} {
	return {
		drawRoomEnabled: settings.drawRoomEnabled ?? true,
	};
}

// JUICE: 絵チャの部屋の全員の線のデータ量の合計の上限(MB)。線は全員分をまとめて読み出すので、512MBまで
export const DRAW_ROOM_MAX_ROOM_MEGABYTES_RANGE = { min: 16, max: 512 } as const;

export function resolveDrawRoomLimitSettings(settings: JuiceSettingsValue): {
	drawRoomMaxRoomMegabytes: number;
} {
	const value = settings.drawRoomMaxRoomMegabytes;
	return {
		drawRoomMaxRoomMegabytes: typeof value === 'number' && Number.isFinite(value)
			? Math.min(DRAW_ROOM_MAX_ROOM_MEGABYTES_RANGE.max, Math.max(DRAW_ROOM_MAX_ROOM_MEGABYTES_RANGE.min, Math.floor(value)))
			: 256,
	};
}

export function resolveRemoteAvatarDecorationSettings(settings: JuiceSettingsValue): {
	remoteAvatarDecorationsEnabled: boolean;
} {
	return {
		remoteAvatarDecorationsEnabled: settings.remoteAvatarDecorationsEnabled ?? true,
	};
}

@Entity('juice_settings')
export class MiJuiceSettings {
	@PrimaryColumn('varchar', {
		length: 32,
	})
	public id: string;

	@Column('jsonb', {
		default: {},
	})
	public settings: JuiceSettingsValue;

	constructor(data: Partial<MiJuiceSettings>) {
		if (data == null) return;

		for (const [k, v] of Object.entries(data)) {
			(this as any)[k] = v;
		}
	}
}
