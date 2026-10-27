import { escapeHtml, safeHref } from "./safe.js";

const grid = document.getElementById("grid");
const emptyState = document.getElementById("emptyState");
const syncBtn = document.getElementById("syncBtn");
const syncLabel = document.getElementById("syncLabel");
const syncedAtEl = document.getElementById("syncedAt");
const statusFilter = document.getElementById("statusFilter");
const showArchivedToggle = document.getElementById("showArchived");
const archivedNote = document.getElementById("archivedNote");
const sortSelect = document.getElementById("sortBy");
const overview = document.getElementById("overview");
const pickEl = document.getElementById("pick");
const topbar = document.querySelector(".topbar");
const controlsToggle = document.getElementById("controlsToggle");

// Must match the breakpoint of the phone layout in style.css. Used only where
// behaviour differs, not looks: on a phone the pick opens the repo's detail
// view, on desktop it scrolls to the card.
const phoneQuery = window.matchMedia("(max-width: 700px)");

const ARCHIVED_PREF_KEY = "trackerator.showArchived";
const SORT_PREF_KEY = "trackerator.sortBy";

let repos = [];
const saveTimers = new Map();

// The site sits behind Netlify team SSO. When that session expires the edge
// answers API calls with a 401 and an HTML login-redirect page, without ever
// reaching the function — so this is never an application error, and there is
// no point showing anyone the redirect markup. Every fetch path checks for it,
// because the failure is invisible otherwise: a save just stops saving.
function isAuthFailure(res) {
  return res.status === 401 || res.status === 403;
}

const AUTH_MESSAGE =
  "Your Netlify login has expired. Reload the page, sign in again, then try that again.";

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

/** relativeTime without the "ago", for the phone rows where width is scarce. */
function shortAge(iso) {
  return iso ? relativeTime(iso).replace(/ ago$/, "") : "never";
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

const STATUSES = ["active", "paused", "idea", "done", "archived"];

// Deliberately not reusing the words in STATUS_LED: that field is what you
// *say* a repo is, this is what the commit history actually shows. Keeping the
// vocabularies separate is what makes the disagreement between them readable.
const STALENESS_TIERS = [
  { key: "fresh", maxDays: 14, label: "FRESH", led: "on-green" },
  { key: "cooling", maxDays: 60, label: "COOLING", led: "on-amber" },
  { key: "stale", maxDays: 365, label: "STALE", led: "on-red" },
  { key: "dormant", maxDays: Infinity, label: "DORMANT", led: "" },
];

function daysSince(iso) {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}

/** Days since the last commit, or null when a repo has no commit history. */
function daysSinceActivity(repo) {
  return daysSince(repo.last_commit_date || repo.pushed_at);
}

function stalenessOf(repo) {
  const days = daysSinceActivity(repo);
  if (days === null) return { ...STALENESS_TIERS[3], days: Infinity };
  return { ...STALENESS_TIERS.find((t) => days <= t.maxDays), days };
}

// The point of the whole dashboard: a repo you called "active" and haven't
// touched in two months is either mislabelled or genuinely being neglected.
// Either way it's the thing worth looking at. Repos GitHub has archived are
// excluded — frozen is the expected state there, not a problem.
function needsAttention(repo) {
  if (repo.github_archived) return false;
  if (repo.status !== "active") return false;
  const days = daysSinceActivity(repo);
  return days !== null && days > 60;
}


// ---------------------------------------------------------------------------
// Completeness: how well set up a repo is, independent of how active it is.
// A repo can be busy and badly set up, or finished and immaculate. Each check
// is a thing you'd expect a project someone else might look at to have.
// ---------------------------------------------------------------------------

const COMPLETENESS_CHECKS = [
  { key: "description", label: "Description", test: (r) => Boolean((r.description || "").trim()) },
  { key: "readme", label: "README", test: (r) => Boolean(r.has_readme) },
  { key: "license", label: "License", test: (r) => Boolean(r.license_name) },
  { key: "topics", label: "Topics", test: (r) => topicsOf(r).length > 0 },
  { key: "release", label: "Release", test: (r) => Boolean(r.latest_release_tag) },
  { key: "ci", label: "CI workflow", test: (r) => Boolean(r.has_ci) },
  { key: "tests", label: "Test suite", test: (r) => Boolean(r.has_tests) },
  { key: "homepage", label: "Live link", test: (r) => Boolean(r.homepage) },
];

function topicsOf(repo) {
  try {
    const parsed = JSON.parse(repo.topics || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function completenessOf(repo) {
  const results = COMPLETENESS_CHECKS.map((c) => ({ ...c, pass: c.test(repo) }));
  const passed = results.filter((r) => r.pass).length;
  return { results, passed, total: results.length };
}

// Categories come from GitHub topics rather than a field in here, so the
// classification lives with the repo and any tool can read it.
const CATEGORY_TOPICS = { audio: "AUDIO", game: "GAME", productivity: "PRODUCTIVITY" };

function categoryOf(repo) {
  for (const topic of topicsOf(repo)) {
    const hit = CATEGORY_TOPICS[topic.toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Open work: the closest thing to an answer for "what would I do next here",
// and unlike the Next steps field it needs no typing. Issues and PRs are
// counted separately because they mean different things — an issue is a thing
// to decide, an open PR is a thing you started and walked away from.
// ---------------------------------------------------------------------------

function openWorkOf(repo) {
  let issues = [];
  try {
    const parsed = JSON.parse(repo.top_issues || "[]");
    if (Array.isArray(parsed)) issues = parsed;
  } catch {
    // Malformed JSON means no titles to show, not a broken card.
  }
  return {
    issues,
    openIssues: repo.open_issues ?? 0,
    openPrs: repo.open_prs ?? 0,
    oldestPrAt: repo.oldest_pr_at || null,
  };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function workHintOf(work) {
  const parts = [];
  if (work.openIssues) parts.push(plural(work.openIssues, "issue"));
  if (work.openPrs) parts.push(plural(work.openPrs, "PR"));
  return parts.join(" · ") || "clear";
}

// ---------------------------------------------------------------------------
// The pick: one repo to open, and why.
//
// The dashboard answers "what is the state of everything". It did not answer
// "I have an afternoon, where should it go" — which is the question you
// actually arrive with. Everything here is already computed elsewhere; the
// only new thing is ranking it and saying one sentence.
//
// Only `active` repos are candidates. Paused, idea, done and archived ones are
// deliberately out of play — the same reasoning the attention flag uses.
// ---------------------------------------------------------------------------

const PICK_REASONS = [
  {
    weight: 100,
    test: (r) => r.ci_status === "failure",
    why: () => "CI is failing",
  },
  {
    // Work you began and walked away from beats work you never started.
    weight: 80,
    test: (r) => (daysSince(openWorkOf(r).oldestPrAt) ?? 0) > 30,
    why: (r) => `a PR has been open ${Math.floor(daysSince(openWorkOf(r).oldestPrAt))} days`,
  },
  {
    weight: 60,
    test: needsAttention,
    why: (r) => `marked active but untouched for ${Math.floor(daysSinceActivity(r))} days`,
  },
  {
    weight: 40,
    test: (r) => openWorkOf(r).openIssues > 0,
    why: (r) => `${plural(openWorkOf(r).openIssues, "open issue")} waiting`,
  },
];

function pickOf(inScope) {
  const ranked = inScope
    .filter((r) => r.status === "active" && !r.github_archived)
    .map((repo) => {
      const reason = PICK_REASONS.find((c) => c.test(repo));
      return reason ? { repo, weight: reason.weight, why: reason.why(repo) } : null;
    })
    .filter(Boolean)
    // Strongest reason first, then whichever has been left alone longest.
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        (daysSinceActivity(b.repo) ?? Infinity) - (daysSinceActivity(a.repo) ?? Infinity)
    );

  return ranked[0] ?? null;
}

function renderPick(inScope) {
  const pick = pickOf(inScope);

  if (!pick) {
    pickEl.innerHTML = inScope.length
      ? `<span class="pick-label">ALL CLEAR</span><span class="pick-why">Nothing active needs picking up.</span>`
      : "";
    return;
  }

  pickEl.innerHTML = `
    <span class="pick-label">PICK UP NEXT</span>
    <button type="button" class="pick-repo" data-id="${pick.repo.id}">${escapeHtml(pick.repo.name)}</button>
    <span class="pick-why">${escapeHtml(pick.why)}</span>
  `;

  pickEl.querySelector(".pick-repo").addEventListener("click", () => {
    if (phoneQuery.matches) return openDetail(pick.repo.id);
    const card = grid.querySelector(`.card[data-id="${pick.repo.id}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("highlight");
    setTimeout(() => card.classList.remove("highlight"), 1600);
  });
}

function renderCard(repo) {
  const stale = stalenessOf(repo);
  const flagged = needsAttention(repo);
  const completeness = completenessOf(repo);
  const category = categoryOf(repo);
  const topics = topicsOf(repo);
  const work = openWorkOf(repo);
  const filledNotes = [repo.progress_note, repo.goals, repo.next_steps].filter((v) => (v || "").trim()).length;
  // Escaped, not trusted: `status` is whatever the API stored, and this string
  // goes into innerHTML below.
  const noteSummary = escapeHtml(
    `${repo.status.toUpperCase()}${filledNotes ? ` · ${filledNotes}/3 filled` : ""}`
  );

  const el = document.createElement("article");
  el.className = `card tier-${stale.key}${flagged ? " needs-attention" : ""}`;
  el.dataset.id = repo.id;

  // .card-row and .card-back exist only for the phone layout (see style.css).
  // The row is the whole card in the list; tapping it opens this same card
  // full-screen, so the detail view is the card itself and every edit path
  // below works there unchanged.
  el.innerHTML = `
    <button type="button" class="card-back">‹ BACK</button>
    <button type="button" class="card-row">
      <span class="row-flag"${flagged ? "" : " hidden"}>!</span>
      <span class="row-name">${escapeHtml(repo.name)}</span>
      <span class="row-age"><span class="led ${stale.led}"></span>${shortAge(repo.last_commit_date || repo.pushed_at)}</span>
      <span class="row-info">
        <span class="row-status">${escapeHtml(repo.status.toUpperCase())}</span>
        <span>${workHintOf(work)}</span>
        <span>${completeness.passed}/${completeness.total}</span>
      </span>
    </button>
    <div class="card-header">
      <a href="${safeHref(repo.html_url)}" target="_blank" rel="noopener">${escapeHtml(repo.name)}</a>
      <span class="header-meta">
        ${category ? `<span class="category">${category}</span>` : ""}
        <span class="staleness"><span class="led ${stale.led}"></span>${stale.label}</span>
      </span>
    </div>
    <div class="attention-flag"${flagged ? "" : " hidden"}>${
      flagged ? `Marked active, untouched for ${Math.floor(stale.days)} days` : ""
    }</div>
    <div class="meter" title="${completeness.passed} of ${completeness.total} setup checks pass">
      ${completeness.results.map((c) => `<span class="seg ${c.pass ? "on" : ""}"></span>`).join("")}
      <span class="meter-score">${completeness.passed}/${completeness.total}</span>
    </div>
    <div class="description">${escapeHtml(repo.description) || "<em>No description</em>"}</div>
    <div class="last-commit">
      ${repo.last_commit_message ? `"${escapeHtml(repo.last_commit_message)}" — ` : ""}${relativeTime(repo.last_commit_date)}
    </div>

    <div class="status-strip" role="radiogroup" aria-label="Status for ${escapeHtml(repo.name)}">
      ${STATUSES.map(
        (s) => `
        <label class="status-chip" data-status="${s}">
          <input type="radio" name="status-${repo.id}" data-field="status" value="${s}" ${
            repo.status === s ? "checked" : ""
          } />
          <span class="chip-face"><span class="led"></span>${s.toUpperCase()}</span>
        </label>`
      ).join("")}
    </div>

    <details class="section zone-yellow">
      <summary><span class="summary-title">NEXT UP</span><span class="summary-hint">${workHintOf(work)}</span></summary>
      ${
        work.issues.length
          ? `<ul class="issue-list">
        ${work.issues
          .map(
            (i) =>
              `<li><a href="${safeHref(i.url)}" target="_blank" rel="noopener"><span class="issue-num">#${escapeHtml(
                String(i.number)
              )}</span>${escapeHtml(i.title)}</a></li>`
          )
          .join("")}
      </ul>
      ${work.openIssues > work.issues.length ? `<div class="work-note">+${work.openIssues - work.issues.length} more open</div>` : ""}`
          : `<div class="work-note">No open issues.</div>`
      }
      ${
        work.openPrs
          ? `<div class="work-note pr-note">
        <span class="led on-amber"></span>${plural(work.openPrs, "open PR")}${
              work.oldestPrAt ? `, oldest from ${relativeTime(work.oldestPrAt)}` : ""
            }
      </div>`
          : ""
      }
    </details>

    <details class="section zone-cyan">
      <summary><span class="summary-title">SETUP</span><span class="summary-hint">${completeness.passed}/${completeness.total}</span></summary>
      <ul class="checklist">
        ${completeness.results
          .map(
            (c) =>
              `<li class="${c.pass ? "pass" : "fail"}"><span class="led ${c.pass ? "on-green" : ""}"></span>${c.label}</li>`
          )
          .join("")}
      </ul>
      <div class="badges">
        <span class="badge">${repo.private ? "private" : "public"}</span>
        ${repo.github_archived ? '<span class="badge">github-archived</span>' : ""}
        ${ciBadge(repo.ci_status)}
        <span class="badge">${plural(work.openIssues, "issue")}</span>
        <span class="badge">${plural(work.openPrs, "PR")}</span>
        <span class="badge">★ ${repo.stars}</span>
        ${repo.license_name ? `<span class="badge">${escapeHtml(repo.license_name)}</span>` : ""}
        ${repo.latest_release_tag ? `<span class="badge">${escapeHtml(repo.latest_release_tag)} · ${relativeTime(repo.latest_release_at)}</span>` : ""}
      </div>
      ${topics.length ? `<div class="badges">${topics.map((t) => `<span class="badge topic">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
    </details>

    <details class="section zone-green">
      <summary><span class="summary-title">NOTES</span><span class="summary-hint notes-hint">${noteSummary}</span></summary>
      <div class="field">
        <label for="progress-${repo.id}">Progress</label>
        <textarea id="progress-${repo.id}" data-field="progress_note" maxlength="10000" placeholder="Where things stand...">${escapeHtml(repo.progress_note)}</textarea>
      </div>
      <div class="field">
        <label for="goals-${repo.id}">Goals</label>
        <textarea id="goals-${repo.id}" data-field="goals" maxlength="10000" placeholder="What this repo is for / aiming at...">${escapeHtml(repo.goals)}</textarea>
      </div>
      <div class="field">
        <label for="next-${repo.id}">Next steps</label>
        <textarea id="next-${repo.id}" data-field="next_steps" maxlength="10000" placeholder="What to do next...">${escapeHtml(repo.next_steps)}</textarea>
      </div>
      <div class="save-indicator">saved</div>
    </details>

    <details class="section zone-violet">
      <summary><span class="summary-title">SEND TO CLAUDE</span><span class="summary-hint">${repo.last_note_sent_at ? relativeTime(repo.last_note_sent_at) : ""}</span></summary>
      <div class="field claude-note-field">
        <textarea id="note-${repo.id}" class="claude-note-input" placeholder="Anything Claude should know next time it works on this repo..."></textarea>
        <div class="field-row claude-note-row">
          <button class="btn-panel btn-send-note" type="button">
            <span class="btn-led"></span>
            <span class="btn-send-label">SEND TO CLAUDE</span>
          </button>
          <span class="note-sent-at">${repo.last_note_sent_at ? `Sent ${relativeTime(repo.last_note_sent_at)}` : ""}</span>
        </div>
      </div>
    </details>

    <div class="card-links">
      <a href="${safeHref(repo.html_url)}" target="_blank" rel="noopener">GitHub ↗</a>
      ${repo.homepage ? `<a href="${safeHref(repo.homepage)}" target="_blank" rel="noopener">Live site ↗</a>` : ""}
    </div>
  `;

  el.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      refreshDerived(el, repo);
      scheduleSave(repo.id, el);
    });
  });

  el.querySelector(".btn-send-note").addEventListener("click", () => sendNote(repo.id, el));
  el.querySelector(".card-row").addEventListener("click", () => openDetail(repo.id));
  el.querySelector(".card-back").addEventListener("click", closeDetail);

  return el;
}

// What a card shows about itself that depends on the fields you can edit.
// Updated in place rather than by re-rendering: marking a repo paused should
// visibly clear its red flag, but the card shouldn't resort itself out from
// under the click that did it.
function refreshDerived(el, repo) {
  const status = el.querySelector('[data-field="status"]:checked')?.value || repo.status;
  const filled = ["progress_note", "goals", "next_steps"].filter((f) =>
    (el.querySelector(`[data-field="${f}"]`)?.value || "").trim()
  ).length;

  el.querySelector(".notes-hint").textContent =
    `${status.toUpperCase()}${filled ? ` · ${filled}/3 filled` : ""}`;

  el.querySelector(".row-status").textContent = status.toUpperCase();

  const flagged = needsAttention({ ...repo, status });
  el.classList.toggle("needs-attention", flagged);
  el.querySelector(".row-flag").hidden = !flagged;
  const flag = el.querySelector(".attention-flag");
  flag.hidden = !flagged;
  if (flagged) {
    flag.textContent = `Marked active, untouched for ${Math.floor(stalenessOf(repo).days)} days`;
  }
}

async function sendNote(id, cardEl) {
  const input = cardEl.querySelector(".claude-note-input");
  const note = input.value.trim();
  if (!note) return;

  const btn = cardEl.querySelector(".btn-send-note");
  const label = cardEl.querySelector(".btn-send-label");
  btn.disabled = true;
  label.textContent = "SENDING...";

  try {
    const res = await fetch(`/api/repos/${id}/send-to-claude`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (isAuthFailure(res)) {
      alert(AUTH_MESSAGE);
      return;
    }

    const body = await res.text();
    let data = null;
    try {
      data = JSON.parse(body);
    } catch {
      // A crash or timeout returns HTML; handled below rather than thrown.
    }
    if (!res.ok || !data) {
      alert(`Send failed: ${data?.error || body.slice(0, 200) || res.statusText}`);
      return;
    }

    const idx = repos.findIndex((r) => r.id === id);
    if (idx !== -1) repos[idx] = data;

    input.value = "";
    cardEl.querySelector(".note-sent-at").textContent = "Sent just now";
  } catch (err) {
    // The connection can drop after GitHub accepted the commit, so a retry
    // could add the note twice.
    alert(`Send failed: ${err.message}. The note may or may not have been committed, `
      + "so check the repo's CLAUDE.md before sending again.");
  } finally {
    btn.disabled = false;
    label.textContent = "SEND TO CLAUDE";
  }
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
    if (input.type === "radio" && !input.checked) return;
    fields[input.dataset.field] = input.value;
  });

  let res;
  try {
    res = await fetch(`/api/repos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
  } catch (err) {
    alert(`Save failed: ${err.message}. Your edit is still on screen but not stored.`);
    return;
  }

  if (isAuthFailure(res)) {
    alert(AUTH_MESSAGE);
    return;
  }

  // Said out loud, because the text stays in the box either way and a silent
  // failure looks exactly like a save.
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    alert(`Save failed: ${data?.error || res.statusText || `HTTP ${res.status}`}. `
      + "Your edit is still on screen but not stored.");
    return;
  }

  const updated = await res.json();
  const idx = repos.findIndex((r) => r.id === id);
  if (idx !== -1) repos[idx] = updated;

  const scope = reposInScope();
  renderOverview(scope);
  renderPick(scope);

  const indicator = cardEl.querySelector(".save-indicator");
  indicator.classList.add("visible");
  setTimeout(() => indicator.classList.remove("visible"), 1200);
}

const SORTERS = {
  // Default. Flagged repos first, then longest-neglected — the order you'd
  // want if you opened this to decide what to pick up.
  attention: (a, b) =>
    Number(needsAttention(b)) - Number(needsAttention(a)) ||
    (daysSinceActivity(b) ?? Infinity) - (daysSinceActivity(a) ?? Infinity),
  recent: (a, b) => (daysSinceActivity(a) ?? Infinity) - (daysSinceActivity(b) ?? Infinity),
  stale: (a, b) => (daysSinceActivity(b) ?? Infinity) - (daysSinceActivity(a) ?? Infinity),
  name: (a, b) => a.name.localeCompare(b.name),
  incomplete: (a, b) => completenessOf(a).passed - completenessOf(b).passed,
};

function sortRepos(list, key) {
  return [...list].sort(SORTERS[key] || SORTERS.attention);
}

// GitHub-archived repos are frozen by definition, so they're noise in a view
// meant to surface what needs attention. Kept in the DB, just hidden here.
function reposInScope() {
  return showArchivedToggle.checked ? repos : repos.filter((r) => !r.github_archived);
}

function renderOverview(inScope) {
  if (inScope.length === 0) {
    overview.innerHTML = "";
    return;
  }

  const counts = { fresh: 0, cooling: 0, stale: 0, dormant: 0 };
  inScope.forEach((r) => counts[stalenessOf(r).key]++);
  const flagged = inScope.filter(needsAttention).length;

  const tiers = STALENESS_TIERS.filter((t) => counts[t.key] > 0)
    .map(
      (t) =>
        `<span class="tally"><span class="led ${t.led}"></span>${counts[t.key]} ${t.label}</span>`
    )
    .join("");

  overview.innerHTML = `
    <span class="tally tally-total">${inScope.length} REPOS</span>
    ${tiers}
    ${flagged ? `<span class="tally tally-flagged">${flagged} NEED${flagged === 1 ? "S" : ""} ATTENTION</span>` : ""}
  `;
}

function render() {
  const filter = statusFilter.value;
  const inScope = reposInScope();
  const hiddenArchived = repos.length - inScope.length;

  const visible = sortRepos(
    filter ? inScope.filter((r) => r.status === filter) : inScope,
    sortSelect.value
  );

  grid.innerHTML = "";
  emptyState.hidden = repos.length > 0;

  visible.forEach((repo) => grid.appendChild(renderCard(repo)));

  renderOverview(inScope);
  renderPick(inScope);

  archivedNote.textContent = hiddenArchived
    ? `${hiddenArchived} archived repo${hiddenArchived === 1 ? "" : "s"} hidden`
    : "";

  const latestSync = repos.reduce(
    (max, r) => (r.synced_at && r.synced_at > max ? r.synced_at : max),
    ""
  );
  syncedAtEl.textContent = latestSync ? `Last synced ${relativeTime(latestSync)}` : "";

  // A re-render (after a sync, say) replaces every card, including an open one.
  applyRoute();
}

// ---------------------------------------------------------------------------
// Phone drill-down. The open repo lives in the URL (#repo/<id>), so the
// phone's own back button or swipe closes it, and a detail view survives a
// reload. Desktop ignores all of this: the classes it sets only have rules
// inside the phone media query.
// ---------------------------------------------------------------------------

const DETAIL_PREFIX = "#repo/";
let listScrollY = 0;
// Whether there's a list entry behind the detail one in history. Not true for
// a detail URL opened directly, where history.back() would leave the site.
let openedFromList = false;

function openDetail(id) {
  listScrollY = window.scrollY;
  openedFromList = true;
  location.hash = `repo/${id}`;
}

function closeDetail() {
  if (openedFromList) {
    history.back();
  } else {
    history.replaceState(null, "", location.pathname + location.search);
    applyRoute();
  }
}

function applyRoute() {
  const id = location.hash.startsWith(DETAIL_PREFIX) ? location.hash.slice(DETAIL_PREFIX.length) : null;
  const card = id ? [...grid.children].find((c) => c.dataset.id === id) : null;
  const wasOpen = document.body.classList.contains("detail-open");

  grid.querySelectorAll(".card.open").forEach((c) => c.classList.remove("open"));
  document.body.classList.toggle("detail-open", Boolean(card));

  if (card) {
    card.classList.add("open");
    if (!wasOpen) window.scrollTo(0, 0);
  } else if (wasOpen) {
    openedFromList = false;
    window.scrollTo(0, listScrollY);
  }
}

window.addEventListener("hashchange", applyRoute);

controlsToggle.addEventListener("click", () => {
  const open = topbar.classList.toggle("controls-open");
  controlsToggle.setAttribute("aria-expanded", String(open));
});

function showLoadError(message) {
  emptyState.hidden = false;
  emptyState.textContent = message;
}

async function loadRepos() {
  try {
    const res = await fetch("/api/repos");
    if (isAuthFailure(res)) return showLoadError(AUTH_MESSAGE);

    const body = await res.text();
    if (!res.ok) {
      return showLoadError(`Couldn't load repos (HTTP ${res.status}). ${body.slice(0, 200)}`);
    }
    try {
      repos = JSON.parse(body);
    } catch {
      return showLoadError(
        `Couldn't load repos: the response wasn't JSON (HTTP ${res.status}).`
      );
    }
    render();
  } catch (err) {
    showLoadError(`Couldn't load repos: ${err.message}`);
  }
}

async function runSync() {
  syncBtn.disabled = true;
  syncLabel.textContent = "SYNCING...";
  try {
    const res = await fetch("/api/sync", { method: "POST" });

    // Read as text first: a function timeout or crash returns an HTML error
    // page, and calling res.json() on that throws — which previously escaped
    // as an unhandled rejection, so a failed sync looked like nothing at all
    // happened. Never let a sync fail silently.
    const body = await res.text();
    let data = null;
    try {
      data = JSON.parse(body);
    } catch {
      // Left null — handled below.
    }

    if (isAuthFailure(res)) {
      alert(AUTH_MESSAGE);
      return;
    }
    if (!res.ok) {
      const detail = data?.error || body.slice(0, 300) || res.statusText;
      alert(`Sync failed (HTTP ${res.status}): ${detail}`);
      return;
    }
    if (!data) {
      alert(
        `Sync returned an unreadable response (HTTP ${res.status}). ` +
          `This usually means the function timed out. First 300 chars:\n\n${body.slice(0, 300)}`
      );
      return;
    }

    repos = data.repos;
    render();
    reportSync(`Synced ${data.synced} repo${data.synced === 1 ? "" : "s"}`);
  } catch (err) {
    alert(`Sync failed: ${err.message}`);
  } finally {
    syncBtn.disabled = false;
    syncLabel.textContent = "SYNC UPLINK";
  }
}

function reportSync(message) {
  syncedAtEl.textContent = message;
  setTimeout(render, 4000);
}

syncBtn.addEventListener("click", runSync);
statusFilter.addEventListener("change", render);

showArchivedToggle.addEventListener("change", () => {
  try {
    localStorage.setItem(ARCHIVED_PREF_KEY, showArchivedToggle.checked ? "1" : "0");
  } catch {
    // Private browsing or blocked storage — the toggle still works this session.
  }
  render();
});

sortSelect.addEventListener("change", () => {
  try {
    localStorage.setItem(SORT_PREF_KEY, sortSelect.value);
  } catch {
    // Blocked storage — the control still works for this session.
  }
  render();
});

try {
  showArchivedToggle.checked = localStorage.getItem(ARCHIVED_PREF_KEY) === "1";
  const savedSort = localStorage.getItem(SORT_PREF_KEY);
  if (savedSort && SORTERS[savedSort]) sortSelect.value = savedSort;
} catch {
  showArchivedToggle.checked = false;
}

loadRepos();
