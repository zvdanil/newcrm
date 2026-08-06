-- 050_versioned_smart_tariffs.sql
-- Привязка смарт-конфигураций к конкретным версиям тарифов (tariffs.id)

-- 1. Добавляем колонку tariff_id и rules_json
ALTER TABLE smart_tariff_configs
  ADD COLUMN IF NOT EXISTS tariff_id UUID REFERENCES tariffs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS rules_json JSONB;

-- 2. Привязываем существующие конфиги смарт-тарифа к самым актуальным/последним тарифам соответствующих активностей
UPDATE smart_tariff_configs stc
SET tariff_id = (
  SELECT t.id
  FROM tariffs t
  WHERE t.activity_id = stc.activity_id
  ORDER BY (t.valid_to IS NULL) DESC, t.valid_from DESC, t.created_at DESC
  LIMIT 1
)
WHERE stc.tariff_id IS NULL;

-- 3. Удаляем записи без привязанного тарифа (если такие оказались)
DELETE FROM smart_tariff_configs WHERE tariff_id IS NULL;

-- 4. Изменяем первичный ключ с activity_id на tariff_id
ALTER TABLE smart_tariff_configs DROP CONSTRAINT IF EXISTS smart_tariff_configs_pkey;
ALTER TABLE smart_tariff_configs ADD CONSTRAINT smart_tariff_configs_pkey PRIMARY KEY (tariff_id);
