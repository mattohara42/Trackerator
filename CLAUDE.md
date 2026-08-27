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
  `pushed_at`, `last_commit_*`, `open_issues_count`, `ci_status`, `synced_at`,
  `homepage`, `topics`, `license_name`, `has_readme`, `has_ci`, `has_tests`,
  `latest_release_*`, `open_issues`, `open_prs`, `oldest_pr_at`, `top_issues`
- **User-owned** (never touched by sync): `status`, `progress_note`, `goals`,
  `next_steps`, `manual_updated_at`, `last_note_sent_at`

`upsertRepo` deliberately lists only sync-owned columns in its
`ON CONFLICT DO UPDATE` clause. **Preserve that split** — clobbering someone's
notes on a routine sync would be the worst bug this app could have.

## Features

- **Activity sync** — last commit (message + relative time), combined CI status
  (falls back from legacy commit status to GitHub Actions check-runs), open
  issues/PRs count, stars, public/private, archived flag.
- **Completeness score** — eight setup checks per repo (description, README,
  licence, topics, published release, CI workflow, test suite, homepage link),
  shown as a segment meter plus `n/8`. Most are derived from a single
  recursive git-tree call per repo rather than one call per check. The score is
  computed **in the frontend** from stored facts, so the checks can be
  reweighted without a re-sync or a migration.
- **Categories from GitHub topics** — a repo topic of `audio`, `game` or
  `productivity` becomes a card badge. Deliberately not a Trackerator field:
  the classification lives on the repo where any tool can read it, and Matt
  sets it once in GitHub.
- **Staleness surfacing** — each repo gets a tier from its last commit (fresh
  ≤14d, cooling ≤60d, stale ≤365d, dormant), plus an attention flag when a
  repo marked `active` has gone untouched for 60+ days. Sort defaults to
  flagged-first. Repos marked paused/idea are exempt; being cold is expected.
- **Open work** — issues and PRs counted separately, plus the titles of the
  three most recently updated issues, in a `NEXT UP` card section. GitHub's
  `open_issues_count` is the two added together, which can't distinguish three
  things to decide from three things half-finished; one extra call per repo to
  `/issues` (where a PR is an issue carrying a `pull_request` key) separates
  them and yields the titles. Answers "what would I pick up here" without
  anyone typing into a field.
- **The pick** — one repo named at the top of the page with a one-line reason,
  answering "I have an afternoon, where should it go" rather than "what is the
  state of everything". Reasons are ranked: failing CI, then a PR left open
  30+ days, then the marked-active-but-cold contradiction, then waiting
  issues; ties go to whichever has been left alone longest. Only `active`
  repos are candidates, on the same reasoning the attention flag uses. Purely
  derived from data already on the card — no new fields, no new sync cost.
- **Manual tracking** — status (`active`/`paused`/`idea`/`done`/`archived`),
  progress note, goals, next steps. Status is five chips on the card face —
  one click, no expanding — since burying it in a collapsed dropdown was why
  every repo sat at the `active` default. Notes autosave inline (600ms
  debounce).
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

6. **An expired SSO session looks like an application bug.** When the Netlify
   team login lapses, the edge answers `/api/*` with **HTTP 401 and an HTML
   login-redirect page** (`<title>Login Redirect</title>`, pointing at
   `app.netlify.com/edge-access`) without the request ever reaching the
   function. So a 401 whose body is HTML is never the GitHub token, the
   database or the sync logic — it is the session, and the fix is to reload
   and sign in again. Every fetch path in `app.js` checks `isAuthFailure`
   first for this reason; before that, a lapsed session dumped raw redirect
   markup into an `alert()` on sync, rendered a blank dashboard on load, and
   dropped note saves silently.

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
  straight to production. Run `npm run typecheck` (covers `lib/**/*.ts` and
  `netlify/functions/**/*.mts` via the checked-in `tsconfig.json`). For
  frontend changes, serve `public/` against a stub API and drive it with
  Playwright — that is how the archived toggle and the sync error handling
  were verified.
- **Netlify builds a deploy preview for every PR**, at
  `deploy-preview-<number>--trackerator.netlify.app`, and the bot posts the
  link as a PR comment once it's ready. Previews run the real functions
  against a branch database, so a UI change can be checked on a live URL
  before it reaches production. Claude still can't open it (see gotcha 5), but
  it is the right thing to point Matt at for anything visual — better evidence
  than a headless screenshot against stub data. Worth waiting for the bot's
  "ready" comment before merging a risky frontend change.

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

Working and deployed, all confirmed against real data: sync, manual fields
with autosave, Send to Claude (verified writing to `squelch`), staleness
flags, completeness scoring, compact collapsible cards, Postgres persistence,
SSO gating.

## Open items

- **Rotate the GitHub PAT.** It was briefly stored as a Netlify variable *name*
  (names are not masked the way secret values are), and tokens were pasted in
  chat. Replace it, update the Netlify variable, then redeploy for it to bind.
- Enable auto-delete of head branches (see above).

## Next up: UI work

See `HANDOFF.md` for the current state of play. The agreed direction is
**smarter status surfacing** — helping Matt act on what he's looking at —
rather than adding more fields to fill in. The theme is settled; the substance
is not.

The live data makes the problem concrete: all repos read `active` with every
note field empty, so the manual half of the tool is going unused. Staleness is
the sharpest gap — `bigmachines` (last pushed 2014) and `WordsPerMinute` (last
pushed yesterday) render nearly identically.

Remaining observations, not an agreed roadmap, are listed in `HANDOFF.md`
under "What to do next". Confirm with Matt before building beyond staleness.
