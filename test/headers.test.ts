import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsp, parseHeaderValues } from "../lib/headers.ts";

const toml = readFileSync(new URL("../netlify.toml", import.meta.url), "utf8");
const headers = parseHeaderValues(toml);
const csp = parseCsp(headers["Content-Security-Policy"] ?? "");

test("the security headers are all present", () => {
  for (const name of [
    "Content-Security-Policy",
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Strict-Transport-Security",
  ]) {
    assert.ok(headers[name], `${name} is set`);
  }
});

test("the CSP has no escape hatches", () => {
  // These are the two directives that would quietly turn the policy off. The
  // frontend has no inline script, no inline style attribute and no eval, so
  // neither is needed — and if a change appears to need one, the change is
  // what should be reconsidered.
  const policy = headers["Content-Security-Policy"];
  assert.ok(!policy.includes("'unsafe-inline'"), "no 'unsafe-inline'");
  assert.ok(!policy.includes("'unsafe-eval'"), "no 'unsafe-eval'");
});

test("scripts and connections are same-origin only", () => {
  assert.deepEqual(csp["script-src"], ["'self'"]);
  assert.deepEqual(csp["connect-src"], ["'self'"]);
  assert.deepEqual(csp["default-src"], ["'self'"]);
});

test("the page cannot be framed", () => {
  // Clickjacking a page whose buttons commit to your repositories is not a
  // theoretical concern.
  assert.deepEqual(csp["frame-ancestors"], ["'none'"]);
  assert.equal(headers["X-Frame-Options"], "DENY");
});

test("base-uri, form-action and object-src are locked down", () => {
  assert.deepEqual(csp["base-uri"], ["'none'"]);
  assert.deepEqual(csp["form-action"], ["'none'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
});

test("only the Google Fonts origins are allowed, and only where needed", () => {
  // The stylesheet comes from googleapis, the font files from gstatic. Neither
  // may appear anywhere else in the policy.
  assert.deepEqual(csp["style-src"], ["'self'", "https://fonts.googleapis.com"]);
  assert.deepEqual(csp["font-src"], ["'self'", "https://fonts.gstatic.com"]);

  for (const [directive, sources] of Object.entries(csp)) {
    if (directive === "style-src" || directive === "font-src") continue;
    assert.ok(
      !sources.some((s) => s.startsWith("https://")),
      `${directive} has no remote origin`
    );
  }
});

test("referrer policy does not leak paths cross-origin", () => {
  // Private repo names appear in this app's content; the path must not travel.
  assert.ok(
    ["strict-origin-when-cross-origin", "strict-origin", "same-origin", "no-referrer"]
      .includes(headers["Referrer-Policy"]),
    `Referrer-Policy is path-safe, got ${headers["Referrer-Policy"]}`
  );
});

test("HSTS is set for a year and does not claim preload", () => {
  const hsts = headers["Strict-Transport-Security"];
  assert.match(hsts, /max-age=(\d+)/);
  assert.ok(Number(hsts.match(/max-age=(\d+)/)![1]) >= 31536000, "at least a year");
  assert.ok(!hsts.includes("preload"), "preload is a one-way door; not claimed");
});

test("the policy covers every origin the page actually references", () => {
  // Catches the reverse failure: a new remote dependency added to index.html
  // without a matching CSP source, which would be blocked at runtime.
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const origins = new Set([...html.matchAll(/https:\/\/[a-z0-9.-]+/gi)].map((m) => m[0]));

  const allowed = new Set(Object.values(csp).flat());
  for (const origin of origins) {
    assert.ok(allowed.has(origin), `${origin} is allowed by some directive`);
  }
});
