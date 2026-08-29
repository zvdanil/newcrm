import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import { reportsApi, type ChildOSVReportResponse, type OSVMonthData } from '../../api/reports.api'
import { accountsApi } from '../../api/accounts.api'

interface ChildOSVWidgetProps {
  childId: string
  childName: string
}

function formatMoney(amount: number | null | undefined, showPlusSign = false) {
  if (amount === null || amount === undefined || isNaN(amount)) return '0.00 ₴'
  const val = Number(amount)
  const formatted = val.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (showPlusSign && val > 0) return `+${formatted} ₴`
  return `${formatted} ₴`
}

export function ChildOSVWidget({ childId, childName }: ChildOSVWidgetProps) {
  const [open, setOpen] = useState(false)
  const currentYear = new Date().getFullYear()
  const [periodPreset, setPeriodPreset] = useState<'current_year' | 'last_year' | 'custom'>('current_year')
  const [startDate, setStartDate] = useState(`${currentYear}-01-01`)
  const [endDate, setEndDate] = useState(`${currentYear}-12-31`)
  const [selectedAccountId, setSelectedAccountId] = useState<string>('')

  // Expanded state for month rows & sections
  const [expandedMonths, setExpandedMonths] = useState<Record<string, boolean>>({})
  const [expandedAccruals, setExpandedAccruals] = useState<Record<string, boolean>>({})
  const [expandedPayments, setExpandedPayments] = useState<Record<string, boolean>>({})
  const [expandedRefunds, setExpandedRefunds] = useState<Record<string, boolean>>({})

  // Fetch accounts for filter
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })

  // Fetch OSV report data
  const { data, isLoading, isError, refetch } = useQuery<ChildOSVReportResponse>({
    queryKey: ['childOSV', childId, startDate, endDate, selectedAccountId],
    queryFn: () =>
      reportsApi.getChildOSV(childId, {
        start_date: startDate,
        end_date: endDate,
        account_id: selectedAccountId || undefined,
      }),
    enabled: !!childId && open,
  })

  const handlePresetChange = (preset: 'current_year' | 'last_year' | 'custom') => {
    setPeriodPreset(preset)
    if (preset === 'current_year') {
      const y = new Date().getFullYear()
      setStartDate(`${y}-01-01`)
      setEndDate(`${y}-12-31`)
    } else if (preset === 'last_year') {
      const y = new Date().getFullYear() - 1
      setStartDate(`${y}-01-01`)
      setEndDate(`${y}-12-31`)
    }
  }

  const toggleMonth = (ym: string) => {
    setExpandedMonths((prev) => {
      const next = { ...prev, [ym]: !prev[ym] }
      // Default expand accruals and payments sections when month is expanded
      if (next[ym]) {
        setExpandedAccruals((a) => ({ ...a, [ym]: true }))
        setExpandedPayments((p) => ({ ...p, [ym]: true }))
        setExpandedRefunds((r) => ({ ...r, [ym]: true }))
      }
      return next
    })
  }

  const toggleAllMonths = (expand: boolean) => {
    if (!data) return
    const nextM: Record<string, boolean> = {}
    const nextA: Record<string, boolean> = {}
    const nextP: Record<string, boolean> = {}
    const nextR: Record<string, boolean> = {}
    data.months.forEach((m) => {
      nextM[m.month] = expand
      nextA[m.month] = expand
      nextP[m.month] = expand
      nextR[m.month] = expand
    })
    setExpandedMonths(nextM)
    setExpandedAccruals(nextA)
    setExpandedPayments(nextP)
    setExpandedRefunds(nextR)
  }

  // Export to Excel according to current screen expanded state
  const handleExportExcel = () => {
    if (!data) return

    const rows: any[][] = []

    // Header Metadata
    rows.push(['ОБОРОТНО-САЛЬДОВА ВЕДОМІСТЬ (АКТ СВЕРКИ)'])
    rows.push([`Клієнт (Дитина): ${data.child.full_name}`])
    rows.push([`Група: ${data.child.group_name || 'Без групи'}`])
    rows.push([`Період: з ${data.period.start_date} по ${data.period.end_date}`])
    const accName = selectedAccountId
      ? accounts?.find((a) => a.id === selectedAccountId)?.name || 'Вибраний рахунок'
      : 'Усі рахунки (Зведений)'
    rows.push([`Рахунок: ${accName}`])
    rows.push([])

    // Table Column Headers
    rows.push(['Період (місяць)', 'Баланс на 1-е число', 'Нараховано', 'Сплачено', 'Возврат', 'Баланс на кінець'])

    // Month Data Rows
    data.months.forEach((m) => {
      rows.push([
        m.month_label,
        m.balance_start,
        m.accruals.total,
        m.payments.total,
        m.refunds.total,
        m.balance_end,
      ])

      const isMExpanded = expandedMonths[m.month]
      if (isMExpanded) {
        // Accruals Details
        if (expandedAccruals[m.month] && m.accruals.items.length > 0) {
          rows.push(['  ├─ Деталізація нарахувань:'])
          m.accruals.items.forEach((item) => {
            const countStr = item.count && item.count > 1 ? ` (${item.count})` : ''
            rows.push([
              `     • ${item.activity_name}${countStr} (${item.account_name})`,
              '',
              item.amount,
              '',
              '',
              '',
            ])
          })
        }

        // Payments Details
        if (expandedPayments[m.month] && m.payments.items.length > 0) {
          rows.push(['  ├─ Деталізація оплат:'])
          m.payments.items.forEach((item) => {
            const dt = item.transaction_date
            const noteStr = item.note ? ` (${item.note})` : ''
            rows.push([
              `     • ${dt} | ${item.payment_method} | ${item.account_name}${noteStr}`,
              '',
              '',
              item.amount,
              '',
              '',
            ])
          })
        }

        // Refunds Details
        if (expandedRefunds[m.month] && m.refunds.items.length > 0) {
          rows.push(['  ├─ Деталізація повернень по рахунках:'])
          m.refunds.items.forEach((item) => {
            rows.push([
              `     • Возврат по рахунку: ${item.account_name}`,
              '',
              '',
              '',
              item.amount,
              '',
            ])
          })
        }
      }
    })

    // Totals Row
    rows.push([])
    rows.push([
      'РАЗОМ ЗА ПЕРІОД',
      data.opening_balance,
      data.totals.accruals,
      data.totals.payments,
      data.totals.refunds,
      data.closing_balance,
    ])

    const ws = XLSX.utils.aoa_to_sheet(rows)

    // Set column widths
    ws['!cols'] = [
      { wch: 35 },
      { wch: 20 },
      { wch: 18 },
      { wch: 18 },
      { wch: 18 },
      { wch: 20 },
    ]

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'ОСВ_Акт_Сверки')

    const safeName = childName.replace(/[^a-zA-Z0-9а-яА-ЯіІїЇєЄ_]/g, '_')
    XLSX.writeFile(wb, `OSV_${safeName}_${data.period.start_date}_${data.period.end_date}.xlsx`)
  }

  // Export to PDF via clean browser print
  const handleExportPDF = () => {
    window.print()
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden print:border-none print:shadow-none print:p-0">
      {/* Collapsible Header */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-gray-50/80 transition-colors print:hidden"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">📊</span>
          <span className="text-sm font-semibold text-gray-900">Оборотно-сальдова ведомость (Акт сверки)</span>
        </div>
        <span className="text-gray-400 text-sm select-none">{open ? '▲' : '▼'}</span>
      </button>

      {/* Main OSV Body */}
      <div className={open ? 'block space-y-4 border-t border-gray-100 print:border-none' : 'hidden print:block'}>
        {/* Controls & Filter Bar */}
        <div className="p-5 pb-0 space-y-4 print:p-0">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs text-gray-500 print:hidden">
                Рух коштів за обраний період із деталізацією нарахувань, оплат та повернень.
              </p>
            </div>

            <div className="flex items-center gap-2 print:hidden">
              <button
                onClick={() => toggleAllMonths(true)}
                className="px-2.5 py-1 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
              >
                ➕ Розгорнути все
              </button>
              <button
                onClick={() => toggleAllMonths(false)}
                className="px-2.5 py-1 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
              >
                ➖ Згорнути все
              </button>

              <button
                onClick={handleExportExcel}
                disabled={!data}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-lg border border-emerald-200 transition-colors shadow-sm disabled:opacity-50"
              >
                <span>📥</span> Excel (.xlsx)
              </button>

              <button
                onClick={handleExportPDF}
                disabled={!data}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-iris-50 hover:bg-iris-100 text-iris-700 text-xs font-semibold rounded-lg border border-iris-200 transition-colors shadow-sm disabled:opacity-50"
              >
                <span>📄</span> Друк / PDF
              </button>
            </div>
          </div>

        {/* Filter Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-gray-50 p-3 rounded-lg border border-gray-100 print:bg-white print:border-none print:p-0">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Період:</label>
            <select
              value={periodPreset}
              onChange={(e) => handlePresetChange(e.target.value as any)}
              className="w-full text-xs font-medium bg-white border border-gray-300 rounded-md px-2.5 py-1.5 focus:ring-1 focus:ring-iris-500 focus:border-iris-500 print:hidden"
            >
              <option value="current_year">Поточний {currentYear} рік</option>
              <option value="last_year">Минулий {currentYear - 1} рік</option>
              <option value="custom">Довільний період</option>
            </select>
            <span className="hidden print:inline text-xs font-medium text-gray-800">
              З {startDate} по {endDate}
            </span>
          </div>

          {periodPreset === 'custom' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">З дати:</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full text-xs bg-white border border-gray-300 rounded-md px-2.5 py-1.5 focus:ring-1 focus:ring-iris-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">По дату:</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full text-xs bg-white border border-gray-300 rounded-md px-2.5 py-1.5 focus:ring-1 focus:ring-iris-500"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Фінансовий рахунок:</label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full text-xs font-medium bg-white border border-gray-300 rounded-md px-2.5 py-1.5 focus:ring-1 focus:ring-iris-500 focus:border-iris-500 print:hidden"
            >
              <option value="">Усі рахунки (Зведений)</option>
              {accounts?.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name}
                </option>
              ))}
            </select>
            <span className="hidden print:inline text-xs font-medium text-gray-800">
              {selectedAccountId
                ? accounts?.find((a) => a.id === selectedAccountId)?.name || 'Обраний рахунок'
                : 'Усі рахунки (Зведений)'}
            </span>
          </div>
        </div>
      </div>

      {/* Report Content State */}
      {isLoading && (
        <div className="p-8 text-center text-sm text-gray-400">Формування ведомості...</div>
      )}

      {isError && (
        <div className="p-6 text-center text-sm text-rose-600">
          Помилка при завантаженні даних ведомості.
          <button onClick={() => refetch()} className="underline ml-2">
            Спробувати знову
          </button>
        </div>
      )}

      {data && (
        <div className="p-5 pt-0 space-y-4 print:p-0">
          {/* Printable Document Title */}
          <div className="hidden print:block text-center space-y-1 mb-4">
            <h1 className="text-xl font-bold text-gray-900">АКТ СВЕРКИ ВЗАЄМОРОЗРАХУНКІВ</h1>
            <p className="text-sm text-gray-700">
              Клієнт: <strong>{data.child.full_name}</strong> ({data.child.group_name || 'Без групи'})
            </p>
            <p className="text-xs text-gray-500">
              Період: з {data.period.start_date} по {data.period.end_date} | Рахунок:{' '}
              {selectedAccountId
                ? accounts?.find((a) => a.id === selectedAccountId)?.name || 'Вибраний рахунок'
                : 'Усі рахунки'}
            </p>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 print:grid-cols-5 print:gap-2">
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-center">
              <span className="block text-[11px] font-medium text-gray-500">Вхідний баланс</span>
              <span className={`text-sm font-bold ${data.opening_balance >= 0 ? 'text-green-700' : 'text-rose-600'}`}>
                {formatMoney(data.opening_balance)}
              </span>
            </div>

            <div className="bg-rose-50/50 p-3 rounded-lg border border-rose-100 text-center">
              <span className="block text-[11px] font-medium text-rose-700">Нараховано</span>
              <span className="text-sm font-bold text-rose-700">
                {formatMoney(data.totals.accruals)}
              </span>
            </div>

            <div className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-100 text-center">
              <span className="block text-[11px] font-medium text-emerald-700">Сплачено</span>
              <span className="text-sm font-bold text-emerald-700">
                {formatMoney(data.totals.payments, true)}
              </span>
            </div>

            <div className="bg-indigo-50/50 p-3 rounded-lg border border-indigo-100 text-center">
              <span className="block text-[11px] font-medium text-indigo-700">Возврат</span>
              <span className="text-sm font-bold text-indigo-700">
                {formatMoney(data.totals.refunds, true)}
              </span>
            </div>

            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-center col-span-2 sm:col-span-1">
              <span className="block text-[11px] font-medium text-gray-500">Вихідний баланс</span>
              <span className={`text-sm font-bold ${data.closing_balance >= 0 ? 'text-green-700' : 'text-rose-600'}`}>
                {formatMoney(data.closing_balance)}
              </span>
            </div>
          </div>

          {/* Main OSV Table */}
          <div className="overflow-x-auto border border-gray-200 rounded-lg print:border-gray-400">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-100 text-gray-700 font-semibold border-b border-gray-200 print:bg-gray-200">
                  <th className="py-2.5 px-3">Період (місяць)</th>
                  <th className="py-2.5 px-3 text-right">Баланс на 1 число</th>
                  <th className="py-2.5 px-3 text-right">Нараховано</th>
                  <th className="py-2.5 px-3 text-right">Сплачено</th>
                  <th className="py-2.5 px-3 text-right">Возврат</th>
                  <th className="py-2.5 px-3 text-right">Баланс на кінець</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data.months.map((m: OSVMonthData) => {
                  const isExpanded = !!expandedMonths[m.month]

                  return (
                    <MonthRowGroup
                      key={m.month}
                      monthData={m}
                      isExpanded={isExpanded}
                      accrualsExpanded={!!expandedAccruals[m.month]}
                      paymentsExpanded={!!expandedPayments[m.month]}
                      refundsExpanded={!!expandedRefunds[m.month]}
                      onToggleMonth={() => toggleMonth(m.month)}
                      onToggleAccruals={() =>
                        setExpandedAccruals((prev) => ({ ...prev, [m.month]: !prev[m.month] }))
                      }
                      onTogglePayments={() =>
                        setExpandedPayments((prev) => ({ ...prev, [m.month]: !prev[m.month] }))
                      }
                      onToggleRefunds={() =>
                        setExpandedRefunds((prev) => ({ ...prev, [m.month]: !prev[m.month] }))
                      }
                    />
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-900 text-white font-bold text-xs print:bg-gray-800 print:text-black">
                  <td className="py-3 px-3">🚀 РАЗОМ ЗА ПЕРІОД</td>
                  <td className="py-3 px-3 text-right">{formatMoney(data.opening_balance)}</td>
                  <td className="py-3 px-3 text-right text-rose-300 print:text-rose-800">
                    {formatMoney(data.totals.accruals)}
                  </td>
                  <td className="py-3 px-3 text-right text-emerald-300 print:text-emerald-800">
                    {formatMoney(data.totals.payments, true)}
                  </td>
                  <td className="py-3 px-3 text-right text-indigo-300 print:text-indigo-800">
                    {formatMoney(data.totals.refunds, true)}
                  </td>
                  <td className="py-3 px-3 text-right">{formatMoney(data.closing_balance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

interface MonthRowGroupProps {
  monthData: OSVMonthData
  isExpanded: boolean
  accrualsExpanded: boolean
  paymentsExpanded: boolean
  refundsExpanded: boolean
  onToggleMonth: () => void
  onToggleAccruals: () => void
  onTogglePayments: () => void
  onToggleRefunds: () => void
}

function MonthRowGroup({
  monthData,
  isExpanded,
  accrualsExpanded,
  paymentsExpanded,
  refundsExpanded,
  onToggleMonth,
  onToggleAccruals,
  onTogglePayments,
  onToggleRefunds,
}: MonthRowGroupProps) {
  const m = monthData
  const hasAccruals = m.accruals.items.length > 0
  const hasPayments = m.payments.items.length > 0
  const hasRefunds = m.refunds.items.length > 0

  return (
    <>
      {/* Month Main Row */}
      <tr className="hover:bg-gray-50/80 transition-colors font-medium text-gray-900">
        <td className="py-2.5 px-3 flex items-center gap-1.5 cursor-pointer select-none" onClick={onToggleMonth}>
          <button className="w-5 h-5 flex items-center justify-center text-xs text-gray-500 font-bold bg-gray-100 rounded hover:bg-gray-200 print:hidden">
            {isExpanded ? '▾' : '▸'}
          </button>
          <span>{m.month_label}</span>
        </td>

        <td className={`py-2.5 px-3 text-right font-mono ${m.balance_start >= 0 ? 'text-gray-700' : 'text-rose-600 font-semibold'}`}>
          {formatMoney(m.balance_start)}
        </td>

        {/* Accruals Column with drill-down icon */}
        <td className="py-2.5 px-3 text-right font-mono text-rose-600">
          <div className="flex items-center justify-end gap-1">
            <span>{formatMoney(m.accruals.total)}</span>
            {hasAccruals && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (!isExpanded) onToggleMonth()
                  onToggleAccruals()
                }}
                className="w-4 h-4 flex items-center justify-center text-[10px] text-rose-700 bg-rose-100 hover:bg-rose-200 rounded font-bold print:hidden"
                title="Деталізація нарахувань"
              >
                {accrualsExpanded && isExpanded ? '−' : '+'}
              </button>
            )}
          </div>
        </td>

        {/* Payments Column with drill-down icon */}
        <td className="py-2.5 px-3 text-right font-mono text-emerald-700">
          <div className="flex items-center justify-end gap-1">
            <span>{formatMoney(m.payments.total, true)}</span>
            {hasPayments && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (!isExpanded) onToggleMonth()
                  onTogglePayments()
                }}
                className="w-4 h-4 flex items-center justify-center text-[10px] text-emerald-700 bg-emerald-100 hover:bg-emerald-200 rounded font-bold print:hidden"
                title="Деталізація оплат"
              >
                {paymentsExpanded && isExpanded ? '−' : '+'}
              </button>
            )}
          </div>
        </td>

        {/* Refunds Column */}
        <td className="py-2.5 px-3 text-right font-mono text-indigo-700">
          <div className="flex items-center justify-end gap-1">
            <span>{formatMoney(m.refunds.total, true)}</span>
            {hasRefunds && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (!isExpanded) onToggleMonth()
                  onToggleRefunds()
                }}
                className="w-4 h-4 flex items-center justify-center text-[10px] text-indigo-700 bg-indigo-100 hover:bg-indigo-200 rounded font-bold print:hidden"
                title="Деталізація повернень"
              >
                {refundsExpanded && isExpanded ? '−' : '+'}
              </button>
            )}
          </div>
        </td>

        <td className={`py-2.5 px-3 text-right font-mono font-semibold ${m.balance_end >= 0 ? 'text-green-700' : 'text-rose-600'}`}>
          {formatMoney(m.balance_end)}
        </td>
      </tr>

      {/* Expanded Details Row */}
      {isExpanded && (
        <tr className="bg-gray-50/70 border-b border-gray-200">
          <td colSpan={6} className="p-3 pl-8">
            <div className="space-y-3 bg-white p-3 rounded-lg border border-gray-200 text-xs shadow-inner">
              {/* Accruals Details Subtable */}
              {accrualsExpanded && (
                <div className="space-y-1.5">
                  <div
                    onClick={onToggleAccruals}
                    className="flex items-center gap-2 font-bold text-rose-700 cursor-pointer select-none border-b border-rose-100 pb-1"
                  >
                    <span>{accrualsExpanded ? '▾' : '▸'} Нараховано послуг ({m.accruals.items.length}):</span>
                    <span className="font-mono">{formatMoney(m.accruals.total)}</span>
                  </div>

                  {m.accruals.items.length > 0 ? (
                    <div className="pl-3 space-y-1">
                      {m.accruals.items.map((item) => (
                        <div key={item.id} className="flex flex-wrap items-center justify-between text-gray-700 py-0.5 border-b border-gray-50 last:border-none">
                          <span className="font-medium text-gray-900">
                            • {item.activity_name} {item.count && item.count > 1 ? `(${item.count})` : ''}
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="text-[11px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                              Рахунок: {item.account_name}
                            </span>
                            <span className="font-mono font-semibold text-rose-600">
                              {formatMoney(item.amount)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-gray-400 pl-3 italic text-[11px]">Немає нарахувань за цей місяць</div>
                  )}
                </div>
              )}

              {/* Payments Details Subtable */}
              {paymentsExpanded && (
                <div className="space-y-1.5 pt-1">
                  <div
                    onClick={onTogglePayments}
                    className="flex items-center gap-2 font-bold text-emerald-700 cursor-pointer select-none border-b border-emerald-100 pb-1"
                  >
                    <span>{paymentsExpanded ? '▾' : '▸'} Поступило оплат ({m.payments.items.length}):</span>
                    <span className="font-mono">{formatMoney(m.payments.total, true)}</span>
                  </div>

                  {m.payments.items.length > 0 ? (
                    <div className="pl-3 space-y-1">
                      {m.payments.items.map((item) => (
                        <div key={item.id} className="flex flex-wrap items-center justify-between text-gray-700 py-1 border-b border-gray-50 last:border-none">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-gray-800">• {item.transaction_date}</span>
                              <span className="text-[11px] font-medium bg-emerald-50 text-emerald-800 px-1.5 py-0.2 rounded border border-emerald-200">
                                {item.payment_method}
                              </span>
                            </div>
                            {(item.note || item.receipt_url) && (
                              <div className="text-[11px] text-gray-500 pl-2">
                                {item.note && <span>Коментар: {item.note}</span>}
                                {item.receipt_url && (
                                  <a
                                    href={item.receipt_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="ml-2 text-iris-600 hover:underline font-medium print:hidden"
                                  >
                                    🔗 Чек
                                  </a>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="text-[11px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                              Цільовий рахунок: {item.account_name}
                            </span>
                            <span className="font-mono font-semibold text-emerald-700">
                              {formatMoney(item.amount, true)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-gray-400 pl-3 italic text-[11px]">Немає оплат за цей місяць</div>
                  )}
                </div>
              )}

              {/* Refunds Details Subtable */}
              {refundsExpanded && (
                <div className="space-y-1.5 pt-1">
                  <div
                    onClick={onToggleRefunds}
                    className="flex items-center gap-2 font-bold text-indigo-700 cursor-pointer select-none border-b border-indigo-100 pb-1"
                  >
                    <span>{refundsExpanded ? '▾' : '▸'} Повернення коштів ({m.refunds.items.length}):</span>
                    <span className="font-mono">{formatMoney(m.refunds.total, true)}</span>
                  </div>

                  {m.refunds.items.length > 0 ? (
                    <div className="pl-3 space-y-1">
                      {m.refunds.items.map((item, idx) => (
                        <div key={idx} className="flex flex-wrap items-center justify-between text-gray-700 py-0.5 border-b border-gray-50 last:border-none">
                          <span className="font-medium text-gray-900">
                            • Повернення по рахунку: {item.account_name}
                          </span>
                          <span className="font-mono font-semibold text-indigo-700">
                            {formatMoney(item.amount, true)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-gray-400 pl-3 italic text-[11px]">Немає повернень за цей місяць</div>
                  )}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
