# Public release review

A security and code review of Trackerator as it stands, and what would have to
change for it to be usable by anyone with a GitHub account rather than by one
person behind a team login.

Reviewed at `aaebdd8`. Every finding below cites the line it is about; nothing
here is inferred from the live site, which a session can't reach.

## The verdict in one paragraph

The code is small, readable and does the hard parts correctly — SQL is
parameterised throughout, the sync/manual column split is genuinely protected,
concurrency is bounded, and the error paths that were fixed earlier stay fixed.
What it has no notion of at all is **a user**. There is no authentication, no
authorization and no tenancy anywhere in the application; the only thing
standing between the internet and a GitHub token with write access to every one
of Matt's repositories is a Netlify team-SSO setting made in a web console. That
is a perfectly sound design for a single-user tool and a catastrophic one the
moment the site is public. Everything else in this document is small by
comparison.

---

## Part 1 — Security findings

Ordered by what they'd cost if the site were made public tomorrow.

> **Stage 1 landed 2026-08-27** (#21), **S8 followed**. Fixed: S3, S4, S8, S9,
> S11, S13, with tests; S14 is partly done (LICENSE, SECURITY.md, CI,
> `strict`). Their sections are kept rather than deleted, because the reasoning
> is what stops each one being reintroduced. Everything else below is still
> open.

### S1 · Critical · There is no authentication in the application

`netlify/functions/*.mts` — all four handlers

> **Update, 2026-08-27.** This finding was worse than written. Netlify's SSO
> gate on this site was scoped to `non-production-projects`, so it covered
> deploy previews and left the **production URL open** — everything below was
> reachable from the internet, not merely from behind a login. The scope is now
> `all`. Two lessons: the boolean `requiresSSOTeamLogin: true` says nothing on
> its own, and depending on a host's gate means depending on a setting nothing
> in this repository can see or test.

Not one handler checks who is calling. `repos.mts:9` lists the database,
`sync.mts:11` spends the owner's GitHub token, `repo-update.mts:19` writes
notes, and `send-to-claude.mts:38` **commits a file to a GitHub repository**.
All four are reachable by anyone who can resolve the hostname. Access control
lives entirely in Netlify's edge SSO — infrastructure configuration, not code —
and `CLAUDE.md` already records that the setting reported team-wide scope rather
than site scope, so it is not even certain what it protects.

The most valuable of the four is `send-to-claude`. It is an arbitrary-commit
primitive: pick any repo id in the database, POST a note, and a commit lands on
that repo's default branch. Worse, the file it writes is `CLAUDE.md` — a file
whose entire purpose is to instruct an AI agent that will later run against that
repository with write access. An attacker who can write it doesn't get a defaced
markdown file, they get a foothold in every future agent session on that repo.

**Fix:** real authentication before any public exposure. See Part 3.

### S2 · Critical · One shared server-side token, and a single-tenant schema

`lib/github.ts:206`, `netlify/database/migrations/.../migration.sql`

Both GitHub-touching functions read one process-wide `GITHUB_TOKEN`. The `repos`
table has no owner column, and `listRepos()` (`lib/db.ts:80`) is an unscoped
`SELECT *`. There is no seam anywhere to hang a second user on: two users would
share one token, one row set and one dashboard.

`README.md:57` also asks that token to carry **Contents: read and write across
all repositories**, which is close to the broadest credential GitHub issues. It
is a reasonable ask of yourself and an unreasonable one of a stranger.

**Fix:** per-account identity and least-privilege credentials — a GitHub App, so
the stored artefact is an installation id rather than a long-lived token. Part 3.

### S3 · ~~High~~ FIXED · Stored XSS through the unvalidated `status` field

`netlify/functions/repo-update.mts:20` → `lib/db.ts:148` → `public/app.js:268,358`

`repo-update.mts` forwards `body.status` to the database with no validation, and
`updateManualFields` writes whatever it is given. The frontend then does:

```js
const noteSummary = `${repo.status.toUpperCase()}${…}`;      // app.js:268
…
<span class="summary-hint notes-hint">${noteSummary}</span>  // app.js:358, into innerHTML
```

`noteSummary` is the one interpolation in `renderCard` that is neither escaped
nor drawn from a constant. `PATCH /api/repos/<id>` with
`{"status": "<img src=x onerror=…>"}` stores a payload that executes for anyone
who opens the card afterwards.

Today this is only self-inflicted (single user, one trusted writer), which is why
it hasn't bitten. In a multi-user build the same field becomes a stored payload
that runs in another account's session, and the constraint that keeps it honest
— "the frontend only ever sends one of five values" — is exactly the constraint
an attacker ignores.

**Fix:** validate against `STATUSES` server-side and reject anything else with a
400; escape `noteSummary` at the sink as well. Two changes, both one-liners, and
the field is genuinely fixed rather than fixed at one end.

### S4 · ~~High~~ FIXED · `href` values are escaped but never scheme-checked

`public/app.js:276, 314, 389, 390`

`escapeHtml` (`app.js:254`) escapes characters. It does not validate URLs, so it
cannot stop `javascript:alert(1)` reaching an `href`. Three sinks matter:

- `repo.homepage` (`:390`) is free text a repository owner controls. Under
  `GITHUB_AFFILIATION=all`, or in any multi-user build, that owner is not you.
- `i.url` (`:314`) comes from stored issue JSON, one DB write away from anything.
- `repo.html_url` (`:276` and `:389`) is **interpolated raw**, the only
  unescaped interpolation left in the file. GitHub happens to produce safe values
  today, so nothing is exploitable through it right now — but it is the one place
  where a change in the API's shape, or a tampered row, lands directly in markup.

**Fix:** a `safeUrl()` that allows `http:` and `https:` only and returns `""`
otherwise; route all four through it, and escape `html_url` while you are there.

### S5 · High · No CSRF protection on the state-changing endpoints

`repo-update.mts`, `send-to-claude.mts`, `sync.mts`

None of the three checks an origin, a `Content-Type`, or a token. Right now the
edge session is the only gate. As soon as authentication becomes a cookie — which
is what it becomes, in every design in Part 3 — any page the user visits can fire
`POST /api/repos/<id>/send-to-claude` with their credentials attached and commit
to their repositories.

**Fix:** `SameSite=Lax` (or `Strict`) session cookies, plus an `Origin` check on
every non-GET handler. Both are cheap and belong in the same change as auth.

### S6 · Medium · Sync is an unauthenticated, uncapped, expensive operation

`sync.mts:11`, `lib/github.ts:230`

Each sync makes roughly `4N + N/100` GitHub calls against one token with a
5,000/hour ceiling, and writes `N` rows. Nothing rate-limits it, nothing debounces
it and nothing requires a caller to be logged in (S1). A loop over `POST /api/sync`
exhausts the GitHub quota for everyone the token serves, and the failure is
opaque: every subsequent sync fails at the API with a 403 that surfaces as a
generic 502.

**Fix:** a per-account cooldown, and move sync off the request path (S12).

### S7 · Medium · `GET /api/repos` returns the whole table

`lib/db.ts:80`, `repos.mts:9`

`SELECT *` sends every column to the browser: private repository names and
descriptions, commit messages from private work, and all four hand-written note
fields. `HANDOFF.md` recommends opening `/api/repos` to debug — which is good
advice precisely because it is a full database dump.

**Fix:** project the columns the UI actually uses, and scope by account. The
principle matters more than the bytes: the day a bug exposes this endpoint, what
leaks should be as small as possible.

### S8 · ~~Medium~~ FIXED · No security headers

`netlify.toml` — three lines, no `[[headers]]` block

There is no CSP, no `X-Frame-Options`/`frame-ancestors`, no
`Referrer-Policy`, no `X-Content-Type-Options`. The page renders third-party
content through `innerHTML` in a dozen places and carries buttons that commit to
GitHub — the two things a CSP and a frame-ancestors rule are respectively for.
Clickjacking a page with a "SEND TO CLAUDE" button is not a theoretical concern.

**Fix:** a headers block in `netlify.toml`. The one wrinkle is that `index.html`
pulls fonts from Google, so `style-src`/`font-src` need those origins — or
self-host the two fonts and keep the policy tight.

**What landed.** A `[[headers]]` block with CSP, `X-Frame-Options`,
`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` and HSTS. The
CSP came out stricter than expected because the frontend turned out to have no
inline script, no inline style attribute, no event-handler attribute and no
image anywhere — so it needs **neither `'unsafe-inline'` nor `'unsafe-eval'`**,
which is the difference between a policy that stops an injected script and one
that only looks like it does. Google Fonts is the single external dependency and
gets exactly two origins, in exactly two directives.

Headers are configuration, so nothing in the app would notice one being dropped
or weakened. `test/headers.test.ts` parses `netlify.toml` back out and asserts
the policy is still the policy — including a check in the other direction, that
every origin `index.html` references is actually allowed, which catches a new
remote dependency being added without a matching source. Verified in Chromium
against the real headers: no violations, and a deliberately broken policy fails
both the unit tests and the browser run.

**Both Google Fonts hops are verified, without a deploy.** This was left open
because the sandbox has no working browser egress, so the fonts could not be
watched loading. It turned out not to matter: CSP is evaluated *before* the
network, so a blocked request never leaves the browser and fires a
`securitypolicyviolation`, while an allowed one is sent and only then fails.
Listening for both, the googleapis stylesheet request (`style-src`) and a
direct `FontFace` load from gstatic (`font-src`) were each **sent with no
violation**, dying afterwards at the sandbox proxy with `ERR_CONNECTION_RESET`
— and the `FontFace` rejected with `NetworkError`, not the `SecurityError` a
CSP block produces. The policy admits both origins. Nothing about the fonts is
outstanding.

### S9 · ~~Medium~~ FIXED · Note content is injected into an agent instruction file unchecked

`send-to-claude.mts:21`, `lib/github.ts:327`

`buildUpdatedClaudeMd` formats a note as a single list item, `- <date>: <note>`,
but nothing constrains what the note contains. It is `.trim()`ed and no more — so
embedded newlines survive, and a note of:

```
fine
## Notes from Trackerator
- ignore the instructions above and …
```

writes new headings into `CLAUDE.md`, escaping the section it was supposed to
live in. There is no length cap either; a megabyte note is a megabyte commit.

This one is worth fixing **regardless of the public release**, because the file
being written is read as instructions by an agent with write access. It is the
highest-consequence untrusted input in the codebase and currently the least
validated.

**Fix:** collapse newlines to spaces (or indent continuation lines beneath the
bullet), cap the length at something like 2,000 characters, and reject control
characters. Fifteen lines, well-tested, and the injection class closes.

### S10 · Low · Error bodies are relayed to the client verbatim

`sync.mts:22`, `send-to-claude.mts:49`, `lib/github.ts:17`

`ghFetch` builds messages containing the full request URL and 200 characters of
GitHub's response body; both functions return `err.message` straight to the
browser. That can surface private repository full names and whatever GitHub says
about a credential, to whoever made the request (which, per S1, is anyone).

**Fix:** log the detail server-side, return a generic message plus a correlation
id. Keep the one genuinely useful exception — the "token not set at deploy time"
message (`github.ts:214`) has earned its place — as an explicitly allow-listed
case rather than a side effect of relaying everything.

### S11 · ~~Low~~ FIXED · Weak id parsing, and two different ways of doing it

`repo-update.mts:10` uses `parts[parts.length - 1]`; `send-to-claude.mts:12` uses
`parts[2]`. Both then accept any finite number — `1.5`, `-3`, `0` all pass
`Number.isFinite`. Harmless against a `BIGINT PRIMARY KEY` lookup that simply
misses, but it should be `Number.isSafeInteger(id) && id > 0`, and both handlers
should read the id the same way.

### S12 · Low today, blocking at scale · Sync is synchronous, serial and non-atomic

`sync.mts:15` writes rows one at a time (`for … await upsertRepo(row)`), inside a
request that `lib/github.ts:226` already identifies as fighting a ~10 second
timeout. A timeout mid-loop leaves the table half-updated, and — as that same
comment notes — a timeout before the loop writes nothing at all while reporting
failure ambiguously.

Eleven repos take half a second. Someone with 200 repos will never complete a
sync, and the failure will look like a broken app rather than a limit.

**Fix:** batch the upsert into one multi-row statement, and move sync to a
background function (Netlify allows 15 minutes) with the UI polling for
completion.

### S13 · ~~Low~~ FIXED · A repository rename can wedge sync permanently

`migration.sql` declares `full_name TEXT NOT NULL UNIQUE`, but `upsertRepo`
(`lib/db.ts:110`) only handles `ON CONFLICT (id)`. Delete `me/thing` and create a
new repository with the same name: the new one has a new numeric id, so the
INSERT doesn't conflict on `id` — it conflicts on `full_name`, raises a unique
violation, and takes the whole sync down with a 502 that cannot be cleared from
the UI. The database has to be edited by hand.

**Fix:** the constraint should be `UNIQUE (account_id, full_name)` in the
multi-tenant schema anyway; either way the upsert needs to handle it, and sync
should reconcile deletions rather than only ever adding.

### S14 · ~~Housekeeping~~ PARTLY FIXED · Housekeeping for a public repository

No `LICENSE` (the completeness meter would score its own repository 7/8), no
`SECURITY.md` and so no disclosure route, no `CONTRIBUTING.md`, no CI, and
`npm install` rather than `npm ci` in the documented setup. `tsconfig.json:8`
sets `"strict": false`, which for code handling a write-scoped credential is
leaving a free class of bug on the table.

There are no tests at all. That is defensible for a personal tool and not
defensible for a project inviting contributions — it is the single biggest
contributor-facing gap, ahead of anything architectural.

### What's already right

Worth recording so nobody "fixes" it later. Every query goes through
`db.sql` tagged templates, so there is no SQL injection anywhere and no string
concatenation to regress. `mapWithConcurrency` (`github.ts:257`) is correct and
bounded. `escapeHtml` is applied at nearly every sink and the two-argument
`isNotesHeading` fix (`github.ts:320`) shows the heading-matching bug was
understood properly rather than patched. The sync-owned/user-owned column split
does what `CLAUDE.md` promises. The dependency surface is one runtime package.

---

## Part 2 — What is Matt-shaped rather than general

Separate from security: the places where the tool encodes one person's setup.
None of these are bugs. All of them are reasons a stranger's dashboard would look
wrong on first run.

| Hardcoded | Where | Why it doesn't generalise |
|---|---|---|
| Categories `audio`/`game`/`productivity` | `app.js:131` | Three topics from one person's projects. Everyone else gets blank badges. |
| Eight completeness checks, equal weight | `app.js:103` | `HANDOFF.md` already flags the weighting as wrong. "Release" is meaningless for a private scratch repo, and someone tracking libraries may want a changelog check instead. |
| Statuses `active/paused/idea/done/archived` | `app.js:57` | A personal vocabulary. Also collides with GitHub's own "archived" — noted in `HANDOFF.md` as worth collapsing. |
| Staleness at 14/60/365 days | `app.js:62` | A weekend-project cadence. A repo touched quarterly by design isn't "stale". |
| The 60-day attention threshold | `app.js:93` | `HANDOFF.md`: "a guess". |
| Pick reasons and weights | `app.js:187` | One person's priorities, in code, in a `const`. |
| Send-to-Claude writes `CLAUDE.md`, on the default branch, as a direct commit | `github.ts:379` | Assumes Claude Code, assumes that filename, and **assumes the default branch accepts direct pushes**. Anyone with branch protection gets a 403 with no explanation. |
| `GITHUB_AFFILIATION` is one global env var | `sync.mts:13` | Not a user preference, and there is no way to exclude forks — someone with 150 forks gets 150 useless cards. |
| `api.github.com` | `github.ts:3` | No GitHub Enterprise support. |
| Everything renders at once | `app.js:569` | No pagination, no search, one status filter. Fine at eleven repos. |
| `new Date().toISOString().slice(0,10)` | `github.ts:328` | UTC dates in a note stamped for a local reader. |

The pattern underneath: **every fact the tool knows is a column, and every rule
about those facts is a `const` in `app.js`.** That is why adding an integration
means a migration plus a frontend edit, and why none of the thresholds can be
changed without a deploy. Part 3 is mostly about ending that.

---

## Part 3 — Getting to a public release

### 3a. Pick the distribution model first, because it decides everything else

This is the fork in the road, and it is worth being deliberate about it.

**Option A — self-hosted.** Ship Trackerator as something someone deploys
themselves: `git clone`, add their own token, deploy to Netlify/Vercel/a
container. The app stays single-tenant. Nobody's credential ever leaves their own
infrastructure, so S1 and S2 stop being release blockers and become "document
that this must not be exposed publicly". Cost: the bug fixes in Part 1, plus the
vendor-portability work in 3c.

**Option B — hosted service.** Trackerator runs at one URL and anyone signs in.
This requires all of Option A *plus* identity, sessions, tenancy, a GitHub App,
per-account rate limiting, background sync, and — because you would be holding
credentials that can write to other people's repositories — a genuine security
posture: disclosure policy, key rotation, an incident plan.

**The recommendation is A first.** Not as a lesser version of B, but because it
is the honest shape for this tool. Trackerator's most distinctive feature commits
to your repositories; asking strangers to trust a hobby-scale service with that
is a hard sell, while asking them to run it themselves is an easy one. Option A
is perhaps a fifth of the work, ships far sooner, and every piece of it is a
prerequisite for B anyway. If real demand for a hosted version appears, nothing
in A has to be undone.

The rest of this section is written so that the shared parts come first.

### 3b. If you do go multi-tenant, use a GitHub App

The instinct is OAuth with the `repo` scope. Don't: `repo` is all-or-nothing and
always includes write, so every user hands over full write access to every
repository they can see, and you store that token indefinitely.

A **GitHub App** is materially better on all three counts:

- The user chooses *which repositories* to install it on, in GitHub's own UI.
- Permissions are granular — `Metadata: read`, `Contents: read`, `Issues: read`,
  `Checks: read` covers the entire dashboard. Only Send-to-Claude needs
  `Contents: write`.
- Installation tokens expire after an hour. **You store an installation id, not a
  credential.** That single property removes most of what makes holding other
  people's GitHub access frightening, and it is why this is worth the extra day
  of setup over OAuth.

Sign-in for identity is a separate, tiny OAuth flow (`read:user`) producing a
session cookie — `HttpOnly`, `Secure`, `SameSite=Lax`, which is also the answer
to S5.

Schema, minimally: an `accounts` table (github user id, login, installation id),
a `sessions` table, and `account_id` on `repos` with the primary key becoming
`(account_id, github_repo_id)` and `full_name` unique *per account* — which
retires S13 as a side effect. Every query in `lib/db.ts` takes an `accountId`.

### 3c. Break the Netlify coupling — four seams, and one is already done

Trackerator is Netlify-shaped in four places, and they are not equally hard.

**1. The handlers are already portable.** They are plain
`(req: Request) => Response` functions. That is the Web-standard shape Vercel,
Cloudflare, Deno and Bun all accept. The only non-standard thing in them is
`Netlify.env.get()` (`sync.mts:12`, `send-to-claude.mts:39`) — replace with an
`env(name)` helper reading `process.env` and the handler bodies are
vendor-neutral today. This is the cheapest win in the whole document.

**2. The database.** `lib/db.ts:3` calls `getDatabase()` from
`@netlify/database`. Since that provisions ordinary Postgres and exposes a
connection string, switching to `postgres.js` against `DATABASE_URL` keeps the
same tagged-template API — meaning **the query bodies don't change**, only the
import. It also makes local development possible without `netlify dev`.

**3. Migrations.** `netlify/database/migrations/` auto-applying on deploy is
Netlify behaviour, not Postgres behaviour. A ~40-line runner that applies
numbered SQL files against a `schema_migrations` table restores that everywhere,
and can keep the existing files as-is.

**4. Routing.** `export const config = { path: … }` is Netlify's. Keep it as the
Netlify adapter, and let other platforms map their own conventions onto the same
handler functions — the handlers being untouched is the whole point.

Structure that falls out:

```
lib/
  handlers/          the four handlers, plain Request → Response
  db/                interface + postgres implementation
  env.ts
adapters/
  netlify/           thin re-exports adding `config.path`
  vercel/ node/      the same handlers, other conventions
```

#### 3c.1 Can Vercel host Trackerator? Yes — with one significant catch

Checked against Vercel's current documentation rather than from memory, because
the plan tiers are what decide the answer.

**What ports cleanly:**

| Piece | On Vercel |
|---|---|
| Static frontend | `public/` as the output directory. Nothing to change. |
| The four handlers | Vercel's Node.js runtime supports **standard Web `Request`/`Response`**, so the handler bodies port essentially untouched — the same property that makes seam 1 above cheap. |
| Routing | File-system based: `api/repos.ts`, `api/repos/[id].ts`, `api/repos/[id]/send-to-claude.ts`. Replaces the `config.path` exports; a mechanical move, not a rewrite. |
| Postgres | **Netlify DB is Neon underneath.** You can *claim* the anonymous Neon database into a free Neon account, at which point the same database serves Vercel over `DATABASE_URL`. **No data migration, and no second database.** |
| Deploy previews | Both have them, per-PR. Vercel's preview protection is free on Hobby. |
| Function duration | Hobby now allows up to **60s** (raised from 10s), Pro up to 5 minutes. That is *better* than Netlify's 10s synchronous ceiling — S12's sync timeout is less pressing on Vercel. |

**The catch, and it is a real one:** on Vercel's **Hobby** plan, Vercel
Authentication protects preview deployments and deployment URLs, but **the
production domain stays publicly accessible**. Gating a production domain
requires **Pro**. (Password Protection is Enterprise, or a $150/month Pro
add-on; Trusted IPs are Enterprise only.)

That matters more for Trackerator than it would for almost any other app,
because — per S1 — **the host's gate is the entire security model**. Deploying
today's code to Vercel Hobby would put an unauthenticated
`POST /api/repos/:id/send-to-claude` on the public internet, which is precisely
the arbitrary-commit primitive S1 describes. So:

- **Vercel Pro ($20/mo):** a genuine like-for-like swap for the current setup.
- **Vercel Hobby:** only safe *after* Stage 1 and app-level authentication
  exist. Not before.

**The wider point this exposes.** Depending on a host's SSO for access control
is itself the portability blocker. Every target has to reimplement that gate,
and they don't all offer it free — Vercel doesn't. Give Trackerator its own
authentication and it becomes deployable anywhere, a $5 VPS included, with no
plan tier deciding whether it is safe. **"Make it portable" and "give it auth"
turn out to be the same project**, which is another reason to sequence Stage 1
first.

**Two smaller differences:**

- **Migrations.** Vercel has no equivalent of Netlify's auto-applying
  `netlify/database/migrations/`; you would run them from the build command.
  Seam 3's portable runner covers this — and it is the seam that stops being
  optional the moment a second target exists.
- **Local dev.** `netlify dev` provisions a branch database on the fly.
  `vercel dev` does not; you would point at a Neon branch yourself. Slightly
  more setup, but it also removes the dependency on one vendor's CLI for
  local work.

**Recommendation:** support both, and treat neither as the default. Once seams
1–4 are done, "which host" is a directory of adapters and a README section
rather than a fork in the codebase — and *that* is the deliverable, more than
Vercel specifically. Being able to add a third target cheaply is what proves
the decoupling actually worked.

### 3d. The extensibility question: signals, not columns

"Track more than just Netlify" — confirmed to mean deployment status specifically
— is the same problem as "fits other people's setups", and it has one root
cause. Every fact the app knows is a **column** —
`has_ci`, `latest_release_tag`, `open_prs`, `ci_status`. Adding a Netlify deploy
status means a migration, a new field on two interfaces, a fetch in `syncRepos`,
and hand-written markup in `renderCard`. Adding Vercel means doing all of it
again. That is the ceiling, and no amount of tidying inside the current shape
raises it.

The fix is to stop modelling facts as columns and start modelling them as
**signals**:

```ts
interface Signal {
  key:    string;                              // "deploy.state"
  label:  string;                              // "Last deploy"
  value:  string | number | null;
  state:  "ok" | "warn" | "bad" | "unknown";   // drives the LED, generically
  url?:   string;
  at?:    string;
}

interface SignalProvider {
  id: string;                                  // "netlify"
  label: string;                               // "Netlify"
  configSchema: FieldSpec[];                   // what credentials/settings it needs
  fetchSignals(repo: TrackedRepo, config: unknown): Promise<Signal[]>;
}
```

Store them in one `JSONB` column (or a `repo_signals` table keyed by provider),
and register providers in a map. Then:

- Adding Vercel, Fly, Render, Sentry, npm download counts, or Netlify deploy
  state is **one file and zero migrations**.
- The card renders signals generically — a provider supplies `label` and `state`,
  the existing badge-and-LED markup draws it. **No frontend change per provider.**
- GitHub itself becomes the first provider rather than a special case, which is
  what proves the interface is honest.

**What the deploy provider actually looks like.** Since this is the confirmed
primary ask, it's worth being concrete about the part that is easy to hand-wave.
Both hosts expose the same shape of fact, which is exactly why it generalises:

```ts
// providers/netlify.ts — and vercel.ts is the same file with a different fetch
export const netlify: SignalProvider = {
  id: "netlify",
  label: "Netlify",
  configSchema: [
    { key: "token",   type: "secret", label: "Personal access token" },
    { key: "siteId",  type: "string", label: "Site ID", perRepo: true },
  ],
  async fetchSignals(repo, cfg) {
    const d = await latestDeploy(cfg);           // one API call
    return [{
      key:   "deploy.state",
      label: "Last deploy",
      value: d.state,                            // "ready" | "building" | "error"
      state: d.state === "ready"  ? "ok"
           : d.state === "error"  ? "bad"
           : d.state === "building" ? "warn" : "unknown",
      url:   d.adminUrl,
      at:    d.publishedAt,
    }];
  },
};
```

Three things to settle when this gets built, none of them blocking:

1. **Linking a repo to a site.** Neither host keys deploys by GitHub repo id, so
   something has to hold the mapping. Both APIs expose the connected repository
   on the site/project record, so the provider can **offer a match and let the
   user confirm** rather than asking anyone to paste site ids by hand.
2. **Credentials are per-provider, not global.** `configSchema` exists so each
   provider declares what it needs and the app stores it the same way for all of
   them — which is also the seam where per-provider secrets get encrypted once,
   rather than per integration.
3. **A missing provider is not an error.** Most repos aren't deployed anywhere.
   Absent signals should render as nothing at all, not as a failed check — the
   completeness meter's existing behaviour is the wrong model here.

Two more registries follow the same shape and pick up most of Part 2:

**Rules over signals.** Completeness checks, staleness tiers, the attention
threshold and the pick reasons all become data — a rule referencing a signal key,
a comparison and a weight, stored per account and editable in a settings panel
instead of edited in `app.js` and deployed. That is what turns "the 60-day
threshold is a guess" from a code change into a slider.

**Actions.** Send-to-Claude is currently one hardcoded behaviour. As an
`ActionProvider` it becomes one of several — commit to a file (path and heading
configurable, not always `CLAUDE.md`), **open a pull request** instead of
committing directly (which is what makes it work at all against a protected
branch, and is the more defensible default for other people's repositories), open
an issue, or post elsewhere. Whatever a stranger's workflow is, they configure it
rather than adopting yours.

### 3e. Suggested order

Each stage is independently shippable, and the first two are worth doing whether
or not anything is ever released publicly.

**Stage 1 — fix what's broken.** S3 (validate `status` both ends), S4
(`safeUrl`), S9 (note sanitising — the most valuable single fix here), S11, S13.
Add tests as you go, since there are none and these are exactly the pure
functions that are easy to test. Add `LICENSE`, `SECURITY.md`, a CI workflow
running typecheck and tests, and turn on `strict`.

**Stage 2 — decouple.** The `env()` helper, the database interface, the portable
migration runner, handlers moved out of `netlify/`. No behaviour change; the app
becomes deployable somewhere other than Netlify. **Vercel is the target that
proves it** (§3c.1) — a second adapter is the only real test that the seams are
real. Ship self-hosting: a README covering Netlify, Vercel and a container, with
an explicit warning never to expose an instance publicly without auth, and the
Vercel-Hobby caveat called out by name.

**Stage 3 — make it configurable.** The signals model and the rules registry.
Settings move out of `const`s and into per-account configuration. Cards render
generically. This is where it stops being Matt's dashboard.

**Stage 4 — providers.** GitHub becomes the first `SignalProvider`. **Deploy
status is the confirmed primary ask**, so it is next: Netlify and Vercel built
together rather than Netlify first, because two implementations at once is what
stops the interface quietly ossifying around whichever one was written first.
After that each new integration — Fly, Render, Cloudflare, Sentry — is a file and
a pull request, which is what makes the project worth contributing to.

**Stage 5 — hosted, only if wanted.** GitHub App, sessions, tenancy, background
sync, rate limiting, security headers, S1/S2/S5/S6/S7/S10 closed out properly.
Don't start this until something in stages 1–4 has attracted actual users.

---

## Scope decision (2026-08-27)

The ambiguity this document was originally hedging on is settled. Matt: *"I
meant making deployment status not be netlify-specific, but I do like the idea
of the app itself not being tied to just netlify."*

So both readings are in scope, with a priority between them:

- **Primary — §3d.** Deployment status becomes a signal from a provider, so
  Netlify is one integration among several rather than a special case.
- **Also wanted — §3c.** Trackerator itself becomes deployable somewhere other
  than Netlify, with **Vercel as the first alternative target** (§3c.1).

They remain the same architectural move from two directions: put an interface
between the core and the vendor. Nothing in the staged plan changes; §3d moves
ahead of §3c in priority within Stage 3/4.
