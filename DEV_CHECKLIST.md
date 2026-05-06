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
- [x] Teacher — заглушка (реализуется в Этапе 3)

---

## ЭТАП 2 — Активности и Подписки
**Статус:** `[ ] В работе` / `[ ] Завершён`

### База данных
- [ ] Таблица `accounts` (id, name, type: fop/cash/bank, currency, is_active)
- [ ] Таблица `activities` (id, name, account_id, tariff_type, is_active)
- [ ] Таблица `tariffs` (id, activity_id, base_fee, valid_from, valid_to) — SCD Type 2
- [ ] Таблица `linked_activities` (parent_activity_id, child_activity_id)
- [ ] Таблица `enrollments` (id, child_id, activity_id, account_id, start_date, end_date, status: active/frozen/archived, valid_from)
- [ ] Таблица `child_prices` (id, child_id, activity_id, price, discount_pct, valid_from, valid_to) — индивидуальный тариф
- [ ] Таблица `child_global_discounts` (child_id, discount_pct, valid_from, valid_to)
- [ ] Индексы: activity_id, enrollment child_id + activity_id

### Бэкенд
- [ ] CRUD /api/activities
- [ ] CRUD /api/accounts
- [ ] GET /api/activities/:id/tariff-history (история тарифов SCD Type 2)
- [ ] POST /api/activities/:id/tariff (новая ставка → valid_to предыдущей = today)
- [ ] CRUD /api/enrollments
- [ ] POST /api/enrollments/:id/freeze (заморозка с датой снятия)
- [ ] POST /api/enrollments/:id/unfreeze
- [ ] GET /api/children/:id/enrollments (подписки ребёнка)
- [ ] GET /api/price-resolve (вычислить итоговую цену по иерархии 5 уровней)

### Фронтенд
- [ ] Раздел "Справочники": список активностей
- [ ] Карточка активности (тариф, счёт, связанные активности, история цен)
- [ ] Список счетов (ФОП 1, ФОП 2 и т.д.)
- [ ] В карточке ребёнка: блок "Подписки" (список + управление)
- [ ] Форма записи на активность (выбор активности, даты, счёта, тарифа)
- [ ] Форма заморозки (дата начала и окончания паузы)
- [ ] Индивидуальный тариф / скидка в карточке ребёнка

---

## ЭТАП 3 — Журналы посещаемости
**Статус:** `[ ] В работе` / `[ ] Завершён`

### База данных
- [ ] Таблица `attendance_logs` (id, enrollment_id, child_id, activity_id, date, status: present/absent_excused/absent_unexcused/special, custom_amount, note, created_by)
- [ ] Таблица `refund_configs` (activity_id, refund_on_excused: bool, refund_amount или refund_pct)
- [ ] Индексы: child_id + date, activity_id + date

### Бэкенд
- [ ] GET /api/journals?activity_id=&date= (данные журнала за день/неделю/месяц)
- [ ] POST /api/attendance (поставить отметку)
- [ ] PUT /api/attendance/:id (изменить отметку)
- [ ] Логика каскада: при POST в родительскую активность → авто-INSERT в linked_activities
- [ ] Проверка заморозки: отметка для замороженного ребёнка → 400 ошибка
- [ ] POST /api/enrollments/quick (Quick Enrollment с pro-rata)

### Фронтенд
- [ ] Раздел "Журналы" с табами (по активностям / по группам)
- [ ] Режимы отображения: день / неделя / месяц (переключатель)
- [ ] Список детей в журнале — алфавитный порядок
- [ ] Ячейки отметок (кликабельные, циклическое переключение статусов)
- [ ] Попап спец-тарифа (ввод суммы + примечание прямо в ячейке)
- [ ] Визуальный маркер на ячейке со спец-тарифом (точка / цвет)
- [ ] Замороженный ребёнок: строка видна, ячейки disabled + иконка заморозки
- [ ] Блок ЗП педагога в шапке журнала (ФИО + сумма за занятие)
- [ ] Кнопка "Добавить ребёнка" (Quick Enrollment через глобальный поиск)
- [ ] Сохранение активного таба и фильтров при возврате "Назад"

---

## ЭТАП 4 — Биллинговое ядро *(MVP-рубеж)*
**Статус:** `[ ] В работе` / `[ ] Завершён`

### База данных
- [ ] Таблица `transactions` (id, type: ACCRUAL/PAYMENT/REFUND/REVERSAL/ADJUSTMENT, child_id, account_id, activity_id, amount, transaction_date, is_deleted, deleted_at, deleted_by, metadata_json, note)
- [ ] Таблица `child_balances` (child_id, account_id, balance) — PRIMARY KEY (child_id, account_id)
- [ ] Таблица `initial_balances` (child_id, account_id, amount, note) — начальные остатки, не входят в оборот
- [ ] Индексы: transactions (child_id, account_id, transaction_date, type)

### Бэкенд (Billing Engine)
- [ ] Сервис `billing.service`: вычисление цены по иерархии (5 уровней)
- [ ] Триггер от `attendance_logs` → генерация ACCRUAL или REFUND
- [ ] Логика REFUND: статус absent_excused + refund_config активности → REFUND_IMMEDIATE
- [ ] Жёсткий абонемент: absent_excused → возврата НЕТ (только для основной активности)
- [ ] Billing Run: POST /api/billing/run?month=YYYY-MM → ACCRUAL = Base_Fee для всех активных enrollments
- [ ] Pro-rata при Quick Enrollment: (Base_Fee / рабочих дней) × оставшиеся дни
- [ ] Soft Delete: PUT /api/transactions/:id/delete → is_deleted=true + авто-REVERSAL
- [ ] Пересчёт `child_balances` после каждой транзакции (триггер или сервис)
- [ ] GET /api/children/:id/balance (массив балансов по счетам)
- [ ] GET /api/children/:id/ledger (история транзакций с пагинацией)
- [ ] POST /api/children/:id/initial-balance (ввод начального остатка)

### Фронтенд
- [ ] В карточке ребёнка: блок "Балансы" (раздельно по каждому счёту)
- [ ] Цветовая индикация: долг (красный) / аванс (зелёный) / ноль (серый)
- [ ] Ledger: таблица всех операций с фильтром по месяцу и типу
- [ ] Форма ввода начального остатка (долг / аванс по счёту)
- [ ] Owner: кнопка мягкого удаления транзакции с полем примечания

---

## ЭТАП 5 — Оплаты и Waterfall
**Статус:** `[ ] В работе` / `[ ] Завершён`

### База данных
- [ ] Таблица `payments` (id, transaction_id, child_id, family_id, account_id, amount, payment_date, matched_debts_json, note)
- [ ] Таблица `inter_account_imbalances` (id, from_account_id, to_account_id, amount, created_at, resolved_at)

### Бэкенд
- [ ] POST /api/payments (внести оплату)
- [ ] Waterfall-алгоритм: ORDER BY transaction_date ASC, amount DESC → поочерёдное гашение долгов
- [ ] Manual Match: указать конкретные enrollment_id для целевого погашения
- [ ] Семейный Waterfall: собрать долги всех детей семьи по account_id → применить Waterfall
- [ ] Кросс-счётная оплата: закрыть долг по ФОП 1, деньги → ФОП 2, создать запись в inter_account_imbalances
- [ ] GET /api/accounts/:id/imbalances (список межсчётных дисбалансов)

### Фронтенд
- [ ] Кнопка "Внести оплату" в карточке ребёнка (с автозаполнением ФИО)
- [ ] Форма оплаты: счёт зачисления, сумма, дата, примечание
- [ ] Опция "Целевой платёж": выбор конкретных активностей для погашения
- [ ] Опция "Семейный платёж": охватить всех детей семьи
- [ ] Опция "Кросс-счётная оплата": указать целевую услугу другого счёта
- [ ] История посещений в карточке ребёнка (связь с attendance_logs)
- [ ] В карточке счёта: виджет "Межсчётный дисбаланс" (видно Owner и Admin)

---

## ЭТАП 6 — Персонал и Зарплата
**Статус:** `[ ] В работе` / `[ ] Завершён`

### База данных
- [ ] Таблица `staff` (id, full_name, phone, user_id, is_active)
- [ ] Таблица `staff_rates` (id, staff_id, activity_id, rate_type: percent/fixed_per_lesson/fixed_per_child/salary, rate_value, valid_from, valid_to) — SCD Type 2
- [ ] Таблица `salary_transactions` (id, staff_id, type: SALARY_ACCRUAL/SALARY_PAYMENT, amount, period, transaction_date, metadata_json)
- [ ] Таблица `substitutions` (id, original_staff_id, substitute_staff_id, activity_id, date, custom_amount)

### Бэкенд
- [ ] CRUD /api/staff
- [ ] CRUD /api/staff/:id/rates (с SCD Type 2)
- [ ] Триггер от attendance_logs → генерация SALARY_ACCRUAL по ставке педагога
- [ ] Логика замен: ручная сумма → ставка замещающего → базовая ставка активности
- [ ] POST /api/staff/:id/salary-payment (выплата ЗП с указанием периода)
- [ ] GET /api/staff/:id/ledger (Staff Ledger: история начислений и выплат)
- [ ] GET /api/salary-journal (сводная ведомость по всем сотрудникам)
- [ ] POST /api/staff/:id/bonus (ручное начисление бонуса с примечанием)

### Фронтенд
- [ ] Раздел "Персонал": список сотрудников
- [ ] Карточка сотрудника: данные, ставки, история изменений ставок
- [ ] Staff Ledger: все начисления и выплаты (фильтр по месяцу)
- [ ] Блок ЗП в шапке журнала (реализация — ФИО + сумма за текущее занятие)
- [ ] Журнал ЗП: сводная ведомость, кнопка "Выплатить" с выбором периода
- [ ] Ручной табель (потоковый ввод часов для почасовиков)
- [ ] Форма бонуса с примечанием
- [ ] Teacher: видит только своё расписание и свою ЗП

---

## ЭТАП 7 — Счета и Расходы
**Статус:** `[ ] В работе` / `[ ] Завершён`

### База данных
- [ ] Таблица `expense_journals` (id, name, account_id, description)
- [ ] Таблица `expenses` (id, journal_id, account_id, category_id, amount, accrual_date, payment_date, status: pending/paid, is_instant, is_advance, note, created_by)
- [ ] Таблица `expense_categories` (id, name, parent_id)
- [ ] Таблица `recurring_expenses` (id, journal_id, template_data, frequency: monthly/weekly, next_run_date)
- [ ] Таблица `account_transfers` (id, from_account_id, to_account_id, amount, commission, transfer_date)

### Бэкенд
- [ ] CRUD /api/expense-journals
- [ ] CRUD /api/expenses
- [ ] POST /api/expenses/:id/pay (выплата → списание со счёта)
- [ ] POST /api/expenses/instant (мгновенный расход: начисление + выплата разом)
- [ ] CRUD /api/recurring-expenses (шаблоны)
- [ ] Cron / scheduler: авто-генерация EXPENSE_ACCRUAL по шаблонам в нужную дату
- [ ] POST /api/account-transfers (перевод между счетами + комиссия)
- [ ] GET /api/accounts/:id/summary (ожидаемые поступления, свободные средства)

### Фронтенд
- [ ] Раздел "Счета": список счетов с балансами и ликвидностью
- [ ] Карточка счёта: ожидаемые поступления / свободные средства / переводы
- [ ] Раздел "Журналы расходов": список журналов (Госп. витрати, Безнал и т.д.)
- [ ] Журнал расходов: список с фильтрами (оплачен / ожидает)
- [ ] Форма расхода (начисленный / мгновенный / аванс)
- [ ] Кнопка "Оплатить" для начисленного расхода (выбор счёта списания)
- [ ] Управление шаблонами регулярных расходов
- [ ] Форма перевода между счетами (с комиссией)

---

## ЭТАП 8 — Дивиденды и PnL
**Статус:** `[ ] В работе` / `[ ] Завершён`

### База данных
- [ ] Таблица `equity_participants` (id, name, share_pct)
- [ ] Таблица `dividend_transactions` (id, participant_id, amount, cash_equivalent, commission, status: in_transit/completed, date)
- [ ] Колонка `is_dividend BOOLEAN` в таблице expenses
- [ ] Таблица `reconciliation_log` (id, entity_type, entity_id, delta, adjustment_transaction_id, date)

### Бэкенд
- [ ] CRUD /api/equity-participants (доли партнёров)
- [ ] POST /api/dividends/cashout (двухэтапный вывод: in_transit → completed)
- [ ] PUT /api/expenses/:id/mark-as-dividend (конвертация расхода в дивиденд)
- [ ] GET /api/equity/ledger (Equity Ledger: перекос выплат)
- [ ] GET /api/equity/equalize (рекомендация к выравниванию баланса)
- [ ] Ретроспективный пересчёт: при изменении тарифа → дельта → ADJUSTMENT
- [ ] GET /api/reports/pnl?from=&to= (PnL по кнопке, 7 колонок)

### Фронтенд
- [ ] Раздел "Дивиденды" (только Owner)
- [ ] Настройка долей участников
- [ ] Cash-out форма (двухэтапный вывод с комиссией)
- [ ] Equity Ledger с кнопкой "Выровнять баланс"
- [ ] Кнопка "Вивести як дивіденд" в журналах расходов
- [ ] PnL-отчёт (генерируется по кнопке, 7 колонок по месяцам)
- [ ] PnL виден только Owner

---

## ЭТАП 9 — Личный кабинет родителя
**Статус:** `[ ] В работе` / `[ ] Завершён`

- [ ] Отдельная точка входа (или роль Parent в общем auth)
- [ ] Дашборд родителя: сводный баланс по детям и счетам
- [ ] История оплат и начислений (фильтр по месяцу)
- [ ] История посещений ребёнка
- [ ] Изоляция данных: Parent видит ТОЛЬКО своих детей (проверка на бэкенде)
- [ ] Адаптация под мобильные устройства

---

## ЭТАП 10 — Производительность и UX
**Статус:** `[ ] В работе` / `[ ] Завершён`

- [ ] Виртуализация всех длинных списков (`react-window` или `@tanstack/virtual`)
- [ ] Global Command Bar (быстрый поиск любой карточки из любой точки системы)
- [ ] Fuzzy-поиск (устойчивость к опечаткам)
- [ ] Mobile-first доработка (бургер-меню, адаптивные таблицы, touch-события)
- [ ] Сохранение фильтров и активного таба при навигации "Назад"
- [ ] Дашборд: ключевые метрики (долги, ожидаемые поступления, ЗП к выплате)
- [ ] Нагрузочное тестирование основных запросов
- [ ] Проверка индексов (EXPLAIN ANALYZE на топ-10 медленных запросов)

---

## ТЕХНИЧЕСКИЕ СТАНДАРТЫ (проверять на каждом этапе)

### Безопасность
- [ ] Все финансовые суммы — `NUMERIC(15,2)`, никогда не `FLOAT`
- [ ] Параметризованные SQL-запросы (защита от инъекций)
- [ ] Проверка прав доступа на бэкенде (не только в UI)
- [ ] Данные одного клиента недоступны другому клиенту (row-level isolation)
- [ ] JWT токены имеют срок жизни и ротацию

### Данные
- [ ] Все временные метки — `TIMESTAMPTZ` (с часовым поясом)
- [ ] Все финансовые таблицы имеют: `is_deleted`, `deleted_at`, `deleted_by`
- [ ] `metadata_json` фиксирует слепок ставки в момент создания транзакции
- [ ] Миграции БД версионированы и воспроизводимы

### API
- [ ] Все списочные эндпоинты: `LIMIT 500 OFFSET ?`
- [ ] Итоговые суммы считаются по всему отфильтрованному массиву в БД (не по 500)
- [ ] Ошибки возвращают человекочитаемый `message` + машиночитаемый `code`
