import { getSql } from "./db/sql.ts";

// Resolved per call rather than at module load. The old module-scope
// `getDatabase()` connected as a side effect of importing this file, which
// meant nothing here could be imported without a database — including by a
// test that only wanted to read a type. It also fixed the driver choice at
// import time, before any test could point it somewhere else.
const db = { get sql() { return getSql(); } };

export interface RepoRow {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  github_archived: boolean;
  default_branch: string | null;
  stars: number;
  pushed_at: string | null;
  last_commit_sha: string | null;
  last_commit_message: string | null;
  last_commit_date: string | null;
  open_issues_count: number;
  ci_status: string | null;
  synced_at: string | null;
  status: string;
  progress_note: string;
  goals: string;
  next_steps: string;
  manual_updated_at: string | null;
  last_note_sent_at: string | null;
  homepage: string | null;
  topics: string;
  license_name: string | null;
  has_readme: boolean;
  has_ci: boolean;
  has_tests: boolean;
  latest_release_tag: string | null;
  latest_release_at: string | null;
  open_issues: number;
  open_prs: number;
  oldest_pr_at: string | null;
  top_issues: string;
}

export interface SyncedRepoInput {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string;
  private: boolean;
  github_archived: boolean;
  default_branch: string;
  stars: number;
  pushed_at: string | null;
  last_commit_sha: string | null;
  last_commit_message: string | null;
  last_commit_date: string | null;
  open_issues_count: number;
  ci_status: string;
  synced_at: string;
  homepage: string | null;
  topics: string;
  license_name: string | null;
  has_readme: boolean;
  has_ci: boolean;
  has_tests: boolean;
  latest_release_tag: string | null;
  latest_release_at: string | null;
  open_issues: number;
  open_prs: number;
  oldest_pr_at: string | null;
  top_issues: string;
}

export interface ManualFields {
  status?: string;
  progress_note?: string;
  goals?: string;
  next_steps?: string;
}

/**
 * Normalises a row so every driver yields the same shape.
 *
 * `repos.id` is a BIGINT. postgres.js returns int8 as a *string*, to avoid
 * silently losing precision past 2^53; the Neon driver behind
 * `@netlify/database` returns it as a number. Left alone that difference is
 * invisible until something compares an id — `repos.findIndex(r => r.id === id)`
 * in `public/app.js` does exactly that — and then the dashboard misbehaves on
 * one host and not the other, with nothing in the code to point at.
 *
 * GitHub's repo ids are nine digits, comfortably inside Number.MAX_SAFE_INTEGER,
 * and `repoIdFrom` already refuses anything outside safe-integer range, so
 * narrowing to a number here loses nothing.
 */
function normalise<T>(row: T): T {
  const r = row as { id?: unknown };
  if (typeof r.id === "string") r.id = Number(r.id);
  return row;
}

export async function listRepos(): Promise<RepoRow[]> {
  const rows = await db.sql`
    SELECT * FROM repos
    ORDER BY COALESCE(last_commit_date, pushed_at) DESC NULLS LAST
  `;
  return (rows as unknown as RepoRow[]).map(normalise);
}

export async function getRepo(id: number): Promise<RepoRow | null> {
  const rows = await db.sql`SELECT * FROM repos WHERE id = ${id}`;
  return rows[0] ? normalise(rows[0] as RepoRow) : null;
}

export async function upsertRepo(r: SyncedRepoInput): Promise<void> {
  await db.sql`
    INSERT INTO repos (
      id, name, full_name, html_url, description, private, github_archived,
      default_branch, stars, pushed_at, last_commit_sha, last_commit_message,
      last_commit_date, open_issues_count, ci_status, synced_at,
      homepage, topics, license_name, has_readme, has_ci, has_tests,
      latest_release_tag, latest_release_at,
      open_issues, open_prs, oldest_pr_at, top_issues
    ) VALUES (
      ${r.id}, ${r.name}, ${r.full_name}, ${r.html_url}, ${r.description}, ${r.private}, ${r.github_archived},
      ${r.default_branch}, ${r.stars}, ${r.pushed_at}, ${r.last_commit_sha}, ${r.last_commit_message},
      ${r.last_commit_date}, ${r.open_issues_count}, ${r.ci_status}, ${r.synced_at},
      ${r.homepage}, ${r.topics}, ${r.license_name}, ${r.has_readme}, ${r.has_ci},
      ${r.has_tests}, ${r.latest_release_tag}, ${r.latest_release_at},
      ${r.open_issues}, ${r.open_prs}, ${r.oldest_pr_at}, ${r.top_issues}
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      full_name = EXCLUDED.full_name,
      html_url = EXCLUDED.html_url,
      description = EXCLUDED.description,
      private = EXCLUDED.private,
      github_archived = EXCLUDED.github_archived,
      default_branch = EXCLUDED.default_branch,
      stars = EXCLUDED.stars,
      pushed_at = EXCLUDED.pushed_at,
      last_commit_sha = EXCLUDED.last_commit_sha,
      last_commit_message = EXCLUDED.last_commit_message,
      last_commit_date = EXCLUDED.last_commit_date,
      open_issues_count = EXCLUDED.open_issues_count,
      ci_status = EXCLUDED.ci_status,
      synced_at = EXCLUDED.synced_at,
      homepage = EXCLUDED.homepage,
      topics = EXCLUDED.topics,
      license_name = EXCLUDED.license_name,
      has_readme = EXCLUDED.has_readme,
      has_ci = EXCLUDED.has_ci,
      has_tests = EXCLUDED.has_tests,
      latest_release_tag = EXCLUDED.latest_release_tag,
      latest_release_at = EXCLUDED.latest_release_at,
      open_issues = EXCLUDED.open_issues,
      open_prs = EXCLUDED.open_prs,
      oldest_pr_at = EXCLUDED.oldest_pr_at,
      top_issues = EXCLUDED.top_issues
  `;
}

export async function updateManualFields(
  id: number,
  fields: ManualFields
): Promise<RepoRow | null> {
  const current = await getRepo(id);
  if (!current) return null;

  const status = fields.status ?? current.status;
  const progress_note = fields.progress_note ?? current.progress_note;
  const goals = fields.goals ?? current.goals;
  const next_steps = fields.next_steps ?? current.next_steps;

  await db.sql`
    UPDATE repos SET
      status = ${status},
      progress_note = ${progress_note},
      goals = ${goals},
      next_steps = ${next_steps},
      manual_updated_at = NOW()
    WHERE id = ${id}
  `;
  return getRepo(id);
}

export async function markNoteSent(id: number): Promise<RepoRow | null> {
  await db.sql`UPDATE repos SET last_note_sent_at = NOW() WHERE id = ${id}`;
  return getRepo(id);
}
