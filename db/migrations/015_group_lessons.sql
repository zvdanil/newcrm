-- Migration 015: Group Lessons
-- Adds settings to activities for group lessons and a table to log group lesson occurrences.

ALTER TABLE activities ADD COLUMN has_group_classes BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE activities ADD COLUMN auto_group_classes BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE group_lesson_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id   UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('conducted', 'cancelled')),
  created_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (activity_id, date)
);

CREATE INDEX ON group_lesson_logs (activity_id, date);

CREATE TRIGGER update_group_lesson_logs_updated_at
  BEFORE UPDATE ON group_lesson_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
