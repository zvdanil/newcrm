import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parentApi } from '../../api/parent.api'
import { localMonthStr, shiftMonth, formatDateStr } from '../../utils/dateStr'
import type { ParentChild, ParentLedgerRow, ParentAttendanceRow, AccountMonthlySummary, ActivityMonthlySummary } from '../../api/parent.api'

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  return formatDateStr(iso)
}

function currentMonth() {
  return localMonthStr()
}

function prevMonth(month: string) {
  return shiftMonth(month, -1)
}

function nextMonth(month: string) {
  return shiftMonth(month, 1)
}

function monthDateRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

const MONTH_LABELS: Record<string, string> = {
  '01': 'Січень', '02': 'Лютий', '03': 'Березень', '04': 'Квітень',
  '05': 'Травень', '06': 'Червень', '07': 'Липень', '08': 'Серпень',
  '09': 'Вересень', '10': 'Жовтень', '11': 'Листопад', '12': 'Грудень',
}

function monthLabel(month: string) {
  const [y, m] = month.split('-')
  return `${MONTH_LABELS[m] ?? m} ${y}`
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item)
    ;(acc[k] ??= []).push(item)
    return acc
  }, {})
}

const STATUS_LABEL: Record<string, string> = {
  present:          'Присутній',
  absent_excused:   'Відсутній (поважна)',
  absent_excused_30: 'Відсутній (поважна 30%)',
  absent_unexcused: 'Відсутній',
  special:          'Особливий',
}

const STATUS_COLOR: Record<string, string> = {
  present:          'text-green-700 bg-green-50',
  absent_excused:   'text-yellow-700 bg-yellow-50',
  absent_excused_30: 'text-yellow-700 bg-yellow-50',
  absent_unexcused: 'text-red-700 bg-red-50',
  special:          'text-purple-700 bg-purple-50',
}

const TYPE_LABEL: Record<string, string> = {
  PAYMENT:    'Оплата',
  REFUND:     'Повернення',
  ADJUSTMENT: 'Корекція',
}

// ────────────────────────────────────────────────────────────
// Balance pill
// ────────────────────────────────────────────────────────────

function BalancePill({ balance, account_name }: { balance: string; account_name: string }) {
  const n = parseFloat(balance)
  const color = n > 0
    ? 'bg-green-50 text-green-700'
    : n < 0
      ? 'bg-red-50 text-red-700'
      : 'bg-gray-100 text-gray-500'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {account_name}: {n > 0 ? '+' : ''}{n.toFixed(2)} ₴
    </span>
  )
}

// ────────────────────────────────────────────────────────────
// Shared tab bar
// ────────────────────────────────────────────────────────────

function TabBar<T extends string>({
  tabs,
  active,
  onChange,
  small,
}: {
  tabs: { id: T; label: string }[]
  active: T
  onChange: (t: T) => void
  small?: boolean
}) {
  return (
    <div className={`flex overflow-x-auto border-b border-gray-100 ${small ? 'px-0 gap-0' : 'px-6'}`}>
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex-shrink-0 py-2.5 mr-5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
            active === id
              ? 'border-iris-500 text-iris-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          } ${small ? 'text-xs mr-4 py-2' : ''}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// TAB 1 — Відвідування
// ────────────────────────────────────────────────────────────

function AttendanceTab({ childId, month }: { childId: string; month: string }) {
  const [activeActivity, setActive] = useState<string | null>(null)

  const { data: rows = [], isLoading } = useQuery<ParentAttendanceRow[]>({
    queryKey: ['parent-attendance', childId, month],
    queryFn: () => parentApi.getAttendance(childId, month),
  })

  const activities = [...new Set(rows.map((r) => r.activity_name))].sort()

  useEffect(() => {
    if (activities.length > 0 && (activeActivity === null || !activities.includes(activeActivity))) {
      setActive(activities[0])
    }
  }, [activities.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps

  const visible = activeActivity ? rows.filter((r) => r.activity_name === activeActivity) : rows

  return (
    <div className="space-y-0">
      {activities.length > 1 && (
        <TabBar
          small
          tabs={activities.map((a) => ({ id: a, label: a }))}
          active={activeActivity ?? activities[0]}
          onChange={setActive}
        />
      )}

      <div className="px-6 py-4">
        {isLoading && <p className="text-sm text-gray-400 py-4 text-center">Завантаження...</p>}
        {!isLoading && visible.length === 0 && (
          <p className="text-sm text-gray-400 py-4 text-center">Відвідувань за цей місяць немає</p>
        )}
        {visible.length > 0 && (
          <div className="space-y-0 divide-y divide-gray-50">
            {visible.map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="text-gray-500 w-24 flex-shrink-0 text-xs">{formatDate(r.date)}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLOR[r.status] ?? 'bg-gray-100 text-gray-500'}`}>
                  {STATUS_LABEL[r.status] ?? r.status}
                </span>
                {r.note && (
                  <span className="text-xs text-gray-400 truncate min-w-0" title={r.note}>{r.note}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// TAB 2 — Нарахування (grouped by account → activity)
// ────────────────────────────────────────────────────────────

function AccrualActivityRow({ summary }: { summary: ActivityMonthlySummary }) {
  const [open, setOpen] = useState(false)
  const net = summary.accrual_total - summary.refund_total
  const isArchived = summary.enrollment_status === null || !summary.activity_is_active

  return (
    <div className={`border rounded-lg overflow-hidden ${isArchived ? 'border-gray-100' : 'border-gray-200'}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`font-medium truncate ${isArchived ? 'text-gray-500' : 'text-gray-800'}`}>
            {summary.activity_name}
          </span>
          {isArchived && (
            <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-400">архів</span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
          {(summary.visit_count > 0 || summary.excused_count > 0) && (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              {summary.visit_count > 0 && <span title="Відвідувань">П: {summary.visit_count}</span>}
              {summary.excused_count > 0 && <span title="Поважних пропусків">В: {summary.excused_count}</span>}
            </div>
          )}
          <span className={`font-semibold ${net < 0 ? 'text-red-500' : net > 0 ? 'text-green-600' : 'text-gray-500'}`}>
            {net !== 0 ? (net > 0 ? '+' : '−') : ''}{Math.abs(net).toFixed(2)} ₴
          </span>
          <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="divide-y divide-gray-50">
          {summary.transactions.length === 0 ? (
            <div className="px-4 py-3 text-xs text-gray-400 text-center">Транзакцій немає</div>
          ) : (
            summary.transactions.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="text-gray-400 text-xs w-24 flex-shrink-0">{formatDate(t.transaction_date)}</span>
                <span className={`text-xs flex-shrink-0 ${t.type === 'REFUND' ? 'text-green-600' : 'text-gray-500'}`}>
                  {t.type === 'REFUND' ? 'Повернення' : 'Нарахування'}
                </span>
                <span className="flex-1 min-w-0 text-xs text-gray-400 truncate">{t.note ?? ''}</span>
                <span className={`flex-shrink-0 font-medium ${t.type === 'REFUND' ? 'text-green-700' : 'text-gray-800'}`}>
                  {t.type === 'REFUND' ? '+' : ''}{parseFloat(t.amount).toFixed(2)} ₴
                </span>
              </div>
            ))
          )}
          <div className="flex justify-between items-center px-4 py-2 bg-gray-50 text-xs text-gray-500">
            <div className="flex gap-3">
              {summary.visit_count > 0 && <span>Відвідувань: {summary.visit_count}</span>}
              {summary.excused_count > 0 && <span>Поважних пропусків: {summary.excused_count}</span>}
            </div>
            <span>Разом: <span className={`font-semibold ${net < 0 ? 'text-red-500' : 'text-gray-700'}`}>
              {net !== 0 ? (net > 0 ? '+' : '−') : ''}{Math.abs(net).toFixed(2)} ₴
            </span></span>
          </div>
        </div>
      )}
    </div>
  )
}

function AccrualsTab({ childId, month }: { childId: string; month: string }) {
  const { data: accounts = [], isLoading } = useQuery<AccountMonthlySummary[]>({
    queryKey: ['parent-month-summary', childId, month],
    queryFn: () => parentApi.getMonthSummary(childId, month),
  })

  if (isLoading) return <div className="px-6 py-6 text-center text-sm text-gray-400">Завантаження...</div>
  if (accounts.length === 0) return <div className="px-6 py-6 text-center text-sm text-gray-400">Нарахувань немає</div>

  return (
    <div className="px-6 py-4 space-y-5">
      {accounts.map((acct) => {
        const totalNet = acct.activities.reduce((s, a) => s + a.accrual_total - a.refund_total, 0)
        return (
          <div key={acct.account_id} className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
              <span className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{acct.account_name}</span>
              <span className={`text-sm font-mono font-medium ${totalNet < 0 ? 'text-red-500' : totalNet > 0 ? 'text-green-600' : 'text-gray-500'}`}>
                {totalNet !== 0 ? (totalNet > 0 ? '+' : '−') : ''}{Math.abs(totalNet).toFixed(2)} ₴
              </span>
            </div>
            <div className="p-3 space-y-2">
              {acct.activities.map((s) => (
                <AccrualActivityRow key={`${acct.account_id}:${s.activity_id}`} summary={s} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// TAB 3 — Оплати (payments per account, filtered by month)
// ────────────────────────────────────────────────────────────

function PaymentsTab({
  childId,
  month,
  balances,
}: {
  childId: string
  month: string
  balances: { account_name: string; balance: string }[]
}) {
  const { from, to } = monthDateRange(month)

  const { data: ledger = [], isLoading } = useQuery<ParentLedgerRow[]>({
    queryKey: ['parent-ledger', childId, month],
    queryFn: () => parentApi.getLedger(childId, { from, to }),
  })

  const payments = ledger.filter((r) => r.type === 'PAYMENT' || r.type === 'REFUND' || r.type === 'ADJUSTMENT')
  const byAccount = groupBy(payments, (r) => r.account_name ?? 'Невідомий рахунок')
  const accounts = Object.keys(byAccount).sort()

  if (isLoading) return <div className="px-6 py-6 text-center text-sm text-gray-400">Завантаження...</div>
  if (payments.length === 0) return <div className="px-6 py-6 text-center text-sm text-gray-400">Оплат за цей місяць немає</div>

  function amountColor(type: string) {
    if (type === 'PAYMENT') return 'text-green-700 font-medium'
    if (type === 'REFUND')  return 'text-green-600'
    return 'text-gray-600'
  }

  function sign(type: string) {
    if (type === 'PAYMENT' || type === 'REFUND') return '+'
    return ''
  }

  return (
    <div className="px-6 py-4 space-y-5">
      {accounts.map((accountName) => {
        const bal = balances.find((b) => b.account_name === accountName)
        const rows = byAccount[accountName]
        return (
          <div key={accountName} className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
              <span className="text-sm font-medium text-gray-800">{accountName}</span>
              {bal && <BalancePill balance={bal.balance} account_name="Поточний баланс" />}
            </div>
            <div className="divide-y divide-gray-50">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="text-gray-400 text-xs w-24 flex-shrink-0">{formatDate(r.transaction_date)}</span>
                  <span className="text-xs text-gray-500 flex-shrink-0">{TYPE_LABEL[r.type] ?? r.type}</span>
                  {r.activity_name && (
                    <span className="text-xs text-gray-400 flex-1 min-w-0 truncate">{r.activity_name}</span>
                  )}
                  {r.note && !r.activity_name && (
                    <span className="text-xs text-gray-400 flex-1 min-w-0 truncate">{r.note}</span>
                  )}
                  <span className={`flex-shrink-0 ${amountColor(r.type)}`}>
                    {sign(r.type)}{parseFloat(r.amount).toFixed(2)} ₴
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// TAB 4 — Рахунок на оплату (segmenting prev month consumed + current subscriptions)
// ────────────────────────────────────────────────────────────

export function InvoiceTab({ child, month }: { child: { id: string; full_name: string }; month: string }) {
  const prev = prevMonth(month)

  const { data: currentSummary = [], isLoading: loadingCurrent } = useQuery<AccountMonthlySummary[]>({
    queryKey: ['parent-month-summary', child.id, month],
    queryFn: () => parentApi.getMonthSummary(child.id, month),
  })

  const { data: prevSummary = [], isLoading: loadingPrev } = useQuery<AccountMonthlySummary[]>({
    queryKey: ['parent-month-summary', child.id, prev],
    queryFn: () => parentApi.getMonthSummary(child.id, prev),
  })

  if (loadingCurrent || loadingPrev) {
    return <div className="px-6 py-6 text-center text-sm text-gray-400">Завантаження...</div>
  }

  // Get all unique account ids across both current and previous summary
  const accountMap = new Map<string, {
    account_name: string
    payment_details: string | null
    balance_start: number
    prevActivities: ActivityMonthlySummary[]
    currSubscriptions: (ActivityMonthlySummary & { display_price: number })[]
  }>()

  // Process previous month (consumed services)
  for (const acct of prevSummary) {
    // Only display activities that had positive accruals (services consumed for payment)
    const paidActivities = acct.activities.filter(a => a.accrual_total > 0)
    if (paidActivities.length > 0) {
      if (!accountMap.has(acct.account_id)) {
        accountMap.set(acct.account_id, {
          account_name: acct.account_name,
          payment_details: acct.account_payment_details,
          balance_start: 0, // Will be set or overwritten by current month summary
          prevActivities: [],
          currSubscriptions: []
        })
      }
      accountMap.get(acct.account_id)!.prevActivities.push(...paidActivities)
    }
  }

  // Process current month (subscriptions/абонементи)
  for (const acct of currentSummary) {
    // Only display monthly or smart tariff activities for the current month
    // Determine the price: expected_price from forecast or actual accrual_total
    const subscriptions = acct.activities
      .map(a => {
        const display_price = a.expected_price > 0 ? a.expected_price : a.accrual_total
        return { ...a, display_price }
      })
      .filter(a =>
        (a.activity_tariff_type === 'monthly' || a.activity_tariff_type === 'smart') &&
        a.display_price > 0
      )

    if (subscriptions.length > 0 || accountMap.has(acct.account_id)) {
      if (!accountMap.has(acct.account_id)) {
        accountMap.set(acct.account_id, {
          account_name: acct.account_name,
          payment_details: acct.account_payment_details,
          balance_start: acct.balance_start,
          prevActivities: [],
          currSubscriptions: []
        })
      } else {
        // Set the current month's starting balance
        accountMap.get(acct.account_id)!.balance_start = acct.balance_start
      }
      // Overwrite/set payment details if not set from previous month
      if (acct.account_payment_details) {
        accountMap.get(acct.account_id)!.payment_details = acct.account_payment_details
      }
      accountMap.get(acct.account_id)!.currSubscriptions.push(...subscriptions)
    }
  }

  const accounts = Array.from(accountMap.entries()).map(([id, val]) => ({
    account_id: id,
    ...val
  })).sort((a, b) => a.account_name.localeCompare(b.account_name, 'uk'))

  if (accounts.length === 0) {
    return <div className="px-6 py-6 text-center text-sm text-gray-400">Немає нарахувань чи абонементів для цього місяця</div>
  }

  const handlePrint = () => {
    window.print()
  }

  return (
    <div className="px-6 py-4 space-y-6 invoice-container">
      {/* Print action */}
      <div className="flex justify-end no-print">
        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-medium rounded-lg transition-colors border border-gray-200"
        >
          🖨️ Друкувати рахунок (Зберегти в PDF)
        </button>
      </div>

      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .invoice-container, .invoice-container * {
            visibility: visible;
          }
          .invoice-container {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 0;
            margin: 0;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {accounts.map((acct) => {
        // Calculate previous month consumed services sum
        const prevSum = acct.prevActivities.reduce((s, a) => s + (a.accrual_total - a.refund_total), 0)
        // Calculate current month subscriptions sum (using display_price)
        const currSum = acct.currSubscriptions.reduce((s, a) => s + a.display_price, 0)

        const balanceStart = acct.balance_start

        // Recommended payment formula: Current subscriptions - Starting Balance of the month (which already includes prev month consumed)
        // Positive balanceStart = advance/overpayment -> reduces recommended payment
        // Negative balanceStart = debt -> increases recommended payment
        const recommendedPayment = Math.max(0, currSum - balanceStart)

        return (
          <div key={acct.account_id} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm print:border-none print:shadow-none">
            {/* Header info */}
            <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex flex-wrap justify-between items-start gap-2 print:bg-white print:border-b-2">
              <div>
                <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold print:text-gray-500">Рахунок на оплату</span>
                <h3 className="text-base font-bold text-gray-800">{acct.account_name}</h3>
                <p className="text-xs text-gray-500 font-medium mt-1">Дитина: {child.full_name}</p>
              </div>
              <div className="text-right">
                <span className="text-xs text-gray-400 print:text-gray-500">Період рахунку</span>
                <p className="text-sm font-semibold text-gray-800">{monthLabel(month)}</p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Previous Month Consumed Services */}
              {acct.prevActivities.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Спожиті послуги за {monthLabel(prev)}
                  </h4>
                  <div className="border border-gray-100 rounded-lg overflow-hidden divide-y divide-gray-50 print:border-gray-300 print:divide-gray-300">
                    {acct.prevActivities.map((a) => {
                      const net = a.accrual_total - a.refund_total
                      return (
                        <div key={a.activity_id} className="flex justify-between items-center px-4 py-2.5 text-sm">
                          <div className="space-y-0.5">
                            <p className="font-medium text-gray-800">{a.activity_name}</p>
                            <p className="text-xs text-gray-400 print:text-gray-500">
                              Відвідування: {a.visit_count} · Пропуски (поважні): {a.excused_count}
                            </p>
                          </div>
                          <span className="font-semibold text-gray-700 font-mono">
                            {net.toFixed(2)} ₴
                          </span>
                        </div>
                      )
                    })}
                    <div className="flex justify-between items-center px-4 py-2 bg-gray-50/50 text-xs font-medium text-gray-600 print:bg-white print:border-t-2">
                      <span>Всього за спожиті послуги</span>
                      <span className="font-mono">{prevSum.toFixed(2)} ₴</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Current Month Subscriptions */}
              {acct.currSubscriptions.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Абонементи послуг на {monthLabel(month)}
                  </h4>
                  <div className="border border-gray-100 rounded-lg overflow-hidden divide-y divide-gray-50 print:border-gray-300 print:divide-gray-300">
                    {acct.currSubscriptions.map((a) => {
                      return (
                        <div key={a.activity_id} className="flex justify-between items-center px-4 py-2.5 text-sm">
                          <p className="font-medium text-gray-800">{a.activity_name}</p>
                          <span className="font-semibold text-gray-700 font-mono">
                            {a.display_price.toFixed(2)} ₴
                          </span>
                        </div>
                      )
                    })}
                    <div className="flex justify-between items-center px-4 py-2 bg-gray-50/50 text-xs font-medium text-gray-600 print:bg-white print:border-t-2">
                      <span>Всього за абонементи</span>
                      <span className="font-mono">{currSum.toFixed(2)} ₴</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Final Totals Table */}
              <div className="pt-2 border-t border-gray-100 space-y-1.5 print:border-gray-300">
                <div className="flex justify-between text-sm text-gray-600 print:text-gray-800">
                  <span>Сума за абонементи:</span>
                  <span className="font-medium font-mono">{currSum.toFixed(2)} ₴</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600 print:text-gray-800">
                  <span>
                    Баланс на початок періоду ({monthLabel(month)}):
                    {balanceStart > 0 && <span className="ml-1.5 text-xs text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full font-medium print:border print:border-green-300 print:bg-white">аванс</span>}
                    {balanceStart < 0 && <span className="ml-1.5 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full font-medium print:border print:border-red-300 print:bg-white">борг</span>}
                  </span>
                  <span className={`font-medium font-mono ${balanceStart > 0 ? 'text-green-700' : balanceStart < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                    {balanceStart > 0 ? '+' : ''}{balanceStart.toFixed(2)} ₴
                  </span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-dashed border-gray-200 print:border-gray-300">
                  <span className="text-base font-bold text-gray-800">Рекомендовано до сплати:</span>
                  <span className="text-xl font-extrabold text-iris-600 tabular-nums font-mono print:text-black">
                    {recommendedPayment.toFixed(2)} ₴
                  </span>
                </div>
              </div>

              {/* Requisites Block */}
              {acct.payment_details && (
                <div className="mt-4 p-4 bg-iris-50/30 rounded-xl border border-iris-100/50 space-y-1.5 print:bg-white print:border-gray-300">
                  <h5 className="text-xs font-semibold text-iris-800 uppercase tracking-wide print:text-gray-800">
                    Реквізити для оплати
                  </h5>
                  <p className="text-xs text-gray-600 font-mono whitespace-pre-wrap leading-relaxed print:text-black print:text-sm">
                    {acct.payment_details}
                  </p>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Child panel — month nav shared across all tabs
// ────────────────────────────────────────────────────────────

type MainTab = 'attendance' | 'accruals' | 'payments' | 'invoice'

const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: 'attendance', label: 'Відвідування' },
  { id: 'accruals',   label: 'Нарахування' },
  { id: 'payments',   label: 'Оплати' },
  { id: 'invoice',    label: 'Рахунок на оплату' },
]

function ChildPanel({ child }: { child: ParentChild }) {
  const [tab, setTab]     = useState<MainTab>('attendance')
  const [month, setMonth] = useState(currentMonth())
  const canGoNext = month < currentMonth()

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-gray-900">{child.full_name}</h2>
            {child.birth_date && (
              <p className="text-xs text-gray-400 mt-0.5">{formatDate(child.birth_date)}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            {child.balances.length === 0 && (
              <span className="text-xs text-gray-400">Балансів немає</span>
            )}
            {child.balances.map((b) => (
              <BalancePill key={b.account_name} balance={b.balance} account_name={b.account_name} />
            ))}
          </div>
        </div>
      </div>

      {/* Month navigation — shared for all tabs */}
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-gray-100 bg-gray-50/60 no-print">
        <button
          onClick={() => setMonth(prevMonth(month))}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 text-lg leading-none"
        >
          ‹
        </button>
        <span className="text-sm font-medium text-gray-700 min-w-[148px] text-center">
          {monthLabel(month)}
        </span>
        <button
          onClick={() => setMonth(nextMonth(month))}
          disabled={!canGoNext}
          className="p-1 rounded hover:bg-gray-200 text-gray-500 disabled:opacity-30 text-lg leading-none"
        >
          ›
        </button>
      </div>

      {/* Main tabs */}
      <TabBar tabs={MAIN_TABS} active={tab} onChange={setTab} />

      {/* Tab content */}
      {tab === 'attendance' && <AttendanceTab childId={child.id} month={month} />}
      {tab === 'accruals'   && <AccrualsTab   childId={child.id} month={month} />}
      {tab === 'payments'   && <PaymentsTab   childId={child.id} month={month} balances={child.balances} />}
      {tab === 'invoice'    && <InvoiceTab    child={child} month={month} />}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Main page
// ────────────────────────────────────────────────────────────

export function CabinetPage() {
  const { data: children = [], isLoading } = useQuery<ParentChild[]>({
    queryKey: ['parent-children'],
    queryFn: parentApi.getChildren,
  })

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
  }

  if (children.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-500 text-sm">Дані не знайдені. Зверніться до адміністратора.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Мій кабінет</h1>
      {children.map((child) => (
        <ChildPanel key={child.id} child={child} />
      ))}
    </div>
  )
}
