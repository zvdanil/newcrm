import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi, type PnLRow } from '../../api/reports.api'

// ─── helpers ────────────────────────────────────────────────────────────────

function currentYM() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function sixMonthsAgo() {
  const d = new Date()
  d.setMonth(d.getMonth() - 5)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtMoney(n: number) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function monthLabel(isoDate: string) {
  // isoDate is 'YYYY-MM-01'
  const d = new Date(isoDate + 'T00:00:00')
  return d.toLocaleDateString('uk-UA', { month: 'short', year: 'numeric' })
}

// ─── row definitions ─────────────────────────────────────────────────────────

interface MetricDef {
  key: keyof PnLRow
  label: string
  hint: string
  colorFn?: (v: number) => string
  bold?: boolean
  separator?: boolean  // draw a top border before this row
}

const METRICS: MetricDef[] = [
  {
    key: 'expected_revenue',
    label: 'Очікуваний дохід',
    hint: 'Сума всіх нарахувань клієнтам (ACCRUAL)',
    colorFn: () => 'text-gray-900',
  },
  {
    key: 'accrued_expense',
    label: 'Нарахований витрат',
    hint: 'Нараховані витрати + нарахована зарплата (метод нарахувань)',
    colorFn: (v) => v > 0 ? 'text-orange-700' : 'text-gray-400',
  },
  {
    key: 'real_income',
    label: 'Реальні надходження',
    hint: 'Фактичні оплати від клієнтів (PAYMENT)',
    colorFn: () => 'text-gray-900',
    separator: true,
  },
  {
    key: 'expense_turnover',
    label: 'Оборот витрат',
    hint: 'Фактично сплачені витрати + виплачена зарплата',
    colorFn: (v) => v > 0 ? 'text-orange-700' : 'text-gray-400',
  },
  {
    key: 'expense_turnover_no_div',
    label: 'Оборот без дивідендів',
    hint: 'Оборот витрат, виключаючи виплати з міткою «дивіденди»',
    colorFn: (v) => v > 0 ? 'text-orange-600' : 'text-gray-400',
  },
  {
    key: 'balance_no_div',
    label: 'Баланс без дивідендів',
    hint: 'Реальні надходження − Оборот без дивідендів',
    colorFn: (v) => v > 0 ? 'text-green-700' : v < 0 ? 'text-red-600' : 'text-gray-500',
    bold: true,
    separator: true,
  },
  {
    key: 'account_balance',
    label: 'Залишок на рахунках',
    hint: 'Накопичена фактична ліквідність (всі надходження − всі виплати з початку)',
    colorFn: (v) => v >= 0 ? 'text-iris-700' : 'text-red-600',
    bold: true,
  },
]

// ─── component ───────────────────────────────────────────────────────────────

export function PnLReport() {
  const [fromMonth, setFromMonth] = useState(sixMonthsAgo())
  const [toMonth, setToMonth]     = useState(currentYM())
  const [committed, setCommitted] = useState<{ from: string; to: string } | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const { data, isFetching, isError } = useQuery({
    queryKey: ['report-pnl', committed],
    queryFn: () => reportsApi.getPnL(committed!.from, committed!.to),
    enabled: !!committed,
    staleTime: 0,
  })

  const rows = data?.rows ?? []

  const handleGenerate = () => {
    setCommitted({ from: fromMonth, to: toMonth })
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  const handleExportCSV = () => {
    const header = ['Показник', ...rows.map(r => monthLabel(r.month))]
    const csvRows = METRICS.map(m => [
      m.label,
      ...rows.map(r => (r[m.key] as number).toFixed(2).replace('.', ',')),
    ])
    const csv = [header, ...csvRows].map(row => row.map(v => `"${v}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `pnl-${fromMonth}-${toMonth}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <h2 className="font-medium text-gray-900">PnL-звіт</h2>
          <p className="text-xs text-gray-400 mt-0.5">7 фінансових показників по місяцях</p>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Період</label>
            <div className="flex items-center gap-2">
              <input
                type="month"
                value={fromMonth}
                onChange={e => setFromMonth(e.target.value)}
                className="rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
              />
              <span className="text-gray-400">—</span>
              <input
                type="month"
                value={toMonth}
                onChange={e => setToMonth(e.target.value)}
                className="rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
          <button
            onClick={handleGenerate}
            disabled={isFetching}
            className="px-4 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isFetching ? 'Формується...' : 'Сформувати звіт'}
          </button>
          {rows.length > 0 && (
            <button
              onClick={handleExportCSV}
              className="ml-auto text-sm text-iris-600 hover:text-iris-700 font-medium"
            >
              ↓ Експорт CSV
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      {committed && (
        <div ref={tableRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isError ? (
            <p className="p-6 text-sm text-red-600">Помилка при формуванні звіту. Спробуйте ще раз.</p>
          ) : isFetching ? (
            <p className="p-6 text-sm text-gray-400">Завантаження...</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-gray-400">Немає даних за обраний період.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-sm border-collapse w-max min-w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {/* Sticky label column */}
                    <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap min-w-[220px] border-r border-gray-200">
                      Показник
                    </th>
                    {rows.map(r => (
                      <th key={r.month} className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap min-w-[120px]">
                        {monthLabel(r.month)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map((metric, idx) => (
                    <tr
                      key={metric.key}
                      className={`
                        ${metric.separator ? 'border-t-2 border-gray-200' : 'border-t border-gray-100'}
                        ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}
                        hover:bg-iris-50/30 transition-colors
                      `}
                    >
                      {/* Sticky label */}
                      <td className={`sticky left-0 z-10 px-4 py-2.5 border-r border-gray-200 whitespace-nowrap
                        ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}
                        hover:bg-iris-50/30`}
                      >
                        <div className={`${metric.bold ? 'font-semibold text-gray-900' : 'font-medium text-gray-700'}`}>
                          {metric.label}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">{metric.hint}</div>
                      </td>
                      {/* Values */}
                      {rows.map(r => {
                        const val = r[metric.key] as number
                        const colorClass = metric.colorFn ? metric.colorFn(val) : 'text-gray-700'
                        return (
                          <td key={r.month} className="px-4 py-2.5 text-right font-mono">
                            <span className={`${colorClass} ${metric.bold ? 'font-semibold' : ''}`}>
                              {fmtMoney(val)}
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
