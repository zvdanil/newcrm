import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { staffApi } from '../../api/staff.api'
import { PayForm, ManualAccrualForm } from '../Staff/StaffCardPage'
import { localMonthStr, shiftMonth } from '../../utils/dateStr'
import { SalaryGridTab } from './SalaryGridTab'

type Tab = 'summary' | 'grid'

function fmt(n: number) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function prevMonth(m: string) { return shiftMonth(m, -1) }
function nextMonth(m: string) { return shiftMonth(m, 1) }

function monthLabel(m: string) {
  const [y, mo] = m.split('-')
  const names = ['Січень','Лютий','Березень','Квітень','Травень','Червень',
                  'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень']
  return `${names[Number(mo) - 1]} ${y}`
}

function AccrualModalWrapper({ staffId, onDone }: { staffId: string, onDone: () => void }) {
  const { data: rates = [], isLoading } = useQuery({
    queryKey: ['staff-rates', staffId],
    queryFn: () => staffApi.getRates(staffId),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">Завантаження...</div>
        ) : (
          <ManualAccrualForm staffId={staffId} rates={rates} onDone={onDone} />
        )}
      </div>
    </div>
  )
}

function PayModalWrapper({ staffId, onDone }: { staffId: string, onDone: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <PayForm staffId={staffId} onDone={onDone} />
      </div>
    </div>
  )
}

export function SalaryJournalPage() {
  const qc = useQueryClient()
  const [month, setMonth] = useState(() => localMonthStr())
  const [tab, setTab] = useState<Tab>('summary')
  const [payStaffId, setPayStaffId] = useState<string | null>(null)
  const [accrualStaffId, setAccrualStaffId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['salary-journal', month],
    queryFn: () => staffApi.getJournal(month),
  })

  const rows = data?.rows ?? []

  const filteredRows = rows.filter(r => {
    if (!search) return true
    const q = search.toLowerCase()
    return r.full_name.toLowerCase().includes(q) || r.specialization?.toLowerCase().includes(q)
  })

  const totals = filteredRows.reduce(
    (acc, r) => ({
      gross:               acc.gross               + r.summary.gross,
      deduction:           acc.deduction           + r.summary.deduction,
      net:                 acc.net                 + r.summary.net,
      paid:                acc.paid                + r.summary.paid,
      balance:             acc.balance             + r.summary.balance,
      debtPreviousPeriods: acc.debtPreviousPeriods + r.summary.debtPreviousPeriods,
    }),
    { gross: 0, deduction: 0, net: 0, paid: 0, balance: 0, debtPreviousPeriods: 0 }
  )

  return (
    <div className="space-y-6">
      {payStaffId && (
        <PayModalWrapper 
          staffId={payStaffId} 
          onDone={() => { 
            setPayStaffId(null)
            qc.invalidateQueries({ queryKey: ['salary-journal'] })
          }} 
        />
      )}
      {accrualStaffId && (
        <AccrualModalWrapper 
          staffId={accrualStaffId} 
          onDone={() => { 
            setAccrualStaffId(null)
            qc.invalidateQueries({ queryKey: ['salary-journal'] })
          }} 
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Журнал зарплати</h1>
          <p className="text-sm text-gray-500">{filteredRows.length} співробітників</p>
        </div>
        {/* Month navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonth(prevMonth(month))}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            ←
          </button>
          <span className="text-sm font-medium text-gray-700 min-w-[140px] text-center">
            {monthLabel(month)}
          </span>
          <button
            onClick={() => setMonth(nextMonth(month))}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            →
          </button>
        </div>
      </div>

      {/* Tabs + Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          <button
            onClick={() => setTab('summary')}
            className={`px-4 py-2 font-medium transition-colors ${
              tab === 'summary'
                ? 'bg-iris-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Зведення
          </button>
          <button
            onClick={() => setTab('grid')}
            className={`px-4 py-2 font-medium transition-colors border-l border-gray-200 ${
              tab === 'grid'
                ? 'bg-iris-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            Журнал
          </button>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Пошук за ПІБ..."
          className="flex-1 min-w-48 rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
        />
      </div>

      {/* Grid tab */}
      {tab === 'grid' && (
        <SalaryGridTab month={month} search={search} />
      )}

      {/* Summary table */}
      {tab === 'summary' && <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
        ) : filteredRows.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">Дані відсутні</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Співробітник</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Тип</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Нараховано (gross)</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Утримання</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">До виплати (net)</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Виплачено</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Залишок</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRows.map(r => (
                <tr key={r.id} className="hover:bg-gray-50 group">
                  <td className="px-4 py-3">
                    <Link
                      to={`/staff/${r.id}`}
                      className="font-medium text-iris-700 hover:text-iris-900"
                    >
                      {r.full_name}
                    </Link>
                    {r.specialization && (
                      <div className="text-xs text-gray-400">{r.specialization}</div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      r.type === 'partner'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-blue-50 text-blue-700'
                    }`}>
                      {r.type === 'partner' ? 'Партнер / ФОП' : 'Співробітник'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700">{fmt(r.summary.gross)}</td>
                  <td className="px-4 py-3 text-right text-red-500">
                    {r.summary.deduction > 0 ? `−${fmt(r.summary.deduction)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900">{fmt(r.summary.net)}</td>
                  <td className="px-4 py-3 text-right text-green-700">{fmt(r.summary.paid)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={r.summary.balance < 0 ? 'text-red-600 font-medium' : 'text-gray-500'}>
                      {r.summary.balance < 0 ? `−${fmt(Math.abs(r.summary.balance))}` : fmt(r.summary.balance)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setAccrualStaffId(r.id)} className="text-xs px-2.5 py-1.5 border border-iris-200 text-iris-600 rounded-lg hover:bg-iris-50 font-medium">
                        + Нарахування
                      </button>
                      <button onClick={() => setPayStaffId(r.id)} className="text-xs px-2.5 py-1.5 bg-green-700 text-white rounded-lg hover:bg-green-800 font-medium">
                        Виплата ЗП
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Totals */}
            <tfoot className="bg-gray-50 border-t-2 border-gray-200">
              <tr>
                <td className="px-4 py-3 font-semibold text-gray-700" colSpan={2}>
                  Разом
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-700">{fmt(totals.gross)}</td>
                <td className="px-4 py-3 text-right font-semibold text-red-500">
                  {totals.deduction > 0 ? `−${fmt(totals.deduction)}` : '—'}
                </td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900">{fmt(totals.net)}</td>
                <td className="px-4 py-3 text-right font-semibold text-green-700">{fmt(totals.paid)}</td>
                <td className="px-4 py-3 text-right font-semibold">
                  <span className={totals.balance < 0 ? 'text-red-600' : 'text-gray-700'}>
                    {totals.balance < 0 ? `−${fmt(Math.abs(totals.balance))}` : fmt(totals.balance)}
                  </span>
                </td>
                <td className="px-4 py-3"></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>}

    </div>
  )
}
