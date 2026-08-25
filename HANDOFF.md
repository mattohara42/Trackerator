# Handoff

Where Trackerator stands and what to pick up next. Written for whoever opens
this repo cold, including me in three weeks.

## Right now

Everything works and is deployed. Sync pulls all repos including private ones,
notes save as you type, GitHub-archived repos hide behind a toggle, and the
site sits behind a Netlify team login. Eleven repos sync in a little over half
a second.

## What to do next

The dashboard shows status but doesn't help you act on it. Every repo
currently reads `active` with all four note fields empty, which means the
manual side of the tool, the part that justifies it existing, is going unused.

The clearest gap is staleness. `bigmachines` was last pushed in 2014 and
`WordsPerMinute` yesterday, and on screen they look nearly the same. Noticing
which projects have drifted is most of the value here, and right now you have
to read timestamps to find out.

Agreed direction: smarter status surfacing rather than more fields to fill in.

Other things worth doing, roughly in order:

- No portfolio view. There's no sense of the whole set: how many are active,
  what's moving, what's stalled.
- `open_issues_count` lumps issues and PRs together. That's a GitHub API
  quirk; separating them costs an extra call per repo.
- Filtering is a single status dropdown. No sort, no search.
- Cards are all the same height whether the notes are full or empty, so a
  dozen repos scroll further than they need to.
- Two unrelated things are both called "archived": GitHub's flag and the
  manual status option. Worth collapsing.

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

## Still untested

Send to Claude has never completed successfully in production. The token
couldn't write until recently, so its first real run is still ahead. Worth
doing early, since it's the feature the whole idea rests on.
