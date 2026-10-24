import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const ALIAS_ACCOUNT = "c25be21f175bf10728876d8ca26a9619";
export const ALIAS_DATABASE = "8df53ce1-0e9d-4e51-aaac-329f84cf1d5f";
export const ALIAS_ORIGIN = "https://staging.tembotechventures.com";
export const LEGACY_MIGRATION = "0003_magenta_reaper.sql";
export const CANONICAL_MIGRATION = "0007_workable_nova.sql";
export const MIGRATION_DIGEST = "f62b2a39f8992a66f83875fc084de2850a1d7bbad6b80c57d153a60567a937a4";
const timestamps = ["2026-04-04 13:38:09", "2026-04-05 00:10:59", "2026-05-27 14:23:03", "2026-07-15 10:01:23",
  "2026-10-24 11:41:49", "2026-10-24 11:41:49", "2026-10-24 11:41:50", "2026-10-24 11:41:50"];
const names = ["0000_greedy_carnage.sql", "0001_soft_silver_centurion.sql", "0002_married_microbe.sql", LEGACY_MIGRATION,
  "0003_absurd_argent.sql", "0004_seed_admin_role.sql", "0005_brief_spiral.sql", "0006_spooky_agent_zero.sql"];
const migrationPath = new URL(`../../src/lib/db/migrations/${CANONICAL_MIGRATION}`, import.meta.url);
const hash = value => createHash("sha256").update(value).digest("hex");
const normalize = sql => sql.trim().replace(/;$/, "").replace(/\s+/g, " ");
const rows = response => (Array.isArray(response) ? response : [response]).flatMap(item => item?.results ?? []);
const fail = reason => { throw new Error(`Staging migration alias refused: ${reason}`); };

export async function inspectAliasTarget({ api, expectedVersion, migrationSql = readFileSync(migrationPath, "utf8") }) {
  if (!/^[a-f0-9]{40}$/.test(expectedVersion ?? "")) fail("exact expected deployed version required");
  if (hash(migrationSql) !== MIGRATION_DIGEST) fail("canonical migration digest mismatch");
  const account = await api("");
  if (account?.id !== ALIAS_ACCOUNT) fail("account mismatch");
  const settings = await api("/workers/scripts/ttv-website-staging/settings");
  const binding = name => settings?.bindings?.find(item => item.name === name);
  if (binding("DB")?.type !== "d1" || binding("DB")?.id !== ALIAS_DATABASE ||
      binding("DEPLOYMENT_ENVIRONMENT")?.text !== "staging" || binding("DEPLOYMENT_VERSION")?.text !== expectedVersion ||
      binding("PRIMARY_DOMAIN")?.text !== "staging.tembotechventures.com" || binding("BETTER_AUTH_URL")?.text !== ALIAS_ORIGIN) fail("Worker binding mismatch");
  const database = await api(`/d1/database/${ALIAS_DATABASE}`);
  if (database?.uuid !== ALIAS_DATABASE || database?.name !== "ttv-website-db-staging") fail("database mismatch");
  const query = async (sql, params = []) => rows(await api(`/d1/database/${ALIAS_DATABASE}/query`, { method: "POST", body: { sql, params } }));
  const definitions = await query("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name IN ('recording_import_source','recording_driveFileId_unique','__drizzle_migrations','d1_migrations') OR (type='trigger' AND tbl_name='d1_migrations') ORDER BY name");
  if (definitions.some(item => item.type === "trigger" || item.name === "__drizzle_migrations")) fail("unexpected second migration ledger");
  const [tableSql, indexSql] = migrationSql.split("--> statement-breakpoint").map(normalize);
  const table = definitions.find(item => item.name === "recording_import_source");
  const index = definitions.find(item => item.name === "recording_driveFileId_unique");
  const ledgerTable = definitions.find(item => item.name === "d1_migrations");
  if (table?.type !== "table" || table.tbl_name !== "recording_import_source" || normalize(table.sql) !== tableSql ||
      index?.type !== "index" || index.tbl_name !== "recording" || normalize(index.sql) !== indexSql || !ledgerTable || normalize(ledgerTable.sql) !== normalize("CREATE TABLE d1_migrations( id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL )")) fail("table/index schema mismatch");
  const ledger = await query("SELECT id,name,applied_at FROM d1_migrations ORDER BY id");
  const canonical = ledger.find(item => item.name === CANONICAL_MIGRATION);
  const originals = ledger.filter(item => item.name !== CANONICAL_MIGRATION);
  if (originals.length !== names.length || originals.some((item, i) => item.id !== i + 1 || item.name !== names[i] || item.applied_at !== timestamps[i]) || ledger.length !== names.length + (canonical ? 1 : 0) ||
      (canonical && (canonical.id !== 9 || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(canonical.applied_at)))) fail("migration ledger mismatch");
  const sequence = await query("SELECT seq FROM sqlite_sequence WHERE name='d1_migrations'");
  if (sequence.length !== 1 || sequence[0].seq !== (canonical ? 9 : 8)) fail("ledger sequence mismatch");
  return { query, definitions, ledger, canonical, expectedVersion, sequence: sequence[0].seq, schemaHash: hash(JSON.stringify(definitions)), ledgerHash: hash(JSON.stringify(ledger)) };
}

/** No other migration, schema, application row or legacy ledger row is changed. */
export function aliasStatement(snapshot) {
  const conditions = ["(SELECT COUNT(*) FROM d1_migrations)=?", "NOT EXISTS(SELECT 1 FROM d1_migrations WHERE name=?)",
    "NOT EXISTS(SELECT 1 FROM sqlite_master WHERE name='__drizzle_migrations' OR (type='trigger' AND tbl_name='d1_migrations'))",
    "EXISTS(SELECT 1 FROM sqlite_sequence WHERE name='d1_migrations' AND seq=?)"];
  const params = [names.length, CANONICAL_MIGRATION, snapshot.sequence];
  for (const item of snapshot.ledger) {
    conditions.push("EXISTS(SELECT 1 FROM d1_migrations WHERE id=? AND name=? AND applied_at=?)");
    params.push(item.id, item.name, item.applied_at);
  }
  for (const item of snapshot.definitions) {
    conditions.push("EXISTS(SELECT 1 FROM sqlite_master WHERE type=? AND name=? AND tbl_name=? AND sql=?)");
    params.push(item.type, item.name, item.tbl_name, item.sql);
  }
  return { sql: `INSERT INTO d1_migrations(name) SELECT ? WHERE ${conditions.join(" AND ")} RETURNING id,name,applied_at`, params: [CANONICAL_MIGRATION, ...params] };
}

export async function reconcileStagingAlias({ api, expectedVersion, apply = false, migrationSql }) {
  const options = { api, expectedVersion, ...(migrationSql === undefined ? {} : { migrationSql }) };
  if (typeof apply !== "boolean") fail("apply must be boolean");
  const before = await inspectAliasTarget(options);
  const report = { environment: "staging", accountId: ALIAS_ACCOUNT, databaseId: ALIAS_DATABASE, expectedVersion,
    migration: CANONICAL_MIGRATION, migrationDigest: MIGRATION_DIGEST, beforeLedgerHash: before.ledgerHash, schemaHash: before.schemaHash,
    legacy: before.ledger[3], ledgerSequence: before.sequence, mode: apply ? "apply" : "dry-run" };
  if (before.canonical) return { ...report, outcome: "already-recorded", canonical: before.canonical, changed: false };
  if (!apply) return { ...report, outcome: "eligible", changed: false, statement: aliasStatement(before) };
  // Repeat target/schema/ledger verification immediately before the sole write.
  const fresh = await inspectAliasTarget(options);
  if (fresh.canonical || fresh.ledgerHash !== before.ledgerHash || fresh.schemaHash !== before.schemaHash) fail("state changed after inspection");
  const statement = aliasStatement(fresh);
  const inserted = await fresh.query(statement.sql, statement.params);
  if (inserted.length !== 1 || inserted[0].id !== 9 || inserted[0].name !== CANONICAL_MIGRATION) fail("atomic insertion precondition failed; inspect ledger before any retry");
  // If readback fails, do not automatically undo or retry the admitted write.
  let after;
  try { after = await inspectAliasTarget(options); } catch { fail("post-write verification failed; inspect ledger before any retry"); }
  if (after.schemaHash !== before.schemaHash || JSON.stringify(after.ledger.filter(item => item.name !== CANONICAL_MIGRATION)) !== JSON.stringify(before.ledger) ||
      JSON.stringify(after.canonical) !== JSON.stringify(inserted[0])) fail("post-write verification failed; inspect ledger before any retry");
  return { ...report, outcome: "recorded", changed: true, canonical: after.canonical, afterLedgerHash: after.ledgerHash };
}

export function parseAliasArguments(args) {
  const apply = args.includes("--apply");
  const versions = args.filter(arg => arg.startsWith("--expected-version="));
  if (versions.length !== 1 || args.length !== versions.length + Number(apply) || args.filter(arg => arg === "--apply").length > 1) fail("use --expected-version=<full deployed SHA> and optional --apply");
  return { expectedVersion: versions[0].slice("--expected-version=".length), apply };
}

async function main() {
  const options = parseAliasArguments(process.argv.slice(2));
  if (!process.env.CF_API_TOKEN || process.env.CF_API_TOKEN.includes("${")) fail("managed CF_API_TOKEN required");
  const api = async (path, requestOptions = {}) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ALIAS_ACCOUNT}${path}`, {
      method: requestOptions.method ?? "GET", redirect: "error", signal: globalThis.AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${process.env.CF_API_TOKEN}`, "Content-Type": "application/json" },
      ...(requestOptions.body ? { body: JSON.stringify(requestOptions.body) } : {}),
    });
    const payload = await response.json();
    if (!response.ok || !payload.success) throw new Error("Staging alias API operation failed; inspect current ledger before retry.");
    return payload.result;
  };
  console.log(JSON.stringify(await reconcileStagingAlias({ ...options, api }), null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  // Never print API errors, credentials, response bodies or arbitrary inputs.
  console.error("Staging migration alias failed. No automatic retry or rollback; inspect the ledger before proceeding.");
  process.exitCode = 1;
});
