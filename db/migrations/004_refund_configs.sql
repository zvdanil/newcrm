-- Migration 004: refund_configs
-- Конфигурация возвратов за пропущенные занятия по уважительной причине.
-- Правила:
--   is_rigid на activity = true → возврата нет, эта запись игнорируется
--   refund_on_excused = false → возврата нет
--   refund_on_excused = true + refund_amount → фиксированный возврат
--   refund_on_excused = true + refund_pct   → процент от текущего тарифа
--   refund_amount и refund_pct не могут быть заданы одновременно (CHECK)

CREATE TABLE refund_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id   UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  refund_on_excused BOOLEAN NOT NULL DEFAULT false,
  refund_amount NUMERIC(15,2) CHECK (refund_amount > 0),
  refund_pct    NUMERIC(5,2)  CHECK (refund_pct > 0 AND refund_pct <= 100),
  note          TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (activity_id),
  CHECK (
    NOT (refund_amount IS NOT NULL AND refund_pct IS NOT NULL)
  )
);

CREATE INDEX ON refund_configs (activity_id);
