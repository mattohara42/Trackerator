/**
 * End-to-end: the real handlers, against a real Postgres, over real HTTP.
 *
 * This is the first test in the project that exercises the API rather than the
 * pure functions behind it, and it only became possible once the handlers
 * stopped being Netlify-shaped — which is the point of the decoupling it
 * verifies. It proves the seam works by *using* it: nothing here imports
 * anything from `netlify/`.
 *
 * Skipped, loudly, unless DATABASE_URL is set, so `npm test` stays green for
 * anyone without a database. `npm run test:e2e` sets one up.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import postgres from "postgres";
import { migrate } from "../lib/migrate.ts";
import { connectionString, resetSql } from "../lib/db/sql.ts";

import repos from "../lib/handlers/repos.ts";
import repoUpdate from "../lib/handlers/repo-update.ts";
import sendToClaude from "../lib/handlers/send-to-claude.ts";

const url = connectionString();

describe("API against a real database", { skip: url ? false : "DATABASE_URL not set" }, () => {
  const sql = postgres(url!, { max: 2, ssl: false });

  const REPO = {
    id: 4242,
    name: "demo",
    full_name: "me/demo",
    html_url: "https://github.com/me/demo",
    description: "A demo repo",
    default_branch: "main",
  };

  before(async () => {
    await migrate((text, params) => sql.unsafe(text, params as never),
      path.join(import.meta.dirname, "..", "netlify", "database", "migrations"));
    await sql`DELETE FROM repos WHERE id = ${REPO.id}`;
    await sql`
      INSERT INTO repos (id, name, full_name, html_url, description, default_branch)
      VALUES (${REPO.id}, ${REPO.name}, ${REPO.full_name}, ${REPO.html_url},
              ${REPO.description}, ${REPO.default_branch})
    `;
    resetSql();

    const check = (await sql`SELECT id FROM repos WHERE id = ${REPO.id}`) as any[];
    assert.equal(check.length, 1, "seed committed before any test runs");
  });

  after(async () => {
    await sql`DELETE FROM repos WHERE id = ${REPO.id}`;
    await sql.end();
  });

  const req = (url: string, init?: RequestInit) => new Request(`https://x.test${url}`, init);
  const patch = (id: number | string, body: unknown) =>
    repoUpdate(req(`/api/repos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));

  it("GET /api/repos returns the seeded row", async () => {
    const res = await repos(req("/api/repos"));
    assert.equal(res.status, 200);
    const rows = (await res.json()) as { id: number; full_name: string }[];
    const found = rows.find((r) => r.id === REPO.id);
    assert.ok(found, "the seeded repo is listed");
    assert.equal(found.full_name, REPO.full_name);
    // Driver-independence, not pedantry: repos.id is a BIGINT, and postgres.js
    // returns int8 as a string while the Neon driver returns a number. The
    // frontend compares ids with ===, so an un-normalised id breaks the
    // dashboard on one host and not the other.
    assert.equal(typeof found.id, "number", "id is a number whichever driver ran");
  });

  it("rejects a method it does not serve", async () => {
    assert.equal((await repos(req("/api/repos", { method: "POST" }))).status, 405);
  });

  it("PATCH persists a manual field and leaves sync-owned columns alone", async () => {
    const res = await patch(REPO.id, { status: "paused", goals: "ship stage 2" });
    assert.equal(res.status, 200);

    const [row] = (await sql`SELECT * FROM repos WHERE id = ${REPO.id}`) as any[];
    assert.equal(row.status, "paused");
    assert.equal(row.goals, "ship stage 2");
    // The whole point of the sync/manual split: a manual write must not touch
    // anything the sync owns.
    assert.equal(row.name, REPO.name);
    assert.equal(row.description, REPO.description);
  });

  it("S3: rejects a status outside the vocabulary, and stores nothing", async () => {
    const res = await patch(REPO.id, { status: "<img src=x onerror=alert(1)>" });
    assert.equal(res.status, 400);

    const [row] = (await sql`SELECT status FROM repos WHERE id = ${REPO.id}`) as any[];
    assert.equal(row.status, "paused", "the rejected value never reached the database");
  });

  it("S11: rejects ids that are not positive integers", async () => {
    for (const bad of ["abc", "-1", "1.5", "0"]) {
      assert.equal((await patch(bad, { status: "active" })).status, 400, bad);
    }
  });

  it("returns 404 for a repo that does not exist", async () => {
    assert.equal((await patch(999999, { status: "active" })).status, 404);
  });

  it("concurrent PATCHes of different fields do not undo each other", async () => {
    // Each request names one field. A read-then-write update reads the row,
    // then writes all four fields back, so a request that read before another
    // committed puts the old value back. Repeated because the window is small.
    for (let round = 0; round < 20; round += 1) {
      const tag = `r${round}`;
      const results = await Promise.all([
        patch(REPO.id, { progress_note: `${tag}-progress` }),
        patch(REPO.id, { goals: `${tag}-goals` }),
        patch(REPO.id, { next_steps: `${tag}-next` }),
      ]);
      assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);

      const [row] = (await sql`
        SELECT progress_note, goals, next_steps FROM repos WHERE id = ${REPO.id}
      `) as any[];
      assert.deepEqual(
        [row.progress_note, row.goals, row.next_steps],
        [`${tag}-progress`, `${tag}-goals`, `${tag}-next`],
        `round ${round}`
      );
    }
    await patch(REPO.id, { goals: "ship stage 2" });
  });

  it("caps an over-long note field", async () => {
    const res = await patch(REPO.id, { goals: "x".repeat(10_001) });
    assert.equal(res.status, 400);
  });

  it("S9: send-to-claude rejects an empty or unusable note before any network call", async () => {
    for (const note of ["", "   ", "\n\n", undefined]) {
      const res = await sendToClaude(req(`/api/repos/${REPO.id}/send-to-claude`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      }));
      assert.equal(res.status, 400, JSON.stringify(note));
    }
  });

  it("S13: a new repo may reuse a deleted repo's full_name", async () => {
    // This was a permanent sync wedge: full_name was UNIQUE, but the upsert
    // only handled ON CONFLICT (id), so a new repo taking an old name raised a
    // unique violation that no retry could clear.
    const other = REPO.id + 1;
    try {
      await sql`
        INSERT INTO repos (id, name, full_name, html_url)
        VALUES (${other}, ${REPO.name}, ${REPO.full_name}, ${REPO.html_url})
      `;
    } finally {
      await sql`DELETE FROM repos WHERE id = ${other}`;
    }
  });
});
