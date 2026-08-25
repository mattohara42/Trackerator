# Handoff

Where Trackerator stands and what to pick up next. Written for whoever opens
this repo cold, including me in three weeks.

## Right now

Everything works and is deployed. Sync pulls all repos including private ones,
notes save as you type, GitHub-archived repos hide behind a toggle, and the
site sits behind a Netlify team login. Eleven repos sync in a little over half
a second.

## What's just landed

Staleness surfacing, which was the top item here. Each repo now gets a tier
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

Every repo still reads `active` with all four note fields empty, so the manual
half of the tool is going unused. Worth watching whether the attention flag
changes that — if it just produces a wall of red, the fix is probably making
status quicker to set rather than adding more prompting.

Roughly in order:

- `open_issues_count` lumps issues and PRs together. That's a GitHub API
  quirk; separating them costs an extra call per repo.
- No search, and filtering is still one status dropdown.
- Cards are all the same height whether the notes are full or empty, so a
  dozen repos scroll further than they need to.
- Two unrelated things are both called "archived": GitHub's flag and the
  manual status option. Worth collapsing.
- The 60-day attention threshold is a guess. It may want to vary by status, or
  be adjustable.

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

Opening a PR gets you more than that, though. Netlify builds a preview for
every one at `deploy-preview-<number>--trackerator.netlify.app` and the bot
comments the link when it's ready. Previews run the real functions against a
branch database, so anything visual is worth a look there before merging.
Stub data only proves the logic; the preview shows what it actually looks
like with your repos in it.

## Still untested

Send to Claude has never completed successfully in production. The token
couldn't write until recently, so its first real run is still ahead. Worth
doing early, since it's the feature the whole idea rests on.
