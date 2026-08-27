import { test } from "node:test";
import assert from "node:assert/strict";
// The frontend module, imported directly. It is plain ESM with no DOM
// dependency, which is the reason these helpers live in their own file.
import { escapeHtml, safeHref, safeUrl } from "../public/safe.js";

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

test("escapes the characters that break out of markup", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('1')">`),
    "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;"
  );
});

test("escapes ampersands without double-escaping the result", () => {
  assert.equal(escapeHtml("Tom & Jerry"), "Tom &amp; Jerry");
});

test("treats null and undefined as empty", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});

test("leaves ordinary text alone", () => {
  assert.equal(escapeHtml("a normal description"), "a normal description");
});

// ---------------------------------------------------------------------------
// safeUrl
// ---------------------------------------------------------------------------

test("allows http and https", () => {
  assert.equal(safeUrl("https://github.com/me/repo"), "https://github.com/me/repo");
  assert.equal(safeUrl("http://example.com"), "http://example.com");
});

test("rejects javascript: URLs", () => {
  // escapeHtml alone cannot stop these: none of the characters need escaping,
  // so the string arrives in the href completely intact.
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("JaVaScRiPt:alert(1)"), "");
  assert.equal(safeUrl("  javascript:alert(1)  "), "");
});

test("rejects other executable or embedding schemes", () => {
  for (const url of [
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ]) {
    assert.equal(safeUrl(url), "", url);
  }
});

test("rejects empty, blank and non-string input", () => {
  for (const url of ["", "   ", null, undefined, 42, {}]) {
    assert.equal(safeUrl(url), "");
  }
});

test("returns the original string rather than a normalised one", () => {
  // Nothing downstream should have to care that this function parsed the URL.
  const url = "https://example.com/a%20path?q=1&b=2#frag";
  assert.equal(safeUrl(url), url);
});

// ---------------------------------------------------------------------------
// safeHref — the composition actually used in the cards
// ---------------------------------------------------------------------------

test("safeHref scheme-checks and escapes", () => {
  assert.equal(safeHref("javascript:alert(1)"), "");
  assert.equal(
    safeHref('https://example.com/?a=1&b="x"'),
    "https://example.com/?a=1&amp;b=&quot;x&quot;"
  );
});

test("safeHref cannot be used to break out of the attribute", () => {
  const attack = `https://example.com" onmouseover="alert(1)`;
  const out = safeHref(attack);
  assert.ok(!out.includes('"'), "no raw quote survives to close the attribute");
});
