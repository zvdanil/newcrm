import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '../../api/reports.api'
import type { ARAnalyticsFilters, ARAnalyticsRow } from '../../api/reports.api'
import { accountsApi } from '../../api/accounts.api'

// ─── helpers ────────────────────────────────────────────────────────────────

function currentYM() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtMoney(n: number) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtMonth(ymd: string) {
  // 'YYYY-MM-01' → 'Місяць РРРР'
  const d = new Date(ymd)
  return d.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })
}

function balanceClass(n: number) {
  if (n < -0.005) return 'text-red-600'
  if (n >  0.005) return 'text-emerald-600'
  return 'text-gray-500'
}

const EMPTY_FILTERS: ARAnalyticsFilters = {
  from_month:   currentYM(),
  to_month:     currentYM(),
  account_ids:  [],
  balance_mode: 'all',
  is_active:    'true',
}

// ─── sub-components ─────────────────────────────────────────────────────────

function MoneyCell({ value, className = '' }: { value: number; className?: string }) {
  return (
    <td className={`px-3 py-2 text-right tabular-nums text-sm ${balanceClass(value)} ${className}`}>
      {fmtMoney(value)}
    </td>
  )
}

interface RowProps {
  row: ARAnalyticsRow
  isExpanded: boolean
  onToggle: () => void
}

function AnalyticsRow({ row, isExpanded, onToggle }: RowProps) {
  return (
    <>
      {/* Summary row */}
      <tr
        className="hover:bg-iris-50 cursor-pointer border-b border-gray-100 transition-colors"
        onClick={onToggle}
      >
        <td className="pl-3 pr-1 py-2 w-6 text-gray-400 text-xs select-none">
          {isExpanded ? '▼' : '▶'}
        </td>
        <td className="px-3 py-2 text-sm font-medium text-gray-900">
          {row.child_name}
          {!row.is_active && (
            <span className="ml-1.5 text-xs text-gray-400">(архів)</span>
          )}
        </td>
        <td className="px-3 py-2 text-sm text-gray-500">{row.family_name ?? '—'}</td>
        <td className="px-3 py-2 text-sm text-gray-500">{row.account_name}</td>
        <MoneyCell value={row.balance_start} />
        <MoneyCell value={row.accrued_in_period} className="text-gray-700" />
        <MoneyCell value={row.paid_in_period} className="text-gray-700" />
        <MoneyCell value={row.balance_end} />
        <MoneyCell value={row.current_balance} />
      </tr>

      {/* Monthly breakdown rows */}
      {isExpanded && row.months.map(m => (
        <tr key={m.month} className="bg-iris-50/60 border-b border-iris-100">
          <td />
          <td colSpan={3} className="pl-8 pr-3 py-1.5 text-xs text-iris-700 italic">
            {fmtMonth(m.month)}
          </td>
          <MoneyCell value={m.balance_start_month} className="text-xs" />
          <td className="px-3 py-1.5 text-right tabular-nums text-xs text-gray-600">
            {fmtMoney(m.accrued_in_month)}
          </td>
          <td className="px-3 py-1.5 text-right tabular-nums text-xs text-gray-600">
            {fmtMoney(m.paid_in_month)}
          </td>
          <MoneyCell value={m.balance_end_month} className="text-xs" />
          <td />
        </tr>
      ))}
    </>
  )
}

// ─── main component ─────────────────────────────────────────────────────────

export function ARAnalyticsReport() {
  const [filters, setFilters]     = useState<ARAnalyticsFilters>(EMPTY_FILTERS)
  const [committed, setCommitted] = useState<ARAnalyticsFilters | null>(null)
  const [expanded, setExpanded]   = useState<Set<string>>(new Set())

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn:  accountsApi.list,
    staleTime: 5 * 60 * 1000,
  })

  const { data, isFetching, isError } = useQuery({
    queryKey: ['report-ar-analytics', committed],
    queryFn:  () => reportsApi.getARAnalytics(committed!),
    enabled:  !!committed,
    staleTime: 0,
  })

  const handleGenerate = () => {
    setCommitted({ ...filters })
    setExpanded(new Set())
  }

  const handleReset = () => {
    setFilters(EMPTY_FILTERS)
    setCommitted(null)
    setExpanded(new Set())
  }

  const toggleExpand = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleExpandAll = () => {
    if (!data) return
    const allKeys = data.rows.map(r => `${r.child_id}:${r.account_id}`)
    if (expanded.size === allKeys.length) {
      setExpanded(new Set())
    } else {
      setExpanded(new Set(allKeys))
    }
  }

  const toggleAccount = (id: string) =>
    setFilters(f => ({
      ...f,
      account_ids: f.account_ids.includes(id)
        ? f.account_ids.filter(x => x !== id)
        : [...f.account_ids, id],
    }))

  const rows = data?.rows ?? []
  const totals = data?.totals
  const allExpanded = rows.length > 0 && expanded.size === rows.length

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">

      {/* Title */}
      <div>
        <h2 className="font-medium text-gray-900">Аналітика дебіторської заборгованості</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Нарахування, оплати та баланс по кожному клієнту з помісячною деталізацією
        </p>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">

        {/* Period */}
        <div className="space-y-2 col-span-2">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Період</label>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={filters.from_month}
              onChange={e => setFilters(f => ({ ...f, from_month: e.target.value }))}
              className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-400"
            />
            <span className="text-gray-400 text-sm">—</span>
            <input
              type="month"
              value={filters.to_month}
              min={filters.from_month}
              onChange={e => setFilters(f => ({ ...f, to_month: e.target.value }))}
              className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-400"
            />
          </div>
        </div>

        {/* Balance mode */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Показати</label>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
            {([
              { value: 'all',      label: 'Всі'     },
              { value: 'debtors',  label: 'Борг'    },
              { value: 'advances', label: 'Аванс'   },
            ] as const).map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilters(f => ({ ...f, balance_mode: opt.value }))}
                className={`flex-1 py-1.5 transition-colors ${
                  filters.balance_mode === opt.value
                    ? 'bg-iris-500 text-white font-medium'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* is_active */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Статус дитини</label>
          <select
            value={filters.is_active}
            onChange={e => setFilters(f => ({ ...f, is_active: e.target.value as ARAnalyticsFilters['is_active'] }))}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-400"
          >
            <option value="">Всі</option>
            <option value="true">Активні</option>
            <option value="false">Архівні</option>
          </select>
        </div>

        {/* Accounts */}
        {accounts.length > 1 && (
          <div className="space-y-2 col-span-2">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Рахунки</label>
            <div className="flex flex-wrap gap-2">
              {accounts.map(a => (
                <button
                  key={a.id}
                  onClick={() => toggleAccount(a.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    filters.account_ids.includes(a.id)
                      ? 'bg-iris-500 text-white border-iris-500'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-iris-400'
                  }`}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleGenerate}
          disabled={isFetching || !filters.from_month || !filters.to_month}
          className="px-5 py-2 bg-iris-600 text-white text-sm font-medium rounded-lg hover:bg-iris-700 disabled:opacity-50 transition-colors"
        >
          {isFetching ? 'Завантаження…' : 'Згенерувати'}
        </button>
        {committed && (
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Скинути
          </button>
        )}
      </div>

      {/* Error */}
      {isError && (
        <p className="text-sm text-red-600">Помилка завантаження. Спробуйте ще раз.</p>
      )}

      {/* Table */}
      {data && rows.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">Дані відсутні для обраних фільтрів.</p>
      )}

      {data && rows.length > 0 && (
        <div className="overflow-x-auto -mx-6">
          <table className="w-full min-w-[900px] text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-y border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
                <th className="pl-3 pr-1 py-2 w-6">
                  <button
                    onClick={toggleExpandAll}
                    className="text-gray-400 hover:text-gray-600"
                    title={allExpanded ? 'Згорнути всі' : 'Розгорнути всі'}
                  >
                    {allExpanded ? '▼' : '▶'}
                  </button>
                </th>
                <th className="px-3 py-2">Ребёнок</th>
                <th className="px-3 py-2">Сімʼя</th>
                <th className="px-3 py-2">Рахунок</th>
                <th className="px-3 py-2 text-right">Баланс на початок</th>
                <th className="px-3 py-2 text-right">Нараховано за період</th>
                <th className="px-3 py-2 text-right">Сплачено за період</th>
                <th className="px-3 py-2 text-right">Баланс на кінець</th>
                <th className="px-3 py-2 text-right">Поточний баланс</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const key = `${row.child_id}:${row.account_id}`
                return (
                  <AnalyticsRow
                    key={key}
                    row={row}
                    isExpanded={expanded.has(key)}
                    onToggle={() => toggleExpand(key)}
                  />
                )
              })}
            </tbody>

            {/* Totals footer */}
            {totals && (
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-sm">
                  <td />
                  <td colSpan={3} className="px-3 py-2.5 text-gray-700">
                    Разом ({rows.length} {rows.length === 1 ? 'дитина' : rows.length < 5 ? 'дитини' : 'дітей'})
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${balanceClass(totals.balance_start)}`}>
                    {fmtMoney(totals.balance_start)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                    {fmtMoney(totals.accrued_in_period)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                    {fmtMoney(totals.paid_in_period)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${balanceClass(totals.balance_end)}`}>
                    {fmtMoney(totals.balance_end)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${balanceClass(totals.current_balance)}`}>
                    {fmtMoney(totals.current_balance)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Placeholder before first generate */}
      {!data && !isFetching && (
        <div className="text-center py-12 text-gray-400 text-sm">
          Оберіть період і натисніть «Згенерувати»
        </div>
      )}

    </div>
  )
}
