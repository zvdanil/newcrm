import React, { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { reportsApi, type PnL2Row } from '../../api/reports.api'
import { accountsApi } from '../../api/accounts.api'
import * as XLSX from 'xlsx'

/**
 * PnL 3 — змішана база:
 *  - Доходи та повернення: за НАРАХУВАННЯМ (очікувані надходження)
 *  - Зарплата та витрати: за ФАКТИЧНОЮ ОПЛАТОЮ
 *  - Повернення відображаються окремо, але зменшують дохід
 *  - Вивід коштів / дивіденди — як у PnL 2 (по оплаті)
 * Дані беруться з того ж ендпоінту, що й PnL 2 (/reports/pnl2).
 */

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
  if (Math.abs(n) < 0.005) return '0'
  const s = Math.abs(n).toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return n < 0 ? `−${s}` : s
}

function monthLabel(isoDate: string) {
  const d = new Date(isoDate + 'T00:00:00')
  return d.toLocaleDateString('uk-UA', { month: 'short', year: 'numeric' })
}

// ─── row calculations ───────────────────────────────────────────────────────

const incomeAccrued = (r: PnL2Row) => r.accounts.reduce((s, ac) => s + ac.accrued, 0)
const refundsAccrued = (r: PnL2Row) => r.refunds?.accrued ?? 0
const netIncome = (r: PnL2Row) => incomeAccrued(r) - refundsAccrued(r)
const expensesPaid = (r: PnL2Row) => r.salary.paid + r.expenses.paid
const opProfit = (r: PnL2Row) => netIncome(r) - expensesPaid(r)
const remaining = (r: PnL2Row) => opProfit(r) - r.withdrawals.paid - r.dividends.paid

export function PnL3Report() {
  const [fromMonth, setFromMonth] = useState(sixMonthsAgo())
  const [toMonth, setToMonth] = useState(currentYM())
  const [committed, setCommitted] = useState<{ from: string; to: string; accountIds: string[] } | null>(null)
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const tableRef = useRef<HTMLDivElement>(null)

  const { data: accountsList } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list
  })

  const { data, isFetching, isError } = useQuery({
    queryKey: ['report-pnl3', committed],
    queryFn: () => reportsApi.getPnL2(committed!.from, committed!.to, committed!.accountIds),
    enabled: !!committed,
    staleTime: 0,
  })

  const months = data?.months ?? []
  const accounts = data?.accounts ?? []
  const rows = data?.rows ?? []

  const toggleExpand = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  const handleGenerate = () => {
    setExpanded({})
    setCommitted({ from: fromMonth, to: toMonth, accountIds: selectedAccounts })
    setTimeout(() => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
  }

  const toggleAccount = (accId: string) => {
    setSelectedAccounts(prev => prev.includes(accId) ? prev.filter(id => id !== accId) : [...prev, accId])
  }

  // ─── unions (only items with non-zero value on the relevant basis) ──────────

  const uniq = (pairs: Array<[string, string, number]>) => {
    const names: Record<string, string> = {}
    const used: Record<string, boolean> = {}
    pairs.forEach(([id, name, v]) => {
      names[id] = name
      if (Math.abs(v) > 0.005) used[id] = true
    })
    return Object.keys(names).filter(id => used[id]).map(id => ({ id, name: names[id] }))
  }

  const incomeAcc = (r: PnL2Row, accId: string) => r.accounts.find(a => a.account_id === accId)
  const refundAcc = (r: PnL2Row, accId: string) => r.refunds?.details?.find(a => a.account_id === accId)

  const activitiesOf = (getAcc: (r: PnL2Row) => PnL2Row['accounts'][0] | undefined) =>
    uniq(rows.flatMap(r => (getAcc(r)?.details ?? []).map(d => [d.activity_id, d.activity_name, d.accrued] as [string, string, number])))

  const childrenOf = (getAcc: (r: PnL2Row) => PnL2Row['accounts'][0] | undefined, actId: string) =>
    uniq(rows.flatMap(r => (getAcc(r)?.details.find(d => d.activity_id === actId)?.children ?? [])
      .map(c => [c.child_id, c.child_name, c.accrued] as [string, string, number])))

  const getUniqueStaff = () =>
    uniq(rows.flatMap(r => r.salary.details.map(d => [d.staff_id, d.staff_name, d.paid] as [string, string, number])))

  const getUniqueCategories = () =>
    uniq(rows.flatMap(r => r.expenses.details.map(d => [d.category_id, d.category_name, d.paid] as [string, string, number])))

  const getCategoryPaidTransactions = (categoryId: string) => {
    const map: Record<string, { id: string; date: string; note: string; payments: Record<string, number> }> = {}
    rows.forEach(r => {
      r.expenses.details.find(d => d.category_id === categoryId)?.transactions.forEach(t => {
        if (t.type !== 'paid') return
        if (!map[t.id]) map[t.id] = { id: t.id, date: t.date, note: t.note, payments: {} }
        map[t.id].payments[r.month] = (map[t.id].payments[r.month] || 0) + t.amount
      })
    })
    return Object.values(map).sort((x, y) => x.date.localeCompare(y.date))
  }

  const getWithdrawalTransactions = () =>
    rows.flatMap(r => r.withdrawals.transactions.map(t => ({ ...t, month: r.month })))
      .sort((x, y) => x.date.localeCompare(y.date))

  const getDividendTransactions = () =>
    rows.flatMap(r => r.dividends.transactions.map(t => ({ ...t, month: r.month })))
      .sort((x, y) => x.date.localeCompare(y.date))

  // ─── Excel ──────────────────────────────────────────────────────────────────

  const handleExportExcel = () => {
    const csvData: (string | number)[][] = [['Показник', ...months.map(monthLabel)]]
    const addRow = (label: string, get: (r: PnL2Row) => number) => {
      csvData.push([label, ...rows.map(r => Math.round(get(r) * 100) / 100)])
    }

    addRow('ДОХОДИ (нараховано)', incomeAccrued)
    accounts.forEach(a => {
      addRow(`  ${a.name}`, r => incomeAcc(r, a.id)?.accrued ?? 0)
      activitiesOf(r => incomeAcc(r, a.id)).forEach(act => {
        addRow(`    └ ${act.name}`, r => incomeAcc(r, a.id)?.details.find(d => d.activity_id === act.id)?.accrued ?? 0)
        childrenOf(r => incomeAcc(r, a.id), act.id).forEach(kid => {
          addRow(`      └ ${kid.name}`, r => incomeAcc(r, a.id)?.details.find(d => d.activity_id === act.id)
            ?.children.find(c => c.child_id === kid.id)?.accrued ?? 0)
        })
      })
    })
    addRow('Повернення за пропуски (нараховано, зменшує дохід)', r => -refundsAccrued(r))
    accounts.forEach(a => {
      const acts = activitiesOf(r => refundAcc(r, a.id))
      if (!acts.length) return
      addRow(`  Рахунок: ${a.name}`, r => -(refundAcc(r, a.id)?.accrued ?? 0))
      acts.forEach(act => {
        addRow(`    └ ${act.name}`, r => -(refundAcc(r, a.id)?.details.find(d => d.activity_id === act.id)?.accrued ?? 0))
        childrenOf(r => refundAcc(r, a.id), act.id).forEach(kid => {
          addRow(`      └ ${kid.name}`, r => -(refundAcc(r, a.id)?.details.find(d => d.activity_id === act.id)
            ?.children.find(c => c.child_id === kid.id)?.accrued ?? 0))
        })
      })
    })
    addRow('Чистий дохід', netIncome)

    addRow('Зарплата (сплачено)', r => r.salary.paid)
    getUniqueStaff().forEach(s => addRow(`  └ ${s.name}`, r => r.salary.details.find(d => d.staff_id === s.id)?.paid ?? 0))
    addRow('Витрати (сплачено)', r => r.expenses.paid)
    getUniqueCategories().forEach(c => {
      addRow(`  └ ${c.name}`, r => r.expenses.details.find(d => d.category_id === c.id)?.paid ?? 0)
      getCategoryPaidTransactions(c.id).forEach(tx =>
        addRow(`      ${tx.date}  ${tx.note || '(без примітки)'}`, r => tx.payments[r.month] ?? 0))
    })
    addRow('Всього фактичних витрат', expensesPaid)

    addRow('Операційний прибуток', opProfit)
    addRow('Вивід коштів', r => r.withdrawals.paid)
    getWithdrawalTransactions().forEach(tx =>
      addRow(`    ${tx.date}  ${tx.note || '(без примітки)'}`, r => r.month === tx.month ? tx.amount : 0))
    addRow('Дивіденди', r => r.dividends.paid)
    getDividendTransactions().forEach(tx =>
      addRow(`    ${tx.date}  [${tx.recipient || 'Учасник'}]  ${tx.note || '(без примітки)'}`, r => r.month === tx.month ? tx.amount : 0))
    addRow('Залишок після розподілу', remaining)

    const ws = XLSX.utils.aoa_to_sheet(csvData)
    ws['!cols'] = [{ wch: 50 }, ...months.map(() => ({ wch: 14 }))]
    ws['!freeze'] = { xSplit: 1, ySplit: 1 }
    const range = XLSX.utils.decode_range(ws['!ref']!)
    for (let R = 1; R <= range.e.r; R++) {
      for (let C = 1; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })]
        if (cell && cell.t === 'n') cell.z = '#,##0.00'
      }
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'PnL 3')
    XLSX.writeFile(wb, `pnl3-${fromMonth}-${toMonth}.xlsx`)
  }

  // ─── render helpers ─────────────────────────────────────────────────────────

  type Level = 0 | 1 | 2 | 3
  const LEVEL_STYLE: Record<Level, { pad: string; text: string; cell: string }> = {
    0: { pad: 'px-4', text: 'font-medium text-gray-700', cell: 'py-2 text-gray-600' },
    1: { pad: 'pl-8 pr-2', text: 'text-xs text-gray-600', cell: 'py-1.5 text-xs text-gray-500' },
    2: { pad: 'pl-14 pr-2', text: 'text-[11px] text-gray-500', cell: 'py-1 text-[11px] text-gray-400' },
    3: { pad: 'pl-20 pr-2', text: 'text-[11px] text-gray-400', cell: 'py-1 text-[11px] text-gray-400' },
  }

  const DataRow = ({ label, level, get, expandKey, bg = 'bg-white', title, emptyAsDash }: {
    label: React.ReactNode
    level: Level
    get: (r: PnL2Row) => number
    expandKey?: string
    bg?: string
    title?: string
    emptyAsDash?: boolean
  }) => {
    const st = LEVEL_STYLE[level]
    return (
      <tr className={bg}>
        <td className={`sticky left-0 z-10 ${level === 0 ? bg : 'bg-gray-50'} ${st.pad} py-1.5 border-r border-gray-200 ${st.text} max-w-[360px] whitespace-normal break-words`} title={title}>
          <div className="flex items-center gap-1.5">
            {expandKey && (
              <button onClick={() => toggleExpand(expandKey)} className="text-gray-400 hover:text-gray-600 focus:outline-none text-[10px]">
                {expanded[expandKey] ? '▼' : '▶'}
              </button>
            )}
            <span>{label}</span>
          </div>
        </td>
        {rows.map(r => {
          const v = get(r)
          return (
            <td key={r.month} className={`px-3 ${st.cell} text-right font-mono border-r border-gray-200`}>
              {emptyAsDash && Math.abs(v) < 0.005 ? '—' : fmtMoney(v)}
            </td>
          )
        })}
      </tr>
    )
  }

  const SectionHeader = ({ label }: { label: string }) => (
    <tr className="bg-gray-100 font-semibold text-gray-900 border-t-2 border-gray-200">
      <td className="sticky left-0 z-10 bg-gray-100 px-4 py-2 border-r border-gray-200">{label}</td>
      {months.map(m => <td key={m} className="border-r border-gray-200" />)}
    </tr>
  )

  const TotalRow = ({ label, get, cls, colored }: { label: string; get: (r: PnL2Row) => number; cls: string; colored?: boolean }) => (
    <tr className={`${cls} font-semibold border-t-2 border-b-2`}>
      <td className={`sticky left-0 z-10 ${cls} px-4 py-2.5 border-r border-gray-200`}>{label}</td>
      {rows.map(r => {
        const v = get(r)
        return (
          <td key={r.month} className={`px-3 py-2.5 text-right font-mono border-r border-gray-200 ${colored ? (v >= 0 ? 'text-green-700' : 'text-red-600') : ''}`}>
            {fmtMoney(v)}
          </td>
        )
      })}
    </tr>
  )

  // Income / refund tree (account → activity → child), accrued basis, sign = 1 or -1
  const renderAccrualTree = (
    prefix: string,
    getAcc: (r: PnL2Row, accId: string) => PnL2Row['accounts'][0] | undefined,
    sign: number,
    baseLevel: 0 | 1,
    accountLabel: (name: string) => string,
  ) => accounts.map((a, idx) => {
    const acts = activitiesOf(r => getAcc(r, a.id))
    if (baseLevel === 1 && acts.length === 0) return null
    const accKey = `${prefix}-acc::${a.id}`
    return (
      <React.Fragment key={`${prefix}-${a.id}`}>
        <DataRow
          label={accountLabel(a.name)}
          level={baseLevel}
          bg={baseLevel === 0 ? (idx % 2 === 0 ? 'bg-white' : 'bg-gray-50') : 'bg-gray-50'}
          expandKey={acts.length ? accKey : undefined}
          get={r => sign * (getAcc(r, a.id)?.accrued ?? 0)}
        />
        {expanded[accKey] && acts.map(act => {
          const actKey = `${prefix}-act::${a.id}::${act.id}`
          const kids = childrenOf(r => getAcc(r, a.id), act.id)
          const actDetail = (r: PnL2Row) => getAcc(r, a.id)?.details.find(d => d.activity_id === act.id)
          return (
            <React.Fragment key={act.id}>
              <DataRow
                label={act.name}
                level={(baseLevel + 1) as Level}
                bg="bg-gray-50"
                expandKey={kids.length ? actKey : undefined}
                get={r => sign * (actDetail(r)?.accrued ?? 0)}
              />
              {expanded[actKey] && kids.map(kid => (
                <DataRow
                  key={kid.id}
                  label={kid.name}
                  level={(baseLevel + 2) as Level}
                  bg="bg-gray-50"
                  get={r => sign * (actDetail(r)?.children.find(c => c.child_id === kid.id)?.accrued ?? 0)}
                />
              ))}
            </React.Fragment>
          )
        })}
      </React.Fragment>
    )
  })

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div>
          <h2 className="font-medium text-gray-900">PnL 3 звіт</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Доходи — за нарахуванням (очікувані надходження), витрати — за фактичною оплатою
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Період</label>
            <div className="flex items-center gap-2">
              <input type="month" value={fromMonth} onChange={e => setFromMonth(e.target.value)}
                className="rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
              <span className="text-gray-400">—</span>
              <input type="month" value={toMonth} onChange={e => setToMonth(e.target.value)}
                className="rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
            </div>
          </div>

          <div className="space-y-1.5 min-w-[200px] flex-1 max-w-sm">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Рахунки</label>
            <div className="relative group">
              <div className="min-h-[38px] p-1.5 bg-white border border-gray-300 rounded-lg shadow-sm flex flex-wrap gap-1 items-center cursor-pointer hover:border-iris-400 transition-colors">
                {selectedAccounts.length === 0 ? (
                  <span className="text-sm text-gray-400 px-2 py-0.5">Всі рахунки (Загальний звіт)</span>
                ) : (
                  selectedAccounts.map(accId => {
                    const acc = accountsList?.find(a => a.id === accId)
                    return (
                      <span key={accId} className="inline-flex items-center gap-1 px-2 py-0.5 bg-iris-50 text-iris-700 text-xs font-medium rounded border border-iris-100">
                        {acc?.name || accId}
                        <button onClick={(e) => { e.stopPropagation(); toggleAccount(accId) }} className="hover:text-iris-900 focus:outline-none">&times;</button>
                      </span>
                    )
                  })
                )}
              </div>
              <div className="absolute top-full left-0 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-30">
                {accountsList?.filter(a => a.is_active).map(acc => (
                  <label key={acc.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={selectedAccounts.includes(acc.id)} onChange={() => toggleAccount(acc.id)}
                      className="rounded border-gray-300 text-iris-600 focus:ring-iris-500" />
                    <span className="text-sm text-gray-700">{acc.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1 border-t border-gray-100">
          <button onClick={handleGenerate} disabled={isFetching}
            className="px-4 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {isFetching ? 'Формується...' : 'Сформувати звіт'}
          </button>
          {rows.length > 0 && (
            <button onClick={handleExportExcel} className="ml-auto text-sm text-iris-600 hover:text-iris-700 font-medium">
              ↓ Експорт Excel
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
                    <th className="sticky left-0 z-20 bg-gray-50 px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide border-r border-gray-200 min-w-[300px]">
                      Показник
                    </th>
                    {months.map(m => (
                      <th key={m} className="px-3 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide border-r border-gray-200 min-w-[120px]">
                        {monthLabel(m)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {/* INCOME — accrued */}
                  <SectionHeader label="ДОХОДИ (НАРАХОВАНО)" />
                  {renderAccrualTree('inc', incomeAcc, 1, 0, n => n)}
                  <TotalRow label="Всього нараховано доходів" get={incomeAccrued} cls="bg-iris-50 text-iris-950 border-iris-100" />

                  {/* Refunds — accrued, reduce income */}
                  <DataRow
                    label="Повернення за пропуски (зменшує дохід)"
                    level={0}
                    expandKey="refunds"
                    get={r => -refundsAccrued(r)}
                  />
                  {expanded['refunds'] && renderAccrualTree('ref', refundAcc, -1, 1, n => `Рахунок: ${n}`)}

                  <TotalRow label="Чистий дохід" get={netIncome} cls="bg-iris-100 text-iris-950 border-iris-200" />

                  {/* EXPENSES — paid */}
                  <SectionHeader label="ФАКТИЧНІ ВИТРАТИ (СПЛАЧЕНО)" />

                  <DataRow label="Зарплата персоналу" level={0} expandKey="salary" get={r => r.salary.paid} />
                  {expanded['salary'] && getUniqueStaff().map(s => (
                    <DataRow key={s.id} label={s.name} level={1} bg="bg-gray-50"
                      get={r => r.salary.details.find(d => d.staff_id === s.id)?.paid ?? 0} />
                  ))}

                  <DataRow label="Операційні витрати" level={0} bg="bg-gray-50" expandKey="expenses" get={r => r.expenses.paid} />
                  {expanded['expenses'] && getUniqueCategories().map(cat => {
                    const catKey = `category::${cat.id}`
                    const txs = getCategoryPaidTransactions(cat.id)
                    return (
                      <React.Fragment key={cat.id}>
                        <DataRow label={cat.name} level={1} bg="bg-gray-50" expandKey={txs.length ? catKey : undefined}
                          get={r => r.expenses.details.find(d => d.category_id === cat.id)?.paid ?? 0} />
                        {expanded[catKey] && txs.map(tx => (
                          <DataRow key={tx.id} level={2} bg="bg-gray-50" title={tx.note} emptyAsDash
                            label={<><span className="font-semibold text-gray-400 mr-2">{tx.date}</span>{tx.note || '(без примітки)'}</>}
                            get={r => tx.payments[r.month] ?? 0} />
                        ))}
                      </React.Fragment>
                    )
                  })}

                  <TotalRow label="Всього фактичних витрат" get={expensesPaid} cls="bg-amber-50 text-amber-950 border-amber-100" />

                  <TotalRow label="Операційний прибуток" get={opProfit} cls="bg-gray-50 text-gray-900 border-gray-200" colored />

                  {/* Distribution — as in PnL 2 */}
                  <SectionHeader label="РОЗПОДІЛ ПРИБУТКУ (ПО ОПЛАТІ)" />

                  <DataRow label="Вивід коштів" level={0} expandKey="withdrawals" get={r => r.withdrawals.paid} />
                  {expanded['withdrawals'] && getWithdrawalTransactions().map(tx => (
                    <DataRow key={tx.id} level={1} bg="bg-gray-50" title={tx.note} emptyAsDash
                      label={<><span className="font-semibold text-gray-400 mr-2">{tx.date}</span>{tx.note || '(без примітки)'}</>}
                      get={r => r.month === tx.month ? tx.amount : 0} />
                  ))}

                  <DataRow label="Дивіденди" level={0} bg="bg-gray-50" expandKey="dividends" get={r => r.dividends.paid} />
                  {expanded['dividends'] && getDividendTransactions().map(tx => (
                    <DataRow key={tx.id} level={1} bg="bg-gray-50" title={tx.note} emptyAsDash
                      label={<>
                        <span className="font-semibold text-gray-400 mr-2">{tx.date}</span>
                        <span className="font-medium text-iris-600 mr-2">[{tx.recipient || 'Учасник'}]</span>
                        {tx.note || '(без примітки)'}
                      </>}
                      get={r => r.month === tx.month ? tx.amount : 0} />
                  ))}

                  <TotalRow label="Залишок після розподілу" get={remaining} cls="bg-iris-50 text-iris-950 border-iris-200" colored />
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
