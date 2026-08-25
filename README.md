# Trackerator

A mini dashboard for tracking status, activity, goals, and next steps across
your own GitHub repos.

It syncs activity automatically from GitHub (last commit, CI status, open
issues/PRs) and lets you keep hand-written notes — status, progress, goals,
next steps — per repo, right alongside that activity. It's deployed on
Netlify (serverless functions + Netlify DB/Postgres) and sits behind a
password gate, since it holds a GitHub token with write access.

## Local development

```bash
npm install
cp .env.example .env   # set GITHUB_TOKEN
netlify link           # one-time, links this directory to the trackerator site
netlify dev
```

`netlify dev` runs the functions and static frontend together and
auto-provisions a local/branch Postgres database via Netlify DB — no manual
DB setup needed.

## Deploying

```bash
netlify deploy --prod
```

There's no GitHub-linked continuous deployment configured — deploys are
triggered manually (or by Claude, on request) after a change is merged.

## Access

The live site is password-protected (Site settings > Sharing > Visitor
access in the Netlify dashboard) since the GitHub token it holds can write
to your repos. Don't share the URL or password.

## How it works

- **Auto-synced per repo:** last commit (message + relative time), combined
  CI status, open issues/PRs count, stars, public/private, GitHub-archived
  flag.
- **Manual per repo:** a status (`active` / `paused` / `idea` / `done` /
  `archived`), a progress note, goals, and next steps — editable inline,
  autosaved as you type.
- **Send to Claude:** each card has a note box. Click **Send to Claude** and
  the note is committed straight into that repo's `CLAUDE.md` under a
  "Notes from Trackerator" section. Any Claude Code session — this one, the
  CLI, or web — reads `CLAUDE.md` automatically the next time it works in
  that repo, so the note is there without you having to repeat it. This is
  deliberately async (it's a durable instruction, not a live chat) — for
  real-time back-and-forth, just talk to Claude directly.
- **Storage:** Netlify DB (managed Postgres). `GITHUB_TOKEN` is set as a
  Netlify environment variable, never committed.

By default sync pulls only repos you own (`GITHUB_AFFILIATION=owner`); set
it to `all` to also include repos you collaborate on or belong to via an
org.

## Architecture

- `public/` — static frontend (unchanged by the Netlify migration; still
  talks to `/api/*`).
- `netlify/functions/` — serverless functions serving `/api/repos`,
  `/api/sync`, `/api/repos/:id` (PATCH), and `/api/repos/:id/send-to-claude`.
- `lib/` — shared GitHub API and database logic used by the functions.
- `netlify/database/migrations/` — SQL migrations, applied automatically by
  Netlify on deploy.
