/**
 * Environment access, without naming a host.
 *
 * The handlers previously read `Netlify.env.get(...)`, a global that exists
 * only inside a Netlify function. That single call was the difference between
 * a handler that runs anywhere and one that runs in exactly one place — the
 * request/response signature was already portable.
 *
 * `process.env` is populated on Netlify too, so it is tried first and the
 * Netlify global is only a fallback for anything that turns out not to be
 * mirrored there.
 */

declare const Netlify: { env: { get(name: string): string | undefined } } | undefined;

export function env(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== "") return fromProcess;

  try {
    if (typeof Netlify !== "undefined") return Netlify.env.get(name) || undefined;
  } catch {
    // Not running on Netlify. `process.env` was the answer.
  }
  return undefined;
}

/** Reads a variable that must be present, with an error naming what to set. */
export function requireEnv(name: string, hint: string): string {
  const value = env(name);
  if (!value) throw new Error(`${name} is not set. ${hint}`);
  return value;
}
