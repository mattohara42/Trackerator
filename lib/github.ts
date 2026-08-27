import type { SyncedRepoInput } from "./db";

const API_BASE = "https://api.github.com";

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch(url: string, token: string) {
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} for ${url}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function listAllRepos(token: string, affiliation: string) {
  const repos: any[] = [];
  let page = 1;
  for (;;) {
    const url = `${API_BASE}/user/repos?affiliation=${encodeURIComponent(
      affiliation
    )}&per_page=100&page=${page}&sort=pushed`;
    const batch = await ghFetch(url, token);
    repos.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }
  return repos;
}

async function getLastCommit(token: string, fullName: string, branch: string) {
  try {
    const commit = await ghFetch(
      `${API_BASE}/repos/${fullName}/commits/${encodeURIComponent(branch)}`,
      token
    );
    return {
      sha: commit.sha as string | null,
      message: (commit.commit?.message?.split("\n")[0] ?? null) as string | null,
      date: (commit.commit?.author?.date ?? null) as string | null,
    };
  } catch {
    return { sha: null, message: null, date: null };
  }
}

async function getCombinedStatus(token: string, fullName: string, sha: string | null) {
  if (!sha) return "unknown";
  try {
    const status = await ghFetch(`${API_BASE}/repos/${fullName}/commits/${sha}/status`, token);
    if (status.state && status.state !== "pending") return status.state as string;

    const checks = await ghFetch(
      `${API_BASE}/repos/${fullName}/commits/${sha}/check-runs`,
      token
    );
    if (!checks.check_runs || checks.check_runs.length === 0) return "unknown";
    const conclusions = checks.check_runs.map((c: any) => c.conclusion ?? "pending");
    if (conclusions.some((c: string) => c === "failure" || c === "timed_out")) return "failure";
    if (conclusions.some((c: string) => c === "pending" || c === null)) return "pending";
    if (conclusions.every((c: string) => c === "success" || c === "neutral" || c === "skipped"))
      return "success";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * One recursive tree call gives us the whole file listing, which answers
 * several setup questions at once (README, licence file, CI workflows, tests)
 * for the price of a single request. Cheaper than a call per check.
 */
async function getRepoTree(token: string, fullName: string, branch: string): Promise<string[]> {
  try {
    const data = await ghFetch(
      `${API_BASE}/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      token
    );
    return (data.tree ?? []).map((n: any) => n.path as string);
  } catch {
    return [];
  }
}

async function getLatestRelease(token: string, fullName: string) {
  try {
    const rel = await ghFetch(`${API_BASE}/repos/${fullName}/releases/latest`, token);
    return { tag: (rel.tag_name ?? null) as string | null, at: (rel.published_at ?? null) as string | null };
  } catch {
    // 404 simply means no published releases, which is a valid answer.
    return { tag: null, at: null };
  }
}

const NO_OPEN_WORK = {
  open_issues: 0,
  open_prs: 0,
  oldest_pr_at: null as string | null,
  top_issues: "[]",
};

/**
 * GitHub's issues endpoint returns pull requests alongside issues — a PR is an
 * issue with a `pull_request` key — and `open_issues_count` on the repo object
 * is the two added together. That sum can't tell you whether a repo has three
 * things to decide or three things half-finished, so one call here separates
 * them and keeps the titles of the liveliest issues.
 *
 * Capped at one page. A personal repo with more than 100 open issues is not a
 * case this dashboard needs to count precisely.
 */
async function getOpenWork(token: string, fullName: string) {
  try {
    const items = await ghFetch(
      `${API_BASE}/repos/${fullName}/issues?state=open&per_page=100&sort=updated&direction=desc`,
      token
    );
    const issues = (items ?? []).filter((i: any) => !i.pull_request);
    const prs = (items ?? []).filter((i: any) => i.pull_request);

    return {
      open_issues: issues.length,
      open_prs: prs.length,
      // ISO strings sort chronologically, so this is the PR that has been open
      // longest — work started and dropped, which is worth surfacing.
      oldest_pr_at: prs.length
        ? (prs.map((p: any) => p.created_at).sort()[0] as string)
        : null,
      top_issues: JSON.stringify(
        issues.slice(0, 3).map((i: any) => ({
          number: i.number,
          title: i.title,
          url: i.html_url,
        }))
      ),
    };
  } catch {
    return NO_OPEN_WORK;
  }
}

const ROOT_README = /^readme(\.|$)/i;
const ROOT_LICENSE = /^(licen[sc]e|copying)(\.|$)/i;
const CI_WORKFLOW = /^\.github\/workflows\/.+\.ya?ml$/i;
const TEST_PATH =
  /(^|\/)(tests?|specs?|__tests__|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)(jest|vitest|playwright|karma|cypress)\.config\.[cm]?[jt]s$/i;

function inspectTree(paths: string[]) {
  return {
    has_readme: paths.some((p) => ROOT_README.test(p)),
    has_license_file: paths.some((p) => ROOT_LICENSE.test(p)),
    has_ci: paths.some((p) => CI_WORKFLOW.test(p)),
    has_tests: paths.some((p) => TEST_PATH.test(p)),
  };
}

function toRow(
  repo: any,
  lastCommit: any,
  ciStatus: string,
  setup: ReturnType<typeof inspectTree>,
  release: { tag: string | null; at: string | null },
  work: typeof NO_OPEN_WORK
): SyncedRepoInput {
  return {
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    html_url: repo.html_url,
    description: repo.description ?? "",
    private: Boolean(repo.private),
    github_archived: Boolean(repo.archived),
    default_branch: repo.default_branch ?? "",
    stars: repo.stargazers_count ?? 0,
    pushed_at: repo.pushed_at ?? null,
    last_commit_sha: lastCommit.sha,
    last_commit_message: lastCommit.message,
    last_commit_date: lastCommit.date,
    open_issues_count: repo.open_issues_count ?? 0,
    ci_status: ciStatus,
    synced_at: new Date().toISOString(),
    homepage: repo.homepage || null,
    topics: JSON.stringify(repo.topics ?? []),
    // GitHub only reports a licence it recognises. A LICENSE file it can't
    // identify still counts as having one for our purposes.
    license_name: repo.license?.spdx_id || repo.license?.name || (setup.has_license_file ? "Custom" : null),
    has_readme: setup.has_readme,
    has_ci: setup.has_ci,
    has_tests: setup.has_tests,
    latest_release_tag: release.tag,
    latest_release_at: release.at,
    open_issues: work.open_issues,
    open_prs: work.open_prs,
    oldest_pr_at: work.oldest_pr_at,
    top_issues: work.top_issues,
  };
}

export async function syncRepos({
  token,
  affiliation = "owner",
}: {
  token: string | undefined;
  affiliation?: string;
}): Promise<SyncedRepoInput[]> {
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set for this deploy. Set it in Netlify under Site "
      + "configuration > Environment variables, then trigger a new deploy — "
      + "functions only pick up environment variables at deploy time.");
  }

  const repos = await listAllRepos(token, affiliation);

  const NO_SETUP = { has_readme: false, has_license_file: false, has_ci: false, has_tests: false };
  const NO_RELEASE = { tag: null, at: null };

  // Each repo needs several more API calls (last commit, CI status, file tree,
  // latest release). Done sequentially that is 4-5N round trips, which blows
  // past Netlify's ~10s synchronous function timeout well before 25 repos —
  // and because nothing is written until every fetch finishes, a timeout
  // writes NOTHING and silently leaves stale data. Bounded concurrency keeps
  // it inside the limit without hammering GitHub's rate limiter.
  return mapWithConcurrency(repos, 8, async (repo) => {
    if (!repo.default_branch) {
      return toRow(
        repo,
        { sha: null, message: null, date: null },
        "unknown",
        NO_SETUP,
        NO_RELEASE,
        NO_OPEN_WORK
      );
    }

    const lastCommit = await getLastCommit(token, repo.full_name, repo.default_branch);
    // Added to the existing parallel batch rather than run after it, so the
    // extra call costs latency only if it is the slowest of the four.
    const [ciStatus, tree, release, work] = await Promise.all([
      getCombinedStatus(token, repo.full_name, lastCommit.sha),
      getRepoTree(token, repo.full_name, repo.default_branch),
      getLatestRelease(token, repo.full_name),
      getOpenWork(token, repo.full_name),
    ]);

    return toRow(repo, lastCommit, ciStatus, inspectTree(tree), release, work);
  });
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });

  await Promise.all(workers);
  return results;
}

async function getFileContents(token: string, fullName: string, path: string, ref: string) {
  const res = await fetch(
    `${API_BASE}/repos/${fullName}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
    { headers: headers(token) }
  );
  if (res.status === 404) return { content: null as string | null, sha: null as string | null };
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} fetching ${path}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return { content: Buffer.from(data.content, "base64").toString("utf-8"), sha: data.sha as string };
}

async function putFileContents(
  token: string,
  fullName: string,
  path: string,
  branch: string,
  content: string,
  sha: string | null,
  message: string
) {
  const res = await fetch(`${API_BASE}/repos/${fullName}/contents/${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} writing ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

const NOTES_HEADING = "## Notes from Trackerator";

function buildUpdatedClaudeMd(existingContent: string | null, note: string): string {
  const timestamp = new Date().toISOString().slice(0, 10);
  const entry = `- ${timestamp}: ${note}`;

  if (!existingContent) {
    return `# CLAUDE.md\n\n${NOTES_HEADING}\n\n${entry}\n`;
  }

  const trimmed = existingContent.trimEnd();
  if (trimmed.includes(NOTES_HEADING)) {
    return `${trimmed}\n${entry}\n`;
  }
  return `${trimmed}\n\n${NOTES_HEADING}\n\n${entry}\n`;
}

export async function sendNoteToClaude({
  token,
  fullName,
  branch,
  note,
}: {
  token: string | undefined;
  fullName: string;
  branch: string;
  note: string;
}): Promise<void> {
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set for this deploy. Set it in Netlify under Site "
      + "configuration > Environment variables, then trigger a new deploy — "
      + "functions only pick up environment variables at deploy time.");
  }
  const path = "CLAUDE.md";
  const { content, sha } = await getFileContents(token, fullName, path, branch);
  const updated = buildUpdatedClaudeMd(content, note);
  await putFileContents(token, fullName, path, branch, updated, sha, "Add Trackerator note to CLAUDE.md");
}
