-- ============================================================
-- ЭТАП 7: Smart Tariff (гибкая логика абонплаты)
-- ============================================================

-- Расширяем CHECK-ограничение на tariff_type
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_tariff_type_check;
ALTER TABLE activities
  ADD CONSTRAINT activities_tariff_type_check
  CHECK (tariff_type IN ('monthly', 'per_lesson', 'smart'));

-- Конфигурация смарт-тарифа (один на активность)
-- Логика 1 (L1): если пропусков >= l1_threshold_absences → списывать l1_threshold_fee вместо base_fee
-- Логика 2 (L2): первые l2_max_refunds пропусков возвращают l2_refund_per_absence каждый
-- Комбинация: к зачёту принимается бо́льший из двух бенефитов
CREATE TABLE smart_tariff_configs (
  activity_id            UUID          PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  base_lessons           INT           NOT NULL DEFAULT 20,   -- ожидаемое число занятий в месяце
  l1_threshold_absences  INT,                                  -- L1: порог пропусков
  l1_threshold_fee       NUMERIC(15,2),                        -- L1: итоговая сумма при достижении порога
  l2_max_refunds         INT,                                  -- L2: макс. число пропусков с возвратом
  l2_refund_per_absence  NUMERIC(15,2),                        -- L2: возврат за один пропуск
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- L1: оба поля либо оба NULL
  CONSTRAINT smart_l1_both_or_none CHECK (
    (l1_threshold_absences IS NULL) = (l1_threshold_fee IS NULL)
  ),
  -- L2: оба поля либо оба NULL
  CONSTRAINT smart_l2_both_or_none CHECK (
    (l2_max_refunds IS NULL) = (l2_refund_per_absence IS NULL)
  )
);
