const API_BASE = "https://api.github.com";

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghFetch(url, token) {
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} for ${url}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function listAllRepos(token, affiliation) {
  const repos = [];
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

async function getLastCommit(token, fullName, branch) {
  try {
    const commit = await ghFetch(
      `${API_BASE}/repos/${fullName}/commits/${encodeURIComponent(branch)}`,
      token
    );
    return {
      sha: commit.sha,
      message: commit.commit?.message?.split("\n")[0] ?? "",
      date: commit.commit?.author?.date ?? null,
    };
  } catch {
    return { sha: null, message: null, date: null };
  }
}

async function getCombinedStatus(token, fullName, sha) {
  if (!sha) return "unknown";
  try {
    const status = await ghFetch(
      `${API_BASE}/repos/${fullName}/commits/${sha}/status`,
      token
    );
    if (status.state && status.state !== "pending") return status.state;

    // Fall back to check runs (GitHub Actions) when there's no legacy status.
    const checks = await ghFetch(
      `${API_BASE}/repos/${fullName}/commits/${sha}/check-runs`,
      token
    );
    if (!checks.check_runs || checks.check_runs.length === 0) return "unknown";
    const conclusions = checks.check_runs.map((c) => c.conclusion ?? "pending");
    if (conclusions.some((c) => c === "failure" || c === "timed_out")) return "failure";
    if (conclusions.some((c) => c === "pending" || c === null)) return "pending";
    if (conclusions.every((c) => c === "success" || c === "neutral" || c === "skipped"))
      return "success";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function syncRepos({ token, affiliation = "owner" }) {
  if (!token) {
    throw new Error("GITHUB_TOKEN is not set. Add it to .env to enable syncing.");
  }

  const repos = await listAllRepos(token, affiliation);
  const results = [];

  for (const repo of repos) {
    if (!repo.default_branch) {
      results.push(toRow(repo, { sha: null, message: null, date: null }, "unknown"));
      continue;
    }
    const lastCommit = await getLastCommit(token, repo.full_name, repo.default_branch);
    const ciStatus = await getCombinedStatus(token, repo.full_name, lastCommit.sha);
    results.push(toRow(repo, lastCommit, ciStatus));
  }

  return results;
}

function toRow(repo, lastCommit, ciStatus) {
  return {
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    html_url: repo.html_url,
    description: repo.description ?? "",
    private: repo.private ? 1 : 0,
    github_archived: repo.archived ? 1 : 0,
    default_branch: repo.default_branch ?? "",
    stars: repo.stargazers_count ?? 0,
    pushed_at: repo.pushed_at ?? null,
    last_commit_sha: lastCommit.sha,
    last_commit_message: lastCommit.message,
    last_commit_date: lastCommit.date,
    open_issues_count: repo.open_issues_count ?? 0,
    ci_status: ciStatus,
    synced_at: new Date().toISOString(),
  };
}
