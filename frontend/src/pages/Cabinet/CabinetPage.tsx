import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parentApi } from '../../api/parent.api'
import type { ParentChild, ParentLedgerRow, ParentAttendanceRow } from '../../api/parent.api'

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('uk-UA')
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7)
}

function prevMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonth(month: string) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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
  absent_unexcused: 'Відсутній',
  special:          'Особливий',
}

const STATUS_COLOR: Record<string, string> = {
  present:          'text-green-700 bg-green-50',
  absent_excused:   'text-yellow-700 bg-yellow-50',
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

function AttendanceTab({ childId }: { childId: string }) {
  const [month, setMonth]             = useState(currentMonth())
  const [activeActivity, setActive]   = useState<string | null>(null)
  const canGoNext = month < currentMonth()

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
      {/* Month nav */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-50">
        <button onClick={() => setMonth(prevMonth(month))} className="p-1 rounded hover:bg-gray-100 text-gray-500 text-lg leading-none">‹</button>
        <span className="text-sm font-medium text-gray-800 min-w-[140px] text-center">{monthLabel(month)}</span>
        <button onClick={() => setMonth(nextMonth(month))} disabled={!canGoNext}
          className="p-1 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-30 text-lg leading-none">›</button>
      </div>

      {/* Activity sub-tabs */}
      {activities.length > 1 && (
        <TabBar
          small
          tabs={activities.map((a) => ({ id: a, label: a }))}
          active={activeActivity ?? activities[0]}
          onChange={setActive}
        />
      )}

      {/* Content */}
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
// TAB 2 — Нарахування (accrual cards per activity)
// ────────────────────────────────────────────────────────────

function AccrualCard({ activity, rows }: { activity: string; rows: ParentLedgerRow[] }) {
  const [open, setOpen] = useState(false)
  const total = rows.reduce((s, r) => s + parseFloat(r.amount), 0)

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-sm"
      >
        <span className="font-medium text-gray-800">{activity}</span>
        <div className="flex items-center gap-3">
          <span className="text-gray-700 font-semibold">{total.toFixed(2)} ₴</span>
          <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="divide-y divide-gray-50">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="text-gray-400 text-xs w-24 flex-shrink-0">{formatDate(r.transaction_date)}</span>
              {r.billing_month && (
                <span className="text-xs text-gray-400 flex-shrink-0">
                  {monthLabel(r.billing_month.slice(0, 7))}
                </span>
              )}
              <span className="flex-1 min-w-0 text-xs text-gray-500 truncate">{r.note ?? ''}</span>
              <span className="text-gray-800 font-medium flex-shrink-0">{parseFloat(r.amount).toFixed(2)} ₴</span>
            </div>
          ))}
          <div className="flex justify-end px-4 py-2 bg-gray-50">
            <span className="text-xs text-gray-500">Разом: <span className="font-semibold text-gray-700">{total.toFixed(2)} ₴</span></span>
          </div>
        </div>
      )}
    </div>
  )
}

function AccrualsTab({ childId }: { childId: string }) {
  const { data: ledger = [], isLoading } = useQuery<ParentLedgerRow[]>({
    queryKey: ['parent-ledger', childId],
    queryFn: () => parentApi.getLedger(childId),
  })

  const accruals = ledger.filter((r) => r.type === 'ACCRUAL')
  const byActivity = groupBy(accruals, (r) => r.activity_name ?? 'Без активності')
  const activities = Object.keys(byActivity).sort()

  if (isLoading) return <div className="px-6 py-6 text-center text-sm text-gray-400">Завантаження...</div>
  if (accruals.length === 0) return <div className="px-6 py-6 text-center text-sm text-gray-400">Нарахувань немає</div>

  return (
    <div className="px-6 py-4 space-y-2">
      {activities.map((activity) => (
        <AccrualCard key={activity} activity={activity} rows={byActivity[activity]} />
      ))}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// TAB 3 — Оплати (payments per account)
// ────────────────────────────────────────────────────────────

function PaymentsTab({
  childId,
  balances,
}: {
  childId: string
  balances: { account_name: string; balance: string }[]
}) {
  const { data: ledger = [], isLoading } = useQuery<ParentLedgerRow[]>({
    queryKey: ['parent-ledger', childId],
    queryFn: () => parentApi.getLedger(childId),
  })

  const payments = ledger.filter((r) => r.type === 'PAYMENT' || r.type === 'REFUND' || r.type === 'ADJUSTMENT')
  const byAccount = groupBy(payments, (r) => r.account_name ?? 'Невідомий рахунок')
  const accounts = Object.keys(byAccount).sort()

  if (isLoading) return <div className="px-6 py-6 text-center text-sm text-gray-400">Завантаження...</div>
  if (payments.length === 0) return <div className="px-6 py-6 text-center text-sm text-gray-400">Оплат немає</div>

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
            {/* Account header */}
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
              <span className="text-sm font-medium text-gray-800">{accountName}</span>
              {bal && <BalancePill balance={bal.balance} account_name="Баланс" />}
            </div>
            {/* Rows */}
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
// Child panel with 3 tabs
// ────────────────────────────────────────────────────────────

type MainTab = 'attendance' | 'accruals' | 'payments'

const MAIN_TABS: { id: MainTab; label: string }[] = [
  { id: 'attendance', label: 'Відвідування' },
  { id: 'accruals',   label: 'Нарахування' },
  { id: 'payments',   label: 'Оплати' },
]

function ChildPanel({ child }: { child: ParentChild }) {
  const [tab, setTab] = useState<MainTab>('attendance')

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

      {/* Main tabs */}
      <TabBar tabs={MAIN_TABS} active={tab} onChange={setTab} />

      {/* Tab content */}
      {tab === 'attendance' && <AttendanceTab childId={child.id} />}
      {tab === 'accruals'   && <AccrualsTab   childId={child.id} />}
      {tab === 'payments'   && <PaymentsTab   childId={child.id} balances={child.balances} />}
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
