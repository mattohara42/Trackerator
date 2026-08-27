import type { Context, Config } from "@netlify/functions";
import { getRepo, markNoteSent } from "../../lib/db";
import { sendNoteToClaude } from "../../lib/github";
import { error, json, repoIdFrom } from "../../lib/http";
import { NoteError, sanitizeNote } from "../../lib/notes";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const id = repoIdFrom(req.url);
  if (id === null) return error("Invalid repo id", 400);

  const body = await req.json().catch(() => ({}));

  // Sanitised before anything else touches it. This value is committed into the
  // target repo's CLAUDE.md, which an agent later reads as instructions, so it
  // gets the strictest handling of any input here.
  let note: string;
  try {
    note = sanitizeNote(body.note);
  } catch (err) {
    if (err instanceof NoteError) return error(err.message, 400);
    throw err;
  }

  const repo = await getRepo(id);
  if (!repo) return error("Repo not found", 404);

  try {
    await sendNoteToClaude({
      token: Netlify.env.get("GITHUB_TOKEN"),
      fullName: repo.full_name,
      branch: repo.default_branch || "main",
      note,
    });
    return json(await markNoteSent(id));
  } catch (err) {
    return error((err as Error).message, 502);
  }
};

export const config: Config = {
  path: "/api/repos/:id/send-to-claude",
};
