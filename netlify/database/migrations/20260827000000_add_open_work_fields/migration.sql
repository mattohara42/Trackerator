-- Open work per repo: what you'd actually pick up next.
--
-- GitHub's `open_issues_count` is issues + pull requests added together, which
-- makes it useless for deciding anything. These columns hold the two counts
-- separately, plus the titles of the liveliest issues so the card can show
-- what the work actually is rather than how much of it there is.
--
-- All sync-owned: overwritten on every sync, never hand-edited.
ALTER TABLE repos ADD COLUMN IF NOT EXISTS open_issues INTEGER NOT NULL DEFAULT 0;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS open_prs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS oldest_pr_at TIMESTAMPTZ;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS top_issues TEXT NOT NULL DEFAULT '[]';
