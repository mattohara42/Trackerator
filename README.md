# Trackerator

A mini dashboard for tracking status, activity, goals, and next steps across
your own GitHub repos.

It syncs activity automatically from GitHub (last commit, CI status, open
issues/PRs) and lets you keep hand-written notes — status, progress, goals,
next steps — per repo, right alongside that activity.

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and set `GITHUB_TOKEN` to a personal access token (classic
`repo` scope, or fine-grained with `Contents: read` + `Metadata: read` on the
repos you want tracked).

## Run

```bash
npm start
```

Open http://localhost:3000, then click **Sync from GitHub** to pull in your
repos. Re-sync any time to refresh activity — your notes are never
overwritten by a sync.

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
- **Storage:** a local SQLite file at `data/trackerator.db` (gitignored).
  Nothing leaves your machine except the GitHub API calls made during sync
  and when sending a note.

By default sync pulls only repos you own (`GITHUB_AFFILIATION=owner` in
`.env`); set it to `all` to also include repos you collaborate on or belong
to via an org.
