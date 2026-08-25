import type { Context, Config } from "@netlify/functions";
import { listRepos } from "../../lib/db";

export default async (req: Request, context: Context) => {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const repos = await listRepos();
  return new Response(JSON.stringify(repos), {
    headers: { "Content-Type": "application/json" },
  });
};

export const config: Config = {
  path: "/api/repos",
};
