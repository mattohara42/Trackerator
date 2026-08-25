import type { Context, Config } from "@netlify/functions";
import { getRepo, markNoteSent } from "../../lib/db";
import { sendNoteToClaude } from "../../lib/github";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // pathname: /api/repos/<id>/send-to-claude
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = Number(parts[2]);
  if (!Number.isFinite(id)) {
    return new Response(JSON.stringify({ error: "Invalid repo id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const note = (body.note ?? "").trim();
  if (!note) {
    return new Response(JSON.stringify({ error: "Note is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const repo = await getRepo(id);
  if (!repo) {
    return new Response(JSON.stringify({ error: "Repo not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await sendNoteToClaude({
      token: Netlify.env.get("GITHUB_TOKEN"),
      fullName: repo.full_name,
      branch: repo.default_branch || "main",
      note,
    });
    const updated = await markNoteSent(id);
    return new Response(JSON.stringify(updated), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/repos/:id/send-to-claude",
};
