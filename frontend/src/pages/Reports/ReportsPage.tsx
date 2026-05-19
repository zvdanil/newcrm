import { useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '../../api/reports.api'
import type { ARFilters, DebtorRow } from '../../api/reports.api'
import { accountsApi } from '../../api/accounts.api'

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtMoney(n: number) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function currentYM() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const EMPTY_FILTERS: ARFilters = {
  from_month: '',
  to_month:   '',
  account_ids: [],
  is_active:  'true',
  min_debt:   '',
  sort:       'desc',
}

// ─── component ──────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [filters, setFilters]         = useState<ARFilters>(EMPTY_FILTERS)
  const [committed, setCommitted]     = useState<ARFilters | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
    staleTime: 5 * 60 * 1000,
  })

  const { data: report, isFetching, isError } = useQuery({
    queryKey: ['report-ar', committed],
    queryFn: () => reportsApi.getAccountsReceivable(committed!),
    enabled: !!committed,
    staleTime: 0,
  })

  const handleGenerate = () => {
    setCommitted({ ...filters })
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  const handleReset = () => {
    setFilters(EMPTY_FILTERS)
    setCommitted(null)
  }

  const toggleAccount = (id: string) => {
    setFilters((f) => ({
      ...f,
      account_ids: f.account_ids.includes(id)
        ? f.account_ids.filter((x) => x !== id)
        : [...f.account_ids, id],
    }))
  }

  // Group rows by child for display (child may appear on multiple accounts)
  const rows = report?.rows ?? []

  // Per-account totals
  const accountTotals = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.account_name] = (acc[r.account_name] ?? 0) + r.debt
    return acc
  }, {})

  const canExport = rows.length > 0

  const handleExportCSV = () => {
    const header = ['ФІО', 'Сімʼя', 'Рахунок', 'Борг (грн)', 'Статус', 'Контакт']
    const csvRows = rows.map((r) => [
      r.child_name,
      r.family_name ?? '',
      r.account_name,
      r.debt.toFixed(2).replace('.', ','),
      r.is_active ? 'Активна' : 'Архів',
      r.primary_parent_phone ?? '',
    ])
    const csv = [header, ...csvRows].map((row) => row.map((v) => `"${v}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `debt-report-${currentYM()}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-5xl space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Звіти</h1>
      </div>

      {/* Report card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        {/* Report title */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium text-gray-900">Дебіторська заборгованість</h2>
            <p className="text-xs text-gray-400 mt-0.5">Дати нарахувань, що не покриті оплатами</p>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">

          {/* Period */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Період нарахувань</label>
            <div className="flex items-center gap-2">
              <input
                type="month"
                value={filters.from_month}
                onChange={(e) => setFilters((f) => ({ ...f, from_month: e.target.value }))}
                className="flex-1 rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                placeholder="від"
              />
              <span className="text-gray-400 text-sm">—</span>
              <input
                type="month"
                value={filters.to_month}
                onChange={(e) => setFilters((f) => ({ ...f, to_month: e.target.value }))}
                className="flex-1 rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                placeholder="до"
              />
            </div>
          </div>

          {/* Account */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Рахунок</label>
            <div className="flex flex-wrap gap-2">
              {accounts.filter((a) => a.is_active).map((a) => {
                const checked = filters.account_ids.includes(a.id)
                return (
                  <label key={a.id} className={`flex items-center gap-1.5 cursor-pointer px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${
                    checked
                      ? 'bg-iris-600 border-iris-600 text-white'
                      : 'border-gray-200 text-gray-600 hover:border-iris-300'
                  }`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAccount(a.id)}
                      className="sr-only"
                    />
                    {a.name}
                  </label>
                )
              })}
              {accounts.filter((a) => a.is_active).length === 0 && (
                <span className="text-xs text-gray-400">Рахунки не знайдено</span>
              )}
            </div>
            <p className="text-xs text-gray-400">Не вибрано — всі рахунки</p>
          </div>

          {/* Status + Min debt + Sort */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Статус дитини</label>
              <div className="flex gap-3">
                {[
                  { value: 'true',  label: 'Активні' },
                  { value: 'false', label: 'Архів' },
                  { value: '',      label: 'Всі' },
                ].map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="is_active"
                      value={value}
                      checked={filters.is_active === value}
                      onChange={() => setFilters((f) => ({ ...f, is_active: value as ARFilters['is_active'] }))}
                      className="text-iris-600 focus:ring-iris-500"
                    />
                    <span className="text-gray-700">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Мін. борг (грн)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={filters.min_debt}
                  onChange={(e) => setFilters((f) => ({ ...f, min_debt: e.target.value }))}
                  placeholder="0.01"
                  className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Сортування</label>
                <select
                  value={filters.sort}
                  onChange={(e) => setFilters((f) => ({ ...f, sort: e.target.value as ARFilters['sort'] }))}
                  className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                >
                  <option value="desc">Найбільший борг</option>
                  <option value="asc">Найменший борг</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
          <button
            onClick={handleGenerate}
            disabled={isFetching}
            className="px-4 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isFetching ? 'Формується...' : 'Сформувати звіт'}
          </button>
          {committed && (
            <button
              onClick={handleReset}
              className="text-sm text-gray-500 hover:text-gray-900"
            >
              Скинути
            </button>
          )}
          {canExport && (
            <button
              onClick={handleExportCSV}
              className="ml-auto text-sm text-iris-600 hover:text-iris-700 font-medium"
            >
              ↓ Експорт CSV
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {committed && (
        <div ref={tableRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isError ? (
            <p className="p-6 text-sm text-red-600">Помилка при формуванні звіту. Спробуйте ще раз.</p>
          ) : isFetching ? (
            <p className="p-6 text-sm text-gray-400">Завантаження...</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-gray-400">Дебіторська заборгованість відсутня за обраними фільтрами.</p>
          ) : (
            <>
              {/* Summary bar */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-6 py-3 bg-gray-50 border-b border-gray-200 text-sm">
                <span className="text-gray-500">
                  Дітей: <span className="font-semibold text-gray-900">{report!.children_count}</span>
                </span>
                <span className="text-gray-500">
                  Загальний борг: <span className="font-semibold text-red-600">{fmtMoney(report!.total_debt)} грн</span>
                </span>
                {Object.entries(accountTotals).map(([name, total]) => (
                  <span key={name} className="text-gray-400">
                    {name}: <span className="text-gray-700">{fmtMoney(total)} грн</span>
                  </span>
                ))}
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">ФІО дитини</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Сімʼя</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Рахунок</th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">Борг (грн)</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Контакт</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((row, i) => (
                      <DebtRow key={`${row.child_id}-${row.account_id}`} row={row} idx={i} />
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50">
                      <td colSpan={3} className="px-4 py-2.5 text-xs font-medium text-gray-600">
                        Всього: {report!.children_count} {pluralChildren(report!.children_count)}, {rows.length} рядків
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-red-600 font-mono">
                        {fmtMoney(report!.total_debt)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Row component ───────────────────────────────────────────────────────────

function DebtRow({ row, idx }: { row: DebtorRow; idx: number }) {
  return (
    <tr className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Link
            to={`/children/${row.child_id}`}
            className="font-medium text-iris-600 hover:text-iris-700 transition-colors"
          >
            {row.child_name}
          </Link>
          {!row.is_active && (
            <span className="px-1.5 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">Архів</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-gray-600">{row.family_name ?? '—'}</td>
      <td className="px-4 py-2.5">
        <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700 font-medium">{row.account_name}</span>
      </td>
      <td className="px-4 py-2.5 text-right font-mono font-semibold text-red-600">
        {fmtMoney(row.debt)}
      </td>
      <td className="px-4 py-2.5 text-gray-500 text-xs">
        {row.primary_parent_phone ?? row.primary_parent_name ?? '—'}
      </td>
    </tr>
  )
}

// ─── helpers ────────────────────────────────────────────────────────────────

function pluralChildren(n: number) {
  if (n % 10 === 1 && n % 100 !== 11) return 'дитина'
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return 'дитини'
  return 'дітей'
}
