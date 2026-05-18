# DIVIDENDS_MODULE.md — Модуль обліку дивідендів

> Реалізовано: травень 2026
> Міграції: `023_dividends.sql`, `024_salary_dividends.sql`

---

## Концепція

Модуль дозволяє власникам бізнесу фіксувати та відслідковувати виплату прибутку (дивідендів). Система:
- Зберігає частки власників (`equity_participants`)
- Веде журнал виплат (`dividend_payouts`) з прив'язкою до джерел фінансування
- Розраховує «перекіс» між партнерами (actual vs. target net)
- Надає рекомендації щодо вирівнювання виплат

---

## База даних

### Нові таблиці

```sql
-- Учасники (власники)
equity_participants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  share_pct NUMERIC(5,2) NOT NULL,  -- частка у відсотках
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
)

-- Глобальні налаштування
dividend_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  default_tax_pct NUMERIC(5,2) DEFAULT 0
)

-- Журнал виплат
dividend_payouts (
  id UUID PRIMARY KEY,
  participant_id UUID REFERENCES equity_participants(id),
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('cash', 'cashless')),
  tax_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  gross_amount NUMERIC(15,2) NOT NULL,  -- списано зі счетів
  net_amount NUMERIC(15,2) NOT NULL,    -- зараховано в рахунок частки
  note TEXT,
  is_deleted BOOLEAN DEFAULT false,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
)
```

### Змінені таблиці

```sql
-- expenses: прив'язка до виплати дивідендів (міграція 023)
ALTER TABLE expenses ADD COLUMN dividend_payout_id UUID REFERENCES dividend_payouts(id) ON DELETE SET NULL;

-- salary_transactions: прив'язка до виплати дивідендів (міграція 024)
ALTER TABLE salary_transactions ADD COLUMN dividend_payout_id UUID REFERENCES dividend_payouts(id) ON DELETE SET NULL;
```

---

## Backend API

### `GET /api/dividends/participants`
Список учасників. Тільки `owner`.

### `POST /api/dividends/participants`
```json
{ "name": "Данило", "share_pct": 60 }
```

### `PUT /api/dividends/participants/:id`
Оновлення імені, частки або `is_active`.

### `DELETE /api/dividends/participants/:id`
Видалення тільки якщо немає виплат.

---

### `GET /api/dividends/settings`
### `PUT /api/dividends/settings`
```json
{ "default_tax_pct": 5 }
```

---

### `GET /api/dividends/ledger`
Повертає зведений баланс:
```json
{
  "total_net": 150000,
  "participants": [
    {
      "id": "...",
      "name": "Данило",
      "share_pct": 60,
      "actual_net": 90000,
      "target_net": 90000,
      "skew": 0
    }
  ],
  "leveling": [
    { "participant_id": "...", "recommendation_amount": 5000 }
  ]
}
```

**Логіка skew:** `actual_net - (total_net × share_pct / 100)`
**Логіка leveling:** рекомендована сума до вирівнювання відносно партнера з найбільшим коефіцієнтом виплат.

---

### `GET /api/dividends/payouts`
Список виплат з джерелами. Джерела включають і `expenses` і `salary_transactions`.
```json
[{
  "id": "...",
  "date": "2026-05-18",
  "participant_name": "Данило",
  "type": "cash",
  "gross_amount": "10000",
  "net_amount": "10000",
  "sources": [
    { "id": "...", "amount": "5000", "account_name": "Каса", "is_salary": false },
    { "id": "...", "amount": "5000", "account_name": "Іван", "is_salary": true }
  ]
}]
```

---

### `POST /api/dividends/payouts`
```json
{
  "participant_id": "...",
  "date": "2026-05-18",
  "type": "cash",
  "tax_pct": 0,
  "note": "Виплата за травень",
  "sources": [
    { "type": "new",             "account_id": "...", "amount": 5000 },
    { "type": "existing",        "expense_id": "..." },
    { "type": "existing_salary", "expense_id": "..." }
  ]
}
```

**Що відбувається при фіксації:**
- `new` → створює нову витрату з `is_dividend=true`, `status=paid`
- `existing` → встановлює `dividend_payout_id`, `status=paid`, `payment_date`
- `existing_salary` → встановлює `dividend_payout_id`

---

### `DELETE /api/dividends/payouts/:id`
Soft-delete виплати. Відв'язує всі `expenses` та `salary_transactions` (обнуляє `dividend_payout_id`), але не видаляє їх.

---

## Правила каскадного видалення

| Видалено | Результат |
|----------|-----------|
| Виплата дивіденду | Відв'язує витрати та зарплати (лишаються) |
| Загальна витрата з `dividend_payout_id` | Soft-delete пов'язаної виплати |
| Зарплатна виплата з `dividend_payout_id` | Soft-delete пов'язаної виплати |

---

## Frontend

### Сторінка `/dividends`

| Компонент | Файл |
|-----------|------|
| Головна сторінка | `DividendsPage.tsx` |
| Заголовок балансу | `LedgerHeader.tsx` |
| Журнал виплат | `PayoutsTab.tsx` |
| Форма фіксації | `CreatePayoutModal.tsx` |
| Налаштування | `SettingsTab.tsx` |

### UX-флоу: відмітка як дивіденд

```
[Журнал витрат]
  Витрата → кнопка ₴↑ → is_dividend=true → navigate('/dividends?add_expense=ID')
  Зарплата → кнопка ₴↑ → is_dividend=true → navigate('/dividends?add_expense=ID')

[Дивіденди]
  DividendsPage → зчитує add_expense з URL
  PayoutsTab → отримує prefillExpenseId, відкриває модалку
  CreatePayoutModal → знаходить запис (витрату або зарплату) і додає як джерело
```

### Форма фіксації (`CreatePayoutModal`)

Завантажує **обидва** списки джерел:
- `GET /api/expenses?is_dividend=true` → витрати без `dividend_payout_id`
- `GET /api/salary/payments?is_dividend=true` → зарплати без `dividend_payout_id`

Об'єднує в один відсортований список з підписами **«Витрата:»** / **«Зарплата:»**.

---

## Типи (TypeScript)

```ts
// backend/src/db/types.ts
interface ExpensesTable {
  dividend_payout_id: string | null  // існував з 023
}
interface SalaryTransactionsTable {
  dividend_payout_id: string | null  // додано у 024
}

// frontend/src/api/dividends.api.ts
sources: Array<
  | { type: 'new';              account_id: string; amount: number }
  | { type: 'existing';         expense_id: string }
  | { type: 'existing_salary';  expense_id: string }
>

// frontend/src/api/expenses.api.ts
interface SalaryPayment {
  dividend_payout_id?: string | null  // додано
}
```

---

## Що залишилось (Future Work)

- [ ] **PnL-звіт** (7 колонок) — `GET /api/reports/pnl?from=&to=`
- [ ] **Двохетапний cash-out** — `in_transit → completed` (відрізняється від простого обналичування)
- [ ] **Експорт журналу дивідендів** у Excel/CSV
- [ ] **Нотифікації** при значному перекосі (skew > X%)
