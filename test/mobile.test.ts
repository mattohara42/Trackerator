import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The standing rule for any phone layout here: a bar pinned to the top of the
// screen pads by the phone's safe-area insets, so the status bar, notch or
// Dynamic Island never sits on top of it. Both halves are needed. Without
// viewport-fit=cover the browser reports every inset as 0, and without the
// padding the bar runs under the status bar once the page is allowed there.

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");

test("the viewport lets the page see the phone's safe-area insets", () => {
  const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/)?.[1] ?? "";
  assert.match(viewport, /viewport-fit=cover/);
});

test("every bar pinned to the top pads by the top safe-area inset", () => {
  // Innermost rule blocks only, which is every rule here, including those
  // nested in a media query.
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim(),
    body: m[2],
  }));
  const pinned = rules.filter(
    (r) => /position:\s*(sticky|fixed)/.test(r.body) && /(^|[;\s])top:\s*0/.test(r.body)
  );

  assert.ok(pinned.length > 0, "found the pinned bars (the regex still matches the stylesheet)");
  for (const rule of pinned) {
    assert.match(rule.body, /env\(safe-area-inset-top\)/, `${rule.selector} clears the status bar`);
  }
});
