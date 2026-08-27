import { test } from "node:test";
import assert from "node:assert/strict";
import { repoIdFrom } from "../lib/http.ts";
import { STATUSES, isValidStatus } from "../lib/status.ts";
import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// repoIdFrom — one reader for both id-bearing routes
// ---------------------------------------------------------------------------

test("reads the id from both routes that carry one", () => {
  assert.equal(repoIdFrom("https://x.test/api/repos/123"), 123);
  assert.equal(repoIdFrom("https://x.test/api/repos/123/send-to-claude"), 123);
});

test("ignores query strings and trailing slashes", () => {
  assert.equal(repoIdFrom("https://x.test/api/repos/123?x=1"), 123);
  assert.equal(repoIdFrom("https://x.test/api/repos/123/"), 123);
});

test("rejects ids that are not positive integers", () => {
  for (const path of [
    "/api/repos/0",
    "/api/repos/-3",
    "/api/repos/1.5",
    "/api/repos/1e999",
    "/api/repos/abc",
    "/api/repos/",
    "/api/repos",
    "/api/sync",
  ]) {
    assert.equal(repoIdFrom(`https://x.test${path}`), null, path);
  }
});

test("rejects an id beyond safe integer range rather than rounding it", () => {
  assert.equal(repoIdFrom("https://x.test/api/repos/9007199254740993"), null);
});

// ---------------------------------------------------------------------------
// isValidStatus — the stored-XSS gate
// ---------------------------------------------------------------------------

test("accepts every status the UI offers", () => {
  for (const s of STATUSES) assert.equal(isValidStatus(s), true, s);
});

test("rejects anything else, including markup and case variants", () => {
  for (const value of [
    "<img src=x onerror=alert(1)>",
    "ACTIVE",
    "active ",
    "",
    null,
    undefined,
    42,
    {},
    ["active"],
  ]) {
    assert.equal(isValidStatus(value), false, String(value));
  }
});

test("the frontend's status list matches the server's", () => {
  // The two lists are deliberately separate — sharing five strings across the
  // client/server boundary costs more than it saves — so this pins them
  // together instead. If one changes, this fails rather than the UI silently
  // offering a status the API rejects.
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const match = app.match(/^const STATUSES = \[(.*?)\];$/m);
  assert.ok(match, "found the frontend STATUSES declaration");

  const frontend = match[1]
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  assert.deepEqual(frontend, [...STATUSES]);
});
