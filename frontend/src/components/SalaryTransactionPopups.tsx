import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { staffApi, type SalaryTransaction, type RateType } from '../api/staff.api'

export function fmt(v: string | number) { return Number(v).toFixed(2) }

export const RATE_TYPE_LABELS: Record<RateType, string> = {
  per_lesson:    'За заняття',
  per_child:     'За дитину',
  group_lesson:  'За групу',
  fixed_monthly: 'Фіксований оклад',
  hourly:        'Погодинна',
  smart:         'Смарт',
  bonus:         'Бонус',
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

  if (src === 'retro_correction') {
    const delta = typeof m.delta === 'number' ? m.delta : null
    return delta != null ? `Ретро Δ ${delta > 0 ? '+' : ''}${fmt(delta)} грн` : 'Ретро-коригування'
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

  const deleteMutation = useMutation({
    mutationFn: (id: string) => staffApi.deleteAccrual(staffId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary', staffId] })
      invalidateKeys?.forEach(k => qc.invalidateQueries({ queryKey: k }))
    },
    onError: () => setError('Помилка видалення'),
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

export function TxPopup({ tx, staffId, onClose, invalidateKeys }: {
  tx:             SalaryTransaction
  staffId:        string
  onClose:        () => void
  invalidateKeys?: string[][]
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
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
    onError: () => setError('Помилка видалення'),
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
