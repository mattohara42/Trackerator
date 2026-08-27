import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * A guard on how the database driver is imported.
 *
 * This exists because the alternative shipped and took production down. The
 * Netlify branch of `lib/db/sql.ts` briefly reached `@netlify/database` through
 * `createRequire(import.meta.url)(...)`, on the theory that a non-Netlify host
 * should not have to have the package installed. esbuild — which bundles the
 * Netlify functions — does not trace `createRequire` calls, so the module was
 * never included in the deployed bundle and every request to every endpoint
 * died with `Cannot find module '@netlify/database'`.
 *
 * Two things made it slip through. It typechecks, because the types are fine.
 * And the bundling check that was supposed to prove the functions build passed
 * `--external:@netlify/database`, which excluded from the test exactly the
 * module whose inclusion was in question.
 *
 * A source-level assertion is crude next to actually bundling and inspecting
 * the output, but it needs no build tooling in the test suite, it runs in
 * milliseconds, and it encodes the specific mistake. If the import ever needs
 * to become lazy again, use `await import()` — esbuild follows that — and
 * verify by bundling *without* externalising anything.
 */

const raw = readFileSync(new URL("../lib/db/sql.ts", import.meta.url), "utf8");

/** Comments discuss `createRequire` at length by way of explaining this file;
 *  the assertions are about code, so strip them first. */
const source = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

test("the Netlify driver is imported statically, so the bundler includes it", () => {
  assert.match(
    source,
    /^import \{[^}]*getDatabase[^}]*\} from "@netlify\/database";$/m,
    "lib/db/sql.ts imports getDatabase with a top-level static import"
  );
});

test("the driver is not reached through createRequire, which esbuild cannot follow", () => {
  assert.ok(
    !source.includes("createRequire"),
    "createRequire leaves a runtime require the bundler never resolves"
  );
});

test("no bare require() of the driver either", () => {
  assert.ok(
    !/[^.\w]require\s*\(\s*["']@netlify\/database["']\s*\)/.test(source),
    "a bare require has the same problem as createRequire"
  );
});
