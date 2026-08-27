/**
 * Small shared helpers for the function handlers.
 *
 * These are deliberately plain `Request`/`Response` — nothing here touches a
 * Netlify global — so the handlers stay portable to any host that speaks the
 * Web fetch API.
 */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function error(message: string, status: number): Response {
  return json({ error: message }, status);
}

/**
 * Reads a repo id out of a path.
 *
 * Both id-bearing routes previously did this by hand and disagreed about how:
 * one counted from the end, the other used a fixed index. Neither rejected
 * `1.5`, `-3` or `0`, which a `BIGINT PRIMARY KEY` lookup would simply miss
 * rather than refuse. `/api/repos/:id` and `/api/repos/:id/send-to-claude` both
 * carry the id in the same position, so one reader serves both.
 */
export function repoIdFrom(url: string): number | null {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const i = parts.indexOf("repos");
  if (i === -1) return null;

  const raw = parts[i + 1];
  if (!raw || !/^\d+$/.test(raw)) return null;

  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
