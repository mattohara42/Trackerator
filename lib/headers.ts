/**
 * Reads the security headers out of `netlify.toml`.
 *
 * They are configuration rather than code, which means nothing would notice if
 * a directive were dropped or weakened — the app would keep working, quietly
 * less protected. Parsing them back out is what lets a test assert the policy
 * is still the policy.
 *
 * Deliberately not a general TOML parser: it understands exactly the one
 * `[headers.values]` block this repo has, and is used only by tests and
 * tooling, never at request time.
 */

export type Headers = Record<string, string>;

/** Splits a CSP string into `directive -> sources`. */
export function parseCsp(csp: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const clause of csp.split(";")) {
    const parts = clause.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    out[parts[0]] = parts.slice(1);
  }
  return out;
}

/**
 * Extracts the key/value pairs from the `[headers.values]` table.
 *
 * Handles TOML's two string forms as they are used here: a plain `"..."` and a
 * multi-line `"""..."""` whose trailing backslashes fold the following newline
 * and its indentation away, which is how the CSP stays readable in the file
 * but arrives as one line.
 */
export function parseHeaderValues(toml: string): Headers {
  const start = toml.indexOf("[headers.values]");
  if (start === -1) return {};
  const body = toml.slice(start + "[headers.values]".length);

  const headers: Headers = {};
  const pattern = /^\s*([A-Za-z][\w-]*)\s*=\s*(""")([\s\S]*?)"""|^\s*([A-Za-z][\w-]*)\s*=\s*"([^"]*)"/gm;

  for (const m of body.matchAll(pattern)) {
    const name = m[1] ?? m[4];
    const raw = m[3] ?? m[5] ?? "";
    headers[name] = raw
      // A backslash at end of line folds the newline and the next line's indent.
      .replace(/\\\s*\n\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return headers;
}
