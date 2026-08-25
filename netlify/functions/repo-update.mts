import type { Context, Config } from "@netlify/functions";
import { updateManualFields } from "../../lib/db";

export default async (req: Request, context: Context) => {
  if (req.method !== "PATCH") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const id = Number(parts[parts.length - 1]);
  if (!Number.isFinite(id)) {
    return new Response(JSON.stringify({ error: "Invalid repo id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = await req.json().catch(() => ({}));
  const updated = await updateManualFields(id, {
    status: body.status,
    progress_note: body.progress_note,
    goals: body.goals,
    next_steps: body.next_steps,
  });

  if (!updated) {
    return new Response(JSON.stringify({ error: "Repo not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(updated), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/repos/:id",
};
