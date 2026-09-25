#!/usr/bin/env node
// One-off data migration: Cloudflare D1 -> the self-hosted MySQL database.
//
//   1. dump the old D1 data (done on 2026-09-26; the `writer-demo` database has
//      since been deleted from Cloudflare, so `back-end/.d1-export/dump.sql` is
//      the only surviving copy of the pre-migration state):
//        npx wrangler@4 d1 export writer-demo --remote --skip-confirmation \
//          --database 2d0222fe-2cbf-4c37-a534-ffcd41376f79 --output back-end/.d1-export/dump.sql
//      -> back-end/.d1-export/dump.sql        (contains password hashes: never commit)
//
//   2. convert it and read the report (offline, writes nothing to MySQL):
//        node scripts/d1-to-mysql.mjs
//      -> back-end/.d1-export/mysql-import.sql + per-table plan
//
//   3. apply it, then verify by reading every row back:
//        node scripts/d1-to-mysql.mjs --apply
//
// This migration ran on 2026-09-26 and imported 81 rows verified field by field;
// keep the script as the record of how the self-hosted database was seeded.
//
// Why the dump is loaded into a real SQLite first instead of being parsed here:
// D1's export encodes values with SQLite expressions (`replace('a\nb', '\n',
// char(10))` for every newline, and whatever else `quote()` emits). Re-implementing
// that escaping in JS silently corrupts prose, so SQLite evaluates its own dump and
// the values are read back as plain strings.
//
// Fidelity rules:
//   * primary keys are copied verbatim so book_id/chapter_id relations keep
//     pointing at the same row; AUTO_INCREMENT is reseated afterwards;
//   * D1 `datetime` text is UTC and MySQL inherits that meaning (the server-side
//     session time zone is pinned to +00:00 for the import);
//   * `t_login_attempt` is skipped (15-minute rate-limit scratch), `d1_migrations`
//     and `sqlite_sequence` are D1-internal;
//   * the demo accounts seeded by 0001_init.sql are dropped together with
//     everything they own, so no orphan rows survive behind them.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DUMP_DIR = join(ROOT, "back-end", ".d1-export");
// mysql2 lives in the backend's tree; this script is a one-off tool, so it
// borrows that install instead of carrying its own package.json.
const mysql = createRequire(join(ROOT, "back-end", "package.json"))("mysql2/promise");
const OUT_FILE = join(DUMP_DIR, "mysql-import.sql");

/** Tables never carried over, whatever the dump contains. */
const SKIP_TABLES = new Set([
  "d1_migrations",
  "_D1_MIGRATIONS",
  "sqlite_sequence",
  "t_login_attempt",
]);

/** Demo accounts from 0001_init.sql: public weak passwords, not real data. */
const DEMO_USERNAMES = new Set(["admin", "zhangsan"]);

/** Insert order: owners before references (no FKs are declared; this keeps the
 *  generated SQL and the report readable). */
const TABLE_ORDER = [
  "t_user",
  "t_login_log",
  "t_book",
  "t_volume",
  "t_chapter",
  "t_chapter_history",
  "t_entry",
  "t_write_log",
];

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

// --- CLI ---------------------------------------------------------------------

const flags = process.argv.slice(2);
const positional = flags.find((a) => !a.startsWith("--"));
const APPLY = flags.includes("--apply");
const KEEP_DEMO = flags.includes("--keep-demo-accounts");
const FORCE = flags.includes("--force");

// --- read the D1 dump through SQLite -----------------------------------------

function findDump() {
  if (positional) return resolve(process.cwd(), positional);
  if (!existsSync(DUMP_DIR)) return null;
  const sql = readdirSync(DUMP_DIR).filter((f) => f.endsWith(".sql"));
  return sql.length ? join(DUMP_DIR, sql.sort()[0]) : null;
}

const dumpFile = findDump();
if (!dumpFile || !existsSync(dumpFile)) {
  fail(
    `no D1 dump found in ${DUMP_DIR}. Run \`cd back-end && npm run db:export:d1\` first, ` +
      `or pass the file path: node scripts/d1-to-mysql.mjs <dump.sql>`
  );
}

const sqlite = new DatabaseSync(":memory:");
try {
  sqlite.exec(readFileSync(dumpFile, "utf8"));
} catch (error) {
  fail(`SQLite could not apply the dump (${error.message})`);
}

function listTables() {
  const rows = sqlite
    .prepare(
      `select name from sqlite_master
       where type = 'table' and name not like 'sqlite_%'`
    )
    .all();
  return rows.map((r) => String(r.name));
}

/** Rows of one table as plain JS values, keyed by column name. */
function readTable(table) {
  const cols = sqlite
    .prepare(`select name from pragma_table_info(?)`)
    .all(table)
    .map((c) => String(c.name));
  const rows = sqlite.prepare(`select * from "${table}"`).all();
  return { cols, rows: rows.map((r) => cols.map((c) => r[c] ?? null)) };
}

// --- MySQL side --------------------------------------------------------------

function loadEnvValue(key) {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && m[1] === key) return m[2].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

// The service name `mysql` only resolves inside the compose network; this tool
// runs on the host, where the shared server is published on 127.0.0.1:3306.
const COMPOSE_DB_HOST = "mysql";
const rawHost = process.env.DB_HOST ?? loadEnvValue("DB_HOST") ?? COMPOSE_DB_HOST;

const DB_CONFIG = {
  host: rawHost === COMPOSE_DB_HOST ? "127.0.0.1" : rawHost,
  port: Number(process.env.DB_PORT ?? loadEnvValue("DB_PORT") ?? 3306),
  user: process.env.DB_USER ?? loadEnvValue("DB_USER") ?? fail("DB_USER missing"),
  password:
    process.env.DB_PASSWORD ?? loadEnvValue("DB_PASSWORD") ?? fail("DB_PASSWORD missing"),
  database: process.env.DB_NAME ?? loadEnvValue("DB_NAME") ?? "writing_assistant",
  // DATETIME columns must round-trip as the exact UTC text they were written as;
  // letting the driver parse them into JS Dates would re-apply the local zone.
  dateStrings: true,
  multipleStatements: false,
};

/** SQL literal for the generated .sql file (mysql2's escaper, same rules as the driver). */
const literal = (v) => mysql.escape(v);

// --- plan --------------------------------------------------------------------

const allTables = listTables();
const unknown = allTables.filter(
  (t) => !SKIP_TABLES.has(t) && !TABLE_ORDER.includes(t)
);
if (unknown.length) {
  console.log(`⚠️  tables in the dump that this script doesn't know about: ${unknown.join(", ")}`);
}

/** Column sets per table, as MySQL actually has them (import targets existing tables). */
async function mysqlColumns(conn) {
  const [rows] = await conn.query(
    `select table_name, column_name from information_schema.columns
     where table_schema = ? order by table_name, ordinal_position`,
    [DB_CONFIG.database]
  );
  const map = new Map();
  for (const r of rows) {
    const t = String(r.TABLE_NAME ?? r.table_name);
    const c = String(r.COLUMN_NAME ?? r.column_name);
    if (!map.has(t)) map.set(t, []);
    map.get(t).push(c);
  }
  return map;
}

const plan = [];

const dumpTables = TABLE_ORDER.filter(
  (t) => allTables.includes(t) && !SKIP_TABLES.has(t)
);

/** Read every table once, keyed by name, with `{cols, rows}`. */
const data = new Map(
  dumpTables.map((t) => [t, { table: t, ...readTable(t), dropped: 0 }])
);

if (!KEEP_DEMO && data.has("t_user")) {
  const users = data.get("t_user");
  const idIdx = users.cols.indexOf("id");
  const nameIdx = users.cols.indexOf("username");
  if (idIdx < 0 || nameIdx < 0) fail("t_user has no id/username column");

  const demoUserIds = new Set(
    users.rows
      .filter((r) => DEMO_USERNAMES.has(String(r[nameIdx])))
      .map((r) => Number(r[idIdx]))
  );

  const demoBookIds = new Set();
  const demoChapterIds = new Set();

  /** Remove rows whose `col` points at one of `bad`, counting what went away. */
  const dropBy = (table, col, bad) => {
    const p = data.get(table);
    if (!p || bad.size === 0) return;
    const i = p.cols.indexOf(col);
    if (i === -1) return;
    const before = p.rows.length;
    p.rows = p.rows.filter((r) => !bad.has(Number(r[i])));
    p.dropped += before - p.rows.length;
  };

  dropBy("t_user", "id", demoUserIds);
  dropBy("t_login_log", "user_id", demoUserIds);
  dropBy("t_write_log", "user_id", demoUserIds);

  const books = data.get("t_book");
  if (books) {
    const bId = books.cols.indexOf("id");
    const bUser = books.cols.indexOf("user_id");
    for (const r of books.rows) {
      if (demoUserIds.has(Number(r[bUser]))) demoBookIds.add(Number(r[bId]));
    }
    dropBy("t_book", "user_id", demoUserIds);
  }

  const chapters = data.get("t_chapter");
  if (chapters) {
    const cId = chapters.cols.indexOf("id");
    const cBook = chapters.cols.indexOf("book_id");
    for (const r of chapters.rows) {
      if (demoBookIds.has(Number(r[cBook]))) demoChapterIds.add(Number(r[cId]));
    }
    dropBy("t_chapter", "book_id", demoBookIds);
  }

  dropBy("t_volume", "book_id", demoBookIds);
  dropBy("t_entry", "book_id", demoBookIds);
  dropBy("t_chapter_history", "chapter_id", demoChapterIds);

  if (demoUserIds.size) {
    console.log(
      `dropped demo accounts [${[...demoUserIds].join(", ")}] and everything they own ` +
        `(re-run with --keep-demo-accounts to import them too)`
    );
  }
}

for (const t of dumpTables) plan.push(data.get(t));

// --- connect, cross-check schema, emit ---------------------------------------

const conn = await mysql.createConnection(DB_CONFIG);
await conn.query(`set time_zone = '+00:00'`);
const mysqlCols = await mysqlColumns(conn);

/** [source] -> target column order, intersected with what MySQL really has. */
function columnCheck(table, cols) {
  const target = mysqlCols.get(table);
  if (!target) return { missing: cols, extra: [], ok: false };
  const missing = cols.filter((c) => !target.includes(c));
  const extra = target.filter((c) => !cols.includes(c));
  return { missing, extra, ok: missing.length === 0 };
}

const lines = [
  `-- Generated by scripts/d1-to-mysql.mjs from ${dumpFile.replace(ROOT + "/", "")}`,
  `-- MySQL session is pinned to UTC because the timestamps below are UTC text.`,
  `set names utf8mb4;`,
  `set time_zone = '+00:00';`,
  `set foreign_key_checks = 0;`,
  ``,
];

let totalRows = 0;
console.log(`\nD1 dump: ${dumpFile.replace(ROOT + "/", "")}`);
console.log(`target : ${DB_CONFIG.user}@${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}\n`);
console.log("table                 D1   kept  dropped  columns");
console.log("--------------------------------------------------------");

for (const p of plan) {
  const { missing, extra, ok } = columnCheck(p.table, p.cols);
  if (!ok) {
    fail(
      `${p.table}: dump has columns MySQL lacks (${missing.join(", ")}). ` +
        `Align back-end/db/schema.mysql.sql before importing.`
    );
  }

  const source = p.rows.length + p.dropped;
  totalRows += p.rows.length;
  console.log(
    `${p.table.padEnd(20)} ${String(source).padStart(4)} ${String(p.rows.length).padStart(5)} ${String(p.dropped).padStart(8)}  ok` +
      (extra.length ? `  (MySQL-only columns left at default: ${extra.join(", ")})` : "")
  );

  if (!p.rows.length) continue;

  const colList = p.cols.map((c) => `\`${c}\``).join(", ");
  // Chunked so a single statement stays well under max_allowed_packet.
  const CHUNK = 200;
  for (let i = 0; i < p.rows.length; i += CHUNK) {
    const chunk = p.rows.slice(i, i + CHUNK);
    const values = chunk
      .map((r) => `(${r.map((v) => literal(v)).join(", ")})`)
      .join(",\n  ");
    lines.push(
      `insert into \`${p.table}\` (${colList}) values\n  ${values};`,
      ``
    );
  }

  const ids = p.cols.indexOf("id");
  if (ids >= 0) {
    const max = p.rows.reduce((m, r) => Math.max(m, Number(r[ids]) || 0), 0);
    if (max > 0) {
      lines.push(`alter table \`${p.table}\` auto_increment = ${max + 1};`, ``);
    }
  }
}

writeFileSync(OUT_FILE, lines.join("\n"));
console.log(`\nwrote ${OUT_FILE.replace(ROOT + "/", "")} (${totalRows} rows)`);

if (!APPLY) {
  console.log(`\ndry run — nothing was written. Re-run with --apply to import.`);
  await conn.end();
  process.exit(0);
}

// --- apply -------------------------------------------------------------------

if (!FORCE) {
  for (const p of plan) {
    const [rows] = await conn.query(
      `select count(*) as n from information_schema.tables
       where table_schema = ? and table_name = ?`,
      [DB_CONFIG.database, p.table]
    );
    if (Number(rows[0].n) === 0) {
      fail(`${p.table} does not exist in ${DB_CONFIG.database}. Run scripts/db-init.sh first.`);
    }
    const [live] = await conn.query(`select count(*) as n from \`${p.table}\``);
    if (Number(live[0].n) > 0) {
      fail(
        `${p.table} already holds ${live[0].n} rows. Import into an empty database, ` +
          `or pass --force to append anyway.`
      );
    }
  }
}

console.log(`\napplying ${totalRows} rows…`);
await conn.query(`set foreign_key_checks = 0`);
for (const p of plan) {
  if (!p.rows.length) continue;
  const colList = p.cols.map((c) => `\`${c}\``).join(", ");
  for (const row of p.rows) {
    await conn.query(
      `insert into \`${p.table}\` (${colList}) values (${row.map(() => "?").join(", ")})`,
      row.map((v) => (v === undefined ? null : v))
    );
  }
}

// --- verify: read every row back and compare field by field ------------------

console.log("\nverification (row-by-row round-trip):");
let bad = 0;
for (const p of plan) {
  const [live] = await conn.query(
    `select ${p.cols.map((c) => `\`${c}\``).join(", ")} from \`${p.table}\` order by \`${p.cols[0]}\``
  );
  const key = p.cols.indexOf("id");
  const byKey = new Map(
    live.map((r) => [key >= 0 ? String(r.id) : JSON.stringify(r), r])
  );
  let mismatches = 0;
  for (const row of p.rows) {
    const src = Object.fromEntries(p.cols.map((c, i) => [c, row[i]]));
    const target = byKey.get(String(src.id));
    if (!target) {
      mismatches++;
      if (mismatches <= 2) console.log(`  ${p.table}: id ${src.id} missing in MySQL`);
      continue;
    }
    for (const c of p.cols) {
      const a = src[c];
      const b = target[c] === undefined ? null : target[c];
      const same =
        a === b ||
        (a !== null && b !== null && String(a) === String(b));
      if (!same) {
        mismatches++;
        if (mismatches <= 2) {
          console.log(
            `  ${p.table}.id ${src.id} column ${c}: D1=${JSON.stringify(String(a).slice(0, 40))} MySQL=${JSON.stringify(String(b).slice(0, 40))}`
          );
        }
      }
    }
  }
  const okness = mismatches === 0 && live.length === p.rows.length;
  if (!okness) bad++;
  console.log(
    `  ${okness ? "✓" : "✗"} ${p.table.padEnd(20)} ${String(p.rows.length).padStart(4)} expected / ${String(live.length).padStart(4)} in MySQL${mismatches ? ` — ${mismatches} field mismatches` : ""}`
  );
}

await conn.end();
if (bad) {
  console.error(`\n❌ ${bad} table(s) did not round-trip. Data was NOT migrated cleanly.`);
  process.exit(1);
}
console.log(`\n✅ ${totalRows} rows imported and verified.`);
