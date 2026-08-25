# CLAUDE.md

Project context for Claude Code sessions working on Trackerator.

## What this is

A personal dashboard for tracking status across Matt's GitHub repos. It pairs
**auto-synced activity** (pulled from the GitHub API) with **hand-written
notes** (progress, goals, next steps) that a sync never overwrites.

It is deliberately single-user and personal — not a product. Design decisions
should favor "useful to one person glancing at it" over generality.

Live at **https://trackerator.netlify.app** (gated behind Netlify team SSO
login — see Access below).

## Architecture

```
public/                     static frontend (vanilla HTML/CSS/JS, no framework)
  index.html                  shell + topbar + empty state
  app.js                      card rendering, autosave, sync, send-to-claude
  style.css                   retro control-panel theme
netlify/functions/*.mts     serverless API (Node, runtimeAPIVersion 2)
  repos.mts                   GET    /api/repos
  sync.mts                    POST   /api/sync
  repo-update.mts             PATCH  /api/repos/:id
  send-to-claude.mts          POST   /api/repos/:id/send-to-claude
lib/                        shared logic used by the functions
  db.ts                       Netlify DB (Postgres) queries via @netlify/database
  github.ts                   GitHub REST calls + CLAUDE.md note writing
netlify/database/migrations/  SQL migrations, applied automatically on deploy
```

Routes are declared **in-code** via each function's exported `config.path`, so
the frontend calls clean `/api/*` paths with no redirect rules in
`netlify.toml`.

### Data model

One table, `repos`, keyed by GitHub's numeric repo id. Two distinct groups of
columns:

- **Sync-owned** (overwritten every sync): `name`, `full_name`, `html_url`,
  `description`, `private`, `github_archived`, `default_branch`, `stars`,
  `pushed_at`, `last_commit_*`, `open_issues_count`, `ci_status`, `synced_at`
- **User-owned** (never touched by sync): `status`, `progress_note`, `goals`,
  `next_steps`, `manual_updated_at`, `last_note_sent_at`

`upsertRepo` deliberately lists only sync-owned columns in its
`ON CONFLICT DO UPDATE` clause. **Preserve that split** — clobbering someone's
notes on a routine sync would be the worst bug this app could have.

## Features

- **Activity sync** — last commit (message + relative time), combined CI status
  (falls back from legacy commit status to GitHub Actions check-runs), open
  issues/PRs count, stars, public/private, archived flag.
- **Manual tracking** — status (`active`/`paused`/`idea`/`done`/`archived`),
  progress note, goals, next steps. Inline, debounced autosave (600ms).
- **Send to Claude** — per-repo note box; commits the note into *that repo's*
  `CLAUDE.md` under a `## Notes from Trackerator` heading, via the GitHub
  Contents API. Any later Claude session on that repo picks it up
  automatically. This is intentionally **asynchronous and durable** — a
  persistent instruction, not a live chat channel. (A live second chat window
  was considered and rejected: it would duplicate the existing Claude Code
  surfaces while adding hosting and credential complexity for no real gain.)

## Deployment

Netlify site `trackerator`, id `86b1700d-287a-4721-945e-8dffbf4c3fbb`,
git-linked to this repo. **Merging to `main` auto-deploys.** Migrations apply
automatically as part of the deploy.

### Operational gotchas — learned the hard way, do not re-derive

1. **Netlify functions bind environment variables at DEPLOY time, not request
   time.** Setting `GITHUB_TOKEN` on an already-published deploy does nothing
   until a *new* deploy happens. If sync reports the token missing while the
   Netlify UI clearly shows it set, check whether the live deploy predates the
   variable — that is almost certainly the cause.

2. **Secret env-var writes via the Netlify MCP tool silently no-op.** Calling
   `manage-env-vars` with `envVarIsSecret: true` returns `"Environment
   variable upserted"` while persisting *nothing*. Non-secret writes work fine.
   Set secrets through the **Netlify web UI** instead, then verify with
   `getAllEnvVars`.

3. **Direct deploys from a Claude Code sandbox do not work.** `api.netlify.com`
   is blocked by the session's network egress policy (403 on CONNECT), so the
   Netlify CLI and `@netlify/mcp` deploy path both fail. Deploy by **merging to
   `main`** and letting the git integration build. Note the failure mode is
   confusing: a failed CLI deploy can coincide with an unrelated
   git-triggered deploy and look like it succeeded — always confirm via
   `commit_ref` on the deploy record.

4. **The GitHub PAT must not be scoped "Public Repositories".** That
   fine-grained option grants *read-only* access to *public* repos only, and
   it fails in two silent ways at once: private repos simply never appear in
   sync (no error — they're absent from the API response), and Send to Claude
   cannot write. Required: **Repository access = All repositories** (or an
   explicit selection including the private ones), plus **Contents: Read and
   write** and **Metadata: Read-only**.

   Diagnostic that settles it in seconds: open `/api/repos` on the live site
   and look at the `private` field. If every row is `"private": false`, the
   token cannot see private repos — no amount of reasoning about sync logic
   will change that.

5. **The sandbox cannot reach `trackerator.netlify.app` either.** Claude cannot
   self-verify the live site; end-to-end confirmation requires Matt to check.
   Verify what you can server-side (deploy state, `commit_ref`, function list,
   migrations) and be explicit about what remains unverified.

   **Ask for real data early rather than reasoning from inference.** Debugging
   a live-site symptom by theorizing from the sandbox has already produced two
   confidently-wrong diagnoses in this project's history: an `api.github.com`
   403 that turned out to be the *sandbox's own egress proxy* rather than
   GitHub rejecting the token, and deploys attributed to CLI commands that had
   actually failed (the real deploys came from git merges landing at a similar
   moment). Asking Matt to paste `/api/repos` takes ten seconds and ends the
   guessing. Prefer it over another round of hypotheses.

### Environment variables

| Variable | Where | Notes |
|---|---|---|
| `GITHUB_TOKEN` | Netlify env vars (secret) | **All repositories** access (not "Public Repositories" — that hides private repos *and* blocks writes), Contents **read and write**, Metadata read |
| `GITHUB_AFFILIATION` | Netlify env vars | `owner` (default) or `all` to include collaborator/org repos |

Locally, both come from `.env` (gitignored) and `netlify dev` loads them.

### Access

The live site requires **Netlify team SSO login** (`requiresSSOTeamLogin`).
This matters: the app holds a GitHub token with repo **write** access, so the
site must never be left publicly reachable. Note the setting reported scope
`"all"` — it may apply team-wide rather than to this site alone.

## Local development

```bash
npm install
cp .env.example .env   # set GITHUB_TOKEN
netlify link           # one-time, links to the trackerator site
netlify dev            # runs functions + frontend, provisions a branch DB
```

## Workflow conventions

- Development branch: `claude/personal-repo-tracker-z8zxi3`.
- **Matt has asked for changes to be merged automatically as we go** — validate,
  push, open a PR, and squash-merge without pausing for approval on each one.
- Validate before pushing. There is no CI on this repo, so a bad merge deploys
  straight to production. At minimum run a typecheck over `lib/**/*.ts` and
  `netlify/functions/**/*.mts` (`@types/node` is needed; install it
  `--no-save` for the check).

### Known annoyance: stale branch ref

Squash-merging rewrites the SHA, leaving the remote branch ref behind and
making the stop hook report phantom "unpushed commits" — even though the local
branch and `main` are byte-identical. Confirm with:

```bash
git diff --name-only origin/claude/personal-repo-tracker-z8zxi3 origin/main   # empty = identical
```

Permanent fix is enabling **Settings → General → "Automatically delete head
branches"** on the repo. Until then it needs a force-push back into line after
each merge, which requires Matt's explicit OK (the permission classifier gates
force-pushes).

## Current state

Working and deployed: sync, manual fields with autosave, Send to Claude, the
retro control-panel theme, Postgres persistence, SSO gating.

## Open items

- **Rotate the GitHub PAT.** It was briefly stored as a Netlify variable *name*
  (names are not masked the way secret values are), and tokens were pasted in
  chat. Replace it, update the Netlify variable, then redeploy for it to bind.
- **Send to Claude:** the token now has Contents write (it was previously
  scoped read-only public, so this path could never have worked). Still worth
  exercising once in production to confirm.
- Enable auto-delete of head branches (see above).

## Next up: UI work

The next phase is making the dashboard **more useful**, not just better
looking. The theme is settled; the substance is not. Known weak points worth
considering:

- **Staleness is invisible.** Cards sort by last commit, but a repo untouched
  for 8 months looks much like one touched last week. Surfacing neglect is
  arguably the core value of the whole tool.
- **No overview.** There is no at-a-glance sense of the portfolio — counts by
  status, what is active, what is drifting.
- **`open_issues_count` conflates issues and PRs** (a GitHub API quirk).
  Splitting them costs extra API calls per repo.
- **Filtering is thin** — a single status dropdown, no sort control, no search.
- **Cards are uniformly tall** regardless of content, so a dense portfolio
  scrolls a lot; empty note fields take the same space as filled ones.

Ask Matt what he actually wants before building — these are observations, not
an agreed roadmap.
