// Netlify adapter. The handler itself lives in `lib/handlers/` as a plain
// Request -> Response function; all this file adds is Netlify's routing, so a
// second host needs its own adapter and nothing else.
import type { Config } from "@netlify/functions";

export { default } from "../../lib/handlers/repo-update.ts";

export const config: Config = {
  path: "/api/repos/:id",
};
