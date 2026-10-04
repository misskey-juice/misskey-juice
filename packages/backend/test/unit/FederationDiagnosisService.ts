/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import { FederationDiagnosisService, FEDERATION_DIAGNOSIS_CHECK_IDS, describeFederationRequestError } from '@/core/FederationDiagnosisService.js';
import type { FederationDiagnosisCheck } from '@/core/FederationDiagnosisService.js';
import { UtilityService } from '@/core/UtilityService.js';
import { StatusError } from '@/misc/status-error.js';
import type { Config } from '@/config.js';
import type { MiMeta } from '@/models/Meta.js';
import type { MiInstance } from '@/models/Instance.js';

// JUICE: 連合の診断(FederationDiagnosisService)。DIコンテナを使わず、偽の依存を渡して直接インスタンス化する。
// 相手のサーバーへの問い合わせ(HTTP・WebFinger・署名付きの取得)と名前解決は、すべて偽物に差し替える

vi.mock('node:dns/promises', () => ({
	lookup: vi.fn(),
}));

const HOST = 'remote.example';
const SECRET_URL = 'https://remote.example/users/secret-path?token=abcdef';

type FakeResponse = { status: number; body?: unknown } | Error;

type KnownUser = { id: string; username: string; uri: string | null; inbox: string | null; sharedInbox: string | null };

const KNOWN_USER: KnownUser = {
	id: 'user1',
	username: 'alice',
	uri: `https://${HOST}/users/alice`,
	inbox: `https://${HOST}/users/alice/inbox`,
	sharedInbox: `https://${HOST}/inbox`,
};

const DEFAULT_RESPONSES: Record<string, FakeResponse> = {
	[`https://${HOST}/`]: { status: 200 },
	[`https://${HOST}/.well-known/nodeinfo`]: { status: 200, body: { links: [{ rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1', href: `https://${HOST}/nodeinfo/2.1` }] } },
	[`https://${HOST}/nodeinfo/2.1`]: { status: 200, body: { software: { name: 'misskey', version: '2025.1.0' } } },
	[`https://${HOST}/inbox`]: { status: 405 },
	[`https://${HOST}/users/alice/inbox`]: { status: 405 },
};

function instanceOf(overrides: Partial<MiInstance> = {}): MiInstance {
	return {
		host: HOST,
		suspensionState: 'none',
		softwareName: 'misskey',
		softwareVersion: '2025.1.0',
		isNotResponding: false,
		notRespondingSince: null,
		latestRequestReceivedAt: new Date(),
		...overrides,
	} as MiInstance;
}

function setup(options: {
	meta?: Partial<MiMeta>;
	config?: Partial<Config>;
	user?: KnownUser | null;
	jobs?: unknown[];
	responses?: Record<string, FakeResponse>;
	webfinger?: () => Promise<unknown>;
	signedGet?: () => Promise<unknown>;
} = {}) {
	const meta = {
		federation: 'all',
		federationHosts: [],
		blockedHosts: [],
		silencedHosts: [],
		mediaSilencedHosts: [],
		deliverSuspendedSoftware: [],
		...options.meta,
	} as unknown as MiMeta;
	const config = { host: 'local.example', url: 'https://local.example', ...options.config } as Config;
	const responses = { ...DEFAULT_RESPONSES, ...options.responses };

	const send = vi.fn(async (url: string, _args?: unknown, _extra?: unknown) => {
		const response = responses[url];
		if (response == null) throw new Error(`unexpected request: ${url}`);
		if (response instanceof Error) throw response;
		return {
			status: response.status,
			ok: response.status >= 200 && response.status < 300,
			json: async () => {
				if (response.body === undefined) throw new SyntaxError('Unexpected end of JSON input');
				return response.body;
			},
		};
	});
	const findOne = vi.fn(async (_query: unknown) => (options.user === undefined ? KNOWN_USER : options.user));
	const getJobs = vi.fn(async (_types: string[]) => options.jobs ?? []);
	const webfinger = vi.fn(options.webfinger ?? (async () => ({ subject: `acct:alice@${HOST}`, links: [{ rel: 'self', type: 'application/activity+json', href: KNOWN_USER.uri }] })));
	const signedGet = vi.fn(options.signedGet ?? (async () => ({ id: KNOWN_USER.uri, type: 'Person', inbox: KNOWN_USER.inbox })));
	const fetchSystemAccount = vi.fn(async (_type: string) => ({ id: 'system-actor' }));

	const service = new FederationDiagnosisService(
		config,
		meta,
		{ findOne } as never,
		{ getJobs } as never,
		{ send } as never,
		new UtilityService(config, meta),
		{ webfinger } as never,
		{ signedGet } as never,
		{ fetch: fetchSystemAccount } as never,
	);

	return { service, send, findOne, getJobs, webfinger, signedGet, fetchSystemAccount };
}

async function diagnose(options: Parameters<typeof setup>[0] = {}, instance: Partial<MiInstance> = {}) {
	const context = setup(options);
	const checks = await context.service.diagnose(instanceOf(instance));
	const byId = Object.fromEntries(checks.map(check => [check.id, check])) as Record<FederationDiagnosisCheck['id'], FederationDiagnosisCheck>;
	return { ...context, checks, byId };
}

function statusError(statusCode: number) {
	return new StatusError(`${statusCode} error at ${SECRET_URL}`, statusCode, `status text ${SECRET_URL}`);
}

function systemError(code: string, name = 'FetchError') {
	const err = new Error(`request to ${SECRET_URL} failed, reason: ${code}`) as Error & { code: string };
	err.name = name;
	err.code = code;
	return err;
}

function abortError() {
	const err = new Error(`The user aborted a request. ${SECRET_URL}`);
	err.name = 'AbortError';
	return err;
}

describe('FederationDiagnosisService', () => {
	beforeEach(() => {
		vi.mocked(lookup).mockReset();
		vi.mocked(lookup).mockResolvedValue([{ address: '203.0.113.10', family: 4 }, { address: '2001:db8::10', family: 6 }] as never);
	});

	describe('describeFederationRequestError', () => {
		test.each([
			[401, 'rejected', 'HTTP 401'],
			[403, 'rejected', 'HTTP 403'],
			[404, 'notFound', 'HTTP 404'],
			[410, 'gone', 'HTTP 410'],
			[429, 'rateLimited', 'HTTP 429'],
			[500, 'serverError', 'HTTP 500'],
			[503, 'serverError', 'HTTP 503'],
			[400, 'httpError', 'HTTP 400'],
		])('StatusError %i → %s', (statusCode, code, detail) => {
			expect(describeFederationRequestError(statusError(statusCode))).toEqual({ code, detail });
		});

		test('AbortError(時間切れ) → timeout', () => {
			expect(describeFederationRequestError(abortError())).toEqual({ code: 'timeout', detail: null });
			expect(describeFederationRequestError({ type: 'aborted', message: SECRET_URL })).toEqual({ code: 'timeout', detail: null });
		});

		test('名前解決の失敗 → dnsFailed', () => {
			expect(describeFederationRequestError(systemError('ENOTFOUND'))).toEqual({ code: 'dnsFailed', detail: 'ENOTFOUND' });
			expect(describeFederationRequestError(systemError('EAI_AGAIN'))).toEqual({ code: 'dnsFailed', detail: 'EAI_AGAIN' });
		});

		test('接続の失敗 → connectionFailed', () => {
			expect(describeFederationRequestError(systemError('ECONNREFUSED'))).toEqual({ code: 'connectionFailed', detail: 'ECONNREFUSED' });
			expect(describeFederationRequestError(systemError('ECONNRESET'))).toEqual({ code: 'connectionFailed', detail: 'ECONNRESET' });
			expect(describeFederationRequestError(systemError('ETIMEDOUT'))).toEqual({ code: 'connectionFailed', detail: 'ETIMEDOUT' });
		});

		test('証明書のエラー → tlsFailed', () => {
			expect(describeFederationRequestError(systemError('CERT_HAS_EXPIRED'))).toEqual({ code: 'tlsFailed', detail: 'CERT_HAS_EXPIRED' });
			expect(describeFederationRequestError(systemError('DEPTH_ZERO_SELF_SIGNED_CERT'))).toEqual({ code: 'tlsFailed', detail: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
			expect(describeFederationRequestError(systemError('UNABLE_TO_VERIFY_LEAF_SIGNATURE'))).toEqual({ code: 'tlsFailed', detail: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
			expect(describeFederationRequestError(systemError('ERR_TLS_CERT_ALTNAME_INVALID'))).toEqual({ code: 'tlsFailed', detail: 'ERR_TLS_CERT_ALTNAME_INVALID' });
		});

		test('エラーコードが原因(cause)の側にあっても拾う', () => {
			const err = new TypeError(`fetch failed ${SECRET_URL}`, { cause: systemError('ECONNREFUSED') });
			expect(describeFederationRequestError(err)).toEqual({ code: 'connectionFailed', detail: 'ECONNREFUSED' });
		});

		test('JSONとして読めない応答 → invalidResponse', () => {
			expect(describeFederationRequestError(new SyntaxError(`Unexpected token < in JSON ${SECRET_URL}`))).toEqual({ code: 'invalidResponse', detail: null });
			expect(describeFederationRequestError({ name: 'FetchError', type: 'invalid-json', message: SECRET_URL })).toEqual({ code: 'invalidResponse', detail: null });
		});

		test('分からないエラー → requestFailed(補足はエラーの名前かコードだけ)', () => {
			expect(describeFederationRequestError(new Error(`something at ${SECRET_URL}`))).toEqual({ code: 'requestFailed', detail: 'Error' });
			expect(describeFederationRequestError(systemError('EPIPE'))).toEqual({ code: 'requestFailed', detail: 'EPIPE' });
			expect(describeFederationRequestError(null)).toEqual({ code: 'requestFailed', detail: null });
			expect(describeFederationRequestError(undefined)).toEqual({ code: 'requestFailed', detail: null });
			expect(describeFederationRequestError('string error')).toEqual({ code: 'requestFailed', detail: null });
		});

		test('エラーの文・URLは、補足にも種類にも写さない', () => {
			const withUrlInName = new Error(SECRET_URL);
			withUrlInName.name = SECRET_URL;
			const errors: unknown[] = [
				statusError(401), statusError(404), statusError(418), statusError(502),
				abortError(),
				systemError('ENOTFOUND'), systemError('ECONNREFUSED'), systemError('CERT_HAS_EXPIRED'), systemError('EPIPE'),
				// コードの形をしていないもの(URLなど)は、コードとして扱わない
				systemError(SECRET_URL), systemError('lower case code with spaces'),
				new Error(SECRET_URL), new SyntaxError(SECRET_URL), withUrlInName,
				{ message: SECRET_URL, code: 42, name: 123 },
			];
			for (const err of errors) {
				const result = JSON.stringify(describeFederationRequestError(err));
				expect(result).not.toContain('secret-path');
				expect(result).not.toContain('token=');
				expect(result).not.toContain('https://');
				expect(result).not.toContain('remote.example');
			}
			expect(describeFederationRequestError(systemError(SECRET_URL))).toEqual({ code: 'requestFailed', detail: 'FetchError' });
			expect(describeFederationRequestError(withUrlInName)).toEqual({ code: 'requestFailed', detail: null });
		});
	});

	describe('diagnose', () => {
		test('問題がなければ、決まった順番ですべての項目がokになる', async () => {
			const { checks, byId, send, webfinger, signedGet, fetchSystemAccount, findOne } = await diagnose();
			expect(checks.map(check => check.id)).toEqual([...FEDERATION_DIAGNOSIS_CHECK_IDS]);
			expect(checks.map(check => check.status)).toEqual(checks.map(() => 'ok'));
			// 署名付きの取得だけは、取れても拒否されていないとは限らない旨の説明を付ける
			expect(checks.filter(check => check.code !== null).map(check => [check.id, check.code])).toEqual([['actor', 'actorFetched']]);

			// このサーバーの設定・状態の項目は、かかった時間を持たない。相手へ問い合わせた項目は持つ
			for (const id of ['federationMode', 'blocked', 'silenced', 'suspension', 'responding', 'lastReceived', 'deliverQueue'] as const) {
				expect(byId[id].elapsedMs).toBeNull();
			}
			for (const id of ['dns', 'https', 'nodeinfo', 'webfinger', 'actor', 'inbox'] as const) {
				expect(typeof byId[id].elapsedMs).toBe('number');
			}

			expect(byId.deliverQueue.detail).toBe('0');
			expect(byId.dns.detail).toBe('203.0.113.10, 2001:db8::10');
			expect(byId.https.detail).toBe('HTTP 200');
			expect(byId.nodeinfo.detail).toBe('misskey 2025.1.0');
			expect(byId.inbox.detail).toBe('HTTP 405');

			// 相手のサーバーには、読み取り(GET)の問い合わせしかしない
			expect(send.mock.calls.length).toBeGreaterThan(0);
			for (const call of send.mock.calls) {
				expect((call[1] as { method: string }).method).toBe('GET');
			}
			// 共有inboxがあれば、そちらを見る
			expect(send.mock.calls.map(call => call[0])).toContain(`https://${HOST}/inbox`);
			expect(send.mock.calls.map(call => call[0])).not.toContain(`https://${HOST}/users/alice/inbox`);

			expect(findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { host: HOST, isDeleted: false, isSuspended: false } }));
			expect(webfinger).toHaveBeenCalledWith(`alice@${HOST}`);
			// 署名付きの取得は、システムの'actor'アカウントで行う
			expect(fetchSystemAccount).toHaveBeenCalledWith('actor');
			expect(signedGet).toHaveBeenCalledWith(KNOWN_USER.uri, { id: 'system-actor' });
		});

		describe('federationMode', () => {
			test('連合しない設定(none) → error federationDisabled', async () => {
				const { byId } = await diagnose({ meta: { federation: 'none' } });
				expect(byId.federationMode).toEqual({ id: 'federationMode', status: 'error', code: 'federationDisabled', detail: null, elapsedMs: null });
			});

			test('指定したサーバーだけ(specified)で、一覧に無い → error notInAllowlist', async () => {
				const { byId } = await diagnose({ meta: { federation: 'specified', federationHosts: ['other.example', 'emote.example'] } });
				expect(byId.federationMode).toEqual({ id: 'federationMode', status: 'error', code: 'notInAllowlist', detail: null, elapsedMs: null });
			});

			test('指定したサーバーだけ(specified)で、一覧にある(親のドメインでもよい) → ok', async () => {
				expect((await diagnose({ meta: { federation: 'specified', federationHosts: [HOST] } })).byId.federationMode.status).toBe('ok');
				expect((await diagnose({ meta: { federation: 'specified', federationHosts: ['example'] } })).byId.federationMode.status).toBe('ok');
			});
		});

		describe('blocked', () => {
			test('ブロックしているサーバー → error blocked', async () => {
				const { byId } = await diagnose({ meta: { blockedHosts: [HOST] } });
				expect(byId.blocked).toEqual({ id: 'blocked', status: 'error', code: 'blocked', detail: null, elapsedMs: null });
			});

			test('ブロックしているサーバーのサブドメイン → error blocked', async () => {
				const { byId } = await diagnose({ meta: { blockedHosts: [HOST] } }, { host: `sub.${HOST}` });
				expect(byId.blocked.status).toBe('error');
				expect(byId.blocked.code).toBe('blocked');
			});

			test('後ろが同じだけの別のサーバーは、ブロックの扱いにしない', async () => {
				const { byId } = await diagnose({ meta: { blockedHosts: ['emote.example'] } });
				expect(byId.blocked.status).toBe('ok');
			});
		});

		describe('silenced', () => {
			test('サイレンスだけ → warn silenced', async () => {
				const { byId } = await diagnose({ meta: { silencedHosts: [HOST] } });
				expect(byId.silenced).toEqual({ id: 'silenced', status: 'warn', code: 'silenced', detail: null, elapsedMs: null });
			});

			test('メディアサイレンスだけ → warn mediaSilenced', async () => {
				const { byId } = await diagnose({ meta: { mediaSilencedHosts: [HOST] } });
				expect(byId.silenced).toEqual({ id: 'silenced', status: 'warn', code: 'mediaSilenced', detail: null, elapsedMs: null });
			});

			test('両方 → warn silencedAndMediaSilenced', async () => {
				const { byId } = await diagnose({ meta: { silencedHosts: [HOST], mediaSilencedHosts: [HOST] } });
				expect(byId.silenced).toEqual({ id: 'silenced', status: 'warn', code: 'silencedAndMediaSilenced', detail: null, elapsedMs: null });
			});

			test('どちらでもない → ok', async () => {
				const { byId } = await diagnose({ meta: { silencedHosts: ['other.example'], mediaSilencedHosts: ['other.example'] } });
				expect(byId.silenced.status).toBe('ok');
			});
		});

		describe('suspension', () => {
			test.each(['manuallySuspended', 'goneSuspended', 'autoSuspendedForNotResponding'] as const)('配送の停止(%s) → error', async (suspensionState) => {
				const { byId } = await diagnose({}, { suspensionState });
				expect(byId.suspension).toEqual({ id: 'suspension', status: 'error', code: suspensionState, detail: null, elapsedMs: null });
			});

			test('ソフトウェアの指定による配送の停止 → error softwareSuspended(補足はソフトウェアの名前とバージョン)', async () => {
				const { byId } = await diagnose(
					{ meta: { deliverSuspendedSoftware: [{ software: 'badware', versionRange: '>=1.0.0' }] } },
					{ softwareName: 'badware', softwareVersion: '1.2.3' },
				);
				expect(byId.suspension).toEqual({ id: 'suspension', status: 'error', code: 'softwareSuspended', detail: 'badware 1.2.3', elapsedMs: null });
			});

			test('ソフトウェアの指定に当てはまらないバージョンは、停止の扱いにしない', async () => {
				const { byId } = await diagnose(
					{ meta: { deliverSuspendedSoftware: [{ software: 'badware', versionRange: '>=2.0.0' }] } },
					{ softwareName: 'badware', softwareVersion: '1.2.3' },
				);
				expect(byId.suspension.status).toBe('ok');
			});

			test('手動の停止とソフトウェアの指定が重なれば、手動の停止を出す', async () => {
				const { byId } = await diagnose(
					{ meta: { deliverSuspendedSoftware: [{ software: 'badware', versionRange: '*' }] } },
					{ softwareName: 'badware', softwareVersion: null, suspensionState: 'manuallySuspended' },
				);
				expect(byId.suspension.code).toBe('manuallySuspended');
			});
		});

		describe('responding', () => {
			test('応答がない状態 → warn notResponding(補足は応答がなくなった日時)', async () => {
				const since = new Date('2026-01-02T03:04:05.000Z');
				const { byId } = await diagnose({}, { isNotResponding: true, notRespondingSince: since });
				expect(byId.responding).toEqual({ id: 'responding', status: 'warn', code: 'notResponding', detail: '2026-01-02T03:04:05.000Z', elapsedMs: null });
			});

			test('応答がなくなった日時が無くても落ちない', async () => {
				const { byId } = await diagnose({}, { isNotResponding: true, notRespondingSince: null });
				expect(byId.responding).toEqual({ id: 'responding', status: 'warn', code: 'notResponding', detail: null, elapsedMs: null });
			});
		});

		describe('lastReceived', () => {
			test('一度も届いていない → warn neverReceived', async () => {
				const { byId } = await diagnose({}, { latestRequestReceivedAt: null });
				expect(byId.lastReceived).toEqual({ id: 'lastReceived', status: 'warn', code: 'neverReceived', detail: null, elapsedMs: null });
			});

			test('1週間より長く届いていない → warn stale', async () => {
				const at = new Date(Date.now() - 1000 * 60 * 60 * 24 * 8);
				const { byId } = await diagnose({}, { latestRequestReceivedAt: at });
				expect(byId.lastReceived).toEqual({ id: 'lastReceived', status: 'warn', code: 'stale', detail: at.toISOString(), elapsedMs: null });
			});

			test('最近届いている → ok(補足は届いた日時)', async () => {
				const at = new Date(Date.now() - 1000 * 60 * 60 * 24 * 6);
				const { byId } = await diagnose({}, { latestRequestReceivedAt: at });
				expect(byId.lastReceived).toEqual({ id: 'lastReceived', status: 'ok', code: null, detail: at.toISOString(), elapsedMs: null });
			});
		});

		describe('deliverQueue', () => {
			test('再送を待っているジョブは、そのサーバー宛てのものだけを数える', async () => {
				const { byId, getJobs } = await diagnose({
					jobs: [
						{ data: { to: `https://${HOST}/inbox` } },
						{ data: { to: `https://${HOST}/users/alice/inbox` } },
						{ data: { to: `https://REMOTE.example/inbox` } },
						{ data: { to: 'https://other.example/inbox' } },
						{ data: { to: `https://sub.${HOST}/inbox` } },
						{ data: { to: `https://${HOST}.evil.example/inbox` } },
						// 宛先が壊れているジョブ・消えたジョブがあっても落ちない
						{ data: { to: 'not a url' } },
						{ data: {} },
						undefined,
					],
				});
				expect(byId.deliverQueue).toEqual({ id: 'deliverQueue', status: 'warn', code: 'delayed', detail: '3', elapsedMs: null });
				expect(getJobs).toHaveBeenCalledWith(['delayed'], 0, 4999);
			});

			test('そのサーバー宛てのジョブが無ければok', async () => {
				const { byId } = await diagnose({ jobs: [{ data: { to: 'https://other.example/inbox' } }] });
				expect(byId.deliverQueue).toEqual({ id: 'deliverQueue', status: 'ok', code: null, detail: '0', elapsedMs: null });
			});

			test('キューを読めなくても、ほかの項目は続ける', async () => {
				const context = setup();
				context.getJobs.mockRejectedValue(systemError('ECONNREFUSED'));
				const checks = await context.service.diagnose(instanceOf());
				expect(checks.map(check => check.id)).toEqual([...FEDERATION_DIAGNOSIS_CHECK_IDS]);
				// このサーバーの中の失敗は、相手のサーバーの問題として出さない
				expect(checks.find(check => check.id === 'deliverQueue')).toEqual({ id: 'deliverQueue', status: 'skipped', code: 'internalError', detail: null, elapsedMs: null });
				expect(checks.find(check => check.id === 'https')?.status).toBe('ok');
			});
		});

		describe('dns', () => {
			test('名前解決できない → error dnsFailed', async () => {
				vi.mocked(lookup).mockRejectedValue(systemError('ENOTFOUND', 'Error'));
				const { byId } = await diagnose();
				expect(byId.dns).toMatchObject({ status: 'error', code: 'dnsFailed', detail: 'ENOTFOUND' });
				expect(typeof byId.dns.elapsedMs).toBe('number');
			});

			test('アドレスが1つも返らない → error dnsFailed', async () => {
				vi.mocked(lookup).mockResolvedValue([] as never);
				const { byId } = await diagnose();
				expect(byId.dns).toMatchObject({ status: 'error', code: 'dnsFailed', detail: null });
			});

			test('補足に出すアドレスは4つまで', async () => {
				vi.mocked(lookup).mockResolvedValue([1, 2, 3, 4, 5, 6].map(n => ({ address: `203.0.113.${n}`, family: 4 })) as never);
				const { byId } = await diagnose();
				expect(byId.dns.detail).toBe('203.0.113.1, 203.0.113.2, 203.0.113.3, 203.0.113.4');
			});

			test('プロキシを使う設定では確かめない(skipped proxy)。プロキシを通さないサーバーなら確かめる', async () => {
				const proxied = await diagnose({ config: { proxy: 'http://proxy.example:8080' } });
				expect(proxied.byId.dns).toMatchObject({ status: 'skipped', code: 'proxy', detail: null });
				expect(lookup).not.toHaveBeenCalled();

				const bypassed = await diagnose({ config: { proxy: 'http://proxy.example:8080', proxyBypassHosts: [HOST] } });
				expect(bypassed.byId.dns.status).toBe('ok');
				expect(lookup).toHaveBeenCalledWith(HOST, { all: true });
			});
		});

		describe('https', () => {
			test('つながらない → error。その先の項目はskipped unreachableになり、問い合わせもしない', async () => {
				const { byId, send, webfinger, signedGet } = await diagnose({ responses: { [`https://${HOST}/`]: systemError('ECONNREFUSED') } });
				expect(byId.https).toMatchObject({ status: 'error', code: 'connectionFailed', detail: 'ECONNREFUSED' });
				for (const id of ['nodeinfo', 'webfinger', 'actor', 'inbox'] as const) {
					expect(byId[id]).toEqual({ id, status: 'skipped', code: 'unreachable', detail: null, elapsedMs: null });
				}
				expect(send).toHaveBeenCalledTimes(1);
				expect(webfinger).not.toHaveBeenCalled();
				expect(signedGet).not.toHaveBeenCalled();
			});

			test('時間切れ → error timeout。その先はskipped unreachable', async () => {
				const { byId } = await diagnose({ responses: { [`https://${HOST}/`]: abortError() } });
				expect(byId.https).toMatchObject({ status: 'error', code: 'timeout', detail: null });
				expect(byId.inbox.code).toBe('unreachable');
			});

			test('証明書のエラー → error tlsFailed', async () => {
				const { byId } = await diagnose({ responses: { [`https://${HOST}/`]: systemError('CERT_HAS_EXPIRED') } });
				expect(byId.https).toMatchObject({ status: 'error', code: 'tlsFailed', detail: 'CERT_HAS_EXPIRED' });
				expect(byId.nodeinfo.code).toBe('unreachable');
			});

			test('5xx → error serverError。つながってはいるので、その先も確かめる', async () => {
				const { byId } = await diagnose({ responses: { [`https://${HOST}/`]: { status: 502 } } });
				expect(byId.https).toMatchObject({ status: 'error', code: 'serverError', detail: 'HTTP 502' });
				expect(byId.nodeinfo.status).toBe('ok');
				expect(byId.webfinger.status).toBe('ok');
				expect(byId.actor.status).toBe('ok');
				expect(byId.inbox.status).toBe('ok');
			});

			test('4xxでも、応答があればok', async () => {
				const { byId } = await diagnose({ responses: { [`https://${HOST}/`]: { status: 403 } } });
				expect(byId.https).toMatchObject({ status: 'ok', code: null, detail: 'HTTP 403' });
			});

			test('エラーの文に入っているURLは、結果に出ない', async () => {
				const { checks } = await diagnose({
					responses: { [`https://${HOST}/`]: systemError('ECONNREFUSED') },
				});
				expect(JSON.stringify(checks)).not.toContain('secret-path');
			});
		});

		describe('このサーバーが知っているユーザーがいないとき', () => {
			test('webfinger・actor・inboxはskipped noKnownUser。nodeinfoは確かめる', async () => {
				const { byId, webfinger, signedGet, send } = await diagnose({ user: null });
				for (const id of ['webfinger', 'actor', 'inbox'] as const) {
					expect(byId[id]).toEqual({ id, status: 'skipped', code: 'noKnownUser', detail: null, elapsedMs: null });
				}
				expect(byId.nodeinfo.status).toBe('ok');
				expect(webfinger).not.toHaveBeenCalled();
				expect(signedGet).not.toHaveBeenCalled();
				expect(send.mock.calls.map(call => call[0])).not.toContain(`https://${HOST}/inbox`);
			});

			test('つながらないときは、ユーザーがいなくてもunreachableを先に出す', async () => {
				const { byId } = await diagnose({ user: null, responses: { [`https://${HOST}/`]: systemError('ENOTFOUND') } });
				expect(byId.https).toMatchObject({ status: 'error', code: 'dnsFailed' });
				expect(byId.webfinger.code).toBe('unreachable');
			});

			test('ユーザーにuri・inboxが無ければ、その項目だけskippedにする', async () => {
				const { byId } = await diagnose({ user: { ...KNOWN_USER, uri: null, inbox: null, sharedInbox: null } });
				expect(byId.webfinger.status).toBe('ok');
				expect(byId.actor).toMatchObject({ status: 'skipped', code: 'noKnownUser' });
				expect(byId.inbox).toMatchObject({ status: 'skipped', code: 'noKnownUser' });
			});
		});

		describe('nodeinfo', () => {
			test('取れなくても連合はできるので、失敗はwarnに下げる', async () => {
				const thrown = await diagnose({ responses: { [`https://${HOST}/.well-known/nodeinfo`]: systemError('ECONNRESET') } });
				expect(thrown.byId.nodeinfo).toMatchObject({ status: 'warn', code: 'connectionFailed', detail: 'ECONNRESET' });

				const timeout = await diagnose({ responses: { [`https://${HOST}/nodeinfo/2.1`]: abortError() } });
				expect(timeout.byId.nodeinfo).toMatchObject({ status: 'warn', code: 'timeout', detail: null });
			});

			test('HTTPのエラー → warn httpError', async () => {
				const wellKnown = await diagnose({ responses: { [`https://${HOST}/.well-known/nodeinfo`]: { status: 404 } } });
				expect(wellKnown.byId.nodeinfo).toMatchObject({ status: 'warn', code: 'httpError', detail: 'HTTP 404' });

				const info = await diagnose({ responses: { [`https://${HOST}/nodeinfo/2.1`]: { status: 500 } } });
				expect(info.byId.nodeinfo).toMatchObject({ status: 'warn', code: 'httpError', detail: 'HTTP 500' });
			});

			test('リンクが別のサーバーを指している → warn invalidResponse(そのURLへは問い合わせない)', async () => {
				const { byId, send } = await diagnose({
					responses: {
						[`https://${HOST}/.well-known/nodeinfo`]: { status: 200, body: { links: [{ rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1', href: 'https://other.example/nodeinfo/2.1' }] } },
					},
				});
				expect(byId.nodeinfo).toMatchObject({ status: 'warn', code: 'invalidResponse', detail: null });
				expect(send.mock.calls.map(call => call[0])).not.toContain('https://other.example/nodeinfo/2.1');
			});

			test('リンクが無い・形がおかしい・JSONでない → warn invalidResponse', async () => {
				const wellKnownUrl = `https://${HOST}/.well-known/nodeinfo`;
				for (const body of [
					{},
					{ links: [] },
					{ links: [{ rel: 'http://nodeinfo.diaspora.software/ns/schema/1.0', href: `https://${HOST}/nodeinfo/1.0` }] },
					{ links: [{ rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1' }] },
					{ links: [{ rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1', href: 'not a url' }] },
					undefined,
				]) {
					const { byId } = await diagnose({ responses: { [wellKnownUrl]: { status: 200, body } } });
					// どの形でも、落ちずにwarnになる
					expect(byId.nodeinfo.status).toBe('warn');
					expect(JSON.stringify(byId.nodeinfo)).not.toContain('not a url');
				}
				const noLink = await diagnose({ responses: { [wellKnownUrl]: { status: 200, body: { links: [] } } } });
				expect(noLink.byId.nodeinfo.code).toBe('invalidResponse');
				const notJson = await diagnose({ responses: { [wellKnownUrl]: { status: 200 } } });
				expect(notJson.byId.nodeinfo.code).toBe('invalidResponse');
			});

			test('ソフトウェアの名前が無い → warn invalidResponse。バージョンが無ければ名前だけ出す', async () => {
				const noName = await diagnose({ responses: { [`https://${HOST}/nodeinfo/2.1`]: { status: 200, body: { software: { version: '1.0.0' } } } } });
				expect(noName.byId.nodeinfo).toMatchObject({ status: 'warn', code: 'invalidResponse', detail: null });

				const noVersion = await diagnose({ responses: { [`https://${HOST}/nodeinfo/2.1`]: { status: 200, body: { software: { name: 'mastodon' } } } } });
				expect(noVersion.byId.nodeinfo).toMatchObject({ status: 'ok', code: null, detail: 'mastodon' });
			});

			test('ソフトウェアの名前・バージョンは64文字までに切る', async () => {
				const { byId } = await diagnose({ responses: { [`https://${HOST}/nodeinfo/2.1`]: { status: 200, body: { software: { name: 'n'.repeat(200), version: 'v'.repeat(200) } } } } });
				expect(byId.nodeinfo.detail).toBe(`${'n'.repeat(64)} ${'v'.repeat(64)}`);
			});

			test('2.0と2.1の両方があれば、後ろのものを使う', async () => {
				const { byId, send } = await diagnose({
					responses: {
						[`https://${HOST}/.well-known/nodeinfo`]: { status: 200, body: { links: [
							{ rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0', href: `https://${HOST}/nodeinfo/2.0` },
							{ rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1', href: `https://${HOST}/nodeinfo/2.1` },
						] } },
					},
				});
				expect(byId.nodeinfo.status).toBe('ok');
				expect(send.mock.calls.map(call => call[0])).not.toContain(`https://${HOST}/nodeinfo/2.0`);
			});
		});

		describe('webfinger', () => {
			test('self のリンクが無い → error invalidResponse', async () => {
				const noSelf = await diagnose({ webfinger: async () => ({ subject: `acct:alice@${HOST}`, links: [{ rel: 'http://webfinger.net/rel/profile-page', href: `https://${HOST}/@alice` }] }) });
				expect(noSelf.byId.webfinger).toMatchObject({ status: 'error', code: 'invalidResponse', detail: null });
				const noLinks = await diagnose({ webfinger: async () => ({ subject: `acct:alice@${HOST}` }) });
				expect(noLinks.byId.webfinger).toMatchObject({ status: 'error', code: 'invalidResponse', detail: null });
			});

			test('404 → warn userGone(確かめるのに使ったユーザーがいないだけで、サーバーの問題とは限らない)', async () => {
				const { byId } = await diagnose({ webfinger: async () => { throw statusError(404); } });
				expect(byId.webfinger).toMatchObject({ status: 'warn', code: 'userGone', detail: 'HTTP 404' });
			});
		});

		describe('actor(署名付きの取得)', () => {
			test.each([401, 403])('%i → error rejected(相手がこのサーバーを拒否している)', async (statusCode) => {
				const { byId } = await diagnose({ signedGet: async () => { throw statusError(statusCode); } });
				expect(byId.actor).toMatchObject({ status: 'error', code: 'rejected', detail: `HTTP ${statusCode}` });
				expect(typeof byId.actor.elapsedMs).toBe('number');
				// ほかの項目には響かない
				expect(byId.webfinger.status).toBe('ok');
				expect(byId.inbox.status).toBe('ok');
			});

			test('404・410 → warn userGone、5xx → error serverError', async () => {
				const notFound = await diagnose({ signedGet: async () => { throw statusError(404); } });
				expect(notFound.byId.actor).toMatchObject({ status: 'warn', code: 'userGone', detail: 'HTTP 404' });
				const gone = await diagnose({ signedGet: async () => { throw statusError(410); } });
				expect(gone.byId.actor).toMatchObject({ status: 'warn', code: 'userGone', detail: 'HTTP 410' });
				const serverError = await diagnose({ signedGet: async () => { throw statusError(503); } });
				expect(serverError.byId.actor).toMatchObject({ status: 'error', code: 'serverError', detail: 'HTTP 503' });
			});

			test('返ってきたものにidが無い → error invalidResponse', async () => {
				for (const object of [null, {}, { id: 123 }, 'text']) {
					const { byId } = await diagnose({ signedGet: async () => object });
					expect(byId.actor).toMatchObject({ status: 'error', code: 'invalidResponse', detail: null });
				}
			});

			test('エラーの文に入っているURLは、結果に出ない', async () => {
				const { checks } = await diagnose({
					signedGet: async () => { throw new Error(`failed to fetch ${SECRET_URL}`); },
					webfinger: async () => { throw statusError(500); },
				});
				expect(JSON.stringify(checks)).not.toContain('secret-path');
				expect(checks.find(check => check.id === 'actor')).toMatchObject({ status: 'error', code: 'requestFailed', detail: 'Error' });
			});
		});

		describe('inbox', () => {
			test.each([400, 401, 404, 405])('GETを受け付けない(%i)のは普通なので、応答があればok', async (status) => {
				const { byId } = await diagnose({ responses: { [`https://${HOST}/inbox`]: { status } } });
				expect(byId.inbox).toMatchObject({ status: 'ok', code: null, detail: `HTTP ${status}` });
			});

			test.each([500, 502, 503])('5xx(%i) → error serverError', async (status) => {
				const { byId } = await diagnose({ responses: { [`https://${HOST}/inbox`]: { status } } });
				expect(byId.inbox).toMatchObject({ status: 'error', code: 'serverError', detail: `HTTP ${status}` });
			});

			test('つながらない → error', async () => {
				const { byId } = await diagnose({ responses: { [`https://${HOST}/inbox`]: abortError() } });
				expect(byId.inbox).toMatchObject({ status: 'error', code: 'timeout', detail: null });
			});

			test('共有inboxが無ければ、ユーザーのinboxを見る', async () => {
				const { byId, send } = await diagnose({ user: { ...KNOWN_USER, sharedInbox: null } });
				expect(byId.inbox).toMatchObject({ status: 'ok', detail: 'HTTP 405' });
				expect(send.mock.calls.map(call => call[0])).toContain(`https://${HOST}/users/alice/inbox`);
			});
		});
	});
});
