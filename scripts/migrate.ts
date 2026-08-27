/**
 * CLI: apply pending migrations to whatever `DATABASE_URL` points at.
 *
 *   DATABASE_URL=postgres://... npm run migrate
 *
 * Netlify runs its own migration step at deploy time, so this is for every
 * other environment: local development, a container, Vercel's build command.
 * It requires a connection string rather than falling back to the Netlify
 * package, because a migration is a deliberate act against a database you
 * named — not something to run against whatever happens to be attached.
 */

import path from "node:path";
import postgres from "postgres";
import { migrate } from "../lib/migrate.ts";
import { connectionString } from "../lib/db/sql.ts";

const url = connectionString();
if (!url) {
  console.error(
    "No database connection string. Set DATABASE_URL (or NETLIFY_DATABASE_URL)\n" +
      "to the Postgres you want migrated, e.g.\n\n" +
      "  DATABASE_URL=postgres://user:pass@localhost:5432/trackerator npm run migrate\n"
  );
  process.exit(1);
}

const local = url.includes("localhost") || url.includes("127.0.0.1");
const sql = postgres(url, { max: 1, ssl: local ? false : "require" });

const dir = path.join(import.meta.dirname, "..", "netlify", "database", "migrations");

try {
  const { applied, skipped } = await migrate((text, params) => sql.unsafe(text, params as never), dir);
  for (const name of skipped) console.log(`  already applied  ${name}`);
  for (const name of applied) console.log(`  applied          ${name}`);
  console.log(
    applied.length ? `\n${applied.length} migration(s) applied.` : "\nNothing to apply."
  );
} catch (err) {
  console.error(`Migration failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
