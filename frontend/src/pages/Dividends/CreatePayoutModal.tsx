import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { dividendsApi } from '../../api/dividends.api'
import { accountsApi } from '../../api/accounts.api'
import { expensesApi, salaryPaymentsApi } from '../../api/expenses.api'
import { useEffect } from 'react'

export function CreatePayoutModal({
  onClose,
  prefillExpenseId,
  prefillPayoutType,
  prefillTaxPct,
}: {
  onClose: () => void
  prefillExpenseId?: string | null
  prefillPayoutType?: 'cash' | 'cashless'
  prefillTaxPct?: string
}) {
  const queryClient = useQueryClient()

  // ── Queries ─────────────────────────────────────────────────────────────
  const { data: participants = [] } = useQuery({
    queryKey: ['dividends', 'participants'],
    queryFn: dividendsApi.getParticipants,
  })

  const { data: settings } = useQuery({
    queryKey: ['dividends', 'settings'],
    queryFn: dividendsApi.getSettings,
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsApi.list(),
  })

  // We only want unlinked expenses/salaries that are marked as dividends
  const { data: expensesData } = useQuery({
    queryKey: ['expenses', { is_dividend: true }],
    queryFn: () => expensesApi.list({ is_dividend: true }),
  })

  const { data: salaryData } = useQuery({
    queryKey: ['salary-payments', { is_dividend: true }],
    queryFn: () => salaryPaymentsApi.list({ is_dividend: true }),
  })

  const availableSources = useMemo(() => {
    const exps = (expensesData?.data || [])
      .filter(e => !e.dividend_payout_id)
      .map(e => ({
        id: e.id,
        source_type: 'existing' as const,
        amount: e.dividend_amount ?? e.amount,
        full_amount: e.amount,
        account_name: e.account_name,
        date: e.accrual_date,
        note: e.note,
        label: 'Витрата'
      }))

    const sals = (salaryData?.data || [])
      .filter(s => !s.dividend_payout_id)
      .map(s => ({
        id: s.id,
        source_type: 'existing_salary' as const,
        amount: s.gross_amount,
        account_name: s.account_name || 'Без рахунку',
        date: s.transaction_date,
        note: `Зарплата: ${s.staff_name}`,
        label: 'Зарплата'
      }))

    return [...exps, ...sals].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  }, [expensesData, salaryData])

  // ── State ───────────────────────────────────────────────────────────────
  const [participantId, setParticipantId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [type, setType] = useState<'cash' | 'cashless'>(prefillPayoutType ?? 'cash')
  const [taxPct, setTaxPct] = useState(prefillTaxPct ?? String(settings?.default_tax_pct || 0))
  const [note, setNote] = useState('')

  // sources array can be { type: 'new', id: local_uuid, account_id, amount } 
  // or { type: 'existing', expense_id, amount_display, account_display }
  const [sources, setSources] = useState<any[]>([])

  // State for new source sub-form
  const [sourceMode, setSourceMode] = useState<'none' | 'new' | 'existing'>('none')
  const [newAccountId, setNewAccountId] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [selectedExpenseId, setSelectedExpenseId] = useState('')

  // Prefill logic
  useEffect(() => {
    if (prefillExpenseId && availableSources.length > 0) {
      const src = availableSources.find(x => x.id === prefillExpenseId)
      if (src) {
        // Only add if not already in sources
        if (!sources.some(s => (s.type === 'existing' || s.type === 'existing_salary') && s.expense_id === prefillExpenseId)) {
          setSources(prev => [...prev, {
            id: Math.random().toString(),
            type: src.source_type,
            expense_id: prefillExpenseId,
            amount: Number(src.amount),
            full_amount: Number((src as any).full_amount ?? src.amount),
            account_name: src.account_name,
            note: src.note
          }])
        }
      }
    }
  }, [prefillExpenseId, availableSources, sources])

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleAddSource = () => {
    if (sourceMode === 'new') {
      if (!newAccountId || !newAmount) return
      setSources([...sources, {
        id: Math.random().toString(),
        type: 'new',
        account_id: newAccountId,
        amount: Number(newAmount)
      }])
    } else if (sourceMode === 'existing') {
      if (!selectedExpenseId) return
      const src = availableSources.find(x => x.id === selectedExpenseId)
      if (!src) return
      // prevent duplicates
      if (sources.find(s => (s.type === 'existing' || s.type === 'existing_salary') && s.expense_id === selectedExpenseId)) return
      setSources([...sources, {
        id: Math.random().toString(),
        type: src.source_type,
        expense_id: selectedExpenseId,
        amount: Number(src.amount),
        full_amount: Number((src as any).full_amount ?? src.amount),
        account_name: src.account_name,
        note: src.note
      }])
    }
    setSourceMode('none')
    setNewAccountId('')
    setNewAmount('')
    setSelectedExpenseId('')
  }

  const handleRemoveSource = (id: string) => {
    setSources(sources.filter(s => s.id !== id))
  }

  const grossTotal = sources.reduce((sum, s) => sum + s.amount, 0)
  const netTotal = type === 'cashless' ? grossTotal * (1 - Number(taxPct) / 100) : grossTotal

  const createMut = useMutation({
    mutationFn: dividendsApi.createPayout,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dividends'] })
      queryClient.invalidateQueries({ queryKey: ['expenses'] }) // existing expenses got bound
      onClose()
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!participantId || sources.length === 0) return
    createMut.mutate({
      participant_id: participantId,
      date,
      type,
      tax_pct: type === 'cashless' ? Number(taxPct) : 0,
      note,
      sources: sources.map(s => {
        if (s.type === 'new') return { type: 'new', account_id: s.account_id, amount: s.amount }
        return { type: s.type, expense_id: s.expense_id }
      })
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm overflow-y-auto">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden my-8">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 sticky top-0">
          <h2 className="text-xl font-bold text-gray-900">Фіксація виплати дивідендів</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors text-lg">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Партнер (Кому)</label>
              <select
                value={participantId}
                onChange={e => setParticipantId(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-iris-500"
              >
                <option value="">Оберіть партнера...</option>
                {participants.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.share_pct}%)</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Дата виплати</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-iris-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Тип виплати</label>
            <select
              value={type}
              onChange={e => {
                setType(e.target.value as 'cash' | 'cashless')
                if (e.target.value === 'cashless' && !taxPct) {
                  setTaxPct(String(settings?.default_tax_pct || 0))
                }
              }}
              className="w-full sm:w-1/2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-iris-500"
            >
              <option value="cash">Готівка (100% в залік)</option>
              <option value="cashless">Безготівка (з очисткою)</option>
            </select>
          </div>

          {type === 'cashless' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Відсоток очистки (Податок на обнал), %</label>
              <input
                type="number"
                min="0" max="100" step="0.1"
                value={taxPct}
                onChange={e => setTaxPct(e.target.value)}
                required
                className="w-full sm:w-1/3 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-iris-500"
              />
              <p className="mt-1 text-xs text-gray-500">Цей відсоток буде вирахувано з суми витрати для визначення "чистої" долі (Net Amount).</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Джерела фінансування</label>
            <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50/50 mb-3">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Джерело</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 w-32">Сума, ₴</th>
                    <th className="px-4 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {sources.map(s => (
                    <tr key={s.id}>
                      <td className="px-4 py-2 text-sm text-gray-900">
                        {s.type === 'new' ? (
                          <span className="flex items-center gap-2">
                            <span className="bg-iris-100 text-iris-800 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold">Нове списання</span>
                            {accounts.find(a => a.id === s.account_id)?.name}
                          </span>
                        ) : (
                          <span className="flex items-center gap-2 flex-wrap">
                            <span className="bg-blue-100 text-blue-800 text-[10px] px-1.5 py-0.5 rounded uppercase font-bold">Привʼязка {s.type === 'existing_salary' ? 'зарплати' : 'витрати'}</span>
                            {s.full_amount && s.full_amount !== s.amount && (
                              <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.5 rounded font-medium" title={`Повна сума витрати: ${s.full_amount} ₴`}>часткова від {Number(s.full_amount).toFixed(2)} ₴</span>
                            )}
                            <span className="truncate max-w-[200px]" title={s.note}>{s.note || 'Без опису'}</span>
                            <span className="text-gray-400">({s.account_name})</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-sm font-medium text-gray-900 text-right">
                        {s.amount.toLocaleString()} ₴
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button type="button" onClick={() => handleRemoveSource(s.id)} className="text-red-500 hover:text-red-700 font-bold">✕</button>
                      </td>
                    </tr>
                  ))}
                  {sources.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-4 text-center text-sm text-gray-500">
                        Додайте хоча б одне джерело (рахунок або існуючу витрату).
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {sourceMode === 'none' ? (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setSourceMode('new')}
                  className="text-sm font-medium text-iris-600 hover:text-iris-800"
                >
                  + Списати з рахунку
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('existing')}
                  className="text-sm font-medium text-iris-600 hover:text-iris-800"
                >
                  + Привʼязати існуючу витрату
                </button>
              </div>
            ) : (
              <div className="p-4 bg-iris-50 rounded-lg border border-iris-100 flex gap-3 items-end">
                {sourceMode === 'new' ? (
                  <>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-700 mb-1">Рахунок</label>
                      <select value={newAccountId} onChange={e => setNewAccountId(e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm">
                        <option value="">Оберіть рахунок...</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Сума</label>
                      <input type="number" min="0" value={newAmount} onChange={e => setNewAmount(e.target.value)} className="w-32 px-2 py-1.5 border rounded text-sm" placeholder="Сума" />
                    </div>
                  </>
                ) : (
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Оберіть витрату чи зарплату (з міткою дивіденд)</label>
                    <select value={selectedExpenseId} onChange={e => setSelectedExpenseId(e.target.value)} className="w-full px-2 py-1.5 border rounded text-sm">
                      <option value="">Оберіть...</option>
                      {availableSources.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.label}: {new Date(s.date).toLocaleDateString()} — {s.amount} ₴ ({s.account_name}) {s.note ? `— ${s.note}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="flex gap-2">
                  <button type="button" onClick={handleAddSource} className="px-3 py-1.5 bg-gray-900 text-white rounded text-sm font-medium">Додати</button>
                  <button type="button" onClick={() => setSourceMode('none')} className="px-3 py-1.5 bg-gray-200 text-gray-800 rounded text-sm font-medium">Скасувати</button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Коментар (опціонально)</label>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-iris-500"
              placeholder="Призначення виплати"
            />
          </div>

          {/* Totals */}
          {sources.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="flex justify-between text-sm mb-1 text-gray-600">
                <span>Загальна сума (Списано зі счетов):</span>
                <span className="font-medium">{grossTotal.toLocaleString()} ₴</span>
              </div>
              <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-200">
                <span>В залік долі партнера (Еквівалент):</span>
                <span className="text-iris-700">{netTotal.toLocaleString()} ₴</span>
              </div>
            </div>
          )}

        </form>

        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 sticky bottom-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors"
          >
            Скасувати
          </button>
          <button
            onClick={handleSubmit}
            disabled={!participantId || sources.length === 0 || createMut.isPending}
            className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 font-medium transition-colors disabled:opacity-50"
          >
            {createMut.isPending ? 'Збереження...' : 'Зафіксувати виплату'}
          </button>
        </div>
      </div>
    </div>
  )
}
