import { syncRepos } from "../github.ts";
import { upsertRepo, listRepos } from "../db.ts";
import { env } from "../env.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const rows = await syncRepos({
      token: env("GITHUB_TOKEN"),
      affiliation: env("GITHUB_AFFILIATION") || "owner",
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

