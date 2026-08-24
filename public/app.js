const grid = document.getElementById("grid");
const emptyState = document.getElementById("emptyState");
const syncBtn = document.getElementById("syncBtn");
const syncedAtEl = document.getElementById("syncedAt");
const statusFilter = document.getElementById("statusFilter");

let repos = [];
const saveTimers = new Map();

function relativeTime(iso) {
  if (!iso) return "no commits yet";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

const CI_LED = {
  success: { led: "on-green", label: "CI NOMINAL" },
  failure: { led: "on-red", label: "CI ALERT" },
  pending: { led: "on-amber", label: "CI STANDBY" },
};

function ciBadge(status) {
  const { led, label } = CI_LED[status] || { led: "", label: "CI OFFLINE" };
  return `<span class="badge"><span class="led ${led}"></span>${label}</span>`;
}

const STATUS_LED = {
  active: "on-green",
  paused: "on-amber",
  idea: "on-blue",
  done: "on-green",
  archived: "",
};

function escapeHtml(str) {
  return (str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function renderCard(repo) {
  const el = document.createElement("article");
  el.className = "card";
  el.dataset.id = repo.id;

  el.innerHTML = `
    <div class="card-header">
      <a href="${repo.html_url}" target="_blank" rel="noopener">${escapeHtml(repo.name)}</a>
    </div>
    <div class="badges">
      <span class="badge">${repo.private ? "private" : "public"}</span>
      ${repo.github_archived ? '<span class="badge">github-archived</span>' : ""}
      ${ciBadge(repo.ci_status)}
      <span class="badge">${repo.open_issues_count} open issue${repo.open_issues_count === 1 ? "" : "s"}/PRs</span>
      <span class="badge">★ ${repo.stars}</span>
    </div>
    <div class="description">${escapeHtml(repo.description)}</div>
    <div class="last-commit">
      ${repo.last_commit_message ? `"${escapeHtml(repo.last_commit_message)}" — ` : ""}${relativeTime(repo.last_commit_date)}
    </div>

    <div class="field">
      <label for="status-${repo.id}">Status</label>
      <div class="field-row">
        <span class="led status-led ${STATUS_LED[repo.status] || ""}"></span>
        <select id="status-${repo.id}" data-field="status">
          ${["active", "paused", "idea", "done", "archived"].map(
            (s) => `<option value="${s}" ${repo.status === s ? "selected" : ""}>${s.toUpperCase()}</option>`
          ).join("")}
        </select>
      </div>
    </div>

    <div class="field">
      <label for="progress-${repo.id}">Progress</label>
      <textarea id="progress-${repo.id}" data-field="progress_note" placeholder="Where things stand...">${escapeHtml(repo.progress_note)}</textarea>
    </div>

    <div class="field">
      <label for="goals-${repo.id}">Goals</label>
      <textarea id="goals-${repo.id}" data-field="goals" placeholder="What this repo is for / aiming at...">${escapeHtml(repo.goals)}</textarea>
    </div>

    <div class="field">
      <label for="next-${repo.id}">Next steps</label>
      <textarea id="next-${repo.id}" data-field="next_steps" placeholder="What to do next...">${escapeHtml(repo.next_steps)}</textarea>
    </div>

    <div class="save-indicator">saved</div>
  `;

  el.querySelectorAll("[data-field]").forEach((input) => {
    const eventName = input.tagName === "SELECT" ? "change" : "input";
    input.addEventListener(eventName, () => scheduleSave(repo.id, el));
  });

  const statusSelect = el.querySelector('[data-field="status"]');
  const statusLed = el.querySelector(".status-led");
  statusSelect.addEventListener("change", () => {
    statusLed.className = `led status-led ${STATUS_LED[statusSelect.value] || ""}`;
  });

  return el;
}

function scheduleSave(id, cardEl) {
  clearTimeout(saveTimers.get(id));
  saveTimers.set(
    id,
    setTimeout(() => saveRepo(id, cardEl), 600)
  );
}

async function saveRepo(id, cardEl) {
  const fields = {};
  cardEl.querySelectorAll("[data-field]").forEach((input) => {
    fields[input.dataset.field] = input.value;
  });

  const res = await fetch(`/api/repos/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });

  if (res.ok) {
    const updated = await res.json();
    const idx = repos.findIndex((r) => r.id === id);
    if (idx !== -1) repos[idx] = updated;

    const indicator = cardEl.querySelector(".save-indicator");
    indicator.classList.add("visible");
    setTimeout(() => indicator.classList.remove("visible"), 1200);
  }
}

function render() {
  const filter = statusFilter.value;
  const visible = filter ? repos.filter((r) => r.status === filter) : repos;

  grid.innerHTML = "";
  emptyState.hidden = repos.length > 0;

  visible.forEach((repo) => grid.appendChild(renderCard(repo)));

  const latestSync = repos.reduce(
    (max, r) => (r.synced_at && r.synced_at > max ? r.synced_at : max),
    ""
  );
  syncedAtEl.textContent = latestSync ? `Last synced ${relativeTime(latestSync)}` : "";
}

async function loadRepos() {
  const res = await fetch("/api/repos");
  repos = await res.json();
  render();
}

async function runSync() {
  syncBtn.disabled = true;
  syncBtn.textContent = "Syncing...";
  try {
    const res = await fetch("/api/sync", { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      alert(`Sync failed: ${data.error || res.statusText}`);
      return;
    }
    repos = data.repos;
    render();
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = "Sync from GitHub";
  }
}

syncBtn.addEventListener("click", runSync);
statusFilter.addEventListener("change", render);

loadRepos();
