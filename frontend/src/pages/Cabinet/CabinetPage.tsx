import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { parentApi } from '../../api/parent.api'
import type { ParentChild, ParentLedgerRow, ParentAttendanceRow } from '../../api/parent.api'

const MONTH_LABELS: Record<string, string> = {
  '01': 'Січень', '02': 'Лютий', '03': 'Березень', '04': 'Квітень',
  '05': 'Травень', '06': 'Червень', '07': 'Липень', '08': 'Серпень',
  '09': 'Вересень', '10': 'Жовтень', '11': 'Листопад', '12': 'Грудень',
}

const TYPE_LABEL: Record<string, string> = {
  ACCRUAL:    'Нарахування',
  PAYMENT:    'Оплата',
  REFUND:     'Повернення',
  ADJUSTMENT: 'Корекція',
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

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('uk-UA')
}

function fmtAmount(amount: string, type: string) {
  const n = parseFloat(amount)
  if (type === 'PAYMENT' || type === 'REFUND') return `+${n.toFixed(2)} ₴`
  if (type === 'ACCRUAL') return `−${n.toFixed(2)} ₴`
  return `${n > 0 ? '+' : ''}${n.toFixed(2)} ₴`
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

function monthLabel(month: string) {
  const [y, m] = month.split('-')
  return `${MONTH_LABELS[m] ?? m} ${y}`
}

// ────────────────────────────────────────────────────────────
// Child balance pill
// ────────────────────────────────────────────────────────────

function BalancePill({ balance, account_name }: { balance: string; account_name: string }) {
  const n = parseFloat(balance)
  const color = n > 0 ? 'bg-green-50 text-green-700' : n < 0 ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {account_name}: {n > 0 ? '+' : ''}{n.toFixed(2)} ₴
    </span>
  )
}

// ────────────────────────────────────────────────────────────
// Ledger tab for one child
// ────────────────────────────────────────────────────────────

function LedgerTab({ childId }: { childId: string }) {
  const { data: rows = [], isLoading } = useQuery<ParentLedgerRow[]>({
    queryKey: ['parent-ledger', childId],
    queryFn: () => parentApi.getLedger(childId),
  })

  if (isLoading) return <div className="py-6 text-center text-sm text-gray-400">Завантаження...</div>
  if (rows.length === 0) return <div className="py-6 text-center text-sm text-gray-400">Операцій немає</div>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-xs text-gray-500">
            <th className="py-2 text-left font-medium pr-3">Дата</th>
            <th className="py-2 text-left font-medium pr-3">Тип</th>
            <th className="py-2 text-left font-medium pr-3">Активність</th>
            <th className="py-2 text-left font-medium pr-3">Рахунок</th>
            <th className="py-2 text-right font-medium">Сума</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const amtColor = (r.type === 'PAYMENT' || r.type === 'REFUND')
              ? 'text-green-700 font-medium'
              : r.type === 'ACCRUAL'
                ? 'text-red-700'
                : 'text-gray-700'
            return (
              <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{formatDate(r.transaction_date)}</td>
                <td className="py-2 pr-3">
                  <span className="text-xs text-gray-600">{TYPE_LABEL[r.type] ?? r.type}</span>
                </td>
                <td className="py-2 pr-3 text-gray-600">{r.activity_name ?? '—'}</td>
                <td className="py-2 pr-3 text-gray-500 text-xs">{r.account_name ?? '—'}</td>
                <td className={`py-2 text-right whitespace-nowrap ${amtColor}`}>
                  {fmtAmount(r.amount, r.type)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Attendance tab for one child
// ────────────────────────────────────────────────────────────

function AttendanceTab({ childId }: { childId: string }) {
  const [month, setMonth] = useState(currentMonth())
  const canGoNext = month < currentMonth()

  const { data: rows = [], isLoading } = useQuery<ParentAttendanceRow[]>({
    queryKey: ['parent-attendance', childId, month],
    queryFn: () => parentApi.getAttendance(childId, month),
  })

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setMonth(prevMonth(month))}
          className="p-1 rounded hover:bg-gray-100 text-gray-500"
        >
          ‹
        </button>
        <span className="text-sm font-medium text-gray-800 min-w-[130px] text-center">{monthLabel(month)}</span>
        <button
          onClick={() => setMonth(nextMonth(month))}
          disabled={!canGoNext}
          className="p-1 rounded hover:bg-gray-100 text-gray-500 disabled:opacity-30"
        >
          ›
        </button>
      </div>

      {isLoading && <div className="py-6 text-center text-sm text-gray-400">Завантаження...</div>}
      {!isLoading && rows.length === 0 && (
        <div className="py-6 text-center text-sm text-gray-400">Відвідувань за цей місяць немає</div>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 py-2 border-b border-gray-50 text-sm">
              <span className="text-gray-500 w-24 flex-shrink-0">{formatDate(r.date)}</span>
              <span className="text-gray-600 flex-1 min-w-0 truncate">{r.activity_name}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLOR[r.status] ?? 'bg-gray-100 text-gray-500'}`}>
                {STATUS_LABEL[r.status] ?? r.status}
              </span>
              {r.note && <span className="text-xs text-gray-400 flex-shrink-0 max-w-[120px] truncate" title={r.note}>{r.note}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Child card with tabs
// ────────────────────────────────────────────────────────────

type Tab = 'attendance' | 'ledger'

function ChildPanel({ child }: { child: ParentChild }) {
  const [tab, setTab] = useState<Tab>('attendance')

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
            {child.balances.map((b) => (
              <BalancePill key={b.account_name} balance={b.balance} account_name={b.account_name} />
            ))}
            {child.balances.length === 0 && (
              <span className="text-xs text-gray-400">Балансів немає</span>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 px-6">
        {(['attendance', 'ledger'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`py-2.5 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-iris-500 text-iris-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'attendance' ? 'Відвідування' : 'Оплати та нарахування'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="px-6 py-4">
        {tab === 'attendance' && <AttendanceTab childId={child.id} />}
        {tab === 'ledger'     && <LedgerTab     childId={child.id} />}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────
// Main cabinet page
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
