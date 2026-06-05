import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { staffApi, type SalaryTransaction, type RateType, type SalaryGridRate } from '../api/staff.api'

export function fmt(v: string | number) { return Number(v).toFixed(2) }

export const RATE_TYPE_LABELS: Record<RateType, string> = {
  per_lesson:      'За заняття',
  per_child:       'За дитину',
  group_lesson:    'За групу',
  fixed_monthly:   'Фіксований оклад',
  hourly:          'Погодинна',
  smart:           'Смарт',
  bonus:           'Бонус',
  smart_per_child: 'Смарт за дитину',
  monthly_by_day:  'Місяць по днях',
  vacation:        'Відпустка',
}

export function workingDaysInMonth(dateStr: string): number {
  const [y, m] = dateStr.slice(0, 7).split('-').map(Number)
  const total = new Date(y, m, 0).getDate()
  let count = 0
  for (let d = 1; d <= total; d++) {
    const dow = new Date(y, m - 1, d).getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

export function dailyRate(rate: SalaryGridRate | { rate_value: string }, dateStr: string): number {
  const monthly = Number(rate.rate_value)
  const days    = workingDaysInMonth(dateStr)
  return Math.round(monthly / days * 100) / 100
}

export const TX_TYPE_LABELS: Record<string, string> = {
  ACCRUAL:    'Нарахування',
  PAYMENT:    'Виплата',
  CORRECTION: 'Коригування',
}

// ── Metadata detail formatter ──────────────────────────────────────────────

export function metaDetail(tx: SalaryTransaction): string | null {
  const m = tx.metadata_json as Record<string, unknown> | null
  if (!m) return null
  const src = m.source as string | undefined

  // percent_of_revenue modes
  if (typeof m.revenue === 'number' && typeof m.rate_pct === 'number') {
    return `${fmt(m.revenue)} грн × ${m.rate_pct}%`
  }

  if (src === 'auto_per_lesson' || src === 'auto_group_lesson') {
    const qty = typeof m.quantity === 'number' ? m.quantity : 1
    const rv  = typeof m.rate_value === 'number' ? m.rate_value : null
    return rv != null ? `${qty} заняття × ${fmt(rv)} грн` : `${qty} заняття`
  }

  if (src === 'auto_per_child') {
    const qty = typeof m.quantity === 'number' ? m.quantity : '?'
    const rv  = typeof m.rate_value === 'number' ? m.rate_value : null
    return rv != null ? `${qty} дітей × ${fmt(rv)} грн` : `${qty} дітей`
  }

  if (src === 'auto_fixed_monthly') {
    const rv = typeof m.rate_value === 'number' ? m.rate_value : null
    return rv != null ? `Оклад ${fmt(rv)} грн` : 'Фіксований оклад'
  }

  if (src === 'auto_smart') {
    const br = typeof m.base_rate    === 'number' ? m.base_rate    : null
    const bl = typeof m.base_lessons === 'number' ? m.base_lessons : null
    return br != null && bl != null ? `${bl} занять × ${fmt(br)} грн (смарт)` : 'Смарт'
  }

  if (src === 'smart_staff') {
    const ab = typeof m.absences  === 'number' ? m.absences  : '?'
    const th = typeof m.threshold === 'number' ? m.threshold : '?'
    return `Коригування: ${ab} пропусків ≥ ${th}`
  }

  if (src === 'smart_per_child') {
    const children = Array.isArray(m.children) ? m.children as Array<{ child_name: string; visits: number; range: string; amount: number }> : []
    if (children.length === 0) return 'Смарт за дитину'
    const lines = children
      .filter(c => c.visits > 0)
      .map(c => `${c.child_name}: ${c.visits} відв.→${c.amount.toFixed(0)} грн`)
      .join('; ')
    const total = typeof m.total === 'number' ? m.total : null
    return `${total != null ? total.toFixed(2) + ' грн. ' : ''}${lines}`
  }

  if (src === 'retro_correction') {
    const delta = typeof m.delta === 'number' ? m.delta : null
    return delta != null ? `Ретро Δ ${delta > 0 ? '+' : ''}${fmt(delta)} грн` : 'Ретро-коригування'
  }

  if (src === 'vacation_day') {
    const dr    = typeof m.day_rate           === 'number' ? m.day_rate           : null
    const spent = typeof m.spent_in_year      === 'number' ? m.spent_in_year      : null
    const limit = typeof m.vacation_days_limit === 'number' ? m.vacation_days_limit : null
    const parts: string[] = []
    if (dr != null) parts.push(`${fmt(dr)} грн/день`)
    if (spent != null && limit != null) parts.push(`${spent + 1} / ${limit} дн.`)
    return parts.length ? parts.join(' · ') : 'Відпускний день (В)'
  }

  if (src === 'manual_daily') {
    const mr = typeof m.monthly_rate === 'number' ? m.monthly_rate : null
    const wd = typeof m.working_days === 'number' ? m.working_days : null
    const dr = typeof m.daily_rate   === 'number' ? m.daily_rate   : null
    if (mr != null && wd != null && dr != null) {
      return `${fmt(mr)} ÷ ${wd} дн = ${fmt(dr)} грн/день`
    }
    return 'Денне нарахування'
  }

  if (src === 'manual') {
    const rt = tx.rate_type
    if (typeof m.quantity === 'number' && typeof m.rate_value === 'number') {
      const unitLabel = rt === 'hourly' ? 'год.' : rt === 'per_child' ? 'дітей' : 'од.'
      return `${m.quantity} ${unitLabel} × ${fmt(m.rate_value)} грн`
    }
    if (typeof m.revenue === 'number' && typeof m.rate_pct === 'number') {
      return `${fmt(m.revenue)} грн × ${m.rate_pct}%`
    }
  }

  return null
}

// ── Payment group popup ────────────────────────────────────────────────────

export function PaymentGroupPopup({ txs, staffId, onClose, invalidateKeys }: {
  txs:            SalaryTransaction[]
  staffId:        string
  onClose:        () => void
  invalidateKeys?: string[][]
}) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['salary', staffId] })
    invalidateKeys?.forEach(k => qc.invalidateQueries({ queryKey: k }))
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => staffApi.deleteAccrual(staffId, id),
    onSuccess: () => { invalidateAll(); onClose() },
    onError: (e: { response?: { status?: number } }) => {
      if (e.response?.status === 404) {
        invalidateAll()
        onClose()
      } else {
        setError('Помилка видалення')
      }
    },
  })

  const total = txs.reduce((s, t) => s + Number(t.gross_amount), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Виплати за {String(txs[0].transaction_date).slice(0, 10)}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="space-y-2">
          {txs.map(tx => (
            <div key={tx.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
              <div className="space-y-0.5">
                <p className="text-sm font-mono text-green-700">{fmt(tx.gross_amount)}</p>
                {tx.note && <p className="text-xs text-gray-500">{tx.note}</p>}
              </div>
              <button
                onClick={() => deleteMutation.mutate(tx.id)}
                disabled={deleteMutation.isPending}
                className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
              >
                Видалити
              </button>
            </div>
          ))}
        </div>
        <div className="flex justify-between pt-2 border-t border-gray-100">
          <span className="text-sm text-gray-600">Разом</span>
          <span className="text-sm font-mono font-semibold text-green-700">{fmt(total)}</span>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </div>
  )
}

// ── Accrual group popup ────────────────────────────────────────────────────

export function AccrualGroupPopup({ txs, onClose, onSelectTx }: {
  txs:        SalaryTransaction[]
  onClose:    () => void
  onSelectTx: (tx: SalaryTransaction) => void
}) {
  const total = txs.reduce((s, t) => {
    const g = Number(t.gross_amount)
    const d = Math.round(g * Number(t.deduction_pct) / 100 * 100) / 100
    return s + g - d
  }, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Нарахування за {String(txs[0].transaction_date).slice(0, 10)}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {txs.map(tx => {
            const g = Number(tx.gross_amount)
            const d = Math.round(g * Number(tx.deduction_pct) / 100 * 100) / 100
            const net = g - d
            const detail = metaDetail(tx)
            return (
              <div key={tx.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                <div className="space-y-0.5 flex-1 min-w-0 pr-2">
                  <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
                    {TX_TYPE_LABELS[tx.type] ?? tx.type}
                    <span className="font-mono text-iris-700">{fmt(net)}</span>
                  </p>
                  {tx.rate_type && (
                    <p className="text-xs text-gray-500">
                      {RATE_TYPE_LABELS[tx.rate_type]}
                      {detail && <span className="text-gray-400 ml-1">· {detail}</span>}
                    </p>
                  )}
                  {!tx.rate_type && detail && <p className="text-xs text-gray-400">{detail}</p>}
                  {tx.activity_name && <p className="text-xs text-gray-400">{tx.activity_name}</p>}
                  {tx.note && <p className="text-xs text-gray-500 truncate">{tx.note}</p>}
                </div>
                <button
                  onClick={() => onSelectTx(tx)}
                  className="text-xs text-iris-600 hover:text-iris-800 px-3 py-1.5 rounded-lg hover:bg-iris-50 font-medium"
                >
                  Деталі
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex justify-between pt-2 border-t border-gray-100">
          <span className="text-sm text-gray-600">Разом (net)</span>
          <span className="text-sm font-mono font-semibold text-iris-700">{fmt(total)}</span>
        </div>
      </div>
    </div>
  )
}

// ── Single transaction popup ───────────────────────────────────────────────

export function TxPopup({ tx, staffId, onClose, invalidateKeys, autoEdit = false }: {
  tx:             SalaryTransaction
  staffId:        string
  onClose:        () => void
  invalidateKeys?: string[][]
  autoEdit?:       boolean
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(autoEdit)
  const [form, setForm] = useState({
    gross_amount:  fmt(tx.gross_amount),
    deduction_pct: fmt(tx.deduction_pct),
    edit_note:     '',
  })
  const [error, setError] = useState<string | null>(null)

  const gross = Number(tx.gross_amount)
  const ded   = Math.round(gross * Number(tx.deduction_pct) / 100 * 100) / 100
  const net   = gross - ded

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['salary', staffId] })
    invalidateKeys?.forEach(k => qc.invalidateQueries({ queryKey: k }))
  }

  const editMutation = useMutation({
    mutationFn: () => staffApi.editAccrual(staffId, tx.id, {
      gross_amount:  parseFloat(form.gross_amount),
      deduction_pct: parseFloat(form.deduction_pct) || 0,
      edit_note:     form.edit_note,
    }),
    onSuccess: () => { invalidateAll(); onClose() },
    onError: (e: { response?: { data?: { message?: string } } }) => setError(e.response?.data?.message ?? 'Помилка'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => staffApi.deleteAccrual(staffId, tx.id),
    onSuccess: () => { invalidateAll(); onClose() },
    onError: (e: { response?: { status?: number } }) => {
      if (e.response?.status === 404) { invalidateAll(); onClose() }
      else setError('Помилка видалення')
    },
  })

  const canEdit = tx.type !== 'PAYMENT'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">{TX_TYPE_LABELS[tx.type] ?? tx.type}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-gray-500">Дата</span>
            <span>{String(tx.transaction_date).slice(0, 10)}</span>
          </div>
          {tx.activity_name && (
            <div className="flex justify-between">
              <span className="text-gray-500">Активність</span>
              <span>{tx.activity_name}</span>
            </div>
          )}
          {tx.account_name && (
            <div className="flex justify-between">
              <span className="text-gray-500">Рахунок</span>
              <span>{tx.account_name}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-500">Тип ставки</span>
            <span>{tx.rate_type ? RATE_TYPE_LABELS[tx.rate_type] : '—'}</span>
          </div>
          {(() => { const d = metaDetail(tx); return d ? (
            <div className="flex justify-between">
              <span className="text-gray-500">Розрахунок</span>
              <span className="font-mono text-gray-700">{d}</span>
            </div>
          ) : null })()}
          <div className="flex justify-between font-medium">
            <span className="text-gray-500">Gross</span>
            <span className="font-mono">{fmt(tx.gross_amount)}</span>
          </div>
          {Number(tx.deduction_pct) > 0 && (
            <div className="flex justify-between text-red-600">
              <span>Утримання ({fmt(tx.deduction_pct)}%)</span>
              <span className="font-mono">−{fmt(ded)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold border-t border-gray-200 pt-1.5">
            <span>До виплати (net)</span>
            <span className="font-mono text-green-700">{fmt(net)}</span>
          </div>
          {tx.note && <div className="text-gray-500 pt-1">{tx.note}</div>}
          {tx.edit_note && (
            <div className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
              Причина правки: {tx.edit_note}
            </div>
          )}
        </div>

        {editing ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Сума (gross)</label>
                <input type="number" min="0.01" step="0.01" value={form.gross_amount}
                  onChange={e => setForm(f => ({ ...f, gross_amount: e.target.value }))}
                  autoFocus
                  onFocus={e => e.target.select()}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">% утримання</label>
                <input type="number" min="0" max="100" step="0.01" value={form.deduction_pct}
                  onChange={e => setForm(f => ({ ...f, deduction_pct: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Причина правки *</label>
              <input value={form.edit_note}
                onChange={e => setForm(f => ({ ...f, edit_note: e.target.value }))}
                placeholder="Обов'язково вкажіть причину"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button onClick={() => editMutation.mutate()} disabled={editMutation.isPending || !form.edit_note.trim()}
                className="flex-1 py-2 bg-iris-600 text-white text-sm rounded-lg hover:bg-iris-700 disabled:opacity-50">
                {editMutation.isPending ? '...' : 'Зберегти'}
              </button>
              <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">
                Скасувати
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            {canEdit && (
              <button onClick={() => setEditing(true)}
                className="flex-1 py-2 text-sm text-iris-600 border border-iris-200 rounded-lg hover:bg-iris-50 transition-colors">
                Редагувати
              </button>
            )}
            <button
              onClick={() => {
                if (window.confirm('Видалити цей запис? Дія незворотна.')) deleteMutation.mutate()
              }}
              disabled={deleteMutation.isPending}
              className="flex-1 py-2 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50">
              {deleteMutation.isPending ? '...' : 'Видалити'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── DailyMarkDialog (monthly_by_day) ──────────────────────────────────────────

export function DailyMarkDialog({
  staffId,
  date,
  rate,
  existingTx,
  onClose,
  invalidateKeys,
}: {
  staffId:        string
  date:           string
  rate:           SalaryGridRate | { id: string; rate_value: string; deduction_pct: string; rate_type: string }
  existingTx:     SalaryTransaction | null
  onClose:        () => void
  invalidateKeys?: string[][]
}) {
  const qc = useQueryClient()

  const computed  = dailyRate(rate, date)
  const initAmt   = existingTx ? fmt(existingTx.gross_amount) : fmt(computed)
  const initNote  = existingTx?.note ?? ''

  const [present, setPresent] = useState<boolean>(existingTx !== null)
  const [amount, setAmount]   = useState(initAmt)
  const [note, setNote]       = useState(initNote)
  const [error, setError]     = useState<string | null>(null)

  const displayDate = new Date(date + 'T00:00:00').toLocaleDateString('uk-UA')
  const wd          = workingDaysInMonth(date)

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['salary', staffId] })
    invalidateKeys?.forEach(k => qc.invalidateQueries({ queryKey: k }))
  }

  const createMutation = useMutation({
    mutationFn: () => staffApi.addManualAccrual(staffId, {
      rate_id:          rate.id,
      gross_amount:     parseFloat(amount),
      transaction_date: date,
      note:             note || undefined,
    }),
    onSuccess: () => { invalidateAll(); onClose() },
    onError:   () => setError('Помилка збереження'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => staffApi.deleteAccrual(staffId, existingTx!.id),
    onSuccess: () => { invalidateAll(); onClose() },
    onError:   (e: { response?: { status?: number } }) => {
      if (e.response?.status === 404) { invalidateAll(); onClose() }
      else setError('Помилка видалення')
    },
  })

  const editMutation = useMutation({
    mutationFn: () => staffApi.editAccrual(staffId, existingTx!.id, {
      gross_amount:  parseFloat(amount),
      edit_note:     note || 'Ручне коригування суми',
    }),
    onSuccess: () => { invalidateAll(); onClose() },
    onError:   () => setError('Помилка збереження'),
  })

  function handleSubmit() {
    setError(null)
    if (present) {
      const amt = parseFloat(amount)
      if (isNaN(amt) || amt < 0) { setError('Введіть коректну суму'); return }
      if (existingTx) {
        // amount or note changed — edit
        editMutation.mutate()
      } else {
        createMutation.mutate()
      }
    } else {
      if (existingTx) {
        deleteMutation.mutate()
      } else {
        onClose()
      }
    }
  }

  const isPending = createMutation.isPending || deleteMutation.isPending || editMutation.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Відмітка · {displayDate}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Місяць по днях · {fmt(rate.rate_value)} ÷ {wd} дн = {fmt(computed)} грн/день
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {/* Present / Absent toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPresent(true)}
            className={`flex-1 py-2.5 text-sm font-medium rounded-xl border-2 transition-colors ${
              present
                ? 'border-iris-500 bg-iris-50 text-iris-700'
                : 'border-gray-200 text-gray-400 hover:border-gray-300'
            }`}
          >
            Присутній
          </button>
          <button
            type="button"
            onClick={() => setPresent(false)}
            className={`flex-1 py-2.5 text-sm font-medium rounded-xl border-2 transition-colors ${
              !present
                ? 'border-rose-400 bg-rose-50 text-rose-600'
                : 'border-gray-200 text-gray-400 hover:border-gray-300'
            }`}
          >
            Відсутній
          </button>
        </div>

        {/* Amount + note — shown only when present */}
        {present && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Сума за день (грн)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                autoFocus
                onFocus={e => e.target.select()}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
              />
              {parseFloat(amount) !== computed && (
                <p className="text-xs text-amber-600 mt-0.5">
                  Змінено з {fmt(computed)} грн (розрахункова ставка)
                </p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Примітка</label>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Необов'язково"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
              />
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSubmit}
            disabled={isPending || (present && (amount === '' || isNaN(parseFloat(amount))))}
            className="flex-1 py-2 bg-iris-600 text-white text-sm rounded-xl hover:bg-iris-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? '...' : 'Зберегти'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 rounded-xl hover:bg-gray-100">
            Скасувати
          </button>
        </div>
      </div>
    </div>
  )
}

// ── VacationMarkDialog (vacation rate) ─────────────────────────────────────

export function VacationMarkDialog({
  staffId,
  date,
  rate,
  existingTx,
  onClose,
  invalidateKeys,
}: {
  staffId:        string
  date:           string
  rate:           SalaryGridRate & { day_rate_cached?: string | null; vacation_days_limit?: number | null }
  existingTx:     SalaryTransaction | null
  onClose:        () => void
  invalidateKeys?: string[][]
}) {
  const qc = useQueryClient()
  const [note, setNote]     = useState(existingTx?.note ?? '')
  const [marked, setMarked] = useState<boolean>(existingTx !== null)
  const [error, setError]   = useState<string | null>(null)

  const year        = new Date(date + 'T00:00:00').getFullYear()
  const displayDate = new Date(date + 'T00:00:00').toLocaleDateString('uk-UA')
  const dayRate     = Number(rate.day_rate_cached ?? 0)

  const { data: vacDays } = useQuery({
    queryKey: ['vacation-days', staffId, year],
    queryFn:  () => staffApi.getVacationDays(staffId, year),
    staleTime: 30_000,
  })

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['salary', staffId] })
    qc.invalidateQueries({ queryKey: ['vacation-days', staffId, year] })
    invalidateKeys?.forEach(k => qc.invalidateQueries({ queryKey: k }))
  }

  const createMutation = useMutation({
    mutationFn: () => staffApi.addManualAccrual(staffId, {
      rate_id:          rate.id,
      transaction_date: date,
      note:             note || undefined,
    }),
    onSuccess: () => { invalidateAll(); onClose() },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      setError(e.response?.data?.message ?? 'Помилка збереження')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => staffApi.deleteAccrual(staffId, existingTx!.id),
    onSuccess: () => { invalidateAll(); onClose() },
    onError: (e: { response?: { status?: number } }) => {
      if (e.response?.status === 404) { invalidateAll(); onClose() }
      else setError('Помилка видалення')
    },
  })

  function handleSubmit() {
    setError(null)
    if (marked) {
      if (!existingTx) createMutation.mutate()
      else onClose()
    } else {
      if (existingTx) deleteMutation.mutate()
      else onClose()
    }
  }

  const isPending  = createMutation.isPending || deleteMutation.isPending
  const usedAfter  = vacDays ? (existingTx ? vacDays.used : vacDays.used + 1) : null
  const limit      = rate.vacation_days_limit ?? vacDays?.limit ?? 0
  const willExceed = !existingTx && vacDays && (vacDays.used + 1) > limit

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Відпустка · {displayDate}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Ставка за день: <span className="font-semibold text-iris-700">{fmt(dayRate)} грн</span>
              {vacDays && (
                <span className="ml-2 text-gray-400">
                  ({vacDays.used} / {vacDays.limit} дн. за {year} рік)
                </span>
              )}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {/* Vacation / Not vacation toggle */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMarked(true)}
            className={`flex-1 py-2.5 text-sm font-medium rounded-xl border-2 transition-colors ${
              marked
                ? 'border-amber-400 bg-amber-50 text-amber-700'
                : 'border-gray-200 text-gray-400 hover:border-gray-300'
            }`}
          >
            В — Відпустка
          </button>
          <button
            type="button"
            onClick={() => setMarked(false)}
            className={`flex-1 py-2.5 text-sm font-medium rounded-xl border-2 transition-colors ${
              !marked
                ? 'border-gray-400 bg-gray-50 text-gray-600'
                : 'border-gray-200 text-gray-400 hover:border-gray-300'
            }`}
          >
            Без відмітки
          </button>
        </div>

        {marked && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs bg-amber-50 rounded-lg px-3 py-2">
              <span className="text-amber-700">Нарахування за цей день:</span>
              <span className="font-mono font-semibold text-amber-800">{fmt(dayRate)} грн</span>
            </div>
            {willExceed && (
              <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
                Досягнуто ліміт {limit} відпускних днів на {year} рік. Відмітка буде відхилена.
              </p>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Примітка</label>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Необов'язково"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
              />
            </div>
            {vacDays && usedAfter !== null && (
              <p className="text-xs text-gray-400">
                Залишок після відмітки: <span className="font-medium">{Math.max(0, limit - usedAfter)}</span> / {limit} дн.
              </p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={handleSubmit}
            disabled={isPending || (marked && !existingTx && !!willExceed)}
            className="flex-1 py-2 bg-iris-600 text-white text-sm rounded-xl hover:bg-iris-700 disabled:opacity-50 transition-colors"
          >
            {isPending ? '...' : 'Зберегти'}
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 rounded-xl hover:bg-gray-100">
            Скасувати
          </button>
        </div>
      </div>
    </div>
  )
}
