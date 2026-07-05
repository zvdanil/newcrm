import React, { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '../../api/reports.api'

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
  if (n === 0) return '0'
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function monthLabel(isoDate: string) {
  const d = new Date(isoDate + 'T00:00:00')
  return d.toLocaleDateString('uk-UA', { month: 'short', year: 'numeric' })
}

export function PnL2Report() {
  const [fromMonth, setFromMonth] = useState(sixMonthsAgo())
  const [toMonth, setToMonth]     = useState(currentYM())
  const [committed, setCommitted] = useState<{ from: string; to: string } | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const { data, isFetching, isError } = useQuery({
    queryKey: ['report-pnl2', committed],
    queryFn: () => reportsApi.getPnL2(committed!.from, committed!.to),
    enabled: !!committed,
    staleTime: 0,
  })

  const months = data?.months ?? []
  const accounts = data?.accounts ?? []
  const rows = data?.rows ?? []

  const handleGenerate = () => {
    setCommitted({ from: fromMonth, to: toMonth })
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  const handleExportCSV = () => {
    // Header rows
    const headerLine1 = ['Показник']
    const headerLine2 = ['']

    months.forEach(m => {
      headerLine1.push(monthLabel(m), '')
      headerLine2.push('Нарах.', 'Сплат.')
    })

    const csvData: string[][] = [headerLine1, headerLine2]

    // Helper: add metric row
    const addRow = (label: string, getVals: (r: typeof rows[0]) => { accrued: number | string; paid: number | string }) => {
      const line = [label]
      rows.forEach(r => {
        const { accrued, paid } = getVals(r)
        line.push(typeof accrued === 'number' ? accrued.toFixed(2).replace('.', ',') : accrued)
        line.push(typeof paid === 'number' ? paid.toFixed(2).replace('.', ',') : paid)
      })
      csvData.push(line)
    }

    // 1. Accounts
    accounts.forEach(a => {
      addRow(`Доходи: ${a.name}`, r => {
        const val = r.accounts.find(ac => ac.account_id === a.id)
        return { accrued: val?.accrued ?? 0, paid: val?.paid ?? 0 }
      })
    })

    // Total income
    addRow('Всього доходів', r => {
      const accrued = r.accounts.reduce((s, ac) => s + ac.accrued, 0)
      const paid = r.accounts.reduce((s, ac) => s + ac.paid, 0)
      return { accrued, paid }
    })

    // 2. Expenses
    addRow('Витрати: Зарплата', r => ({ accrued: r.salary.accrued, paid: r.salary.paid }))
    addRow('Витрати: Суммарные расходы', r => ({ accrued: r.expenses.accrued, paid: r.expenses.paid }))
    
    // Total expenses
    addRow('Всього операційних витрат', r => {
      const accrued = r.salary.accrued + r.expenses.accrued
      const paid = r.salary.paid + r.expenses.paid
      return { accrued, paid }
    })

    // Operating profit
    addRow('Операційний прибуток (Баланс)', r => {
      const revAccrued = r.accounts.reduce((s, ac) => s + ac.accrued, 0)
      const revPaid = r.accounts.reduce((s, ac) => s + ac.paid, 0)
      const expAccrued = r.salary.accrued + r.expenses.accrued
      const expPaid = r.salary.paid + r.expenses.paid
      return { accrued: revAccrued - expAccrued, paid: revPaid - expPaid }
    })

    // Distributions
    addRow('Вивід коштів', r => ({ accrued: '—', paid: r.withdrawals.paid }))
    addRow('Дивіденди', r => ({ accrued: '—', paid: r.dividends.paid }))

    // Net flow
    addRow('Чистий грошовий потік', r => {
      const revAccrued = r.accounts.reduce((s, ac) => s + ac.accrued, 0)
      const revPaid = r.accounts.reduce((s, ac) => s + ac.paid, 0)
      const expAccrued = r.salary.accrued + r.expenses.accrued
      const expPaid = r.salary.paid + r.expenses.paid
      const opProfitAccrued = revAccrued - expAccrued
      const netPaidFlow = revPaid - expPaid - r.withdrawals.paid - r.dividends.paid
      return { accrued: opProfitAccrued, paid: netPaidFlow }
    })

    const csv = csvData.map(row => row.map(v => `"${v}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `pnl2-${fromMonth}-${toMonth}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <h2 className="font-medium text-gray-900">PnL 2 звіт</h2>
          <p className="text-xs text-gray-400 mt-0.5">Порівняльний аналіз доходів та витрат (Нарахування vs Сплати)</p>
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
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th rowSpan={2} className="sticky left-0 z-20 bg-gray-50 px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-r border-gray-200 min-w-[240px]">
                      Показник
                    </th>
                    {months.map(m => (
                      <th key={m} colSpan={2} className="px-4 py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide border-r border-gray-200 min-w-[180px]">
                        {monthLabel(m)}
                      </th>
                    ))}
                  </tr>
                  <tr className="bg-gray-50 border-b border-gray-200 text-[10px] font-bold text-gray-400">
                    {months.map(m => (
                      <React.Fragment key={m}>
                        <th className="px-2 py-1.5 text-right border-r border-gray-100 uppercase tracking-wide">Нарах.</th>
                        <th className="px-2 py-1.5 text-right border-r border-gray-200 uppercase tracking-wide">Сплат.</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {/* Category Header: Income */}
                  <tr className="bg-gray-50/70 font-semibold text-gray-900 border-t-2 border-gray-200">
                    <td className="sticky left-0 z-10 bg-gray-50/70 px-4 py-2 border-r border-gray-200">
                      НАДХОДЖЕННЯ ЗА ПОСЛУГИ (ДОХОДИ)
                    </td>
                    {months.map(m => (
                      <React.Fragment key={m}>
                        <td className="border-r border-gray-100" />
                        <td className="border-r border-gray-200" />
                      </React.Fragment>
                    ))}
                  </tr>

                  {/* Individual active accounts */}
                  {accounts.map((a, idx) => (
                    <tr key={a.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}>
                      <td className={`sticky left-0 z-10 px-4 py-2 border-r border-gray-200 font-medium text-gray-700
                        ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                      >
                        {a.name}
                      </td>
                      {rows.map(r => {
                        const val = r.accounts.find(ac => ac.account_id === a.id)
                        return (
                          <React.Fragment key={r.month}>
                            <td className="px-2 py-2 text-right font-mono text-gray-600 border-r border-gray-100">
                              {fmtMoney(val?.accrued ?? 0)}
                            </td>
                            <td className="px-2 py-2 text-right font-mono text-gray-600 border-r border-gray-200">
                              {fmtMoney(val?.paid ?? 0)}
                            </td>
                          </React.Fragment>
                        )
                      })}
                    </tr>
                  ))}

                  {/* Total Income */}
                  <tr className="bg-iris-50/30 font-semibold text-iris-950 border-t border-b-2 border-iris-100">
                    <td className="sticky left-0 z-10 bg-iris-50/30 px-4 py-2.5 border-r border-gray-200">
                      Всього доходів
                    </td>
                    {rows.map(r => {
                      const totalAccrued = r.accounts.reduce((s, ac) => s + ac.accrued, 0)
                      const totalPaid = r.accounts.reduce((s, ac) => s + ac.paid, 0)
                      return (
                        <React.Fragment key={r.month}>
                          <td className="px-2 py-2.5 text-right font-mono border-r border-iris-100">
                            {fmtMoney(totalAccrued)}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono border-r border-gray-200">
                            {fmtMoney(totalPaid)}
                          </td>
                        </React.Fragment>
                      )
                    })}
                  </tr>

                  {/* Category Header: Expenses */}
                  <tr className="bg-gray-50/70 font-semibold text-gray-900">
                    <td className="sticky left-0 z-10 bg-gray-50/70 px-4 py-2 border-r border-gray-200">
                      ОПЕРАЦІЙНІ ВИТРАТИ
                    </td>
                    {months.map(m => (
                      <React.Fragment key={m}>
                        <td className="border-r border-gray-100" />
                        <td className="border-r border-gray-200" />
                      </React.Fragment>
                    ))}
                  </tr>

                  {/* Salary row */}
                  <tr className="bg-white">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 border-r border-gray-200 font-medium text-gray-700">
                      Зарплата персоналу
                    </td>
                    {rows.map(r => (
                      <React.Fragment key={r.month}>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 border-r border-gray-100">
                          {fmtMoney(r.salary.accrued)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 border-r border-gray-200">
                          {fmtMoney(r.salary.paid)}
                        </td>
                      </React.Fragment>
                    ))}
                  </tr>

                  {/* General expenses row */}
                  <tr className="bg-gray-50/30">
                    <td className="sticky left-0 z-10 bg-gray-50/30 px-4 py-2 border-r border-gray-200 font-medium text-gray-700">
                      Суммарные расходы
                    </td>
                    {rows.map(r => (
                      <React.Fragment key={r.month}>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 border-r border-gray-100">
                          {fmtMoney(r.expenses.accrued)}
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 border-r border-gray-200">
                          {fmtMoney(r.expenses.paid)}
                        </td>
                      </React.Fragment>
                    ))}
                  </tr>

                  {/* Total operating expenses */}
                  <tr className="bg-amber-50/20 font-semibold text-amber-950 border-t border-b border-amber-100">
                    <td className="sticky left-0 z-10 bg-amber-50/20 px-4 py-2.5 border-r border-gray-200">
                      Всього операційних витрат
                    </td>
                    {rows.map(r => {
                      const totalAccrued = r.salary.accrued + r.expenses.accrued
                      const totalPaid = r.salary.paid + r.expenses.paid
                      return (
                        <React.Fragment key={r.month}>
                          <td className="px-2 py-2.5 text-right font-mono border-r border-amber-100 text-amber-900">
                            {fmtMoney(totalAccrued)}
                          </td>
                          <td className="px-2 py-2.5 text-right font-mono border-r border-gray-200 text-amber-900">
                            {fmtMoney(totalPaid)}
                          </td>
                        </React.Fragment>
                      )
                    })}
                  </tr>

                  {/* Operating Profit */}
                  <tr className="bg-gray-50 font-bold text-gray-900 border-t-2 border-b-2 border-gray-200">
                    <td className="sticky left-0 z-10 bg-gray-50 px-4 py-2.5 border-r border-gray-200">
                      Операційний прибуток (Баланс)
                    </td>
                    {rows.map(r => {
                      const totalIncomeAccrued = r.accounts.reduce((s, ac) => s + ac.accrued, 0)
                      const totalIncomePaid = r.accounts.reduce((s, ac) => s + ac.paid, 0)
                      const totalExpenseAccrued = r.salary.accrued + r.expenses.accrued
                      const totalExpensePaid = r.salary.paid + r.expenses.paid

                      const diffAccrued = totalIncomeAccrued - totalExpenseAccrued
                      const diffPaid = totalIncomePaid - totalExpensePaid

                      return (
                        <React.Fragment key={r.month}>
                          <td className={`px-2 py-2.5 text-right font-mono border-r border-gray-100 
                            ${diffAccrued >= 0 ? 'text-green-700' : 'text-red-600'}`}
                          >
                            {diffAccrued < 0 ? '−' : ''}{fmtMoney(Math.abs(diffAccrued))}
                          </td>
                          <td className={`px-2 py-2.5 text-right font-mono border-r border-gray-200
                            ${diffPaid >= 0 ? 'text-green-700' : 'text-red-600'}`}
                          >
                            {diffPaid < 0 ? '−' : ''}{fmtMoney(Math.abs(diffPaid))}
                          </td>
                        </React.Fragment>
                      )
                    })}
                  </tr>

                  {/* Profit Distribution header */}
                  <tr className="bg-gray-50/70 font-semibold text-gray-900">
                    <td className="sticky left-0 z-10 bg-gray-50/70 px-4 py-2 border-r border-gray-200">
                      РОЗПОДІЛ ПРИБУТКУ (ПО ОПЛАТІ)
                    </td>
                    {months.map(m => (
                      <React.Fragment key={m}>
                        <td className="border-r border-gray-100" />
                        <td className="border-r border-gray-200" />
                      </React.Fragment>
                    ))}
                  </tr>

                  {/* Withdrawals row */}
                  <tr className="bg-white">
                    <td className="sticky left-0 z-10 bg-white px-4 py-2 border-r border-gray-200 font-medium text-gray-700">
                      Вивід коштів
                    </td>
                    {rows.map(r => (
                      <React.Fragment key={r.month}>
                        <td className="px-2 py-2 text-center text-gray-400 font-mono border-r border-gray-100">
                          —
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 border-r border-gray-200">
                          {fmtMoney(r.withdrawals.paid)}
                        </td>
                      </React.Fragment>
                    ))}
                  </tr>

                  {/* Dividends row */}
                  <tr className="bg-gray-50/30">
                    <td className="sticky left-0 z-10 bg-gray-50/30 px-4 py-2 border-r border-gray-200 font-medium text-gray-700">
                      Дивіденди
                    </td>
                    {rows.map(r => (
                      <React.Fragment key={r.month}>
                        <td className="px-2 py-2 text-center text-gray-400 font-mono border-r border-gray-100">
                          —
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-gray-600 border-r border-gray-200">
                          {fmtMoney(r.dividends.paid)}
                        </td>
                      </React.Fragment>
                    ))}
                  </tr>

                  {/* Net Cash Flow / Remaining Profit */}
                  <tr className="bg-iris-900/10 font-bold text-iris-950 border-t-2 border-b-2 border-iris-200">
                    <td className="sticky left-0 z-10 bg-iris-50 px-4 py-3 border-r border-gray-200">
                      Чистий грошовий потік
                    </td>
                    {rows.map(r => {
                      const totalIncomeAccrued = r.accounts.reduce((s, ac) => s + ac.accrued, 0)
                      const totalExpenseAccrued = r.salary.accrued + r.expenses.accrued
                      const opProfitAccrued = totalIncomeAccrued - totalExpenseAccrued

                      const totalIncomePaid = r.accounts.reduce((s, ac) => s + ac.paid, 0)
                      const totalExpensePaid = r.salary.paid + r.expenses.paid
                      const netPaidFlow = totalIncomePaid - totalExpensePaid - r.withdrawals.paid - r.dividends.paid

                      return (
                        <React.Fragment key={r.month}>
                          <td className={`px-2 py-3 text-right font-mono border-r border-gray-100
                            ${opProfitAccrued >= 0 ? 'text-iris-800' : 'text-red-700'}`}
                          >
                            {opProfitAccrued < 0 ? '−' : ''}{fmtMoney(Math.abs(opProfitAccrued))}
                          </td>
                          <td className={`px-2 py-3 text-right font-mono border-r border-gray-200
                            ${netPaidFlow >= 0 ? 'text-iris-800' : 'text-red-700'}`}
                          >
                            {netPaidFlow < 0 ? '−' : ''}{fmtMoney(Math.abs(netPaidFlow))}
                          </td>
                        </React.Fragment>
                      )
                    })}
                  </tr>

                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
