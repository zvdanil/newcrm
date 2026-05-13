-- Migration 018: Calendar Module
-- Adds activity schedule templates with RRule recurrence, exceptions, and substitutions

-- Шаблоны расписаний занятий
CREATE TABLE activity_schedules (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id   UUID         NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  staff_id      UUID         REFERENCES staff(id) ON DELETE SET NULL,
  room          VARCHAR(100),
  start_time    TIME         NOT NULL,
  duration_min  INT          NOT NULL DEFAULT 60,
  rrule         TEXT         NOT NULL,  -- iCal RRULE e.g. "FREQ=WEEKLY;BYDAY=MO,WE"
  dtstart       DATE         NOT NULL,
  dtend         DATE,                   -- NULL = open-ended
  color         VARCHAR(20),            -- hex color override
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  note          TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Исключения: отмена или перенос отдельного вхождения серии
CREATE TABLE schedule_exceptions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id    UUID        NOT NULL REFERENCES activity_schedules(id) ON DELETE CASCADE,
  original_date  DATE        NOT NULL,
  exception_type TEXT        NOT NULL CHECK (exception_type IN ('cancelled', 'moved')),
  new_date       DATE,                  -- только для 'moved'
  new_start_time TIME,
  note           TEXT,
  created_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (schedule_id, original_date)
);

-- Замены педагогов на конкретное занятие
CREATE TABLE substitutions (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id         UUID          NOT NULL REFERENCES activity_schedules(id) ON DELETE CASCADE,
  occurrence_date     DATE          NOT NULL,
  original_staff_id   UUID          REFERENCES staff(id) ON DELETE SET NULL,
  substitute_staff_id UUID          NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  rate_override       NUMERIC(15,2) NOT NULL,
  salary_tx_id        UUID,         -- ссылка на созданный salary_transactions.id
  note                TEXT,
  created_by          UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (schedule_id, occurrence_date)
);

CREATE INDEX ON activity_schedules(activity_id);
CREATE INDEX ON activity_schedules(staff_id);
CREATE INDEX ON activity_schedules(is_active);
CREATE INDEX ON schedule_exceptions(schedule_id, original_date);
CREATE INDEX ON substitutions(schedule_id, occurrence_date);
CREATE INDEX ON substitutions(substitute_staff_id);
CREATE INDEX ON substitutions(original_staff_id);

CREATE TRIGGER update_activity_schedules_updated_at
  BEFORE UPDATE ON activity_schedules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
