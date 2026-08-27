/**
 * A portable migration runner.
 *
 * Netlify applies `netlify/database/migrations/` automatically at deploy time.
 * That is Netlify behaviour, not Postgres behaviour, so on any other host — or
 * on a local database — the migrations simply never run and the app meets an
 * empty schema. This restores that step everywhere, reading the same directory
 * so there is one set of migration files rather than two.
 *
 * Applied migrations are recorded in `schema_migrations`, so running it twice
 * is a no-op. The existing migrations happen to be idempotent anyway
 * (`IF NOT EXISTS` / `IF EXISTS`), which is why it is safe for this runner and
 * Netlify's own to act on the same database.
 *
 * A migration file is DDL, not a query with values, so it cannot go through a
 * tagged template — those parameterise values and would send the file as a
 * string literal. The runner therefore takes an explicit raw executor rather
 * than the `Sql` type used everywhere else; `exec` is the one place in this
 * project where SQL text is passed through unparameterised, and it takes only
 * files from disk, never anything from a request.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** Runs SQL text, optionally with positional parameters. */
export type Exec = (text: string, params?: unknown[]) => Promise<readonly unknown[]>;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/** Migration directories, in the lexical order their timestamps imply. */
export function migrationNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export async function migrate(exec: Exec, dir: string): Promise<MigrationResult> {
  await exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const rows = (await exec(`SELECT name FROM schema_migrations`)) as readonly { name: string }[];
  const done = new Set(rows.map((r) => r.name));

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const name of migrationNames(dir)) {
    if (done.has(name)) {
      result.skipped.push(name);
      continue;
    }

    const statements = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
    await exec(statements);
    await exec(`INSERT INTO schema_migrations (name) VALUES ($1)`, [name]);
    result.applied.push(name);
  }

  return result;
}
