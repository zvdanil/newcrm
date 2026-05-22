-- Migration 032: Allow linking activity_schedules to merged journals
-- activity_id becomes nullable; merged_journal_id is an alternative link target

ALTER TABLE activity_schedules
  ALTER COLUMN activity_id DROP NOT NULL,
  ADD COLUMN merged_journal_id UUID REFERENCES merged_journals(id) ON DELETE SET NULL;

CREATE INDEX ON activity_schedules(merged_journal_id);
