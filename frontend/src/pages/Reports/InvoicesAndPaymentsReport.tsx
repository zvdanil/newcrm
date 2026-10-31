import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '../../api/reports.api'
import type {
  InvoicesAndPaymentsFilters,
  InvoicesAndPaymentsChildRow,
  InvoicesAndPaymentsAccountDetail,
} from '../../api/reports.api'
import { accountsApi } from '../../api/accounts.api'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function currentYM() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtMoney(n: number) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function balanceClass(n: number) {
  if (n < -0.005) return 'text-red-600 font-semibold'
  if (n > 0.005) return 'text-emerald-600 font-semibold'
  return 'text-gray-500'
}

function fmtMonth(ym: string) {
  if (!ym) return ''
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })
}

const EMPTY_FILTERS: InvoicesAndPaymentsFilters = {
  from_month: currentYM(),
  to_month: currentYM(),
  account_ids: [],
  is_active: 'true',
  debt_filter: 'all',
}

// ─── Sub-component: Child Row with Accordion ──────────────────────────────────

interface ChildRowProps {
  row: InvoicesAndPaymentsChildRow
  isExpanded: boolean
  onToggle: () => void
}

function ChildRow({ row, isExpanded, onToggle }: ChildRowProps) {
  return (
    <>
      <tr
        className={`border-b border-gray-100 transition-colors hover:bg-iris-50/60 cursor-pointer ${
          isExpanded ? 'bg-iris-50/30' : 'bg-white'
        }`}
        onClick={onToggle}
      >
        {/* Toggle icon */}
        <td className="pl-3 pr-1 py-3 w-7 text-gray-400 select-none text-xs">
          <span className="inline-block transition-transform duration-150">
            {isExpanded ? '▼' : '▶'}
          </span>
        </td>

        {/* Child info */}
        <td className="px-3 py-3 text-sm">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link
              to={`/children/${row.child_id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-iris-600 hover:text-iris-800 font-semibold hover:underline"
              title="Перейти в картку дитини"
            >
              {row.child_name}
            </Link>
            {!row.is_active && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium">
                архів
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            {row.family_name ? `Сім'я: ${row.family_name}` : ''}
            {row.family_name && row.primary_parent_phone ? ' · ' : ''}
            {row.primary_parent_phone ? row.primary_parent_phone : ''}
          </div>
        </td>

        {/* Accounts badges */}
        <td className="px-3 py-3 text-xs">
          <div className="flex gap-1 flex-wrap">
            {row.accounts.map((acc) => (
              <span
                key={acc.account_id}
                className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 font-medium border border-gray-200"
              >
                {acc.account_name}
              </span>
            ))}
          </div>
        </td>

        {/* Invoiced to pay */}
        <td className="px-3 py-3 text-right tabular-nums text-sm font-semibold text-gray-900">
          <div>{fmtMoney(row.invoice_total)} ₴</div>
          <div className="text-[11px] text-gray-400 font-normal">
            абонементи: {fmtMoney(row.subscriptions_total)} ₴
            {row.balance_start < -0.005 && (
              <span className="text-red-500"> · борг на поч.: {fmtMoney(Math.abs(row.balance_start))} ₴</span>
            )}
            {row.balance_start > 0.005 && (
              <span className="text-emerald-600"> · аванс на поч.: {fmtMoney(row.balance_start)} ₴</span>
            )}
          </div>
        </td>

        {/* Paid in period */}
        <td className="px-3 py-3 text-right tabular-nums text-sm font-medium">
          <div className="text-emerald-700">
            {row.paid_in_period > 0 ? `+${fmtMoney(row.paid_in_period)} ₴` : '0,00 ₴'}
          </div>
          {((row.transfers_in_period ?? 0) > 0 || (row.transfers_out_period ?? 0) > 0) && (
            <div className="text-[11px] text-purple-700 font-normal mt-0.5" title="Внутрішній переброс коштів між рахунками">
              {row.transfers_in_period === row.transfers_out_period ? (
                <span>⇄ переброс: {fmtMoney(row.transfers_in_period ?? 0)} ₴</span>
              ) : (
                <span>
                  {(row.transfers_in_period ?? 0) > 0 && `⇄ +${fmtMoney(row.transfers_in_period ?? 0)} ₴ `}
                  {(row.transfers_out_period ?? 0) > 0 && `⇄ −${fmtMoney(row.transfers_out_period ?? 0)} ₴`}
                </span>
              )}
            </div>
          )}
        </td>

        {/* Paid after period */}
        <td className="px-3 py-3 text-right tabular-nums text-sm text-blue-700 font-medium">
          {row.paid_after_period > 0 ? (
            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 px-2 py-0.5 rounded-full text-xs font-semibold">
              +{fmtMoney(row.paid_after_period)} ₴
            </span>
          ) : (
            <span className="text-gray-400 text-xs">—</span>
          )}
        </td>

        {/* Balance at period end */}
        <td className={`px-3 py-3 text-right tabular-nums text-sm ${balanceClass(row.balance_end)}`}>
          {fmtMoney(row.balance_end)} ₴
          {row.balance_end < -0.005 && (
            <div className="text-[10px] text-red-500 font-normal">борг на кінець</div>
          )}
          {row.balance_end >= -0.005 && row.invoice_total > 0 && (
            <div className="text-[10px] text-emerald-600 font-normal">погашено вчасно</div>
          )}
        </td>

        {/* Current balance */}
        <td className={`px-3 py-3 text-right tabular-nums text-sm ${balanceClass(row.current_balance)}`}>
          {fmtMoney(row.current_balance)} ₴
        </td>
      </tr>

      {/* Accordion Detail Row */}
      {isExpanded && (
        <tr className="bg-gray-50/70 border-b border-gray-200">
          <td colSpan={8} className="px-6 py-4">
            <div className="space-y-5">
              <div className="flex items-center justify-between border-b border-gray-200 pb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 flex items-center gap-2">
                  <span>📋 Деталізація рахунку на оплату:</span>
                  <span className="text-iris-600 font-semibold">{row.child_name}</span>
                </h4>
                <div className="text-xs text-gray-500">
                  Кількість рахунків: <span className="font-semibold">{row.accounts.length}</span>
                </div>
              </div>

              {row.accounts.map((acc: InvoicesAndPaymentsAccountDetail) => (
                <div
                  key={acc.account_id}
                  className="bg-white rounded-xl border border-gray-200 shadow-xs overflow-hidden"
                >
                  {/* Account Header */}
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-800 text-sm">{acc.account_name}</span>
                      {acc.account_type && (
                        <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">
                          {acc.account_type}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs flex-wrap">
                      <span className="text-gray-600">
                        Виставлено до сплати:{' '}
                        <strong className="text-gray-900 font-mono text-sm">
                          {fmtMoney(acc.invoice_total)} ₴
                        </strong>
                      </span>
                      <span className="text-gray-300">|</span>
                      <span className="text-emerald-700">
                        Сплачено:{' '}
                        <strong className="font-mono">+{fmtMoney(acc.paid_in_period)} ₴</strong>
                      </span>
                      {((acc.transfers_in_period ?? 0) > 0 || (acc.transfers_out_period ?? 0) > 0) && (
                        <>
                          <span className="text-gray-300">|</span>
                          <span className="text-purple-700">
                            Переброс:{' '}
                            <strong className="font-mono">
                              {(acc.transfers_in_period ?? 0) > 0 && `+${fmtMoney(acc.transfers_in_period!)} ₴`}
                              {(acc.transfers_in_period ?? 0) > 0 && (acc.transfers_out_period ?? 0) > 0 && ' / '}
                              {(acc.transfers_out_period ?? 0) > 0 && `−${fmtMoney(acc.transfers_out_period!)} ₴`}
                            </strong>
                          </span>
                        </>
                      )}
                      {acc.paid_after_period > 0 && (
                        <>
                          <span className="text-gray-300">|</span>
                          <span className="text-blue-700">
                            Сплачено пізніше:{' '}
                            <strong className="font-mono">+{fmtMoney(acc.paid_after_period)} ₴</strong>
                          </span>
                        </>
                      )}
                      <span className="text-gray-300">|</span>
                      <span>
                        Кінець періоду:{' '}
                        <strong className={`font-mono ${balanceClass(acc.balance_end)}`}>
                          {fmtMoney(acc.balance_end)} ₴
                        </strong>
                      </span>
                    </div>
                  </div>

                  {/* Account Content */}
                  <div className="p-4 space-y-4">
                    {/* ── SECTION 1: Previous Month Consumed Services ── */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                          <span>📦</span>
                          <span>Спожиті послуги за минулий місяць:</span>
                        </h5>
                        <span className="text-xs font-medium text-gray-500">
                          Всього: <strong className="font-mono text-gray-800">{fmtMoney(acc.consumed_services_total)} ₴</strong>
                        </span>
                      </div>

                      {acc.consumed_services.length > 0 ? (
                        <div className="border border-gray-100 rounded-lg overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50/80 text-gray-500 border-b border-gray-100">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium">Послуга</th>
                                <th className="px-3 py-2 text-left font-medium">Місяць споживання</th>
                                <th className="px-3 py-2 text-center font-medium">Кількість занять</th>
                                <th className="px-3 py-2 text-right font-medium">Сума (₴)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {acc.consumed_services.map((srv, idx) => (
                                <tr key={idx} className="hover:bg-gray-50/50">
                                  <td className="px-3 py-2 text-gray-800 font-medium">
                                    {srv.activity_name}
                                  </td>
                                  <td className="px-3 py-2 text-gray-500">
                                    {srv.month ? fmtMonth(srv.month) : 'минулий місяць'}
                                  </td>
                                  <td className="px-3 py-2 text-center text-gray-600">
                                    {srv.visit_count && srv.visit_count > 0 ? (
                                      <span className="px-1.5 py-0.5 rounded bg-gray-100 font-medium text-[11px]">
                                        {srv.visit_count} {srv.visit_count === 1 ? 'заняття' : 'занять'}
                                      </span>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono font-medium text-gray-900">
                                    {fmtMoney(srv.amount)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="bg-gray-50/60 border-t border-gray-100 font-semibold text-gray-700">
                              <tr>
                                <td colSpan={3} className="px-3 py-2">
                                  Всього за спожиті послуги:
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-gray-900">
                                  {fmtMoney(acc.consumed_services_total)} ₴
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <div className="text-xs text-gray-400 italic py-1 px-1">
                          Немає спожитих разових послуг за минулий місяць.
                        </div>
                      )}
                    </div>

                    {/* ── SECTION 2: Current Month Subscriptions ── */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <h5 className="text-xs font-bold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
                          <span>🎫</span>
                          <span>Абонементи послуг на обраний період:</span>
                        </h5>
                        <span className="text-xs font-medium text-gray-500">
                          Всього: <strong className="font-mono text-gray-800">{fmtMoney(acc.subscriptions_total)} ₴</strong>
                        </span>
                      </div>

                      {acc.subscriptions.length > 0 ? (
                        <div className="border border-gray-100 rounded-lg overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50/80 text-gray-500 border-b border-gray-100">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium">Абонемент / Активність</th>
                                <th className="px-3 py-2 text-left font-medium">Період</th>
                                <th className="px-3 py-2 text-left font-medium">Тип тарифу</th>
                                <th className="px-3 py-2 text-right font-medium">Сума (₴)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {acc.subscriptions.map((sub, idx) => (
                                <tr key={idx} className="hover:bg-gray-50/50">
                                  <td className="px-3 py-2 text-gray-800 font-medium">
                                    {sub.activity_name}
                                  </td>
                                  <td className="px-3 py-2 text-gray-500">
                                    {sub.month ? fmtMonth(sub.month) : 'обраний період'}
                                  </td>
                                  <td className="px-3 py-2 text-gray-400">
                                    {sub.tariff_type === 'smart' ? 'Розумний абонемент' : 'Місячний абонемент'}
                                  </td>
                                  <td className="px-3 py-2 text-right font-mono font-medium text-gray-900">
                                    {fmtMoney(sub.amount)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot className="bg-gray-50/60 border-t border-gray-100 font-semibold text-gray-700">
                              <tr>
                                <td colSpan={3} className="px-3 py-2">
                                  Всього за абонементи:
                                </td>
                                <td className="px-3 py-2 text-right font-mono text-gray-900">
                                  {fmtMoney(acc.subscriptions_total)} ₴
                                </td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      ) : (
                        <div className="text-xs text-gray-400 italic py-1 px-1">
                          Немає діючих абонементів на обраний період.
                        </div>
                      )}
                    </div>

                    {/* ── SECTION 3: Financial Summary Cards for this account ── */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 pt-2 text-xs border-t border-gray-100">
                      <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                        <span className="text-gray-500 block">Баланс на початок періоду</span>
                        <span className={`text-sm font-bold font-mono mt-0.5 block ${balanceClass(acc.balance_start)}`}>
                          {fmtMoney(acc.balance_start)} ₴
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {acc.balance_start < 0 ? 'борг (в т.ч. спожиті послуги)' : acc.balance_start > 0 ? 'переплата / аванс' : 'нульовий'}
                        </span>
                      </div>

                      <div className="p-2.5 rounded-lg bg-iris-50/60 border border-iris-200">
                        <span className="text-iris-800 font-medium block">Виставлено до сплати</span>
                        <span className="text-sm font-bold font-mono text-iris-950 mt-0.5 block">
                          {fmtMoney(acc.invoice_total)} ₴
                        </span>
                        <span className="text-[10px] text-iris-600">
                          абонементи: {fmtMoney(acc.subscriptions_total)} ₴
                        </span>
                      </div>

                      {((acc.transfers_in_period ?? 0) === 0 && (acc.transfers_out_period ?? 0) === 0) ? (
                        <div className="p-2.5 rounded-lg bg-emerald-50/60 border border-emerald-200">
                          <span className="text-emerald-800 font-medium block">Оплачено у періоді</span>
                          <span className="text-sm font-bold font-mono text-emerald-900 mt-0.5 block">
                            +{fmtMoney(acc.paid_in_period)} ₴
                          </span>
                          <span className="text-[10px] text-emerald-600">
                            {acc.paid_after_period > 0
                              ? `+${fmtMoney(acc.paid_after_period)} ₴ сплачено пізніше`
                              : 'надійшло вчасно'}
                          </span>
                        </div>
                      ) : (
                        <div className="p-2.5 rounded-lg bg-white border border-gray-200 shadow-xs flex flex-col justify-between">
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-emerald-800 font-medium text-[11px] block">Пряма оплата</span>
                              <span className="text-[10px] text-emerald-600">
                                {acc.paid_after_period > 0 ? `+${fmtMoney(acc.paid_after_period)} ₴ пізніше` : 'надійшло'}
                              </span>
                            </div>
                            <span className="text-sm font-bold font-mono text-emerald-700 mt-0.5 block">
                              {acc.paid_in_period > 0 ? `+${fmtMoney(acc.paid_in_period)} ₴` : '0,00 ₴'}
                            </span>
                          </div>

                          <div className="pt-2 mt-2 border-t border-purple-100 bg-purple-50/70 -mx-2.5 -mb-2.5 p-2 rounded-b-lg space-y-1">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-semibold text-purple-900 flex items-center gap-1">
                                <span>⇄</span>
                                {(acc.transfers_in_period ?? 0) > 0 && (acc.transfers_out_period ?? 0) > 0
                                  ? 'Переброси'
                                  : (acc.transfers_in_period ?? 0) > 0
                                  ? 'Зараховано перебросом'
                                  : 'Списано перебросом'}
                              </span>
                              <span className="font-mono font-bold text-purple-800 text-xs">
                                {(acc.transfers_in_period ?? 0) > 0 && `+${fmtMoney(acc.transfers_in_period!)} ₴`}
                                {(acc.transfers_in_period ?? 0) > 0 && (acc.transfers_out_period ?? 0) > 0 && ' / '}
                                {(acc.transfers_out_period ?? 0) > 0 && `−${fmtMoney(acc.transfers_out_period!)} ₴`}
                              </span>
                            </div>
                            {acc.transfers && acc.transfers.length > 0 && (
                              <div className="space-y-0.5 text-[10px] text-purple-700/80">
                                {acc.transfers.map((tr, idx) => (
                                  <div key={idx} className="truncate" title={tr.note ?? ''}>
                                    {tr.type === 'TRANSFER_IN' ? '+' : '−'}{fmtMoney(tr.amount)} ₴ {tr.note ? `· ${tr.note}` : ''}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-200">
                        <span className="text-gray-500 block">Баланс на кінець періоду</span>
                        <span className={`text-sm font-bold font-mono mt-0.5 block ${balanceClass(acc.balance_end)}`}>
                          {fmtMoney(acc.balance_end)} ₴
                        </span>
                        <span className="text-[10px] text-gray-400">
                          поточний на сьогодні: {fmtMoney(acc.current_balance)} ₴
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function InvoicesAndPaymentsReport() {
  const [filters, setFilters] = useState<InvoicesAndPaymentsFilters>(EMPTY_FILTERS)
  const [committed, setCommitted] = useState<InvoicesAndPaymentsFilters>(EMPTY_FILTERS)
  const [search, setSearch] = useState('')
  const [expandedChildIds, setExpandedChildIds] = useState<Set<string>>(new Set())

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
    staleTime: 5 * 60 * 1000,
  })

  const { data: report, isFetching, isError } = useQuery({
    queryKey: ['report-invoices-and-payments', committed],
    queryFn: () => reportsApi.getInvoicesAndPayments(committed),
    staleTime: 0,
  })

  const handleApply = () => {
    setCommitted({ ...filters })
  }

  const handleReset = () => {
    setFilters(EMPTY_FILTERS)
    setCommitted(EMPTY_FILTERS)
    setSearch('')
  }

  const toggleAccount = (id: string) => {
    setFilters((prev) => ({
      ...prev,
      account_ids: prev.account_ids.includes(id)
        ? prev.account_ids.filter((x) => x !== id)
        : [...prev.account_ids, id],
    }))
  }

  const toggleChild = (childId: string) => {
    setExpandedChildIds((prev) => {
      const next = new Set(prev)
      if (next.has(childId)) next.delete(childId)
      else next.add(childId)
      return next
    })
  }

  const expandAll = () => {
    if (!report?.rows) return
    setExpandedChildIds(new Set(report.rows.map((r) => r.child_id)))
  }

  const collapseAll = () => {
    setExpandedChildIds(new Set())
  }

  // Filter rows by search term
  const filteredRows = useMemo(() => {
    if (!report?.rows) return []
    if (!search.trim()) return report.rows
    const q = search.trim().toLowerCase()
    return report.rows.filter(
      (r) =>
        r.child_name.toLowerCase().includes(q) ||
        (r.family_name && r.family_name.toLowerCase().includes(q)) ||
        (r.primary_parent_phone && r.primary_parent_phone.includes(q))
    )
  }, [report?.rows, search])

  // CSV Export
  const handleExportCSV = () => {
    if (!filteredRows.length) return
    const header = [
      'Дитина',
      "Сім'я",
      'Телефон',
      'Рахунки',
      'Виставлено до сплати',
      'Спожиті послуги (мин. місяць)',
      'Абонементи',
      'Оплачено у періоді',
      'Переброси (⇄)',
      'Оплачено після періоду',
      'Баланс на кінець періоду',
      'Поточний баланс',
    ]

    const csvRows = filteredRows.map((r) => [
      `"${r.child_name}"`,
      `"${r.family_name ?? ''}"`,
      `"${r.primary_parent_phone ?? ''}"`,
      `"${r.accounts.map((a) => a.account_name).join(', ')}"`,
      r.invoice_total.toFixed(2),
      r.consumed_services_total.toFixed(2),
      r.subscriptions_total.toFixed(2),
      r.paid_in_period.toFixed(2),
      ((r.transfers_in_period ?? 0) - (r.transfers_out_period ?? 0)).toFixed(2),
      r.paid_after_period.toFixed(2),
      r.balance_end.toFixed(2),
      r.current_balance.toFixed(2),
    ])

    const csvContent = '\uFEFF' + [header.join(';'), ...csvRows.map((row) => row.join(';'))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `invoices_and_payments_${committed.from_month}_${committed.to_month}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* ── Filter Panel ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* From Month */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Період з місяця:
            </label>
            <input
              type="month"
              value={filters.from_month}
              onChange={(e) => setFilters({ ...filters, from_month: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-iris-500 focus:outline-none"
            />
          </div>

          {/* To Month */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              По місяць:
            </label>
            <input
              type="month"
              value={filters.to_month}
              onChange={(e) => setFilters({ ...filters, to_month: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-iris-500 focus:outline-none"
            />
          </div>

          {/* Debt filter */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Фільтр заборгованості:
            </label>
            <select
              value={filters.debt_filter}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  debt_filter: e.target.value as InvoicesAndPaymentsFilters['debt_filter'],
                })
              }
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-iris-500 focus:outline-none bg-white"
            >
              <option value="all">Всі клієнти</option>
              <option value="debt_period_end">Тільки з боргом на кінець періоду</option>
              <option value="debt_today">Тільки з боргом на сьогодні</option>
            </select>
          </div>

          {/* Active status */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 mb-1">
              Статус клієнтів:
            </label>
            <select
              value={filters.is_active}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  is_active: e.target.value as InvoicesAndPaymentsFilters['is_active'],
                })
              }
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-iris-500 focus:outline-none bg-white"
            >
              <option value="true">Тільки активні</option>
              <option value="false">Тільки архівні</option>
              <option value="">Всі (активні та архівні)</option>
            </select>
          </div>
        </div>

        {/* Account buttons (ФОП, ТОВ, etc.) */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-2">
            Счета привязок (ФОП / ТОВ / Каса):
          </label>
          <div className="flex gap-2 flex-wrap items-center">
            <button
              type="button"
              onClick={() => setFilters({ ...filters, account_ids: [] })}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                filters.account_ids.length === 0
                  ? 'bg-iris-600 text-white border-iris-600 shadow-xs'
                  : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
              }`}
            >
              Всі рахунки ({accounts.length})
            </button>
            {accounts.map((acc) => {
              const selected = filters.account_ids.includes(acc.id)
              return (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => toggleAccount(acc.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                    selected
                      ? 'bg-iris-50 text-iris-800 border-iris-300 font-semibold shadow-xs'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span>{acc.name}</span>
                  {selected && <span className="text-iris-600 text-[10px]">✓</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApply}
              disabled={isFetching}
              className="px-5 py-2 bg-iris-600 hover:bg-iris-700 text-white font-semibold text-sm rounded-lg shadow-sm transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isFetching ? (
                <>
                  <span className="animate-spin text-xs">⏳</span>
                  <span>Завантаження...</span>
                </>
              ) : (
                <span>Зформувати звіт</span>
              )}
            </button>

            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-sm rounded-lg transition-colors cursor-pointer"
            >
              Скинути
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={!filteredRows.length}
              className="px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 text-sm rounded-lg transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5"
            >
              <span>📥</span>
              <span>Експорт в CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── KPI Summary Cards ────────────────────────────────────────────── */}
      {report?.totals && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs">
            <span className="text-xs text-gray-500 block">Виставлено до сплати</span>
            <span className="text-base font-bold font-mono text-gray-900 mt-1 block">
              {fmtMoney(report.totals.invoice_total)} ₴
            </span>
            <span className="text-[11px] text-gray-400">
              абонементи: {fmtMoney(report.totals.subscriptions_total)} ₴
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs">
            <span className="text-xs text-amber-700 font-medium block">Послуги (мин. місяць)</span>
            <span className="text-base font-bold font-mono text-amber-800 mt-1 block">
              {fmtMoney(report.totals.consumed_services_total)} ₴
            </span>
            <span className="text-[11px] text-amber-600">разові занять</span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs">
            <span className="text-xs text-emerald-700 font-medium block">Оплачено у періоді</span>
            <span className="text-base font-bold font-mono text-emerald-800 mt-1 block">
              +{fmtMoney(report.totals.paid_in_period)} ₴
            </span>
            <span className="text-[11px] text-emerald-600 flex justify-between items-center">
              <span>надійшло вчасно</span>
              {(report.totals.transfers_in_total ?? 0) > 0 && (
                <span className="text-purple-700 font-medium" title="Внутрішні переброси між рахунками">
                  ⇄ {fmtMoney(report.totals.transfers_in_total!)} ₴
                </span>
              )}
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs">
            <span className="text-xs text-blue-700 font-medium block">Оплачено після періоду</span>
            <span className="text-base font-bold font-mono text-blue-800 mt-1 block">
              +{fmtMoney(report.totals.paid_after_period)} ₴
            </span>
            <span className="text-[11px] text-blue-600">наступні оплати</span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs">
            <span className="text-xs text-gray-500 block">Борг на кінець періоду</span>
            <span className={`text-base font-bold font-mono mt-1 block ${balanceClass(report.totals.balance_end)}`}>
              {fmtMoney(report.totals.balance_end)} ₴
            </span>
            <span className="text-[11px] text-gray-400">
              {report.totals.balance_end < 0 ? 'залишок боргу' : 'вчасно закрито'}
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-gray-200 shadow-xs">
            <span className="text-xs text-gray-500 block">Поточний баланс</span>
            <span
              className={`text-base font-bold font-mono mt-1 block ${balanceClass(
                report.totals.current_balance
              )}`}
            >
              {fmtMoney(report.totals.current_balance)} ₴
            </span>
            <span className="text-[11px] text-gray-400">на сьогодні</span>
          </div>
        </div>
      )}

      {/* ── Table Toolbar ────────────────────────────────────────────────── */}
      {report && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Search */}
          <div className="relative w-72">
            <input
              type="text"
              placeholder="Пошук дитини або сім'ї..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-iris-500 focus:outline-none bg-white"
            />
            <span className="absolute left-3 top-2 text-gray-400 text-xs">🔍</span>
          </div>

          {/* Expand/Collapse All */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={expandAll}
              className="text-xs text-iris-600 hover:text-iris-800 font-medium px-2 py-1 rounded hover:bg-iris-50 transition-colors cursor-pointer"
            >
              Розгорнути всі деталі
            </button>
            <span className="text-gray-300">|</span>
            <button
              type="button"
              onClick={collapseAll}
              className="text-xs text-gray-500 hover:text-gray-700 font-medium px-2 py-1 rounded hover:bg-gray-100 transition-colors cursor-pointer"
            >
              Згорнути всі
            </button>
          </div>
        </div>
      )}

      {/* ── Report Table ─────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
        {isError && (
          <div className="p-8 text-center text-red-600 text-sm">
            Помилка завантаження даних. Спробуйте оновити сторінку або змінити параметри.
          </div>
        )}

        {isFetching && !report && (
          <div className="p-12 text-center text-gray-400 text-sm">
            <div className="animate-spin text-2xl mb-2">⏳</div>
            <div>Завантаження даних звіту «Рахунки та оплати»...</div>
          </div>
        )}

        {report && filteredRows.length === 0 && (
          <div className="p-10 text-center text-gray-400 text-sm">
            Немає записів, що відповідають обраним фільтрам.
          </div>
        )}

        {report && filteredRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-gray-50/90 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                  <th className="pl-3 pr-1 py-3 w-7"></th>
                  <th className="px-3 py-3">Клієнт (Дитина)</th>
                  <th className="px-3 py-3">Счета</th>
                  <th className="px-3 py-3 text-right">Виставлено до сплати</th>
                  <th className="px-3 py-3 text-right text-emerald-800">Оплачено у періоді</th>
                  <th className="px-3 py-3 text-right text-blue-800">Оплачено після періоду</th>
                  <th className="px-3 py-3 text-right">Баланс на кінець</th>
                  <th className="px-3 py-3 text-right">Поточний баланс</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRows.map((row) => (
                  <ChildRow
                    key={row.child_id}
                    row={row}
                    isExpanded={expandedChildIds.has(row.child_id)}
                    onToggle={() => toggleChild(row.child_id)}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100/80 border-t-2 border-gray-300 font-bold text-sm text-gray-900">
                  <td colSpan={3} className="px-4 py-3">
                    Всього ({filteredRows.length} дітей):
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">
                    {fmtMoney(report.totals.invoice_total)} ₴
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-emerald-700">
                    <div>+{fmtMoney(report.totals.paid_in_period)} ₴</div>
                    {(report.totals.transfers_in_total ?? 0) > 0 && (
                      <div className="text-[11px] text-purple-700 font-normal">
                        ⇄ {fmtMoney(report.totals.transfers_in_total!)} ₴
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-blue-700">
                    +{fmtMoney(report.totals.paid_after_period)} ₴
                  </td>
                  <td className={`px-3 py-3 text-right font-mono tabular-nums ${balanceClass(report.totals.balance_end)}`}>
                    {fmtMoney(report.totals.balance_end)} ₴
                  </td>
                  <td className={`px-3 py-3 text-right font-mono tabular-nums ${balanceClass(report.totals.current_balance)}`}>
                    {fmtMoney(report.totals.current_balance)} ₴
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
