import type { Context, Config } from "@netlify/functions";
import { syncRepos } from "../../lib/github";
import { upsertRepo, listRepos } from "../../lib/db";

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const rows = await syncRepos({
      token: Netlify.env.get("GITHUB_TOKEN"),
      affiliation: Netlify.env.get("GITHUB_AFFILIATION") || "owner",
    });
    for (const row of rows) await upsertRepo(row);

    const repos = await listRepos();
    return new Response(JSON.stringify({ synced: rows.length, repos }), {
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
  path: "/api/sync",
};
