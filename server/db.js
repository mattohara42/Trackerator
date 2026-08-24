import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const DATA_DIR = path.resolve("data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "trackerator.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS repos (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    full_name TEXT NOT NULL UNIQUE,
    html_url TEXT NOT NULL,
    description TEXT,
    private INTEGER NOT NULL DEFAULT 0,
    github_archived INTEGER NOT NULL DEFAULT 0,
    default_branch TEXT,
    stars INTEGER NOT NULL DEFAULT 0,
    pushed_at TEXT,
    last_commit_sha TEXT,
    last_commit_message TEXT,
    last_commit_date TEXT,
    open_issues_count INTEGER NOT NULL DEFAULT 0,
    ci_status TEXT,
    synced_at TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    progress_note TEXT NOT NULL DEFAULT '',
    goals TEXT NOT NULL DEFAULT '',
    next_steps TEXT NOT NULL DEFAULT '',
    manual_updated_at TEXT
  )
`);

const upsertRepoStmt = db.prepare(`
  INSERT INTO repos (
    id, name, full_name, html_url, description, private, github_archived,
    default_branch, stars, pushed_at, last_commit_sha, last_commit_message,
    last_commit_date, open_issues_count, ci_status, synced_at
  ) VALUES (
    @id, @name, @full_name, @html_url, @description, @private, @github_archived,
    @default_branch, @stars, @pushed_at, @last_commit_sha, @last_commit_message,
    @last_commit_date, @open_issues_count, @ci_status, @synced_at
  )
  ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    full_name = excluded.full_name,
    html_url = excluded.html_url,
    description = excluded.description,
    private = excluded.private,
    github_archived = excluded.github_archived,
    default_branch = excluded.default_branch,
    stars = excluded.stars,
    pushed_at = excluded.pushed_at,
    last_commit_sha = excluded.last_commit_sha,
    last_commit_message = excluded.last_commit_message,
    last_commit_date = excluded.last_commit_date,
    open_issues_count = excluded.open_issues_count,
    ci_status = excluded.ci_status,
    synced_at = excluded.synced_at
`);

export function upsertRepo(repo) {
  upsertRepoStmt.run(repo);
}

export function listRepos() {
  return db
    .prepare(
      `SELECT * FROM repos ORDER BY COALESCE(last_commit_date, pushed_at) DESC`
    )
    .all();
}

export function getRepo(id) {
  return db.prepare(`SELECT * FROM repos WHERE id = ?`).get(id);
}

const updateManualStmt = db.prepare(`
  UPDATE repos SET
    status = @status,
    progress_note = @progress_note,
    goals = @goals,
    next_steps = @next_steps,
    manual_updated_at = @manual_updated_at
  WHERE id = @id
`);

export function updateManualFields(id, fields) {
  const current = getRepo(id);
  if (!current) return null;
  updateManualStmt.run({
    id,
    status: fields.status ?? current.status,
    progress_note: fields.progress_note ?? current.progress_note,
    goals: fields.goals ?? current.goals,
    next_steps: fields.next_steps ?? current.next_steps,
    manual_updated_at: new Date().toISOString(),
  });
  return getRepo(id);
}

export default db;
