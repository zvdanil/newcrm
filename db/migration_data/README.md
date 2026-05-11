# Migration Data

Сюда кладите JSON-файлы, экспортированные из старой Supabase-системы.

## Ожидаемые файлы

| Файл                       | Источник (старая БД)         |
|----------------------------|------------------------------|
| groups.json                | БЛОК 1 export_queries.sql    |
| payment_accounts.json      | БЛОК 2                       |
| students.json              | БЛОК 3                       |
| activities.json            | БЛОК 4                       |
| enrollments.json           | БЛОК 5                       |
| attendance.json            | БЛОК 6                       |
| parent_payments.json       | БЛОК 7                       |
| staff.json                 | БЛОК 8                       |
| staff_payouts.json         | БЛОК 9                       |
| staff_journal_entries.json | БЛОК 10                      |

## Формат

Supabase SQL Editor → кнопка **Download JSON** внизу результата.
Файл может быть массивом `[...]` или объектом `{ "data": [...] }` — скрипт понимает оба формата.

## Запуск

```bash
# Сначала — пробный прогон (без записи в БД)
node db/import_from_supabase/index.js --from 2025-09-01 --to 2026-05-01 --dry-run

# Боевой прогон
node db/import_from_supabase/index.js --from 2025-09-01 --to 2026-05-01
```
