# Handoff

Where Trackerator stands and what to pick up next. Written for whoever opens
this repo cold, including me in three weeks.

## Branch audit — this repo is clean (2026-08-31)

A cross-repo audit of unmerged branches ran across all twelve repos on
2026-08-31. **Trackerator needs nothing.** The only branch besides `main` is
`claude/personal-repo-tracker-z8zxi3`, the designated dev branch — fully
contained in `main`, deliberately kept, not deleted.

It is exactly the "stale branch ref" annoyance `CLAUDE.md` already documents:
squash-merging rewrites the SHA, so the remote ref lingers and git reports
phantom unpushed commits even when the trees are identical. Confirm with:

```bash
git diff --name-only origin/claude/personal-repo-tracker-z8zxi3 origin/main   # empty = identical
```

The permanent fix is still open and now applies across every repo, not just
this one: enable **Settings → General → "Automatically delete head branches"**.
The audit found ~57 stale refs across the other repos, nearly all of them
created by exactly this mechanism.

## Right now

Everything works and is deployed. Sync pulls all repos including private ones,
notes save as you type, GitHub-archived repos hide behind a toggle, and the
site sits behind a Netlify team login. Eleven repos sync in a little over half
a second.

## What's just landed

**Completeness scoring and compact cards.** Each repo is scored against eight
setup checks — description, README, licence, topics, a published release, a CI
workflow, a test suite, and a homepage link — shown as a meter and `n/8`. Most
of that comes from one recursive git-tree call per repo, so the sync cost is
about two extra requests each rather than one per check.

Cards now open in sections (`<details>` for Setup, Notes, Send to Claude)
instead of showing everything at once. A collapsed card is roughly a third the
height of the old one, so a dozen repos fit on a screen. What stays visible is
what you'd scan for: name, category, staleness, the meter, and any attention
flag.

Categories come from **GitHub topics**, not a field in here. Tag a repo
`audio`, `game` or `productivity` on GitHub and the badge appears after the
next sync. That keeps the classification on the repo itself.

**Staleness surfacing**, from the round before. Each repo now gets a tier
computed from its last commit — fresh (≤14d), cooling (≤60d), stale (≤365d),
dormant — shown as a label on the card and a colour down its left edge.

The useful part is the flag built on top. A repo whose status says `active`
but which hasn't been touched in over 60 days gets called out directly:
"marked active, untouched for 95 days". That disagreement between what you
said and what the commits show is the thing worth acting on. Repos you've
marked paused or idea stay quiet however old they get, because being cold is
the expected state there.

The default sort puts flagged repos first, then longest-neglected. There's a
tally strip across the top with counts per tier.

## What to do next

Every repo read `active` with all four note fields empty, so the manual half of
the tool was going unused. The first response was to make status cheap rather
than to prompt harder for it: it's now five chips on the card face instead of a
dropdown inside a collapsed section. Worth watching whether that alone gets the
statuses honest before touching the note fields at all.

`NEXT UP` is the same idea applied to the most valuable empty field. Rather than
ask what the next step is, the card shows the repo's open issues and flags any
PR left hanging — the answer usually already exists on GitHub.

Nothing is tagged with a category topic yet, so those badges will stay blank
until repos get topics on GitHub. Same for the homepage field — setting it on
each repo is what lights up the "Live link" check and the Live site link.

Roughly in order:

- No search, and filtering is still one status dropdown. No filter by category
  or by completeness either, now that both exist.
- Two unrelated things are both called "archived": GitHub's flag and the
  manual status option. Worth collapsing.
- The 60-day attention threshold is a guess. It may want to vary by status, or
  be adjustable.
- The eight completeness checks are weighted equally, which is probably wrong.
  A missing README matters more than a missing release for most of these.
- Last security review, last code review and Netlify publish state were all
  discussed and deliberately deferred. The first two have no GitHub API behind
  them and need a convention we'd have to invent; the third needs a second
  credential.

## Before you trust anything

The sandbox Claude runs in cannot reach `trackerator.netlify.app` or
`api.netlify.com`, so nothing about the live site can be verified from inside
a session. Deploy state, commit refs, function lists and migrations are all
checkable through the Netlify MCP tools. Everything else needs a person to
look.

When the data seems wrong, open `/api/repos` on the live site before forming a
theory. It dumps the database as JSON and settles most questions in one look.
Several rounds of debugging went into hypotheses that this would have ended
immediately.

## Things that will bite

Full detail is in `CLAUDE.md`. The short version:

Environment variables bind when a deploy is built, not when a request arrives.
Setting one on a running deploy does nothing until the next build.

Secret environment writes through the Netlify MCP tool report success and save
nothing. Use the web UI, then confirm with `getAllEnvVars`.

A token scoped to "public repositories" fails two ways at once: private repos
disappear from sync with no error, and Send to Claude can't write.

## Checking a change

No CI, and `main` deploys straight to production.

```bash
npm run typecheck
```

For frontend work, serve `public/` against a stub API and drive it with
Playwright. The archived toggle and the sync error handling were both checked
that way, including a simulated 504 to confirm failures surface instead of
disappearing.

> **Stale as of 2026-08-27 — deploy previews are OFF.** The paragraph below
> describes the old behaviour and is kept only so nobody re-derives it from an
> old PR. Netlify credits ran out: no preview is built for a PR, and merging to
> `main` no longer publishes. See `CLAUDE.md` → "Workflow conventions". Verify
> locally instead, and treat "it works on `main`" as untested in production
> until a deploy actually happens.

Opening a PR gets you more than that, though. Netlify builds a preview for
every one at `deploy-preview-<number>--trackerator.netlify.app` and the bot
comments the link when it's ready. Previews run the real functions against a
branch database, so anything visual is worth a look there before merging.
Stub data only proves the logic; the preview shows what it actually looks
like with your repos in it.

## Proven working

Send to Claude has now run successfully in production against one of Matt's
repos, writing into its `CLAUDE.md`. That was the last unproven path, and it
could never have worked before the token gained Contents write access.

Sync, notes, staleness flags, completeness scoring and the compact cards are
all confirmed working against real data.
