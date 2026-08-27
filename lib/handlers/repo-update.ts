import { updateManualFields } from "../db.ts";
import { error, json, repoIdFrom } from "../http.ts";
import { isValidStatus } from "../status.ts";

/** The note fields, which are free text and stored as-is. */
const TEXT_FIELDS = ["progress_note", "goals", "next_steps"] as const;

/**
 * Generous, but not unbounded. These are `TEXT` columns with no limit of their
 * own, so without a cap here a single request can put a megabyte into a row
 * that every dashboard load then reads back.
 */
const MAX_TEXT_LENGTH = 10_000;

export default async (req: Request): Promise<Response> => {
  if (req.method !== "PATCH") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const id = repoIdFrom(req.url);
  if (id === null) return error("Invalid repo id", 400);

  const body = await req.json().catch(() => ({}));

  // `status` is validated rather than stored as given: it is rendered back into
  // the page, so an unconstrained value here is a stored-XSS vector. The
  // frontend only ever sends one of the five, but the API is what has to
  // enforce that — anything else can call it.
  if (body.status !== undefined && !isValidStatus(body.status)) {
    return error("Invalid status", 400);
  }

  for (const field of TEXT_FIELDS) {
    const value = body[field];
    if (value === undefined) continue;
    if (typeof value !== "string") {
      return error(`${field} must be a string`, 400);
    }
    if (value.length > MAX_TEXT_LENGTH) {
      return error(`${field} is too long (maximum ${MAX_TEXT_LENGTH} characters)`, 400);
    }
  }

  const updated = await updateManualFields(id, {
    status: body.status,
    progress_note: body.progress_note,
    goals: body.goals,
    next_steps: body.next_steps,
  });

  if (!updated) return error("Repo not found", 404);

  return json(updated);
};

