// Runtime environment for the self-hosted (Node + MySQL) API.
//
// This replaces the `Env` interface `wrangler types` used to generate. The DB
// binding keeps D1's `prepare(sql).bind(...).all/first/run` surface — service
// code is written against it — but is implemented by src/db/mysql.ts.
//
// Ambient (no top-level import/export) so `Env` stays a global, as before.

interface QueryMeta {
  /** Rows *matched* by the statement (see the driver's FOUND_ROWS note). */
  changes: number;
  /** AUTO_INCREMENT id of the last INSERT. */
  last_row_id: number;
}

interface AppStatement {
  bind(...values: unknown[]): AppStatement;
  all<T = unknown>(): Promise<{
    results: T[];
    success: boolean;
    meta: QueryMeta;
  }>;
  first<T = unknown>(): Promise<T | null>;
  run<T = unknown>(): Promise<{ success: boolean; meta: QueryMeta }>;
}

interface AppDatabase {
  prepare(sql: string): AppStatement;
  /** Runs the statements in one transaction (max 100 per call). */
  batch(statements: AppStatement[]): Promise<
    { success: boolean; meta: QueryMeta }[]
  >;
}

interface Env {
  DB: AppDatabase;
  /** HMAC keys for the access / refresh tokens (>= 32 chars each). */
  TOKEN_SECRET: string;
  REFRESH_SECRET: string;
}
