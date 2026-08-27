# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/mattohara42/Trackerator/security/advisories/new)
rather than opening a public issue.

This is a personal project maintained in spare time, so there is no response
time commitment. Expect a reply when it gets read.

## Deploying an instance safely — read this first

**Trackerator has no authentication of its own.** Every `/api/*` endpoint is
unauthenticated, and access control is expected to come from whatever sits in
front of it. That is a deliberate design for a single-user tool behind a login,
and it means an exposed instance is not a hardening problem but a total
compromise of every repository the configured token can reach.

Specifically, an instance reachable without a login lets anyone:

- read every tracked repository, **including private ones** — names,
  descriptions and commit messages — along with all of your notes;
- spend your GitHub API quota by triggering syncs;
- **commit to any repository the token can write to**, via
  `POST /api/repos/:id/send-to-claude`.

That last one deserves emphasis. The file it writes is `CLAUDE.md`, which is
read as *instructions* by an AI agent that later runs against that repository
with write access. Someone who can write it is not defacing a markdown file.

So, whatever you deploy to:

- **Put the instance behind authentication.** On Netlify, team SSO on the site.
  On Vercel, note that Deployment Protection covers the production domain only
  on Pro — the Hobby plan leaves it publicly reachable. Self-hosting, use
  whatever your reverse proxy offers.
- **Never expose an instance publicly**, even briefly, even "just to test".
- **Scope the token as narrowly as you can live with.** `Contents: write` is
  needed only for Send to Claude; without that feature, read-only scopes are
  enough.
- **Rotate the token** if an instance was ever reachable, or if the token was
  pasted anywhere it might be logged.

## Known gaps

`docs/PUBLIC_RELEASE_REVIEW.md` is a full security review of this codebase and
is deliberately public. Findings still open are listed there with severities;
S1, S2, S5, S6, S7 and S10 are the ones that would have to close before an
instance could reasonably be offered to people other than its operator.
