# DEV_CHECKLIST.md — Чеклист разработки КіндерCRM / IRIS

> Этот файл — рабочий журнал прогресса. Отмечай выполненное `[x]` по мере готовности.
> Перед стартом нового этапа убедись, что все пункты предыдущего закрыты.

---

## ПРАВИЛА ПРОЦЕССА (читать перед каждой сессией)

### Как мы работаем
- Один этап — один фокус. Не начинать следующий этап, пока текущий не прошёл Definition of Done.
- Каждый новый компонент или модуль — сначала схема БД / типы данных, потом UI.
- Финансовые расчёты — ТОЛЬКО на бэкенде. Фронтенд только отображает результат.
- **После каждой сессии:** сверить каждый пункт текущего этапа, отметить `[x]` только то, что реально проверено в браузере или через API — не на глаз.
- **Перед объявлением этапа завершённым:** пройти по каждому пункту чеклиста вручную. Если хоть один `[ ]` — этап не закрыт.
- Перед стартом сессии — прочитать CLAUDE.md и этот файл, чтобы восстановить контекст.

### Definition of Done (для любого этапа)
Этап считается завершённым, если выполнены ВСЕ пункты:
- Каждый пункт чеклиста этапа отмечен `[x]`
- Схема БД создана и проверена (миграции применены, таблицы видны в БД)
- Каждый API-эндпоинт проверен реальным запросом (curl или браузер)
- Каждая страница UI открыта в браузере и работает без ошибок в консоли
- RBAC проверен: кнопки и данные скрыты/показаны по роли
- Edge cases проверены вручную: пустые списки, несуществующие ID, чужие данные

---

## ЭТАП 1 — Фундамент: Auth + Дети + Семьи
**Статус:** `[x] Завершён`

### База данных
- [x] Таблица `users` (id, email, password_hash, role, is_active, created_at)
- [x] Таблица `roles` — enum: owner, admin, manager, accountant, teacher, parent
- [x] Таблица `parents` (id, full_name, phone, email, user_id)
- [x] Таблица `families` (id, name, primary_parent_id)
- [x] Таблица `family_members` (family_id, parent_id)
- [x] Таблица `children` (id, full_name, birth_date, family_id, group_id, is_active)
- [x] Таблица `groups` (id, name) — старшая, младшая и т.д.
- [x] Индексы: child_id, family_id, user_id

### Бэкенд
- [x] Auth: POST /api/auth/login → JWT
- [x] Auth: POST /api/auth/refresh
- [x] Auth: POST /api/auth/logout
- [x] RBAC middleware (проверка роли на каждом защищённом маршруте)
- [x] GET /api/children (список с поиском, пагинация LIMIT 500)
- [x] GET /api/children/:id (карточка ребёнка)
- [x] POST /api/children (создание)
- [x] PUT /api/children/:id (редактирование)
- [x] GET /api/families (список семей)
- [x] GET /api/families/:id (карточка семьи с детьми)
- [x] GET /api/groups (справочник групп)

### Фронтенд
- [x] Страница логина (форма, обработка ошибок, redirect после входа)
- [x] Защищённые маршруты (redirect на логин без токена)
- [x] Навигационная шапка с разделами (заглушки для будущих разделов)
- [x] Список детей с live-поиском по ФИО
- [x] Фильтр по группе и статусу (активный / архив)
- [x] Карточка ребёнка: анкетные данные (просмотр + редактирование)
- [x] Форма создания ребёнка (/children/new)
- [x] Страница семей: список
- [x] Карточка семьи: дети, участники

### RBAC для этапа 1
- [x] Owner, Admin, Manager — видят всех детей (бэкенд)
- [x] Parent — видит только своих детей (бэкенд)
- [x] RBAC в UI: кнопка "Додати дитину" скрыта для Parent/Teacher/Accountant

---

## ЭТАП 2 — Активности и Подписки
**Статус:** `[x] Завершён`

### База данных
- [x] Таблица `accounts` (id, name, type: fop/cash/bank, currency, is_active)
- [x] Таблица `activities` (id, name, account_id, tariff_type: monthly/per_lesson/smart, is_active)
- [x] Таблица `tariffs` (id, activity_id, base_fee, valid_from, valid_to) — SCD Type 2
- [x] Таблица `linked_activities` (parent_activity_id, child_activity_id)
- [x] Таблица `enrollments` (id, child_id, activity_id, account_id, start_date, end_date, status: active/frozen/archived, frozen_from, frozen_to)
- [x] Таблица `child_prices` (id, child_id, activity_id, price, discount_pct, valid_from, valid_to) — SCD Type 2
- [x] Таблица `child_global_discounts` (id, child_id, discount_pct, valid_from, valid_to)
- [x] Таблица `refund_configs` (activity_id, refund_on_excused, refund_amount, refund_pct)
- [x] Индексы: activity_id, enrollment child_id + activity_id

### Бэкенд
- [x] CRUD /api/activities
- [x] CRUD /api/accounts
- [x] GET /api/activities/:id/tariff-history (история тарифов SCD Type 2)
- [x] POST /api/activities/:id/tariff (новая ставка → valid_to предыдущей = today)
- [x] CRUD /api/enrollments
- [x] POST /api/enrollments/:id/freeze / unfreeze
- [x] GET /api/children/:id/enrollments
- [x] Linked activities: каскад отметок

### Фронтенд
- [x] Раздел "Довідники": список активностей с карточкой
- [x] Карточка активности (тариф, счёт, связанные активности, конфиг возвратов, история тарифов)
- [x] Список счетов
- [x] В карточке ребёнка: блок "Підписки" (список + управление)
- [x] Форма записи на активность (выбор активности, даты, счёта)
- [x] Форма заморозки (дата начала и окончания паузы)

---

## ЭТАП 3 — Журналы посещаемости
**Статус:** `[x] Завершён`

### База данных
- [x] Таблица `attendance_logs` (id, enrollment_id, child_id, activity_id, date, status, custom_amount, note, created_by)
- [x] Таблица `refund_configs` — добавлена в Этапе 2

### Бэкенд
- [x] GET /api/journals?activity_id=&date= (данные журнала за день/неделю/месяц)
- [x] POST /api/attendance (поставить отметку)
- [x] PUT /api/attendance/:id (изменить отметку)
- [x] Логика каскада: отметка в parent → авто-INSERT в linked_activities
- [x] Проверка заморозки: замороженный ребёнок → ячейки заблокированы

### Фронтенд
- [x] Раздел "Журнали" с табами (по активностям)
- [x] Список детей в журнале — алфавитный порядок
- [x] Ячейки отметок (кликабельные, циклическое переключение статусов)
- [x] Спец-тариф (custom_amount) — попап ввода суммы в ячейке
- [x] Замороженный ребёнок: строка видна, ячейки disabled

---

## ЭТАП 4 — Биллинговое ядро *(MVP-рубеж)*
**Статус:** `[x] В основном завершён` *(4.5 требует визуальной проверки)*

---

### 4.1 — База данных (фундамент)
- [x] Таблица `transactions` (id, type, child_id, account_id, activity_id, enrollment_id, amount NUMERIC(15,2), transaction_date, billing_month, is_deleted, deleted_at, deleted_by, metadata_json, note)
- [x] Таблица `child_balances` (child_id, account_id, balance)
- [x] Таблица `initial_balances` (id, child_id, account_id, amount, note)
- [x] Индексы: transactions (child_id, account_id, transaction_date, type, billing_month)
- [x] Таблица `billing_run_log`
- [x] Таблица `child_prices` — SCD Type 2
- [x] Таблица `child_global_discounts` — SCD Type 2
- [x] Таблица `smart_tariff_configs`

### 4.2 — Баланс и Ledger
- [x] Сервис `balanceService.createTransaction` + `recalcBalance`
- [x] GET /api/children/:id/balance
- [x] GET /api/children/:id/ledger
- [x] POST /api/children/:id/initial-balance
- [x] POST /api/children/:id/payment — ручное внесение оплаты
- [x] Фронтенд: блок "Баланси" в карточке ребёнка
- [x] Фронтенд: таблица Ledger с навигацией по месяцам

### 4.3 — Billing Run
- [x] `billingRunService.runBilling(month)` (иерархия цен 5 уровней, идемпотентность)
- [x] Cron: `0 6 1 * *`
- [x] POST /api/billing/run (Owner only)
- [x] GET /api/billing/run-log
- [x] Фронтенд: страница "Billing" (Owner) — лог + ручной запуск

### 4.4 — Attendance → финансовые триггеры
- [x] per_lesson: triggerPerLessonAccrual / reversePerLessonAccrual
- [x] monthly: triggerRefund / reverseRefund (с учётом is_rigid, refund_config)
- [x] smart: recalcSmartBenefit после каждого изменения отметки
- [x] Каскад на linked_activities (каждая активность — свои правила)

### 4.4б — Индивидуальные тарифы и скидки
- [x] GET/POST/DELETE /api/children/:id/prices (SCD Type 2, сброс с датой)
- [x] GET/POST/DELETE /api/children/:id/global-discount
- [x] Фронтенд: инлайн-тариф в строке подписки (зачёркнутый base_fee + индивидуальная цена)
- [x] Фронтенд: инлайн-форма тарифа (режимы: фиксированная цена / скидка %)
- [x] Фронтенд: сброс тарифа с выбором даты (planning)
- [x] Фронтенд: глобальная скидка — компактная кнопка в шапке блока подписок

### 4.5 — Soft Delete транзакций (Owner)
- [x] PUT /api/transactions/:id/delete (body: `{ txId, reason }`) — только Owner
  - is_deleted = true + REVERSAL транзакция + обновление child_balances
- [x] Фронтенд: кнопка отмены платежа в Ledger (только Owner)
  - _TypeScript-фикс: `cancelPayMutation.mutate({ txId: tx.id })` (было ошибочно `.mutate(tx.id)`)_

### 4.5б — Смарт-тариф
- [x] Миграция `007_smart_tariff.sql` + `smart_tariff_configs`
- [x] `smartTariffService.recalcSmartBenefit(enrollmentId, billingMonth)`
- [x] `smartTariffService.runSmartAccruals(month)` + Cron
- [x] GET/PUT /api/activities/:id/smart-tariff
- [x] Фронтенд: `SmartTariffConfigBlock` (L1 + L2, правило max)

### 4.6б — Биллинг: критические исправления (2026-05-11)

> Обнаружены и устранены системные баги после завершения основного этапа 4.

**billingRunService.ts**
- [x] `getChildIndividualTariff` + `getEffectivePrice`: `valid_to >=` → `valid_to >` (SCD Type 2 exclusive end — закрытый тариф не залипает на дату закрытия)
- [x] `recalcActivityAccruals`: добавлен параметр `childId?` — скоупит пересчёт на одного ребёнка
- [x] `recalcActivityAccruals`: фильтр soft-delete REFUNDs переключён с `billing_month = billingDate` на диапазон `transaction_date` (REFUNDs от журнала имеют `billing_month = null`)
- [x] `recalcActivityAccruals`: добавлена проверка `effectiveType !== 'smart'` — не создаёт per-absence REFUNDs при смарт-тарифе (смарт использует только `recalcSmartBenefit`)
- [x] `recalcActivityAccruals`: условие пропуска исправлено с `!== 'monthly'` → `=== 'per_lesson'` (смарт-индивидуальный тариф теперь создаёт ACCRUAL корректно)

**children.ts**
- [x] `POST/DELETE /:id/individual-tariffs` и `POST/DELETE /:id/prices`: после изменения автоматически запускают `recalcActivityAccruals` — карточка мгновенно пересчитывается без ожидания Billing Run
- [x] Дефолт `valid_to` при закрытии тарифа изменён на `firstOfCurrentMonth` (не сегодня)
- [x] `recalcSmartBenefit` вызывается по каждому месяцу при установке / закрытии смарт-индивидуального тарифа

**journals.ts**
- [x] `reverseRefund`: исправлен с `executeTakeFirst()` → `execute()` + цикл — удаляет ВСЕ активные REFUND для enrollment+date (дубли больше не залипают)
- [x] `triggerRefund` + `triggerPerLessonAccrual`: `valid_to >=` → `valid_to >` (3 места — согласование с billingRunService)
- [x] `POST /attendance`: проверка существующего REFUND перед `triggerRefund` — при upsert той же отметки REFUND не дублируется. Проверка для каждой linked-активности

**transactions.ts**
- [x] `POST /:id/cancel` при ACCRUAL: каскадная очистка:
  - monthly/smart: soft-delete всех REFUND за enrollment+billing_month + физическое удаление `absent_excused` из `attendance_logs` + каскад на все linked-активности
  - per_lesson: физическое удаление `present/special` отметки из `attendance_logs` за дату ACCRUAL

**ChildCardPage.tsx**
- [x] Дефолт `close_date` в форме закрытия тарифа/цены → `firstOfMonth()`
- [x] `onSuccess` у `setTariffMutation` и `closeTariffMutation`: инвалидация `['balance']` и `['ledger']` — мгновенное обновление UI

### 4.6 — Pro-rata при Quick Enrollment
> ⚠️ **Изменение от плана:** реализовано только для `tariff_type = 'monthly'`. Для per_lesson и smart — не применяется (логично по природе этих тарифов).

- [x] При создании enrollment НЕ с 1-го числа и `tariff_type = 'monthly'` → немедленно ACCRUAL с про-ратой
  - `pro_rata = round(base_fee / calendar_days_in_month * days_remaining, 2)`
  - Рабочие дни = **календарные**
  - `billing_month` = первый день текущего месяца
  - metadata_json: `{ pro_rata: true, days_remaining, days_in_month, full_price }`
- [x] `getEffectivePrice` экспортирован из `billingRunService.ts` для переиспользования
- [x] С 1-го числа следующего месяца — стандартный Billing Run

---

## ЭТАП 5 — Оплаты и Waterfall
**Статус:** `[x] Реализован` *(визуальная проверка на живых данных — следующий шаг)*

> ⚠️ **Изменения от плана:**
> - Отдельная таблица `payments` **не создавалась** — платежи идут в `transactions` (type=PAYMENT). Это соответствует архитектуре immutable ledger.
> - "Виджет межсчётного дисбаланса" в карточке счёта убран — **отметка о дисбалансе ставится прямо в строку транзакции** при кросс-счётной оплате.

### База данных
- [x] Таблица `inter_account_imbalances` (id, from_account_id, to_account_id, amount, transaction_id, note, created_at, resolved_at, resolved_by)

### Бэкенд — Waterfall
- [x] `waterfallService.getFamilyDebts(familyId, accountId)` — долги всех детей семьи, с датой старейшего ACCRUAL
- [x] `waterfallService.computeWaterfall(debts, amount, advanceChildId?)` — FIFO: сортировка по oldest_accrual_date ASC, debt DESC
- [x] GET /api/families/:id/debts?account_id= — breakdown долгов по детям
- [x] POST /api/families/:id/payment — авто-waterfall или manual_match; создаёт PAYMENT per child; поддержка кросс-счётной оплаты (inter_account_imbalances)

### Фронтенд
- [x] `WaterfallBlock` в `FamilyCardPage`: выбор счёта, таблица долгов, превью распределения, форма суммы
- [x] Режим "Авто" (FIFO) и "Ручний розподіл" (manual_match с выбором детей)
- [x] Селектор "зачислити аванс на дитину" когда сумма > общий долг

---

## ЭТАП 6 — Персонал и Зарплата
**Статус:** `[~] В процессе` *(основной функционал реализован, замены и роль Teacher — отложены)*

> ⚠️ **Изменения от первоначального плана:**
> 1. **`substitutions` (замены) — не реализована.** Отложено на будущую итерацию.
> 2. **Формула начисления изменена:** `gross = quantity × rate_value` (не flat rate). Поддерживаются типы: hourly, per_lesson, per_child (с quantity), fixed_monthly, bonus, smart (без quantity).
> 3. **Добавлен `value_mode`** — два режима ставки: `fixed` (абсолютная сумма) и `percent_of_revenue` (% от выручки за активность). Миграция `012_staff_rate_value_mode.sql`.
> 4. **Ретроспективный пересчёт** при задании ставки "задним числом" — автоматически через `recalcRetroAccruals()` создаёт CORRECTION транзакции.
> 5. **Soft delete начислений** — сотрудники из попапа в фин. истории могут удалять транзакции (is_deleted=true).
> 6. **Тип транзакций:** ACCRUAL / PAYMENT / CORRECTION (не SALARY_ACCRUAL/SALARY_PAYMENT — используется отдельная таблица `salary_transactions`).

### База данных
- [x] Таблица `staff` (id, full_name, specialization, type: employee/partner, phone, start_date, is_active, note)
- [x] Таблица `staff_rates` (id, staff_id, activity_id, rate_category: auto/manual, rate_type: per_lesson/per_child/fixed_monthly/hourly/smart/bonus, value_mode: fixed/percent_of_revenue, rate_value, deduction_pct, valid_from, valid_to, note) — SCD Type 2
- [x] Таблица `staff_smart_configs` (rate_id PK, base_lessons, absence_threshold, threshold_rate)
- [x] Таблица `salary_transactions` (id, staff_id, rate_id, activity_id, type: ACCRUAL/PAYMENT/CORRECTION, gross_amount, deduction_pct, transaction_date, billing_month, note, edit_note, metadata_json, is_deleted, deleted_at, deleted_by, created_by)
- [x] Миграция `011_staff.sql`, `012_staff_rate_value_mode.sql`
- [ ] Таблица `substitutions` (замены педагогов) — отложено

### Бэкенд
- [x] CRUD /api/staff (GET список, GET /:id, POST, PUT /:id)
- [x] GET /api/staff/:id/rates — ставки с join smart_config
- [x] POST /api/staff/:id/rates — создание ставки (SCD Type 2: закрывает предыдущую); запускает `recalcRetroAccruals` если valid_from < today
- [x] Ретро-создание начислений: при вводе ставки задним числом система автоматически создает пропущенные записи (triggerRetroAccruals)
- [x] Поддержка Group Lessons: добавлен тип ставки `group_lesson`, учет `lessons_count` в начислениях
- [x] PUT /api/staff/:id/rates/:rateId — редактирование (deduction_pct, valid_to, note, smart_config)
- [x] DELETE /api/staff/:id/rates/:rateId — закрытие ставки (valid_to = today)
- [x] GET /api/staff/:id/salary?month=YYYY-MM — транзакции + summary (gross/deduction/net/paid/balance)
- [x] POST /api/staff/:id/salary — ручное начисление (quantity × rate или gross_amount)
- [x] PUT /api/staff/:id/salary/:txId — редактирование начисления (требует edit_note)
- [x] DELETE /api/staff/:id/salary/:txId — мягкое удаление начисления
- [x] POST /api/staff/:id/salary/pay — выплата ЗП
- [x] GET /api/salary/journal?month=YYYY-MM — сводная ведомость по всем сотрудникам
- [x] Триггер attendance → `recalcStaffAccruals(activityId, date)` — авто-начисление per_lesson/per_child
- [x] Смарт-ставка педагога: `recalcSmartStaffBenefit(rateId, billingMonth)` после каждой отметки
- [x] Cron: `runFixedMonthlyAccruals` + `runSmartStaffAccruals` 1-го числа
- [x] `recalcRetroAccruals` — ретроспективный пересчёт при backdated ставке (CORRECTION по delta)
- [x] `triggerRetroAccruals` — автоматическое создание пропущенных начислений при вводе ставки задним числом
- [x] **Стабилизация % ставок**: Переход на строковое сравнение дат (устранение проблем с TZ)
- [x] **Дедупликация начислений**: Автоматическая очистка конкурирующих авто-начислений (одно начисление на активность в день)
- [ ] Логика замен педагогов — отложено

### Фронтенд
- [x] Раздел "Персонал" /staff — список сотрудников (тип, специализация, статус)
- [x] Карточка сотрудника /staff/:id — анкетные данные (просмотр + редактирование)
- [x] Блок ставок: просмотр, добавление (все типы + value_mode), инлайн-редактирование (deduction_pct, valid_to, note, smart_config), закрытие
- [x] Фин. история: календарная сетка (строки = активности, колонки = дни месяца)
- [x] Навигация по месяцам в фин. истории
- [x] Попап транзакции: просмотр деталей, инлайн-редактирование суммы (с edit_note), удаление
- [x] Форма ручного начисления: выбор ставки, поле quantity (или gross_amount), вычисленная сумма
- [x] Форма выплаты ЗП
- [x] Журнал ЗП /salary/journal — сводная таблица по всем сотрудникам с навигацией по месяцам
- [x] Навигация: "Персонал" → /staff, "Журнал ЗП" → /salary/journal
- [ ] Блок ЗП в шапке журнала посещений — отложено
- [ ] Teacher: видит только своё расписание и свою ЗП — отложено

---

## ЭТАП 7 — Счета и Расходы
**Статус:** `[x] Реализован` *(визуальная проверка UI — следующий шаг)*

> ⚠️ **Изменения от первоначального плана:**
> 1. **`expense_journals` — убран.** Решили сделать **один единый журнал расходов** вместо нескольких журналов. Фильтрация по счёту/категории/статусу покрывает все кейсы разделения.
> 2. **`recurring_expenses` — не реализован** (отложен). Шаблоны регулярных расходов — будущая итерация.
> 3. **`is_dividend` и обналичивание — внесены в Этап 7**, а не в Этап 8. Логика флага дивиденда и операция "вывод средств" реализованы прямо на расходах, без отдельных таблиц equity.
> 4. **`withdrawal_transfer_id` — новый механизм** защиты от двойного обналичивания: ссылка на `account_transfers.id` на записи расхода.
> 5. **Рахунок за замовчуванням** — localStorage-фича для быстрого ввода однотипных расходов (не было в плане).
> 6. **Двухуровневый CategoryPicker** — UX-решение: сначала выбор категории, потом подкатегории (вместо единого плоского списка).

### База данных (миграции 009, 010)
- [x] Таблица `expense_categories` (id, name, parent_id, is_active, sort_order) — иерархия 2 уровня; 7 seed-записей
- [x] Таблица `expenses` (id, account_id, category_id, amount, accrual_date, payment_date, status: pending/paid, is_instant, is_dividend, note, created_by, withdrawal_transfer_id, is_deleted, deleted_at, deleted_by)
- [x] Таблица `account_transfers` (id, from_account_id, to_account_id, amount, commission, transfer_date, note, created_by)
- [x] `expenses.withdrawal_transfer_id UUID REFERENCES account_transfers(id) ON DELETE SET NULL` — миграция 010
- [x] Типы Kysely: `ExpenseCategoriesTable`, `ExpensesTable`, `AccountTransfersTable` в `db/types.ts`

### Бэкенд (`/api/expenses`)
- [x] GET /api/expenses/categories
- [x] POST /api/expenses/categories (owner/admin)
- [x] PUT /api/expenses/categories/:id
- [x] DELETE /api/expenses/categories/:id — блокируется если есть подкатегории (409); при удалении category_id в expenses → NULL (ON DELETE SET NULL)
- [x] GET /api/expenses?account_id=&category_id=&status=&from=&to=&is_dividend=&limit=&offset=
  - Возвращает: data[], total, total_amount (сумма по всему фильтру), limit, offset
  - category_id фильтр: матчит категорию ИЛИ её дочерние
- [x] POST /api/expenses (pending / мгновенный через is_instant)
- [x] PUT /api/expenses/:id (только pending)
- [x] DELETE /api/expenses/:id — soft delete
- [x] POST /api/expenses/:id/pay — pending → paid
- [x] PUT /api/expenses/:id/dividend — toggle is_dividend (owner only)
- [x] POST /api/expenses/:id/withdraw — обналичивание:
  - Проверка: withdrawal_transfer_id уже есть → 409 AlreadyWithdrawn
  - Создаёт `account_transfer` на сумму `amount − commission`
  - Если commission > 0: создаёт отдельный expense (is_instant, paid) с описанием "Комісія за обналичування..."
  - Устанавливает `withdrawal_transfer_id` на исходном расходе
- [x] GET /api/expenses/transfers?account_id=&from=&to=
- [x] POST /api/expenses/transfers
- [x] DELETE /api/expenses/transfers/:id (owner only)

### Фронтенд (`/expenses`)
- [x] Три таба: "Журнал витрат" / "Перекази" / "Категорії" (последний — только admin+)
- [x] Фильтры журнала: рахунок, категорія (двухуровневый), статус, тип (звичайні/дивіденди), дата від/по
- [x] Кнопка "Рахунок за замовч." (📌) в тулбаре — сохраняется в localStorage, применяется к форме
- [x] Форма добавления/редактирования расхода с `CategoryPicker` (двухуровневый, inline-создание подкатегории)
- [x] Форма перекладу між рахунками (с полем комиссии)
- [x] `CategoriesManager` — дерево категорий: inline-редактирование, удаление, добавление подкатегорий
- [x] `ExpenseRow`: кнопки Оплатить / ₴↑ (дивиденд) / ↗ (обналичивание) / ред. / удалить
  - Оплачен + is_instant → бейдж "миттєво"
  - withdrawal_transfer_id установлен → кнопка заменяется бейджем "↗ обнал." (зелёный)
  - is_dividend → строка с фиолетовым фоном + бейдж "дивіденд"
- [x] `WithdrawalDialog`: выбор целевого счёта (исключает источник), поле комиссии, дата, live-preview суммы зачисления и суммы комиссии
- [x] Итого в футере таблицы (total_amount из бэкенда)
- [x] Навигационная ссылка "Витрати" в AppLayout

---

## ЭТАП 8 — Дивиденды и PnL
**Статус:** `[ ] Не начат`

> ⚠️ **Уточнение после реализации Этапа 7:**
> Флаг `is_dividend` на расходах уже реализован. В Этапе 8 остаётся:
> - Учёт долей партнёров и Equity Ledger
> - Двухэтапный cash-out (in_transit → completed) — отличается от простого обналичивания
> - PnL-отчёт (7 колонок, только по кнопке)

### База данных
- [ ] Таблица `equity_participants` (id, name, share_pct)
- [ ] Таблица `dividend_transactions` (id, participant_id, amount, commission, status: in_transit/completed, date)

### Бэкенд
- [ ] CRUD /api/equity-participants (доли партнёров)
- [ ] POST /api/dividends/cashout (двухэтапный вывод: in_transit → completed)
- [ ] GET /api/equity/ledger (перекос выплат по партнёрам)
- [ ] GET /api/reports/pnl?from=&to= (PnL по кнопке, 7 колонок по месяцам):
  | Колонка | Источник |
  |---|---|
  | Ожидаемый доход | Σ ACCRUAL клиентам |
  | Начисленный расход | Σ expenses.amount (статус pending+paid по дате начисления) |
  | Реальные доходы | Σ PAYMENT от клиентов |
  | Оборот расходов | Σ expenses.payment_date (фактически оплаченные) |
  | Оборот без дивидендов | То же, is_dividend = false |
  | Баланс без дивидендов | Реальные доходы − Оборот без дивидендов |
  | Остаток на счетах | Ликвидность накопительно |

### Фронтенд
- [ ] Раздел "Дивіденди" (только Owner)
- [ ] Настройка долей участников
- [ ] Cash-out форма (двухэтапный с комиссией)
- [ ] Equity Ledger с кнопкой "Виробнити баланс"
- [ ] PnL-отчёт (генерируется по кнопке, 7 колонок)

---

## ЭТАП 9 — Личный кабинет родителя
**Статус:** `[ ] Не начат`

- [ ] Отдельная точка входа (роль Parent в общем auth)
- [ ] Дашборд родителя: сводный баланс по детям и счетам
- [ ] История оплат и начислений (фильтр по месяцу)
- [ ] История посещений ребёнка
- [ ] Изоляция данных: Parent видит ТОЛЬКО своих детей (проверка на бэкенде)
- [ ] Адаптация под мобильные устройства

---

## ЭТАП 10 — Производительность и UX
**Статус:** `[ ] Не начат`

- [ ] Виртуализация длинных списков (`react-window` или `@tanstack/virtual`)
- [ ] Global Command Bar (быстрый поиск из любой точки)
- [ ] Mobile-first доработка
- [ ] Сохранение фильтров и активного таба при навигации "Назад"
- [ ] Дашборд: ключевые метрики (долги, ожидаемые поступления, ЗП к выплате)
- [ ] Нагрузочное тестирование + EXPLAIN ANALYZE на топ-10 медленных запросов

---

## ТЕХНИЧЕСКИЕ СТАНДАРТЫ

### Безопасность
- [x] Все финансовые суммы — `NUMERIC(15,2)`
- [x] Параметризованные запросы (Kysely)
- [x] Проверка прав на бэкенде (requireRole на каждом роуте)
- [x] JWT с ротацией

### Данные
- [x] Все временные метки — `TIMESTAMPTZ`
- [x] Финансовые таблицы: `is_deleted`, `deleted_at`, `deleted_by`
- [x] `metadata_json` — слепок ставки при создании транзакции
- [x] Миграции версионированы (файлы 001–010)

### API
- [x] Списочные эндпоинты: `LIMIT 500`
- [x] Итоговые суммы — по всему фильтру в БД, не по 500 строкам
- [x] Ошибки: `{ error: 'Code', message: 'human text' }`
