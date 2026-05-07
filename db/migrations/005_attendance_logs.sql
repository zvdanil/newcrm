-- Migration 005: attendance_logs
-- Журнал посещаемости. Одна запись = одна отметка ребёнка на одно занятие.
-- UNIQUE (enrollment_id, date) — нельзя поставить две отметки за один день.
-- Статус 'special' — нестандартный тариф (хранится в custom_amount).
-- Каскад для связанных активностей реализован на уровне бэкенда.

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE attendance_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id UUID NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  child_id      UUID NOT NULL REFERENCES children(id),
  activity_id   UUID NOT NULL REFERENCES activities(id),
  date          DATE NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('present', 'absent_excused', 'absent_unexcused', 'special')),
  custom_amount NUMERIC(15,2) CHECK (custom_amount IS NULL OR custom_amount > 0),
  note          TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (enrollment_id, date)
);

CREATE INDEX ON attendance_logs (child_id, date);
CREATE INDEX ON attendance_logs (activity_id, date);
CREATE INDEX ON attendance_logs (enrollment_id);

CREATE TRIGGER update_attendance_logs_updated_at
  BEFORE UPDATE ON attendance_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
