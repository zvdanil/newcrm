import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { staffApi, type SalaryTransaction } from '../../api/staff.api'
import {
  TxPopup,
  AccrualGroupPopup,
  PaymentGroupPopup,
  fmt,
} from '../../components/SalaryTransactionPopups'
import { ManualAccrualForm, PayForm } from '../Staff/StaffCardPage'

// ── helpers ────────────────────────────────────────────────────────────────

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return String(d.getDate())
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + 'T00:00:00').getDay()
  return day === 0 || day === 6
}

function dayOfWeekShort(dateStr: string): string {
  const names = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  return names[new Date(dateStr + 'T00:00:00').getDay()]
}

// ── Helpers ────────────────────────────────────────────────────────────────

const RATE_TYPE_SHORT: Record<string, string> = {
  per_lesson:    'за заняття',
  per_child:     'за дитину',
  group_lesson:  'за групу',
  fixed_monthly: 'оклад',
  hourly:        'год.',
  smart:         'смарт',
  bonus:         'бонус',
}

function accrualTooltipLine(tx: SalaryTransaction): string {
  const g   = Number(tx.gross_amount)
  const d   = Math.round(g * Number(tx.deduction_pct) / 100 * 100) / 100
  const net = g - d
  const meta = tx.metadata_json as Record<string, unknown> | null

  const typePart = tx.type === 'CORRECTION' ? 'Коригування' : 'Нарахування'
  const ratePart = tx.rate_type ? ` (${RATE_TYPE_SHORT[tx.rate_type] ?? tx.rate_type})` : ''

  let qtyPart = ''
  if (meta) {
    if (typeof meta.quantity === 'number') {
      qtyPart = ` × ${meta.quantity}`
    } else if (typeof meta.present_count === 'number') {
      qtyPart = ` × ${meta.present_count} дітей`
    } else if (typeof meta.revenue === 'number') {
      qtyPart = ` від виручки ${fmt(meta.revenue)}`
    }
  }

  const actPart = tx.activity_name ? ` [${tx.activity_name}]` : ''
  return `${typePart}${ratePart}${qtyPart}: net ${fmt(net)}${actPart}`
}

// ── Cell for accrual row ────────────────────────────────────────────────────

function AccrualCell({
  txs,
  onClickExisting,
  onClickEmpty,
}: {
  txs: SalaryTransaction[]
  onClickExisting: (txs: SalaryTransaction[]) => void
  onClickEmpty: () => void
}) {
  if (txs.length === 0) {
    return (
      <button
        onClick={onClickEmpty}
        className="w-full h-full min-h-[22px] rounded text-gray-200 hover:bg-iris-50 hover:text-iris-400 transition-colors text-xs"
        title="Додати нарахування"
      >
        ·
      </button>
    )
  }

  const hasCorrection = txs.some(t => t.type === 'CORRECTION')
  const net = txs.reduce((s, t) => {
    const g = Number(t.gross_amount)
    const d = Math.round(g * Number(t.deduction_pct) / 100 * 100) / 100
    return s + g - d
  }, 0)

  return (
    <button
      onClick={() => onClickExisting(txs)}
      className={`w-full rounded px-0.5 py-0.5 font-mono text-xs transition-colors ${
        hasCorrection
          ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
          : 'bg-iris-50 text-iris-700 hover:bg-iris-100'
      }`}
      title={txs.map(accrualTooltipLine).join('\n')}
    >
      {net % 1 === 0 ? net : net.toFixed(0)}
    </button>
  )
}

// ── Cell for payment row ────────────────────────────────────────────────────

function PaymentCell({
  txs,
  onClickExisting,
  onClickEmpty,
}: {
  txs: SalaryTransaction[]
  onClickExisting: (txs: SalaryTransaction[]) => void
  onClickEmpty: () => void
}) {
  if (txs.length === 0) {
    return (
      <button
        onClick={onClickEmpty}
        className="w-full h-full min-h-[22px] rounded text-gray-200 hover:bg-green-50 hover:text-green-400 transition-colors text-xs"
        title="Додати виплату"
      >
        ·
      </button>
    )
  }

  const total = txs.reduce((s, t) => s + Number(t.gross_amount), 0)

  return (
    <button
      onClick={() => onClickExisting(txs)}
      className="w-full rounded px-0.5 py-0.5 font-mono text-xs bg-green-100 text-green-800 hover:bg-green-200 transition-colors"
      title={txs.map(t => `Виплата: ${fmt(t.gross_amount)}`).join('\n')}
    >
      {total % 1 === 0 ? total : total.toFixed(0)}
    </button>
  )
}

// ── Dialog wrappers (overlay modals) ───────────────────────────────────────

function AccrualModalOverlay({
  staffId,
  initialDate,
  onDone,
}: {
  staffId: string
  initialDate: string
  onDone: () => void
}) {
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
          <ManualAccrualForm
            staffId={staffId}
            rates={rates}
            onDone={onDone}
            initialDate={initialDate}
          />
        )}
      </div>
    </div>
  )
}

function PayModalOverlay({
  staffId,
  initialDate,
  onDone,
}: {
  staffId: string
  initialDate: string
  onDone: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <PayForm staffId={staffId} onDone={onDone} initialDate={initialDate} />
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

type DialogState =
  | { type: 'tx';            tx: SalaryTransaction; staffId: string }
  | { type: 'accrualGroup';  txs: SalaryTransaction[]; staffId: string }
  | { type: 'paymentGroup';  txs: SalaryTransaction[]; staffId: string }
  | { type: 'newAccrual';    staffId: string; date: string }
  | { type: 'newPayment';    staffId: string; date: string }
  | null

export function SalaryGridTab({ month, search }: { month: string; search: string }) {
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<DialogState>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['salary-grid', month],
    queryFn: () => staffApi.getGrid(month),
  })

  const gridKey = ['salary-grid', month]

  const filteredRows = useMemo(() => {
    const rows = data?.rows ?? []
    if (!search) return rows
    const q = search.toLowerCase()
    return rows.filter(r =>
      r.full_name.toLowerCase().includes(q) ||
      r.specialization?.toLowerCase().includes(q)
    )
  }, [data?.rows, search])

  const dates = data?.dates ?? []
  const days  = daysInMonth(month)

  function closeDialog() { setDialog(null) }

  function invalidateAfterMutation(staffId: string) {
    qc.invalidateQueries({ queryKey: gridKey })
    qc.invalidateQueries({ queryKey: ['salary', staffId] })
    qc.invalidateQueries({ queryKey: ['salary-journal'] })
    closeDialog()
  }

  return (
    <>
      {/* ── Dialogs ── */}
      {dialog?.type === 'tx' && (
        <TxPopup
          tx={dialog.tx}
          staffId={dialog.staffId}
          onClose={closeDialog}
          invalidateKeys={[gridKey, ['salary-journal']]}
        />
      )}
      {dialog?.type === 'accrualGroup' && (
        <AccrualGroupPopup
          txs={dialog.txs}
          onClose={closeDialog}
          onSelectTx={tx => setDialog({ type: 'tx', tx, staffId: dialog.staffId })}
        />
      )}
      {dialog?.type === 'paymentGroup' && (
        <PaymentGroupPopup
          txs={dialog.txs}
          staffId={dialog.staffId}
          onClose={closeDialog}
          invalidateKeys={[gridKey, ['salary-journal']]}
        />
      )}
      {dialog?.type === 'newAccrual' && (
        <AccrualModalOverlay
          staffId={dialog.staffId}
          initialDate={dialog.date}
          onDone={() => invalidateAfterMutation(dialog.staffId)}
        />
      )}
      {dialog?.type === 'newPayment' && (
        <PayModalOverlay
          staffId={dialog.staffId}
          initialDate={dialog.date}
          onDone={() => invalidateAfterMutation(dialog.staffId)}
        />
      )}

      {/* ── Grid ── */}
      {isLoading ? (
        <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
      ) : filteredRows.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-400">Немає даних</div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white" style={{ overflow: 'auto', maxHeight: 'calc(100vh - 220px)' }}>
          <table className="text-xs border-collapse" style={{ minWidth: `${180 + days * 32}px` }}>
            <thead className="sticky top-0 z-20">
              {/* day-of-week row */}
              <tr>
                <th className="sticky left-0 z-30 bg-gray-50 border-b border-r border-gray-200 px-2 py-1 min-w-[180px]" />
                <th className="bg-gray-50 border-b border-r border-gray-200 px-1 py-1 text-center text-gray-400 font-normal min-w-[52px]">
                  Рядок
                </th>
                {dates.map(d => (
                  <th
                    key={d}
                    className={`bg-gray-50 border-b border-r border-gray-100 px-0.5 py-1 text-center font-normal min-w-[32px] ${
                      isWeekend(d) ? 'text-rose-400' : 'text-gray-400'
                    }`}
                  >
                    {dayOfWeekShort(d)}
                  </th>
                ))}
                <th className="bg-gray-50 border-b border-l border-gray-200 px-2 py-1 text-right font-medium text-gray-600">
                  Разом
                </th>
              </tr>
              {/* date numbers row */}
              <tr>
                <th className="sticky left-0 z-30 bg-gray-50 border-b border-r border-gray-200 px-3 py-1.5 text-left text-xs font-medium text-gray-600">
                  Співробітник
                </th>
                <th className="bg-gray-50 border-b border-r border-gray-200 px-1 py-1.5 text-center text-gray-500 font-medium min-w-[52px]" />
                {dates.map(d => (
                  <th
                    key={d}
                    className={`bg-gray-50 border-b border-r border-gray-100 px-0.5 py-1.5 text-center font-medium min-w-[32px] ${
                      isWeekend(d) ? 'text-rose-500' : 'text-gray-700'
                    }`}
                  >
                    {dayLabel(d)}
                  </th>
                ))}
                <th className="bg-gray-50 border-b border-l border-gray-200 px-2 py-1.5 text-right font-medium text-gray-600">
                  Net
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, rowIdx) => {
                // Group transactions by date and type
                const accrualsByDate = new Map<string, SalaryTransaction[]>()
                const paymentsByDate = new Map<string, SalaryTransaction[]>()
                for (const tx of row.transactions) {
                  const date = String(tx.transaction_date).slice(0, 10)
                  if (tx.type === 'PAYMENT') {
                    if (!paymentsByDate.has(date)) paymentsByDate.set(date, [])
                    paymentsByDate.get(date)!.push(tx)
                  } else {
                    if (!accrualsByDate.has(date)) accrualsByDate.set(date, [])
                    accrualsByDate.get(date)!.push(tx)
                  }
                }

                const accrualTotal = row.summary.net
                const paymentTotal = row.summary.paid
                const isEven = rowIdx % 2 === 0

                return [
                  /* ── Нарахування row ── */
                  <tr
                    key={`${row.id}-accrual`}
                    className={`border-t border-gray-100 ${isEven ? 'bg-white' : 'bg-gray-50/40'} hover:bg-iris-50/30`}
                  >
                    <td
                      rowSpan={2}
                      className={`sticky left-0 z-10 border-r border-gray-200 px-3 py-1 align-middle ${isEven ? 'bg-white' : 'bg-gray-50/60'}`}
                    >
                      <div className="flex flex-col gap-0.5">
                        <Link
                          to={`/staff/${row.id}`}
                          className="font-medium text-iris-700 hover:text-iris-900 text-xs leading-tight"
                        >
                          {row.full_name}
                        </Link>
                        {row.specialization && (
                          <span className="text-gray-400 text-[10px] leading-tight">{row.specialization}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-1 py-1 text-center border-r border-gray-200">
                      <span className="inline-block text-[10px] font-medium text-iris-600 bg-iris-50 rounded px-1 py-0.5 whitespace-nowrap">
                        Нарах.
                      </span>
                    </td>
                    {dates.map(d => {
                      const txs = accrualsByDate.get(d) ?? []
                      return (
                        <td key={d} className={`px-0.5 py-1 text-center border-r border-gray-100 ${isWeekend(d) ? 'bg-rose-50/30' : ''}`}>
                          <AccrualCell
                            txs={txs}
                            onClickExisting={ts =>
                              ts.length === 1
                                ? setDialog({ type: 'tx', tx: ts[0], staffId: row.id })
                                : setDialog({ type: 'accrualGroup', txs: ts, staffId: row.id })
                            }
                            onClickEmpty={() => setDialog({ type: 'newAccrual', staffId: row.id, date: d })}
                          />
                        </td>
                      )
                    })}
                    <td className="px-2 py-1 text-right font-mono border-l border-gray-200 text-iris-700">
                      {accrualTotal > 0 ? fmt(accrualTotal) : '—'}
                    </td>
                  </tr>,

                  /* ── Виплати row ── */
                  <tr
                    key={`${row.id}-payment`}
                    className={`border-b-2 border-gray-200 ${isEven ? 'bg-white' : 'bg-gray-50/40'} hover:bg-green-50/30`}
                  >
                    <td className="px-1 py-1 text-center border-r border-gray-200">
                      <span className="inline-block text-[10px] font-medium text-green-700 bg-green-50 rounded px-1 py-0.5 whitespace-nowrap">
                        Виплат.
                      </span>
                    </td>
                    {dates.map(d => {
                      const txs = paymentsByDate.get(d) ?? []
                      return (
                        <td key={d} className={`px-0.5 py-1 text-center border-r border-gray-100 ${isWeekend(d) ? 'bg-rose-50/30' : ''}`}>
                          <PaymentCell
                            txs={txs}
                            onClickExisting={ts =>
                              ts.length === 1
                                ? setDialog({ type: 'tx', tx: ts[0], staffId: row.id })
                                : setDialog({ type: 'paymentGroup', txs: ts, staffId: row.id })
                            }
                            onClickEmpty={() => setDialog({ type: 'newPayment', staffId: row.id, date: d })}
                          />
                        </td>
                      )
                    })}
                    <td className="px-2 py-1 text-right font-mono border-l border-gray-200 text-green-700">
                      {paymentTotal > 0 ? fmt(paymentTotal) : '—'}
                    </td>
                  </tr>,
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
