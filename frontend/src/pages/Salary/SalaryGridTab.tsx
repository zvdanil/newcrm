import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { staffApi, type SalaryTransaction, type SalaryGridRate } from '../../api/staff.api'
import { accountsApi } from '../../api/accounts.api'
import {
  TxPopup,
  AccrualGroupPopup,
  fmt,
} from '../../components/SalaryTransactionPopups'
import { ManualAccrualForm } from '../Staff/StaffCardPage'

// ── date helpers ───────────────────────────────────────────────────────────

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

function dayLabel(dateStr: string): string {
  return String(new Date(dateStr + 'T00:00:00').getDate())
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr + 'T00:00:00').getDay()
  return day === 0 || day === 6
}

function dayOfWeekShort(dateStr: string): string {
  const names = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  return names[new Date(dateStr + 'T00:00:00').getDay()]
}

// ── rate helpers ───────────────────────────────────────────────────────────

const RATE_TYPE_SHORT: Record<string, string> = {
  per_lesson:    'Заняття',
  per_child:     'Дитина',
  group_lesson:  'Група',
  fixed_monthly: 'Оклад',
  hourly:        'Год.',
  smart:         'Смарт',
  bonus:         'Бонус',
}

function rateRowLabel(rate: SalaryGridRate): string {
  const typeShort = RATE_TYPE_SHORT[rate.rate_type] ?? rate.rate_type
  return rate.activity_name ? `${typeShort} · ${rate.activity_name}` : typeShort
}

function accrualTooltipLine(tx: SalaryTransaction): string {
  const g   = Number(tx.gross_amount)
  const d   = Math.round(g * Number(tx.deduction_pct) / 100 * 100) / 100
  const net = g - d
  const meta = tx.metadata_json as Record<string, unknown> | null
  const typePart = tx.type === 'CORRECTION' ? 'Коригування' : 'Нарахування'
  let qtyPart = ''
  if (meta) {
    if (typeof meta.quantity === 'number')           qtyPart = ` × ${meta.quantity}`
    else if (typeof meta.present_count === 'number') qtyPart = ` × ${meta.present_count} дітей`
    else if (typeof meta.revenue === 'number')       qtyPart = ` від виручки ${fmt(meta.revenue)}`
  }
  return `${typePart}${qtyPart}: net ${fmt(net)}`
}

// ── AccrualCell ────────────────────────────────────────────────────────────

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
      >·</button>
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

// ── PaymentCell ────────────────────────────────────────────────────────────

function PaymentCell({
  txs,
  onClick,
}: {
  txs: SalaryTransaction[]
  onClick: () => void
}) {
  const total = txs.reduce((s, t) => s + Number(t.gross_amount), 0)

  if (txs.length === 0) {
    return (
      <button
        onClick={onClick}
        className="w-full h-full min-h-[22px] rounded text-gray-200 hover:bg-green-50 hover:text-green-400 transition-colors text-xs"
        title="Додати виплату"
      >·</button>
    )
  }

  return (
    <button
      onClick={onClick}
      className="w-full rounded px-0.5 py-0.5 font-mono text-xs bg-green-100 text-green-800 hover:bg-green-200 transition-colors"
      title={txs.map(t => `Виплата: ${fmt(t.gross_amount)}${t.note ? ` (${t.note})` : ''}`).join('\n')}
    >
      {total % 1 === 0 ? total : total.toFixed(0)}
    </button>
  )
}

// ── PaymentDayDialog ───────────────────────────────────────────────────────

function PaymentDayDialog({
  staffId,
  date,
  txs,
  invalidateKeys,
  onClose,
}: {
  staffId:        string
  date:           string
  txs:            SalaryTransaction[]
  invalidateKeys?: string[][]
  onClose:        () => void
}) {
  const qc = useQueryClient()
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn:  accountsApi.list,
  })

  const [form, setForm] = useState({ gross_amount: '', account_id: '', note: '' })
  const [error, setError] = useState<string | null>(null)

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['salary', staffId] })
    invalidateKeys?.forEach(k => qc.invalidateQueries({ queryKey: k }))
  }

  const addMutation = useMutation({
    mutationFn: () => staffApi.pay(staffId, {
      gross_amount:     parseFloat(form.gross_amount),
      transaction_date: date,
      account_id:       form.account_id || undefined,
      note:             form.note || undefined,
    }),
    onSuccess: () => { invalidateAll(); onClose() },
    onError:   () => setError('Помилка збереження'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => staffApi.deleteAccrual(staffId, id),
    onSuccess: invalidateAll,
    onError:   (e: { response?: { status?: number } }) => {
      if (e.response?.status === 404) invalidateAll()
    },
  })

  const total = txs.reduce((s, t) => s + Number(t.gross_amount), 0)
  const displayDate = new Date(date + 'T00:00:00').toLocaleDateString('uk-UA')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Виплати · {displayDate}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {/* Existing payments */}
        {txs.length > 0 && (
          <div className="space-y-2">
            {txs.map(tx => (
              <div key={tx.id} className="flex items-start justify-between rounded-lg border border-gray-100 px-3 py-2">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-sm font-mono text-green-700">{fmt(tx.gross_amount)} ₴</p>
                  {tx.account_name && <p className="text-xs text-gray-400">{tx.account_name}</p>}
                  {tx.note && <p className="text-xs text-gray-500">{tx.note}</p>}
                </div>
                <button
                  onClick={() => deleteMutation.mutate(tx.id)}
                  disabled={deleteMutation.isPending}
                  className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 shrink-0 ml-2"
                >
                  Видалити
                </button>
              </div>
            ))}
            <div className="flex justify-between pt-1 border-t border-gray-100 text-sm">
              <span className="text-gray-500">Разом</span>
              <span className="font-mono font-semibold text-green-700">{fmt(total)} ₴</span>
            </div>
          </div>
        )}

        {/* Add new payment form */}
        <div className={txs.length > 0 ? 'border-t border-gray-100 pt-4 space-y-3' : 'space-y-3'}>
          {txs.length > 0 && (
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Нова виплата</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Сума *</label>
              <input
                type="number" min="0.01" step="0.01" placeholder="0.00"
                value={form.gross_amount}
                onChange={e => setForm(f => ({ ...f, gross_amount: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Рахунок</label>
              <select
                value={form.account_id}
                onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">— не вказано —</option>
                {accounts.filter(a => a.is_active).map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Примітка</label>
              <input
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="За травень, аванс..."
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => { setError(null); addMutation.mutate() }}
              disabled={addMutation.isPending || !form.gross_amount || parseFloat(form.gross_amount) <= 0}
              className="flex-1 py-2 bg-green-700 text-white text-sm rounded-lg hover:bg-green-800 disabled:opacity-50"
            >
              {addMutation.isPending ? '...' : 'Виплатити'}
            </button>
            <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">
              Скасувати
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── AccrualModalOverlay ────────────────────────────────────────────────────

function AccrualModalOverlay({
  staffId,
  initialDate,
  initialRateId,
  onDone,
}: {
  staffId:        string
  initialDate:    string
  initialRateId?: string
  onDone:         () => void
}) {
  const { data: rates = [], isLoading } = useQuery({
    queryKey: ['staff-rates', staffId],
    queryFn:  () => staffApi.getRates(staffId),
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
            initialRateId={initialRateId}
          />
        )}
      </div>
    </div>
  )
}

// ── Dialog state ───────────────────────────────────────────────────────────

type DialogState =
  | { type: 'tx';           tx: SalaryTransaction; staffId: string }
  | { type: 'accrualGroup'; txs: SalaryTransaction[]; staffId: string }
  | { type: 'paymentDay';   staffId: string; date: string }
  | { type: 'newAccrual';   staffId: string; date: string; rateId?: string }
  | null

// ── Main component ─────────────────────────────────────────────────────────

export function SalaryGridTab({ month, search }: { month: string; search: string }) {
  const qc = useQueryClient()
  const [dialog, setDialog] = useState<DialogState>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['salary-grid', month],
    queryFn:  () => staffApi.getGrid(month),
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
          autoEdit
        />
      )}
      {dialog?.type === 'accrualGroup' && (
        <AccrualGroupPopup
          txs={dialog.txs}
          onClose={closeDialog}
          onSelectTx={tx => setDialog({ type: 'tx', tx, staffId: dialog.staffId })}
        />
      )}
      {dialog?.type === 'paymentDay' && (() => {
        const staffRow = data?.rows.find(r => r.id === dialog.staffId)
        const dayTxs = staffRow?.transactions.filter(
          t => t.type === 'PAYMENT' && String(t.transaction_date).slice(0, 10) === dialog.date
        ) ?? []
        return (
          <PaymentDayDialog
            staffId={dialog.staffId}
            date={dialog.date}
            txs={dayTxs}
            invalidateKeys={[gridKey, ['salary-journal']]}
            onClose={closeDialog}
          />
        )
      })()}
      {dialog?.type === 'newAccrual' && (
        <AccrualModalOverlay
          staffId={dialog.staffId}
          initialDate={dialog.date}
          initialRateId={dialog.rateId}
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
          <table className="text-xs border-collapse" style={{ minWidth: `${260 + days * 32}px` }}>
            <thead className="sticky top-0 z-20">
              {/* day-of-week row */}
              <tr>
                <th className="sticky left-0 z-30 bg-gray-50 border-b border-r border-gray-200 px-2 py-1 min-w-[180px]" />
                <th className="bg-gray-50 border-b border-r border-gray-200 px-1 py-1 text-center text-gray-400 font-normal min-w-[80px]">
                  Ставка
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
                <th className="bg-gray-50 border-b border-r border-gray-200 px-1 py-1.5 text-center text-gray-500 font-medium min-w-[80px]" />
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
                  Net / ₴
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, rowIdx) => {
                const staffRates    = row.rates
                const activeRateIds = new Set(staffRates.map(r => r.id))
                const isEven        = rowIdx % 2 === 0
                const baseRowClass  = isEven ? 'bg-white' : 'bg-gray-50/40'
                const stickyBg      = isEven ? 'bg-white' : 'bg-gray-50/60'

                // Group payment transactions by date
                const paymentsByDate = new Map<string, SalaryTransaction[]>()
                for (const tx of row.transactions) {
                  if (tx.type !== 'PAYMENT') continue
                  const date = String(tx.transaction_date).slice(0, 10)
                  if (!paymentsByDate.has(date)) paymentsByDate.set(date, [])
                  paymentsByDate.get(date)!.push(tx)
                }

                // Orphan accruals: no rate_id or rate not in active set
                const orphanTxs = row.transactions.filter(
                  tx => tx.type !== 'PAYMENT' && (!tx.rate_id || !activeRateIds.has(tx.rate_id))
                )
                
                const rateGroupsMap = new Map<string, {
                  key: string,
                  label: string,
                  rateIds: Set<string>,
                  rates: typeof staffRates
                }>()

                for (const r of staffRates) {
                  const key = `${r.rate_type}-${r.activity_id ?? 'no_act'}-${r.rate_category}`
                  if (!rateGroupsMap.has(key)) {
                    rateGroupsMap.set(key, {
                      key,
                      label: rateRowLabel(r),
                      rateIds: new Set(),
                      rates: []
                    })
                  }
                  const group = rateGroupsMap.get(key)!
                  group.rateIds.add(r.id)
                  group.rates.push(r)
                }

                const rateGroups = Array.from(rateGroupsMap.values())

                const showCatchAll = rateGroups.length === 0 || orphanTxs.length > 0
                const rowCount     = rateGroups.length + (showCatchAll ? 1 : 0) + 1

                const paymentTotal = row.summary.paid

                // Name cell (rendered once via rowSpan)
                const nameCell = (
                  <td
                    rowSpan={rowCount}
                    className={`sticky left-0 z-10 border-r border-gray-200 px-3 py-1 align-middle ${stickyBg}`}
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
                )

                // Build rate rows
                const rateRows = rateGroups.map((group, groupIdx) => {
                  const rateTxsByDate = new Map<string, SalaryTransaction[]>()
                  for (const tx of row.transactions) {
                    if (tx.type === 'PAYMENT' || !group.rateIds.has(tx.rate_id!)) continue
                    const date = String(tx.transaction_date).slice(0, 10)
                    if (!rateTxsByDate.has(date)) rateTxsByDate.set(date, [])
                    rateTxsByDate.get(date)!.push(tx)
                  }

                  const rateNet = [...rateTxsByDate.values()].flat().reduce((s, tx) => {
                    const g = Number(tx.gross_amount)
                    const d = Math.round(g * Number(tx.deduction_pct) / 100 * 100) / 100
                    return s + g - d
                  }, 0)

                  return (
                    <tr
                      key={`${row.id}-group-${group.key}`}
                      className={`border-t border-gray-100 ${baseRowClass} hover:bg-iris-50/20`}
                    >
                      {groupIdx === 0 && nameCell}
                      <td className="px-1 py-1 text-center border-r border-gray-200 whitespace-nowrap">
                        <span className="inline-block text-[10px] font-medium text-iris-600 bg-iris-50 rounded px-1 py-0.5">
                          {group.label}
                        </span>
                      </td>
                      {dates.map(d => {
                        const txs = rateTxsByDate.get(d) ?? []
                        return (
                          <td key={d} className={`px-0.5 py-1 text-center border-r border-gray-100 ${isWeekend(d) ? 'bg-rose-50/30' : ''}`}>
                            <AccrualCell
                              txs={txs}
                              onClickExisting={ts =>
                                ts.length === 1
                                  ? setDialog({ type: 'tx', tx: ts[0], staffId: row.id })
                                  : setDialog({ type: 'accrualGroup', txs: ts, staffId: row.id })
                              }
                              onClickEmpty={() => {
                                let activeRate = group.rates.find(r => r.valid_from <= d && (!r.valid_to || r.valid_to > d))
                                if (!activeRate) {
                                  activeRate = group.rates.find(r => !r.valid_to) ?? [...group.rates].sort((a, b) => b.valid_from.localeCompare(a.valid_from))[0]
                                }
                                setDialog({ type: 'newAccrual', staffId: row.id, date: d, rateId: activeRate.id })
                              }}
                            />
                          </td>
                        )
                      })}
                      <td className="px-2 py-1 text-right font-mono border-l border-gray-200 text-iris-700">
                        {rateNet > 0 ? fmt(rateNet) : '—'}
                      </td>
                    </tr>
                  )
                })

                // Catch-all row for orphan accruals (or when no rates configured)
                const catchAllRow = showCatchAll ? (() => {
                  const orphansByDate = new Map<string, SalaryTransaction[]>()
                  for (const tx of orphanTxs) {
                    const date = String(tx.transaction_date).slice(0, 10)
                    if (!orphansByDate.has(date)) orphansByDate.set(date, [])
                    orphansByDate.get(date)!.push(tx)
                  }
                  const orphanNet = orphanTxs.reduce((s, tx) => {
                    const g = Number(tx.gross_amount)
                    const d = Math.round(g * Number(tx.deduction_pct) / 100 * 100) / 100
                    return s + g - d
                  }, 0)

                  return (
                    <tr
                      key={`${row.id}-catchall`}
                      className={`border-t border-gray-100 ${baseRowClass} hover:bg-iris-50/20`}
                    >
                      {rateGroups.length === 0 && nameCell}
                      <td className="px-1 py-1 text-center border-r border-gray-200">
                        <span className="inline-block text-[10px] font-medium text-gray-400 bg-gray-100 rounded px-1 py-0.5">
                          Нарах.
                        </span>
                      </td>
                      {dates.map(d => {
                        const txs = orphansByDate.get(d) ?? []
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
                        {orphanNet > 0 ? fmt(orphanNet) : '—'}
                      </td>
                    </tr>
                  )
                })() : null

                // Payment row — always last, no nameCell needed (rowSpan already covers it)
                const paymentRow = (
                  <tr
                    key={`${row.id}-payment`}
                    className={`border-b-2 border-gray-200 ${baseRowClass} hover:bg-green-50/20`}
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
                            onClick={() => setDialog({ type: 'paymentDay', staffId: row.id, date: d })}
                          />
                        </td>
                      )
                    })}
                    <td className="px-2 py-1 text-right font-mono border-l border-gray-200 text-green-700">
                      {paymentTotal > 0 ? fmt(paymentTotal) : '—'}
                    </td>
                  </tr>
                )

                return [...rateRows, catchAllRow, paymentRow].filter(Boolean)
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
