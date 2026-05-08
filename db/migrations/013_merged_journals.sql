-- 013: merged journals — virtual aggregated journal view
-- Allows combining multiple activity journals into one unified attendance view.

CREATE TABLE merged_journals (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(200) NOT NULL,
  note       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID        REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE merged_journal_activities (
  merged_journal_id UUID    NOT NULL REFERENCES merged_journals(id) ON DELETE CASCADE,
  activity_id       UUID    NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (merged_journal_id, activity_id)
);
