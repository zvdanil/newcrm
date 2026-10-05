import React, { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { childrenApi } from '../../api/children.api'
import { today } from '../../utils/dateStr'

interface AccountOption {
  id: string
  name: string
  is_active: boolean
}

interface BalanceOption {
  account_id: string
  account_name: string
  balance: string | number
}

interface TransferBalanceModalProps {
  childId: string
  isOpen: boolean
  accounts: AccountOption[]
  balances: BalanceOption[]
  onClose: () => void
}

function fmt(n: number) {
  return `${n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} грн`
}

export function TransferBalanceModal({ childId, isOpen, accounts, balances, onClose }: TransferBalanceModalProps) {
  const qc = useQueryClient()
  const [fromAccountId, setFromAccountId] = useState('')
  const [toAccountId, setToAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const activeAccounts = accounts.filter((a) => a.is_active)
  const balanceOf = (accId: string) => Number(balances.find((b) => b.account_id === accId)?.balance ?? 0)

  useEffect(() => {
    if (!isOpen) return
    setError(null)
    setAmount('')
    setNote('')
    setDate(today())
    // Default source: account with the largest positive balance
    const positive = [...balances].filter((b) => Number(b.balance) > 0).sort((a, b) => Number(b.balance) - Number(a.balance))
    const from = positive[0]?.account_id ?? balances[0]?.account_id ?? ''
    setFromAccountId(from)
    setToAccountId(activeAccounts.find((a) => a.id !== from)?.id ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const mutation = useMutation({
    mutationFn: () =>
      childrenApi.transferBalance(childId, {
        from_account_id: fromAccountId,
        to_account_id: toAccountId,
        amount: Number(amount),
        transaction_date: date || undefined,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance', childId] })
      qc.invalidateQueries({ queryKey: ['ledger', childId] })
      qc.invalidateQueries({ queryKey: ['childOSV', childId] })
      qc.invalidateQueries({ queryKey: ['open-accruals', childId] })
      onClose()
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setError(msg ?? 'Помилка при перебросі балансу')
    },
  })

  if (!isOpen) return null

  const fromBalance = fromAccountId ? balanceOf(fromAccountId) : 0
  const toBalance = toAccountId ? balanceOf(toAccountId) : 0
  const numAmount = Number(amount)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!fromAccountId || !toAccountId) return setError('Оберіть обидва рахунки')
    if (fromAccountId === toAccountId) return setError('Рахунки мають бути різними')
    if (!(numAmount > 0)) return setError('Вкажіть суму більше 0')
    if (numAmount > fromBalance + 0.005 &&
      !window.confirm(`Сума перевищує баланс рахунку-джерела (${fmt(fromBalance)}). Баланс стане від'ємним. Продовжити?`)) return
    mutation.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Переброс балансу між рахунками</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {error && <div className="p-2.5 bg-red-50 text-red-700 text-xs rounded-lg">{error}</div>}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">З рахунку *</label>
          <select value={fromAccountId}
            onChange={(e) => {
              setFromAccountId(e.target.value)
              if (e.target.value === toAccountId) setToAccountId('')
            }}
            className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
            <option value="">— оберіть —</option>
            {activeAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {fromAccountId && (
            <div className="flex justify-between mt-1 text-xs text-gray-500">
              <span>Баланс: <strong className={fromBalance >= 0 ? 'text-green-600' : 'text-red-600'}>{fmt(fromBalance)}</strong></span>
              {fromBalance > 0 && (
                <button type="button" className="text-iris-600 hover:underline" onClick={() => setAmount(fromBalance.toFixed(2))}>
                  Вся сума
                </button>
              )}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">На рахунок *</label>
          <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}
            className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
            <option value="">— оберіть —</option>
            {activeAccounts.filter((a) => a.id !== fromAccountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {toAccountId && (
            <p className="mt-1 text-xs text-gray-500">
              Баланс: <strong className={toBalance >= 0 ? 'text-green-600' : 'text-red-600'}>{fmt(toBalance)}</strong>
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Сума (грн) *</label>
            <input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Дата</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Примітка</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="необов'язково"
            className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
        </div>

        {fromAccountId && toAccountId && numAmount > 0 && (
          <div className="p-3 bg-purple-50 border border-purple-100 rounded-lg text-xs text-purple-900 space-y-0.5">
            <p>Після переброса:</p>
            <p>• {accounts.find((a) => a.id === fromAccountId)?.name}: {fmt(fromBalance)} → <strong>{fmt(fromBalance - numAmount)}</strong></p>
            <p>• {accounts.find((a) => a.id === toAccountId)?.name}: {fmt(toBalance)} → <strong>{fmt(toBalance + numAmount)}</strong></p>
            <p className="text-purple-600 pt-1">Банківські рахунки та PnL не змінюються.</p>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900">Скасувати</button>
          <button type="submit" disabled={mutation.isPending}
            className="px-4 py-1.5 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-md disabled:opacity-50">
            {mutation.isPending ? '...' : 'Виконати переброс'}
          </button>
        </div>
      </form>
    </div>
  )
}
