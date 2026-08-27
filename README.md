# Trackerator

A dashboard for keeping track of what's happening across my GitHub repos.

Half of it fills itself in. Trackerator pulls each repo's latest commit, CI
status, open issues and stars from the GitHub API. The other half I write
myself: what state a project is in, what I'm aiming at, what to do next.
Syncing never touches those notes.

It's built for one person glancing at it, not for general use.

Live at [trackerator.netlify.app](https://trackerator.netlify.app), behind a
Netlify team login.

## Running it locally

```bash
npm install
cp .env.example .env    # add a GitHub token
netlify link            # once, to connect this directory to the site
netlify dev
```

`netlify dev` serves the frontend and the functions together and provisions a
branch database on the fly, so there's no local Postgres to set up.

## Deploying

Merging to `main` deploys. The site is git-linked, and any new migrations in
`netlify/database/migrations/` run as part of the build.

## What it tracks

Pulled from GitHub on every sync: the last commit and how long ago it landed,
combined CI status, open issues and PRs, stars, whether the repo is private,
and whether GitHub has it archived.

Written by hand and left alone by sync: a status (active, paused, idea, done,
archived), a progress note, goals, and next steps. These save as you type.

## Send to Claude

Every card has a note box. Whatever you write there gets committed into that
repo's own `CLAUDE.md`, under a "Notes from Trackerator" heading. The next
Claude Code session that opens the repo picks it up without being told.

This is a durable instruction rather than a conversation. If you want to talk
something through, open Claude directly. The point here is that a thought you
have while looking at the dashboard survives until you next sit down with that
project.

## The token

Sync and Send to Claude share one `GITHUB_TOKEN`, stored as a Netlify
environment variable. It needs:

- Repository access: all repositories, or a selection that includes your
  private ones
- Contents: read and write
- Metadata: read

Anything narrower fails quietly. A token scoped to public repositories will
sync your public repos and silently leave out the private ones, and Send to
Claude won't be able to write at all.

`GITHUB_AFFILIATION` sets the scope: `owner` for repos you own, `all` to
include ones you collaborate on.

## Access

The live site requires a Netlify team login. That matters more than it might
look: **the app has no authentication of its own**, so that login is the entire
access control model, and the token behind it can write to your repositories.
An instance left publicly reachable lets anyone read your private repos and
commit to them. `SECURITY.md` has the details and the per-host caveats.

## Layout

```
public/                        frontend: one page, vanilla JS, no build step
netlify/functions/             the API
  repos.mts                    GET    /api/repos
  sync.mts                     POST   /api/sync
  repo-update.mts              PATCH  /api/repos/:id
  send-to-claude.mts           POST   /api/repos/:id/send-to-claude
lib/                           GitHub and database code shared by the functions
netlify/database/migrations/   SQL, applied on deploy
```

Each function declares its own route in an exported `config.path`, so there
are no redirect rules to keep in sync.

## Working on it

Merging to `main` goes straight to production, so check your work first:

```bash
npm run check     # typecheck + tests
```

CI runs the same on every push and pull request. Tests are `node --test` over
`test/*.test.ts` — no build step and no test framework, since Node strips the
types itself.

`CLAUDE.md` has the architecture notes and the operational traps worth knowing
about. `HANDOFF.md` covers where things stand and what to pick up next.

## Security

`SECURITY.md` covers how to report an issue and how to deploy an instance
without handing your repositories to the internet.
`docs/PUBLIC_RELEASE_REVIEW.md` is a full review of this codebase, kept public
on purpose: it lists what is fixed, what is still open, and what would have to
change for anyone other than its operator to use it.

## Licence

MIT — see `LICENSE`.
