/**
 * The database seam.
 *
 * Every query in this project is a tagged template — `sql\`SELECT ...\`` — which
 * is a shape both drivers here already speak. So the queries themselves are
 * portable as written; the only thing that was Netlify-specific was *how the
 * client gets created*. That is the whole of this file.
 *
 * Two adapters, chosen by whether a connection string is present:
 *
 *   DATABASE_URL set   -> postgres.js against that URL.  Local, Vercel,
 *                         a container, a VPS — anywhere with a Postgres.
 *   nothing set        -> @netlify/database, exactly as before.
 *
 * The ordering matters and is deliberate. On Netlify today no `DATABASE_URL`
 * is set, so the second branch runs and the deployed behaviour is byte for
 * byte what it was — this file cannot regress production, which is worth a
 * great deal given that the Netlify path currently cannot be tested from here
 * (no credits, no deploy, no reachable API).
 *
 * `@netlify/database` also exports `getConnectionString()`, so once a real
 * deploy confirms postgres.js works on Netlify, the second branch can collapse
 * into the first and the dependency can go. Until something has actually run
 * there, keeping the proven path is the honest choice rather than the tidy one.
 */

import { getDatabase } from "@netlify/database";
import postgres from "postgres";
import { env } from "../env.ts";

/**
 * What the rest of the codebase needs: a tagged template that resolves to rows.
 * Deliberately narrow — anything wider would let a driver-specific feature leak
 * into the queries and quietly re-couple them.
 */
export type Sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<readonly unknown[]>;

let cached: Sql | null = null;

/** The connection string, if this environment provides one directly. */
export function connectionString(): string | undefined {
  return (
    env("DATABASE_URL") ??
    // Netlify DB sets these when a database is attached. Preferred over the
    // package when present because it needs no vendor import.
    env("NETLIFY_DATABASE_URL") ??
    env("NETLIFY_DATABASE_URL_UNPOOLED")
  );
}

export function getSql(): Sql {
  if (cached) return cached;

  const url = connectionString();
  if (url) {
    const client = postgres(url, {
      // Serverless: many short-lived instances, so a large pool per instance is
      // wasted connections against Postgres's global limit.
      max: 5,
      idle_timeout: 20,
      // Neon and most managed Postgres require TLS; a plain local socket does
      // not offer it, so this is conditional rather than always-on.
      ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
    });
    // postgres.js types its parameters against a driver-specific union; the Sql
    // type here is deliberately narrower (plain `unknown`), so the values are
    // cast at this one boundary rather than leaking driver types into callers.
    cached = ((strings: TemplateStringsArray, ...values: unknown[]) =>
      client(strings, ...(values as never[]))) as unknown as Sql;
    return cached;
  }

  // No connection string: assume Netlify's attached database.
  //
  // This import is static, and must stay static. It was briefly a lazy
  // `createRequire(...)` on the theory that a non-Netlify host should not need
  // the package present — which broke production: esbuild, which bundles the
  // Netlify functions, does not trace `createRequire` calls, so the module was
  // never included and every request died with "Cannot find module
  // '@netlify/database'" at runtime.
  //
  // The theory was wrong anyway. The package is a declared dependency, so it is
  // installed everywhere `npm ci` runs, and importing it is side-effect-free —
  // only `getDatabase()` touches a connection, and that is behind the branch
  // above. Nothing is saved by hiding it from the bundler.
  cached = getDatabase().sql as unknown as Sql;
  return cached;
}

/** Test seam: drops the memoised client so a suite can point at another database. */
export function resetSql(): void {
  cached = null;
}
