# CLAUDE.md

Project context for Claude Code sessions working on Trackerator.

## What this is

A personal dashboard for tracking status across Matt's GitHub repos. It pairs
**auto-synced activity** (pulled from the GitHub API) with **hand-written
notes** (progress, goals, next steps) that a sync never overwrites.

It is deliberately single-user and personal — not a product. Design decisions
should favor "useful to one person glancing at it" over generality.

**The app has no authentication of its own** — every `/api/*` route is
unauthenticated and the login in front of it is the entire access control
model. `docs/PUBLIC_RELEASE_REVIEW.md` is the full security review and the plan
for opening it up; `SECURITY.md` is the short version for anyone deploying an
instance. Read the review before adding a route or widening what one returns.

Live at **https://trackerator.netlify.app** (gated behind Netlify team SSO
login — see Access below).

## Architecture

```
public/                     static frontend (vanilla HTML/CSS/JS, no framework)
  index.html                  shell + topbar + empty state
  app.js                      card rendering, autosave, sync, send-to-claude
  safe.js                     escapeHtml / safeUrl, imported by app.js
  style.css                   retro control-panel theme
  logo.webp                   the wordmark, in the topbar
  backdrop.webp               the neon grid horizon, fixed behind everything
scripts/build-art.py        regenerates both assets from the source artwork
lib/handlers/*.ts           the API, as plain Request -> Response functions
  repos.ts                    GET    /api/repos
  sync.ts                     POST   /api/sync
  repo-update.ts              PATCH  /api/repos/:id
  send-to-claude.ts           POST   /api/repos/:id/send-to-claude
netlify/functions/*.mts     Netlify adapter: re-exports a handler + config.path
lib/                        shared logic
  db.ts                       repo queries + cross-driver row normalising
  db/sql.ts                   THE DATABASE SEAM — picks a driver, see below
  env.ts                      env(name), replacing the Netlify.env global
  migrate.ts                  portable migration runner
  github.ts                   GitHub REST calls
  notes.ts                    note sanitising + CLAUDE.md content building
  status.ts                   the canonical status vocabulary + validator
  http.ts                     json/error responses, repo-id parsing
  headers.ts                  reads the security headers back out of netlify.toml
scripts/migrate.ts          CLI: apply migrations to DATABASE_URL
test/                       node:test suites (`npm test`), no build step
  e2e.test.ts                 real handlers against real Postgres (needs DATABASE_URL)
netlify/database/migrations/  SQL migrations; Netlify applies them on deploy,
                              `npm run migrate` applies them anywhere else
```

Routes are declared **in-code** via each function's exported `config.path`, so
the frontend calls clean `/api/*` paths with no redirect rules in
`netlify.toml`. That file does carry the **security headers**, including a CSP
strict enough to have no `'unsafe-inline'` — so **no inline `<script>`, no
`style="..."` attribute, no `onclick=`, and no remote asset** may be added to
the frontend without also widening the policy. `test/headers.test.ts` fails if
the policy is weakened, and fails the other way too if `index.html` gains an
origin the policy doesn't allow.

### Portability (Stage 2)

The app is no longer Netlify-shaped. Handlers are plain
`(Request) => Promise<Response>` in `lib/handlers/`; `netlify/functions/*.mts`
are adapters that add nothing but `config.path`. A second host needs its own
adapter directory and no changes to anything else.

**`lib/db/sql.ts` is the seam, and the branch order is deliberate:**

| Condition | Driver |
|---|---|
| `DATABASE_URL` (or `NETLIFY_DATABASE_URL`) set | `postgres.js` against that URL |
| nothing set | `@netlify/database`, exactly as before |

On Netlify today no `DATABASE_URL` is set, so the second branch runs and the
deployed behaviour is unchanged. **That is the point** — the Netlify path
cannot currently be tested from here (no credits, no deploy, no reachable API),
so it was left on the driver that is known to work rather than moved onto one
that merely ought to. `getConnectionString()` from `@netlify/database` is the
escape hatch for collapsing the two once a real deploy confirms postgres.js
works there.

**Drivers disagree about types, and the seam is where that gets fixed.**
`repos.id` is a BIGINT: postgres.js returns int8 as a *string* (to avoid losing
precision past 2^53), the Neon driver returns a number. `public/app.js`
compares ids with `===`, so an un-normalised id breaks the dashboard on one
host and not the other. `normalise()` in `lib/db.ts` coerces it. Any new
BIGINT or NUMERIC column needs the same treatment — this is the trap to watch
when adding one.

**Imports inside `lib/` carry explicit `.ts` extensions.** That is the only
specifier Node's type stripping resolves, and it is what lets `test/e2e.test.ts`
import the real handlers and run them. esbuild (which bundles the Netlify
functions) resolves the literal path, so both paths work from the same source.

**Import `@netlify/database` statically, and never lazily.** It was briefly
reached through `createRequire(...)` so a non-Netlify host would not need the
package — and it took production down: esbuild does not trace `createRequire`,
so the module was left out of the deployed bundle and every endpoint returned
`Cannot find module '@netlify/database'`. `test/bundling.test.ts` guards it.

The deeper lesson is about the check, not the code. The bundling check that was
supposed to prove the functions build ran with
`--external:@netlify/database` — excluding from the test the exact module whose
inclusion was in doubt, so it passed while the real build was broken. **When
verifying that something bundles, bundle it without externals**, and confirm
the dependency is actually in the output (`grep` the bundle, or check its size:
74KB without the driver, 608KB with it).

### The artwork

Two assets, doing two different jobs, both derived from one source image by
`scripts/build-art.py` — run that rather than hand-editing them.

- **`logo.webp`** is the wordmark, cropped tight and luminance-keyed to
  transparency so it sits on the topbar panel instead of on a black rectangle.
- **`backdrop.webp`** is only the *lower band* of the art — grid, horizon,
  mountains — fixed to the bottom of the viewport. The wordmark is cropped out
  rather than blurred away: blurred, it still read as a bright smear behind the
  cards, a ghost of the logo already in the topbar. The scene is the
  background, the type is the logo, each doing one job.

Legibility is what this trades against, so it is handled in two places. The
body scrim fades *downwards* — heaviest at the top where cards are densest,
lightest at the bottom where the grid is meant to show — and `.card` /
`.topbar` use `--panel-a` / `--panel-raised-a` (translucent twins of the panel
colours) plus `backdrop-filter`, which frosts whatever is behind them. **Tune
the scrim alphas in `body`, not the asset**; the asset is only lightly
darkened on purpose, because darkening in both places is what made the
backdrop invisible on the first attempt.

Both are same-origin, so `img-src 'self'` covers them and the CSP needed no
change. A *remote* image would need a policy widening and would fail
`test/headers.test.ts` — see the CSP note above.

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

7. **The sandbox proxy passes `curl` but resets Chromium.** Outbound HTTPS goes
   through an egress proxy that `curl` uses via the CA bundle, so a `curl` to
   `fonts.googleapis.com` returns 200. The same URL from headless Chromium —
   even launched with `--proxy-server` pointed at `$HTTPS_PROXY` — dies with
   `net::ERR_CONNECTION_RESET`, because the browser does not trust the proxy's
   MITM certificate. So **a remote asset failing in a headless browser here is
   not evidence about the asset, the CSP, or the site.**

   The way to tell them apart, which is exact: CSP is evaluated *before* the
   network. A request the policy blocks never leaves the browser and fires a
   `securitypolicyviolation` event. A request the policy allows is *sent* and
   then dies at the proxy. So listen for `page.on("request")` and
   `securitypolicyviolation` together — a sent request with no violation proves
   the CSP allows it, whatever happens to it afterwards. That is how both
   Google Fonts hops (`style-src` → googleapis, `font-src` → gstatic) were
   verified with no working egress and no deploy.

8. **Sync failing with GitHub `401 "Bad credentials"` means the token is dead.**
   The body is GitHub's own JSON, which separates it from gotcha 6 (an HTML
   401 from the SSO edge). If no deploy has happened since it last worked,
   the code and the bound env var are unchanged, so the token itself has
   expired or been revoked. First seen 2026-10-27: the token was set
   2026-08-25 and stopped working about 60 days later, which matches
   GitHub's 60-day expiry option. Its replacement (set 2026-10-27) has **no
   expiry**, so a 401 from now on means revoked, not expired.

   Fixing it needs a **deploy**, because of gotcha 1. A new value in the
   Netlify UI does nothing until a build picks it up. Set the variable
   first, then deploy. If builds are off for lack of credits, the rotation
   waits on them like any code change.

   **The `dev` context value of a secret is returned in plaintext by the
   Netlify env API** (`manage-env-vars` with `getAllEnvVars`), while the
   other contexts come back masked. Anything with Netlify API access can
   read it, this session included. Leave `dev` empty for `GITHUB_TOKEN`, or
   give it a separate low-privilege token, so the write-capable one is never
   readable that way.

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
This matters more than for most sites: the app has no authentication of its
own, so that gate is the whole access control model, and the token behind it
can write to your repositories.

**The gate has a scope, and it was set wrong (found and fixed 2026-08-27.)**
Netlify's `update-visitor-access-controls` takes an `appliesTo` of either
`all-projects` or `non-production-projects`. This site was on
**`non-production-projects`**, which gates deploy previews and branch deploys
and leaves the **production URL open to the internet** — with an unauthenticated
`POST /api/repos/:id/send-to-claude` behind it. It now reads `all`.

Two things follow. **Check the scope, not just the boolean**:
`requiresSSOTeamLogin: true` on its own tells you nothing about production —
read `whichProjectsRequireSSOTeamLogin` alongside it, via the Netlify project
reader or the UI. And this is the assumption `docs/PUBLIC_RELEASE_REVIEW.md`
was written on top of, so S1 was a live exposure for as long as that setting
stood, not the theoretical one the review described.

## Local development

```bash
npm install
cp .env.example .env   # set GITHUB_TOKEN
netlify link           # one-time, links to the trackerator site
netlify dev            # runs functions + frontend, provisions a branch DB
```

**Without Netlify** (which is the situation while credits are out) the app runs
against any Postgres:

```bash
docker run -d --name tpg -e POSTGRES_PASSWORD=x -p 5432:5432 postgres:16
export DATABASE_URL=postgres://postgres:x@127.0.0.1:5432/postgres
npm run migrate        # applies netlify/database/migrations/ anywhere
npm run test:e2e       # real handlers, real Postgres, real HTTP
```

`npm run test:e2e` is the closest thing to proof the API works. `npm test`
skips it with a visible `# SKIP DATABASE_URL not set` when there is no
database, so the default suite stays green without one.

## Workflow conventions

- Development branch: `claude/personal-repo-tracker-z8zxi3`.
- **Matt has asked for changes to be merged automatically as we go** — validate,
  push, open a PR, and squash-merge without pausing for approval on each one.
- Validate before pushing with **`npm run check`** (typecheck + tests). CI runs
  the same thing on every push and PR (`.github/workflows/ci.yml`). Merging to
  `main` publishes to production, so these checks are the gate before it does.
  - `npm test` is `node --test` over `test/*.test.ts`. Node 22.18+ strips
    types natively, so there is still **no build step and no test framework**.
  - Tests import `.ts` files *with the extension* (`../lib/notes.ts`) because
    that is the only specifier Node's type stripping resolves. `lib/` and
    `netlify/functions/` keep their extensionless imports, which is why the
    pure logic lives in modules with no relative imports of their own.
  - `npm run test:e2e` runs the real handlers against a real Postgres (needs
    `DATABASE_URL`). It is the only test that exercises the API rather than the
    pure logic behind it, and it exists because the handlers stopped being
    Netlify-shaped — it imports nothing from `netlify/`.
  - For frontend changes, serve `public/` against a stub API and drive it with
    Playwright — that is how the archived toggle, the sync error handling, and
    the S3/S4 XSS fixes were verified. **Check the harness fails against the
    pre-fix code**; a security test that passes either way proves nothing.
- **Deploy previews and auto-deploy are back ON (2026-10-27).** They were off
  from 2026-08-27 because the Netlify credits ran out, and came back with the
  credits: PR #29 got a preview, and its merge published to production
  (`commit_ref` 6e23894, not a manual deploy). If previews stop again, suspect
  billing before the integration. While they are off, a merge does not reach
  production and `main` drifts ahead of the live site.

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

- Enable auto-delete of head branches (see above).

## Next up: UI work

See `HANDOFF.md` for the current state of play. The agreed direction is
**smarter status surfacing** — helping Matt act on what he's looking at —
rather than adding more fields to fill in. The theme is settled; the substance
is not.

The live data makes the problem concrete: all repos read `active` with every
note field empty, so the manual half of the tool is going unused. Staleness is
the sharpest gap — `bigmachines` (last pushed 2014) and
`hook-line-and-sentence` (last pushed yesterday) render nearly identically.

Remaining observations, not an agreed roadmap, are listed in `HANDOFF.md`
under "What to do next". Confirm with Matt before building beyond staleness.

## Notes from Trackerator

- 2026-08-27: /repo-metadata
