/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';

/**
 * 開発用DBを誤って消さないためのガード。
 *
 * 読む設定ファイル(default.yml / test.yml)は NODE_ENV や MISSKEY_CONFIG_YML で変わるため、
 * 環境変数だけを信用すると設定と実際の接続先がズレたときに
 * 開発用DBを削除してしまう。実際の接続先DB名を検証しておく。
 */
export function assertTestDatabaseName(database: unknown, context: string) {
	if (typeof database !== 'string' || !database.includes('test')) {
		throw new Error(`${context}: refusing to reset/sync a database that does not look like a test database (database=${String(database)}). Check which config file was loaded — it may be default.yml.`);
	}
}

export function assertTestDatabase(db: DataSource) {
	assertTestDatabaseName(db.options.database, 'resetDb');
}

export async function resetDb(db: DataSource) {
	assertTestDatabase(db);

	const reset = async () => {
		const tables = await db.query(`SELECT relname AS "table"
		FROM pg_class C LEFT JOIN pg_namespace N ON (N.oid = C.relnamespace)
		WHERE nspname NOT IN ('pg_catalog', 'information_schema')
			AND C.relkind = 'r'
			AND nspname !~ '^pg_toast';`);
		for (const table of tables) {
			await db.query(`DELETE FROM "${table.table}" CASCADE`);
		}
	};

	for (let i = 1; i <= 3; i++) {
		try {
			await reset();
		} catch (e) {
			if (i === 3) {
				throw e;
			} else {
				await new Promise(resolve => setTimeout(resolve, 1000));
				continue;
			}
		}
		break;
	}
}
