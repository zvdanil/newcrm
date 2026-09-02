-- Migration 056: child_group_history (SCD Type 2 for child group assignments)
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS child_group_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id    UUID        NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  group_id    UUID        NOT NULL REFERENCES groups(id),
  start_date  DATE        NOT NULL,
  end_date    DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT prevent_child_group_overlap EXCLUDE USING gist (
    child_id WITH =,
    daterange(start_date, COALESCE(end_date, '5000-01-01'::date), '[]') WITH &&
  )
);

CREATE INDEX IF NOT EXISTS idx_cgh_child_id ON child_group_history(child_id);
CREATE INDEX IF NOT EXISTS idx_cgh_group_id ON child_group_history(group_id);

-- Migrate existing children.group_id into child_group_history
INSERT INTO child_group_history (child_id, group_id, start_date, end_date)
SELECT id, group_id, '2025-01-01'::date, NULL
FROM children
WHERE group_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM child_group_history h WHERE h.child_id = children.id
  );
