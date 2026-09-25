// MySQL driver exposing the exact surface the services already use against D1
// (`prepare(sql).bind(...).all/first/run` plus transactional `batch`), so no
// service has to know which engine it runs on.

import mysql, { type PoolConnection } from "mysql2/promise";
import type { ExecuteValues, OkPacket } from "mysql2";

export interface MysqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface Meta {
  changes: number;
  last_row_id: number;
}

interface QueryOutcome {
  rows: Record<string, unknown>[];
  meta: Meta;
}

/** Statement surface plus the pieces `batch` needs to re-run it on one connection. */
interface Prepared {
  bind(...values: unknown[]): Prepared;
  all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Meta }>;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<{ success: boolean; meta: Meta }>;
  readonly sql: string;
  readonly params: unknown[];
}

/**
 * D1 stores `CURRENT_TIMESTAMP` as UTC while this deployment's MySQL defaults to
 * `+08:00` (mysql-server/mysql/conf.d/my.cnf), so statements run on a
 * connection pinned to UTC and DATETIME keeps its D1 meaning.
 */
async function executeOn(
  conn: PoolConnection,
  utcConnections: Set<number>,
  sql: string,
  params: unknown[]
): Promise<QueryOutcome> {
  if (!utcConnections.has(conn.threadId)) {
    await conn.query("SET time_zone = '+00:00'");
    utcConnections.add(conn.threadId);
  }
  const [result] = await conn.execute(sql, params as ExecuteValues[]);
  if (Array.isArray(result)) {
    return {
      rows: result as Record<string, unknown>[],
      meta: { changes: result.length, last_row_id: 0 },
    };
  }
  const ok = result as OkPacket;
  return {
    rows: [],
    meta: { changes: ok.affectedRows ?? 0, last_row_id: ok.insertId ?? 0 },
  };
}

/**
 * `undefined` is a bind error on mysql2 but stores NULL on D1, so normalise
 * before the value reaches the driver.
 */
function normalize(values: unknown[]): unknown[] {
  return values.map((value) => (value === undefined ? null : value));
}

function createPrepared(
  sql: string,
  params: unknown[],
  exec: (sql: string, params: unknown[]) => Promise<QueryOutcome>
): Prepared {
  return {
    sql,
    params,
    bind(...values: unknown[]) {
      return createPrepared(sql, [...params, ...normalize(values)], exec);
    },
    async all<T = unknown>() {
      const { rows, meta } = await exec(sql, params);
      return { results: rows as T[], success: true, meta };
    },
    async first<T = unknown>() {
      const { rows } = await exec(sql, params);
      return (rows[0] as T) ?? null;
    },
    async run<T = unknown>() {
      const { meta } = await exec(sql, params);
      return { success: true, meta };
    },
  };
}

export interface DatabaseHandle {
  DB: AppDatabase;
  close(): Promise<void>;
}

export function createMysqlDatabase(config: MysqlConfig): DatabaseHandle {
  const pool = mysql.createPool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // DATETIME comes back as 'YYYY-MM-DD HH:MM:SS' text, exactly like D1 —
    // clients treat `update_time` as an opaque optimistic-lock token.
    dateStrings: true,
    // `sum()`/`count()` arrive as DECIMAL/BIGINT; D1 hands back plain numbers and
    // the envelope must not turn word counts into strings.
    decimalNumbers: true,
    // D1/SQLite report UPDATE matches; MySQL reports actual value changes
    // unless the client negotiates CLIENT_FOUND_ROWS — mysql2 sends it by
    // default, which keeps `changes` meaning "rows matched". The
    // `WHERE version = ?` guard relies on that: a rewrite that happens to
    // store identical values must still count as a hit.
    flags: ["FOUND_ROWS"],
    // Stacked statements would turn any injection into an escalation.
    multipleStatements: false,
  });
  const utcConnections = new Set<number>();

  const exec = (sql: string, params: unknown[]) =>
    pool
      .getConnection()
      .then((conn) =>
        executeOn(conn, utcConnections, sql, params).finally(() =>
          conn.release()
        )
      );

  const DB = {
    prepare(sql: string) {
      return createPrepared(sql, [], exec);
    },
    async batch(statements: Prepared[]) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const results: { success: boolean; meta: Meta }[] = [];
        for (const statement of statements) {
          const { meta } = await executeOn(
            conn,
            utcConnections,
            statement.sql,
            statement.params
          );
          results.push({ success: true, meta });
        }
        await conn.commit();
        return results;
      } catch (error) {
        await conn.rollback();
        throw error;
      } finally {
        conn.release();
      }
    },
  };

  return {
    DB,
    close: () => pool.end(),
  };
}
