-- Migration 029: Direct child-parent links
-- Замінює зв'язок через сім'ї на прямий зв'язок дитина → батьки/опікуни.

CREATE TABLE IF NOT EXISTS child_parents (
  child_id   UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  parent_id  UUID NOT NULL REFERENCES parents(id)  ON DELETE CASCADE,
  role       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (child_id, parent_id)
);

CREATE INDEX IF NOT EXISTS child_parents_child_idx  ON child_parents (child_id);
CREATE INDEX IF NOT EXISTS child_parents_parent_idx ON child_parents (parent_id);
