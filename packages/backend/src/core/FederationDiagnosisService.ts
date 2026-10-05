/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createPublicKey, type KeyObject } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import type { UsersRepository, UserPublickeysRepository, MiMeta } from '@/models/_.js';
import type { MiInstance } from '@/models/Instance.js';
import { bindThis } from '@/decorators.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { WebfingerService } from '@/core/WebfingerService.js';
import { ApRequestService } from '@/core/activitypub/ApRequestService.js';
import { SystemAccountService } from '@/core/SystemAccountService.js';
import { UserKeypairService } from '@/core/UserKeypairService.js';
import type { DeliverQueue } from '@/core/QueueModule.js';

// JUICE: 連合しているサーバーとの連合の診断。このサーバーの設定(連合の範囲・ブロック・配送の停止など)と、
// 相手のサーバーへの実際の問い合わせ(名前解決・HTTPS・NodeInfo・WebFinger・署名付きの取得・inbox)を順に確かめて、
// どこで連合が止まっているかを見つけやすくする。相手のサーバーには何も配送しない
// (inboxには、署名の無い空のPOSTを送って応答を見るだけ。署名が無いので、相手は中身を処理せずに断る)

export const FEDERATION_DIAGNOSIS_CHECK_IDS = [
	'federationMode', 'blocked', 'silenced', 'suspension', 'responding', 'lastReceived', 'deliverQueue',
	'dns', 'https', 'nodeinfo', 'webfinger', 'actor', 'inbox',
] as const;

// 署名の鍵の種類(署名付きでのユーザー情報の取得の項目に付ける)
export type FederationDiagnosisKey = {
	// local: このサーバーが署名に使う鍵 / publicKey: 相手が公開している鍵(publicKey) /
	// assertionMethod: 相手が公開している鍵(assertionMethodのMultikey) / stored: このサーバーが保存している相手の鍵(相手の署名を確かめるのに使う)
	source: 'local' | 'publicKey' | 'assertionMethod' | 'stored';
	// rsa / ed25519 / ec:<曲線の名前> / unknown など
	type: string;
	// RSAの鍵の長さ(ビット)。分からないときと、RSA以外はnull
	bits: number | null;
	// 署名のアルゴリズム(このサーバーの鍵だけ。相手の鍵は、相手がどのアルゴリズムで署名するかまでは分からないのでnull)
	algorithm: string | null;
};

export type FederationDiagnosisCheck = {
	id: typeof FEDERATION_DIAGNOSIS_CHECK_IDS[number];
	// ok: 問題なし / warn: 連合はできるが気を付ける点がある / error: 連合の妨げになっている / skipped: 確かめられなかった
	status: 'ok' | 'warn' | 'error' | 'skipped';
	// 結果の種類(画面で説明文を選ぶのに使う。問題なければnull)
	code: string | null;
	// 補足(HTTPのステータス・ソフトウェアの名前・日時など。画面にそのまま出す)
	detail: string | null;
	// 相手のサーバーへ問い合わせた項目の、かかった時間(ミリ秒)
	elapsedMs: number | null;
	// 署名の鍵の種類(署名付きでのユーザー情報の取得の項目だけ。それ以外はnull)
	keys: FederationDiagnosisKey[] | null;
};

type CheckResult = Pick<FederationDiagnosisCheck, 'status' | 'code' | 'detail'>;

const REQUEST_TIMEOUT_MS = 8000;
// これより長く相手から何も届いていなければ、気を付ける点として出す
const STALE_RECEIVE_MS = 1000 * 60 * 60 * 24 * 7;
// 再送を待っている配送を数えるときに、見るジョブの数の上限(配送の中身ごと読むので、全部は読まない)
const DELIVER_QUEUE_SCAN_LIMIT = 5000;
// 相手のユーザーの情報から読む鍵の数の上限(publicKey・assertionMethodそれぞれ)
const ACTOR_KEYS_LIMIT = 5;

/** 鍵の種類と長さ */
function describeKeyObject(key: KeyObject): Pick<FederationDiagnosisKey, 'type' | 'bits'> {
	const type = key.asymmetricKeyType ?? 'unknown';
	if (type === 'ec') return { type: `ec:${key.asymmetricKeyDetails?.namedCurve ?? 'unknown'}`, bits: null };
	return { type, bits: type === 'rsa' || type === 'rsa-pss' ? key.asymmetricKeyDetails?.modulusLength ?? null : null };
}

/** PEMの公開鍵の種類と長さ(読めなければunknown) */
export function describePublicKeyPem(pem: string): Pick<FederationDiagnosisKey, 'type' | 'bits'> {
	try {
		return describeKeyObject(createPublicKey(pem));
	} catch {
		return { type: 'unknown', bits: null };
	}
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function decodeBase58(text: string): Buffer | null {
	let n = 0n;
	for (const char of text) {
		const i = BASE58_ALPHABET.indexOf(char);
		if (i === -1) return null;
		n = n * 58n + BigInt(i);
	}
	let hex = n === 0n ? '' : n.toString(16);
	if (hex.length % 2 === 1) hex = `0${hex}`;
	let zeros = 0;
	while (zeros < text.length && text[zeros] === '1') zeros++;
	return Buffer.concat([Buffer.alloc(zeros), Buffer.from(hex, 'hex')]);
}

/**
 * Multikey(publicKeyMultibase)の鍵の種類と長さ。base58btc(先頭がz)で、先頭のmulticodecで種類を見分ける
 * (0xed01: Ed25519 / 0x8524: RSA(PKCS#1のDER) / 0x8024: P-256 / 0x8124: P-384)
 */
export function describeMultikey(multibase: string): Pick<FederationDiagnosisKey, 'type' | 'bits'> {
	// RSA 4096bitでも1000文字に届かないので、それより長いものは読まない
	if (!multibase.startsWith('z') || multibase.length > 2000) return { type: 'unknown', bits: null };
	const bytes = decodeBase58(multibase.slice(1));
	if (bytes == null || bytes.length < 3) return { type: 'unknown', bits: null };
	if (bytes[0] === 0xed && bytes[1] === 0x01) return { type: 'ed25519', bits: null };
	if (bytes[0] === 0x80 && bytes[1] === 0x24) return { type: 'ec:prime256v1', bits: null };
	if (bytes[0] === 0x81 && bytes[1] === 0x24) return { type: 'ec:secp384r1', bits: null };
	if (bytes[0] === 0x85 && bytes[1] === 0x24) {
		try {
			return describeKeyObject(createPublicKey({ key: bytes.subarray(2), format: 'der', type: 'pkcs1' }));
		} catch {
			return { type: 'rsa', bits: null };
		}
	}
	return { type: 'unknown', bits: null };
}

/** 相手のユーザーの情報(actor)に載っている鍵(publicKeyと、assertionMethodのMultikey) */
export function describeActorKeys(actor: unknown): FederationDiagnosisKey[] {
	const toArray = (x: unknown): unknown[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
	const object = actor as { publicKey?: unknown; assertionMethod?: unknown } | null;
	const keys: FederationDiagnosisKey[] = [];
	for (const key of toArray(object?.publicKey).slice(0, ACTOR_KEYS_LIMIT)) {
		const pem = (key as { publicKeyPem?: unknown } | null)?.publicKeyPem;
		if (typeof pem === 'string' && pem.length <= 10000) keys.push({ source: 'publicKey', ...describePublicKeyPem(pem), algorithm: null });
	}
	for (const method of toArray(object?.assertionMethod).slice(0, ACTOR_KEYS_LIMIT)) {
		const multibase = (method as { publicKeyMultibase?: unknown } | null)?.publicKeyMultibase;
		if (typeof multibase === 'string') keys.push({ source: 'assertionMethod', ...describeMultikey(multibase), algorithm: null });
	}
	return keys;
}

/**
 * 問い合わせの失敗を、結果の種類(code)と補足にする。エラーの文には問い合わせ先のURLなどが入ることがあるので、
 * そのままは返さず、種類(HTTPのステータス・ネットワークのエラーコード)だけを取り出す
 */
export function describeFederationRequestError(err: unknown): { code: string; detail: string | null } {
	const e = err as { name?: string; statusCode?: number; code?: string; type?: string; cause?: { code?: string } } | null;
	if (e?.name === 'StatusError' && typeof e.statusCode === 'number') {
		if (e.statusCode === 401 || e.statusCode === 403) return { code: 'rejected', detail: `HTTP ${e.statusCode}` };
		if (e.statusCode === 404) return { code: 'notFound', detail: 'HTTP 404' };
		if (e.statusCode === 410) return { code: 'gone', detail: 'HTTP 410' };
		if (e.statusCode === 429) return { code: 'rateLimited', detail: 'HTTP 429' };
		if (e.statusCode >= 500) return { code: 'serverError', detail: `HTTP ${e.statusCode}` };
		return { code: 'httpError', detail: `HTTP ${e.statusCode}` };
	}
	if (e?.name === 'AbortError' || e?.type === 'aborted') return { code: 'timeout', detail: null };
	const code = e?.code ?? e?.cause?.code;
	if (typeof code === 'string' && /^[A-Z0-9_]{3,64}$/.test(code)) {
		if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return { code: 'dnsFailed', detail: code };
		if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ETIMEDOUT') return { code: 'connectionFailed', detail: code };
		if (code.includes('CERT') || code.includes('SSL') || code.includes('TLS') || code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') return { code: 'tlsFailed', detail: code };
		return { code: 'requestFailed', detail: code };
	}
	if (e?.name === 'SyntaxError' || e?.type === 'invalid-json') return { code: 'invalidResponse', detail: null };
	return { code: 'requestFailed', detail: typeof e?.name === 'string' && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : null };
}

@Injectable()
export class FederationDiagnosisService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.meta)
		private meta: MiMeta,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.userPublickeysRepository)
		private userPublickeysRepository: UserPublickeysRepository,

		@Inject('queue:deliver')
		private deliverQueue: DeliverQueue,

		private httpRequestService: HttpRequestService,
		private utilityService: UtilityService,
		private webfingerService: WebfingerService,
		private apRequestService: ApRequestService,
		private systemAccountService: SystemAccountService,
		private userKeypairService: UserKeypairService,
	) {
	}

	@bindThis
	public async diagnose(instance: MiInstance): Promise<FederationDiagnosisCheck[]> {
		const host = instance.host;
		const timed = async (id: FederationDiagnosisCheck['id'], fn: () => Promise<CheckResult>): Promise<FederationDiagnosisCheck> => {
			const startedAt = Date.now();
			try {
				return { id, ...await fn(), elapsedMs: Date.now() - startedAt, keys: null };
			} catch (err) {
				return { id, status: 'error', ...describeFederationRequestError(err), elapsedMs: Date.now() - startedAt, keys: null };
			}
		};
		const local = (id: FederationDiagnosisCheck['id'], result: CheckResult): FederationDiagnosisCheck => ({ id, ...result, elapsedMs: null, keys: null });
		const ok = (detail: string | null = null): CheckResult => ({ status: 'ok', code: null, detail });

		const checks: FederationDiagnosisCheck[] = [];

		//#region このサーバーの設定・状態
		checks.push(local('federationMode', this.meta.federation === 'none'
			? { status: 'error', code: 'federationDisabled', detail: null }
			: this.meta.federation === 'specified' && !this.meta.federationHosts.some(x => `.${host}`.endsWith(`.${x}`))
				? { status: 'error', code: 'notInAllowlist', detail: null }
				: ok()));

		checks.push(local('blocked', this.utilityService.isBlockedHost(this.meta.blockedHosts, host)
			? { status: 'error', code: 'blocked', detail: null }
			: ok()));

		const silenced = this.utilityService.isSilencedHost(this.meta.silencedHosts, host);
		// メディアサイレンスは、ほかの所と同じく、ホストがちょうど一致するときだけ
		const mediaSilenced = this.utilityService.isMediaSilencedHost(this.meta.mediaSilencedHosts, host);
		checks.push(local('silenced', silenced || mediaSilenced
			? { status: 'warn', code: silenced && mediaSilenced ? 'silencedAndMediaSilenced' : silenced ? 'silenced' : 'mediaSilenced', detail: null }
			: ok()));

		const softwareSuspension = this.utilityService.isDeliverSuspendedSoftware(instance);
		checks.push(local('suspension', instance.suspensionState !== 'none'
			? { status: 'error', code: instance.suspensionState, detail: null }
			: softwareSuspension != null
				? { status: 'error', code: 'softwareSuspended', detail: [instance.softwareName, instance.softwareVersion].filter(x => x != null).join(' ') || null }
				: ok()));

		checks.push(local('responding', instance.isNotResponding
			? { status: 'warn', code: 'notResponding', detail: instance.notRespondingSince?.toISOString() ?? null }
			: ok()));

		checks.push(local('lastReceived', instance.latestRequestReceivedAt == null
			? { status: 'warn', code: 'neverReceived', detail: null }
			: Date.now() - instance.latestRequestReceivedAt.getTime() > STALE_RECEIVE_MS
				? { status: 'warn', code: 'stale', detail: instance.latestRequestReceivedAt.toISOString() }
				: ok(instance.latestRequestReceivedAt.toISOString())));

		checks.push(local('deliverQueue', await (async (): Promise<CheckResult> => {
			// 配送に失敗して、再送を待っているジョブの数(多いサーバーでは全部は読まず、上限まで見る)
			const jobs = await this.deliverQueue.getJobs(['delayed'], 0, DELIVER_QUEUE_SCAN_LIMIT - 1);
			const count = jobs.filter(job => {
				try {
					return this.utilityService.toPuny(new URL(job.data.to).host) === host;
				} catch {
					return false;
				}
			}).length;
			const text = `${count}${jobs.length >= DELIVER_QUEUE_SCAN_LIMIT ? '+' : ''}`;
			return count > 0 ? { status: 'warn', code: 'delayed', detail: text } : ok(text);
			// このサーバーの中の失敗(Redisなど)は、相手のサーバーの問題として出さない
		})().catch((): CheckResult => ({ status: 'skipped', code: 'internalError', detail: null }))));
		//#endregion

		//#region 相手のサーバーへの問い合わせ
		// 応答の中身を読まない項目は、中身を捨てておく(読まずに残すと、接続がしばらく開いたままになる)
		const discard = (res: { arrayBuffer?: () => Promise<unknown> }) => {
			try {
				res.arrayBuffer?.().catch(() => {});
			} catch { /* 捨てられなくても、結果には関係ない */ }
		};
		// 相手のサーバーの名前(ポートが付いていれば除く)
		const hostname = (() => {
			try {
				return new URL(`https://${host}`).hostname;
			} catch {
				return host;
			}
		})();
		// 確かめるのに使ったユーザーが相手のサーバーにもういない(404・410)のは、サーバーそのものの問題とは限らないので、注意として出す
		const userGone = (check: FederationDiagnosisCheck): FederationDiagnosisCheck => (check.status === 'error' && (check.code === 'notFound' || check.code === 'gone')
			? { ...check, status: 'warn', code: 'userGone' }
			: check);
		const request = async (url: string, accept: string) => await this.httpRequestService.send(url, {
			method: 'GET',
			headers: { Accept: accept },
			timeout: REQUEST_TIMEOUT_MS,
			size: 1024 * 1024,
		}, { throwErrorWhenResponseNotOk: false });

		checks.push(await timed('dns', async () => {
			// プロキシを使う設定では、名前解決はプロキシが行うので確かめない
			if (this.config.proxy != null && !(this.config.proxyBypassHosts ?? []).includes(hostname)) return { status: 'skipped', code: 'proxy', detail: null };
			const addresses = await lookup(hostname, { all: true });
			if (addresses.length === 0) return { status: 'error', code: 'dnsFailed', detail: null };
			return ok(addresses.slice(0, 4).map(a => a.address).join(', '));
		}));

		const https = await timed('https', async () => {
			const res = await request(`https://${host}/`, 'text/html, */*');
			discard(res);
			// 応答があれば、つながってはいる(中身は見ない)。5xxだけ、サーバーの不調として出す
			return res.status >= 500 ? { status: 'error', code: 'serverError', detail: `HTTP ${res.status}` } : ok(`HTTP ${res.status}`);
		});
		checks.push(https);

		// HTTPSでつながらなければ、その先は確かめられない
		const unreachable = https.status === 'error' && https.code !== 'serverError';
		const skippedUnreachable = (id: FederationDiagnosisCheck['id']): FederationDiagnosisCheck => local(id, { status: 'skipped', code: 'unreachable', detail: null });

		// 署名付きの取得・WebFinger・inboxを確かめるのに使う、相手のサーバーのユーザー(このサーバーが知っている中で、最近更新されたもの)
		const knownUser = await this.usersRepository.findOne({
			where: { host, isDeleted: false, isSuspended: false },
			order: { lastFetchedAt: { direction: 'DESC', nulls: 'LAST' } },
			select: { id: true, username: true, uri: true, inbox: true, sharedInbox: true },
		});
		const skippedNoUser = (id: FederationDiagnosisCheck['id']): FederationDiagnosisCheck => local(id, { status: 'skipped', code: 'noKnownUser', detail: null });

		checks.push(...await Promise.all([
			unreachable ? skippedUnreachable('nodeinfo') : timed('nodeinfo', async () => {
				const res = await request(`https://${host}/.well-known/nodeinfo`, 'application/json, */*');
				if (!res.ok) return { status: 'warn', code: 'httpError', detail: `HTTP ${res.status}` };
				const wellKnown = await res.json() as { links?: { rel?: string; href?: string }[] };
				const link = (wellKnown.links ?? []).filter(l => typeof l.href === 'string' && typeof l.rel === 'string' && /\/ns\/schema\/2\.[01]$/.test(l.rel)).at(-1);
				if (link?.href == null || !URL.canParse(link.href) || new URL(link.href).protocol !== 'https:' || this.utilityService.toPuny(new URL(link.href).host) !== host) return { status: 'warn', code: 'invalidResponse', detail: null };
				const infoRes = await request(link.href, 'application/json, */*');
				if (!infoRes.ok) return { status: 'warn', code: 'httpError', detail: `HTTP ${infoRes.status}` };
				const info = await infoRes.json() as { software?: { name?: unknown; version?: unknown } };
				const name = typeof info.software?.name === 'string' ? info.software.name.slice(0, 64) : null;
				const version = typeof info.software?.version === 'string' ? info.software.version.slice(0, 64) : null;
				return name == null ? { status: 'warn', code: 'invalidResponse', detail: null } : ok([name, version].filter(x => x != null).join(' '));
			}).then(check => (check.status === 'error' ? { ...check, status: 'warn' as const } : check)),

			unreachable ? skippedUnreachable('webfinger') : knownUser == null ? skippedNoUser('webfinger') : timed('webfinger', async () => {
				const finger = await this.webfingerService.webfinger(`${knownUser.username}@${host}`);
				const self = finger.links?.find(link => link.rel === 'self' && link.href != null);
				return self == null ? { status: 'error', code: 'invalidResponse', detail: null } : ok();
			}).then(userGone),

			unreachable ? skippedUnreachable('actor') : knownUser?.uri == null ? skippedNoUser('actor') : (async () => {
				// 取得できた相手のユーザーの情報に載っている鍵(取得できなければnull)
				const fetched: { keys: FederationDiagnosisKey[] | null } = { keys: null };
				const check = await timed('actor', async () => {
					// このサーバーの署名を付けて、相手のユーザーの情報を取りに行く(相手がこのサーバーを拒否していれば401・403になる)
					const actor = await this.systemAccountService.fetch('actor');
					const object = await this.apRequestService.signedGet(knownUser.uri!, actor) as { id?: unknown; inbox?: unknown } | null;
					// 取れても、相手がこのサーバーを拒否していないとは限らない(署名を確かめずに返すサーバーが多い)ので、その旨を出す
					if (object == null || typeof object.id !== 'string') return { status: 'error', code: 'invalidResponse', detail: null };
					fetched.keys = describeActorKeys(object);
					return { status: 'ok', code: 'actorFetched', detail: null };
				}).then(userGone);
				// 署名の鍵の種類: このサーバーが署名に使う鍵、相手が公開している鍵、このサーバーが保存している相手の鍵(相手の署名を確かめるのに使う)。
				// 取得に失敗しても、このサーバーの鍵と保存している鍵は出す
				const keys = await this.collectSignatureKeys(knownUser.id, fetched.keys).catch(() => fetched.keys);
				return { ...check, keys };
			})(),

			unreachable ? skippedUnreachable('inbox') : (knownUser?.sharedInbox ?? knownUser?.inbox) == null ? skippedNoUser('inbox') : timed('inbox', async () => {
				// 配送はせず、署名の無い空のPOSTを送って、inboxとして受け付ける場所かだけを見る。
				// GETでは、inboxの無いURLでもページ(200)を返したり、inboxでも404を返したりするサーバーがあって見分けられないため。
				// inboxなら、署名が無いことで断られる(401・403・400など)。404・410・405なら、配送先として受け付けていない
				const res = await this.httpRequestService.send((knownUser!.sharedInbox ?? knownUser!.inbox)!, {
					method: 'POST',
					headers: { 'Content-Type': 'application/activity+json', Accept: 'application/activity+json, */*' },
					body: '{}',
					timeout: REQUEST_TIMEOUT_MS,
					size: 1024 * 1024,
				}, { throwErrorWhenResponseNotOk: false });
				discard(res);
				const detail = `HTTP ${res.status}`;
				if (res.status === 404 || res.status === 410 || res.status === 405) return { status: 'error', code: 'inboxNotFound', detail };
				if (res.status === 429) return { status: 'warn', code: 'rateLimited', detail };
				if (res.status >= 500) return { status: 'error', code: 'serverError', detail };
				return ok(detail);
			}),
		]));
		//#endregion

		return checks;
	}

	/** 署名の鍵の種類(このサーバーが署名に使う鍵・相手が公開している鍵・このサーバーが保存している相手の鍵) */
	@bindThis
	private async collectSignatureKeys(remoteUserId: string, fetchedKeys: FederationDiagnosisKey[] | null): Promise<FederationDiagnosisKey[]> {
		const keys: FederationDiagnosisKey[] = [];
		// このサーバーは、インスタンスアクターの鍵で、HTTP Signatures(draft-cavage)のrsa-sha256で署名する(ApRequestCreator)
		const actor = await this.systemAccountService.fetch('actor');
		const keypair = await this.userKeypairService.getUserKeypair(actor.id);
		keys.push({ source: 'local', ...describePublicKeyPem(keypair.publicKey), algorithm: 'rsa-sha256' });
		keys.push(...fetchedKeys ?? []);
		const stored = await this.userPublickeysRepository.findOneBy({ userId: remoteUserId });
		if (stored != null) keys.push({ source: 'stored', ...describePublicKeyPem(stored.keyPem), algorithm: null });
		return keys;
	}
}
