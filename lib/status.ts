/**
 * The manual status vocabulary.
 *
 * Canonical here rather than in the frontend, because the API is what has to
 * enforce it: `public/app.js` only ever sends one of these five, but a request
 * made by anything else can say whatever it likes, and the value lands in
 * `innerHTML` on the way back out. The frontend keeps its own copy of the list
 * for rendering; `statuses.test.ts` pins the two together.
 */
export const STATUSES = ["active", "paused", "idea", "done", "archived"] as const;

export type Status = (typeof STATUSES)[number];

export function isValidStatus(value: unknown): value is Status {
  return typeof value === "string" && (STATUSES as readonly string[]).includes(value);
}
