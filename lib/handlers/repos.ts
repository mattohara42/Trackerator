import { listRepos } from "../db.ts";

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const repos = await listRepos();
  return new Response(JSON.stringify(repos), {
    headers: { "Content-Type": "application/json" },
  });
};

