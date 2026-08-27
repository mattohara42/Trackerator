// Escaping helpers for everything the cards render.
//
// Split out of app.js so they can be unit-tested directly. There is still no
// build step: this is a plain ES module, which browsers load natively and
// `node --test` imports as-is.

/**
 * Escapes the five characters that matter inside an HTML text node or a quoted
 * attribute value. Every attribute in app.js is quoted, so backtick and `=` do
 * not need handling.
 */
export function escapeHtml(str) {
  return (str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// `javascript:` and `data:` URLs execute when followed. Escaping cannot prevent
// that — escapeHtml leaves `javascript:alert(1)` entirely intact, because none
// of its characters need escaping — so a scheme check is a separate job from an
// entity check, and href values need both.
const SAFE_SCHEME = /^https?:$/;

/**
 * Returns `url` if it is safe to put in an `href`, or `""` if it is not.
 *
 * Relative URLs are resolved against a dummy base purely so they can be
 * scheme-checked; the original string is what gets returned, so nothing is
 * rewritten or normalised on the way through. Anything unparseable is rejected,
 * which is the right default for a value that came from an API response or a
 * database row rather than from us.
 */
export function safeUrl(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";

  let parsed;
  try {
    parsed = new URL(trimmed, "https://invalid.example");
  } catch {
    return "";
  }
  return SAFE_SCHEME.test(parsed.protocol) ? trimmed : "";
}

/** `href` attribute value: scheme-checked, then entity-escaped. */
export function safeHref(url) {
  return escapeHtml(safeUrl(url));
}
