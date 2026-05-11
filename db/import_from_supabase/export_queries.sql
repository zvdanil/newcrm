-- ============================================================
-- ЭКСПОРТ ДАННЫХ ИЗ СТАРОЙ SUPABASE-СИСТЕМЫ
-- ============================================================
-- Инструкция:
--   1. Откройте Supabase → SQL Editor
--   2. Замените FROM_DATE и TO_DATE на нужный период (формат 'YYYY-MM-DD')
--   3. Выполните каждый блок поочерёдно, сохраняйте результат как JSON
--      (кнопка "Download JSON" в SQL Editor)
--   4. Назовите файлы точно так, как указано в заголовках
--
-- Перед экспортом — обязательно запустите БЛОК 0 и сообщите результаты!
-- ============================================================


-- ============================================================
-- БЛОК 0: ПРОВЕРКА ENUM-ЗНАЧЕНИЙ (запустите первым, пришлите результаты)
-- ============================================================

-- 0a. Типы финансовых транзакций
SELECT DISTINCT type, COUNT(*) AS cnt
FROM finance_transactions
GROUP BY type ORDER BY cnt DESC;

-- 0b. Типы тарифов активностей
SELECT DISTINCT payment_type FROM activities;

-- 0c. Типы ставок сотрудников
SELECT DISTINCT tariff_type FROM staff;

-- 0d. Статусы посещаемости
SELECT DISTINCT status FROM attendance;


-- ============================================================
-- БЛОК 1: groups.json
-- Все группы (справочник, без фильтра по дате)
-- ============================================================
SELECT
  id,
  name,
  created_at
FROM groups
ORDER BY name;


-- ============================================================
-- БЛОК 2: payment_accounts.json
-- Счета, задействованные в периоде или активные
-- ============================================================
SELECT
  id,
  name,
  description,
  is_active,
  created_at,
  updated_at
FROM payment_accounts
WHERE is_active = true
   OR id IN (
     SELECT DISTINCT account_id FROM finance_transactions
     WHERE date BETWEEN 'FROM_DATE' AND 'TO_DATE'
     UNION
     SELECT DISTINCT account_id FROM staff_payouts
     WHERE payout_date BETWEEN 'FROM_DATE' AND 'TO_DATE'
   )
ORDER BY name;


-- ============================================================
-- БЛОК 3: students.json
-- Дети с активными записями в периоде
-- ============================================================
SELECT
  s.id,
  s.full_name,
  s.birth_date,
  s.guardian_name,
  s.guardian_phone,
  s.guardian_email,
  s.status,
  s.custom_fields,
  s.group_id,
  s.created_at,
  s.updated_at
FROM students s
WHERE s.id IN (
  SELECT DISTINCT student_id FROM enrollments
  WHERE enrolled_at::date <= 'TO_DATE'
    AND (unenrolled_at IS NULL OR unenrolled_at::date >= 'FROM_DATE')
)
ORDER BY s.full_name;


-- ============================================================
-- БЛОК 4: activities.json
-- Активности с подписками в периоде
-- ============================================================
SELECT
  id,
  name,
  default_price,
  payment_type,
  description,
  is_active,
  account_id,
  created_at,
  updated_at
FROM activities
WHERE id IN (
  SELECT DISTINCT activity_id FROM enrollments
  WHERE enrolled_at::date <= 'TO_DATE'
    AND (unenrolled_at IS NULL OR unenrolled_at::date >= 'FROM_DATE')
)
ORDER BY name;


-- ============================================================
-- БЛОК 5: enrollments.json
-- Подписки, пересекающиеся с периодом
-- ============================================================
SELECT
  id,
  student_id,
  activity_id,
  account_id,
  is_active,
  effective_from,
  enrolled_at,
  unenrolled_at,
  custom_price,
  discount_percent,
  created_at,
  updated_at
FROM enrollments
WHERE enrolled_at::date <= 'TO_DATE'
  AND (unenrolled_at IS NULL OR unenrolled_at::date >= 'FROM_DATE')
ORDER BY enrolled_at;


-- ============================================================
-- БЛОК 6: attendance.json
-- Отметки посещаемости за период (JOIN для child_id и activity_id)
-- ============================================================
SELECT
  a.id,
  a.enrollment_id,
  e.student_id   AS child_id,
  e.activity_id,
  a.date,
  a.status,
  a.charged_amount,
  a.notes,
  a.created_at,
  a.updated_at
FROM attendance a
JOIN enrollments e ON e.id = a.enrollment_id
WHERE a.date BETWEEN 'FROM_DATE' AND 'TO_DATE'
ORDER BY a.date, e.student_id;


-- ============================================================
-- БЛОК 7: parent_payments.json
-- Оплаты от родителей за период
--
-- ВАЖНО: замените типы в IN(...) на реальные значения из БЛОКА 0a
--        Оставьте только те типы, которые означают "оплата от клиента"
-- ============================================================
SELECT
  id,
  student_id,
  activity_id,
  account_id,
  amount,
  date,
  description,
  created_at
FROM finance_transactions
WHERE student_id IS NOT NULL
  AND date BETWEEN 'FROM_DATE' AND 'TO_DATE'
  AND type IN ('income', 'payment')  -- income = оплата от родителей; payment = доп. форма оплаты
ORDER BY date, student_id;


-- ============================================================
-- БЛОК 8: staff.json
-- Сотрудники, задействованные в периоде
-- ============================================================
SELECT
  id,
  full_name,
  position,
  tariff_type,
  tariff_value,
  is_active,
  accrual_mode,
  manual_rate_type,
  manual_rate_value,
  created_at,
  updated_at
FROM staff
WHERE is_active = true
   OR id IN (
     SELECT DISTINCT staff_id FROM staff_payouts
     WHERE payout_date BETWEEN 'FROM_DATE' AND 'TO_DATE'
       AND is_deleted = false
     UNION
     SELECT DISTINCT staff_id FROM staff_journal_entries
     WHERE date BETWEEN 'FROM_DATE' AND 'TO_DATE'
   )
ORDER BY full_name;


-- ============================================================
-- БЛОК 9: staff_payouts.json
-- Выплаты зарплат за период
-- ============================================================
SELECT
  id,
  staff_id,
  amount,
  payout_date,
  notes,
  account_id,
  payout_for_period,
  is_deleted,
  created_at,
  updated_at
FROM staff_payouts
WHERE payout_date BETWEEN 'FROM_DATE' AND 'TO_DATE'
  AND is_deleted = false
ORDER BY payout_date, staff_id;


-- ============================================================
-- БЛОК 10: staff_journal_entries.json
-- Начисления зарплат и бонусы за период
-- ============================================================
SELECT
  id,
  staff_id,
  activity_id,
  date,
  amount,
  calculated_amount,
  description,
  notes,
  bonus,
  bonus_notes,
  created_at,
  updated_at
FROM staff_journal_entries
WHERE date BETWEEN 'FROM_DATE' AND 'TO_DATE'
ORDER BY date, staff_id;
