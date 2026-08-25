import { getDatabase } from "@netlify/database";

const db = getDatabase();

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
}

export interface ManualFields {
  status?: string;
  progress_note?: string;
  goals?: string;
  next_steps?: string;
}

export async function listRepos(): Promise<RepoRow[]> {
  const rows = await db.sql`
    SELECT * FROM repos
    ORDER BY COALESCE(last_commit_date, pushed_at) DESC NULLS LAST
  `;
  return rows as unknown as RepoRow[];
}

export async function getRepo(id: number): Promise<RepoRow | null> {
  const rows = await db.sql`SELECT * FROM repos WHERE id = ${id}`;
  return (rows[0] as RepoRow) ?? null;
}

export async function upsertRepo(r: SyncedRepoInput): Promise<void> {
  await db.sql`
    INSERT INTO repos (
      id, name, full_name, html_url, description, private, github_archived,
      default_branch, stars, pushed_at, last_commit_sha, last_commit_message,
      last_commit_date, open_issues_count, ci_status, synced_at
    ) VALUES (
      ${r.id}, ${r.name}, ${r.full_name}, ${r.html_url}, ${r.description}, ${r.private}, ${r.github_archived},
      ${r.default_branch}, ${r.stars}, ${r.pushed_at}, ${r.last_commit_sha}, ${r.last_commit_message},
      ${r.last_commit_date}, ${r.open_issues_count}, ${r.ci_status}, ${r.synced_at}
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
      synced_at = EXCLUDED.synced_at
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
