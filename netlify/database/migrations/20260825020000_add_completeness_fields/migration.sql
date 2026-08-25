-- Repo setup signals, used to score how completely a project is set up.
-- All sync-owned: overwritten on every sync, never hand-edited.
ALTER TABLE repos ADD COLUMN IF NOT EXISTS homepage TEXT;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS topics TEXT NOT NULL DEFAULT '[]';
ALTER TABLE repos ADD COLUMN IF NOT EXISTS license_name TEXT;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS has_readme BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS has_ci BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS has_tests BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS latest_release_tag TEXT;
ALTER TABLE repos ADD COLUMN IF NOT EXISTS latest_release_at TIMESTAMPTZ;
