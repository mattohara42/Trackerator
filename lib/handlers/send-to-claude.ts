import { getRepo, markNoteSent } from "../db.ts";
import { sendNoteToClaude } from "../github.ts";
import { error, json, repoIdFrom } from "../http.ts";
import { NoteError, sanitizeNote } from "../notes.ts";
import { env } from "../env.ts";

export default async (req: Request): Promise<Response> => {
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
      token: env("GITHUB_TOKEN"),
      fullName: repo.full_name,
      branch: repo.default_branch || "main",
      note,
    });
    return json(await markNoteSent(id));
  } catch (err) {
    return error((err as Error).message, 502);
  }
};

