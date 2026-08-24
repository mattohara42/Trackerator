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
- **Storage:** a local SQLite file at `data/trackerator.db` (gitignored).
  Nothing leaves your machine except the GitHub API calls made during sync.

By default sync pulls only repos you own (`GITHUB_AFFILIATION=owner` in
`.env`); set it to `all` to also include repos you collaborate on or belong
to via an org.
