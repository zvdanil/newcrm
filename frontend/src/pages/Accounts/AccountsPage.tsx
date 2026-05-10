import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { accountsApi } from '../../api/accounts.api'
import { useCanAccess } from '../../hooks/useCanAccess'
import type { Account } from '../../types'

const TYPE_LABELS: Record<Account['type'], string> = { fop: 'ФОП', cash: 'Готівка', bank: 'Банк' }

function fmt(v: string | undefined) {
  if (v === undefined) return '—'
  const n = parseFloat(v)
  return (n >= 0 ? '+' : '') + n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₴'
}

export function AccountsPage() {
  const qc = useQueryClient()
  const canEdit = useCanAccess('owner', 'admin')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', type: 'fop' as Account['type'], currency: 'UAH', note: '' })

  const [addingNew, setAddingNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', type: 'fop' as Account['type'], currency: 'UAH', note: '' })
  const [newError, setNewError] = useState<string | null>(null)

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & typeof editForm) => accountsApi.update(id, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); setEditingId(null) },
  })

  const createMutation = useMutation({
    mutationFn: accountsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      setAddingNew(false)
      setNewForm({ name: '', type: 'fop', currency: 'UAH', note: '' })
      setNewError(null)
    },
    onError: () => setNewError('Помилка при збереженні'),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => accountsApi.update(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })

  const startEdit = (a: (typeof accounts)[0]) => {
    setEditingId(a.id)
    setEditForm({ name: a.name, type: a.type, currency: a.currency, note: a.note ?? '' })
  }

  const handleCreate = () => {
    if (!newForm.name.trim()) { setNewError('Назва є обовʼязковою'); return }
    createMutation.mutate({ ...newForm, name: newForm.name.trim(), note: newForm.note || undefined })
  }

  const totalBalance = accounts
    .filter((a) => a.is_active)
    .reduce((sum, a) => sum + parseFloat(a.balance ?? '0'), 0)

  const activeCount   = accounts.filter((a) => a.is_active).length
  const inactiveCount = accounts.filter((a) => !a.is_active).length

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Рахунки</h1>
          <p className="text-sm text-gray-500">
            {activeCount} активних{inactiveCount > 0 ? `, ${inactiveCount} архів` : ''}
            {' · '}
            <span className={totalBalance >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
              загалом {totalBalance.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴
            </span>
          </p>
        </div>
        {canEdit && !addingNew && (
          <button
            onClick={() => setAddingNew(true)}
            className="px-4 py-2 bg-iris-600 hover:bg-iris-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + Додати рахунок
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
        ) : accounts.length === 0 && !addingNew ? (
          <div className="py-12 text-center text-sm text-gray-400">Рахунків ще немає</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Назва</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Тип</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Валюта</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Баланс</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Статус</th>
                {canEdit && <th className="px-4 py-3 w-36" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {accounts.map((account) => (
                <tr key={account.id} className={`transition-colors ${account.is_active ? 'hover:bg-gray-50' : 'bg-gray-50 opacity-60'}`}>
                  {editingId === account.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input
                          type="text" value={editForm.name} autoFocus
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <select
                          value={editForm.type}
                          onChange={(e) => setEditForm({ ...editForm, type: e.target.value as Account['type'] })}
                          className="rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                        >
                          <option value="fop">ФОП</option>
                          <option value="cash">Готівка</option>
                          <option value="bank">Банк</option>
                        </select>
                      </td>
                      <td className="px-4 py-2 hidden sm:table-cell">
                        <input
                          type="text" value={editForm.currency}
                          onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })}
                          className="w-20 rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                        />
                      </td>
                      <td className="px-4 py-2" />
                      <td className="px-4 py-2" />
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => updateMutation.mutate({ id: account.id, ...editForm })}
                            disabled={updateMutation.isPending}
                            className="text-xs px-3 py-1 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-md transition-colors"
                          >
                            {updateMutation.isPending ? '...' : 'Зберегти'}
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-900">
                            Скасувати
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        <Link to={`/accounts/${account.id}`} className="hover:text-iris-600 transition-colors">
                          {account.name}
                        </Link>
                        {account.note && <p className="text-xs text-gray-400 font-normal">{account.note}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-500">{TYPE_LABELS[account.type]}</td>
                      <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{account.currency}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        <span className={parseFloat(account.balance ?? '0') >= 0 ? 'text-green-700' : 'text-red-600'}>
                          {fmt(account.balance)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${account.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {account.is_active ? 'Активний' : 'Архів'}
                        </span>
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 justify-end">
                            <button onClick={() => startEdit(account)} className="text-xs text-iris-600 hover:text-iris-700 font-medium">
                              Редагувати
                            </button>
                            <button
                              onClick={() => toggleActiveMutation.mutate({ id: account.id, is_active: !account.is_active })}
                              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                            >
                              {account.is_active ? 'Вимкнути' : 'Увімкнути'}
                            </button>
                          </div>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}

              {addingNew && (
                <tr className="bg-iris-50">
                  <td className="px-4 py-2">
                    <div className="space-y-1">
                      <input
                        type="text" value={newForm.name} placeholder="Назва рахунку" autoFocus
                        onChange={(e) => { setNewForm({ ...newForm, name: e.target.value }); setNewError(null) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setAddingNew(false) }}
                        className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                      />
                      {newError && <p className="text-xs text-red-600">{newError}</p>}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={newForm.type}
                      onChange={(e) => setNewForm({ ...newForm, type: e.target.value as Account['type'] })}
                      className="rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                    >
                      <option value="fop">ФОП</option>
                      <option value="cash">Готівка</option>
                      <option value="bank">Банк</option>
                    </select>
                  </td>
                  <td className="px-4 py-2 hidden sm:table-cell">
                    <input
                      type="text" value={newForm.currency}
                      onChange={(e) => setNewForm({ ...newForm, currency: e.target.value })}
                      className="w-20 rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                    />
                  </td>
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2" />
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={handleCreate} disabled={createMutation.isPending}
                        className="text-xs px-3 py-1 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-md transition-colors"
                      >
                        {createMutation.isPending ? '...' : 'Додати'}
                      </button>
                      <button
                        onClick={() => { setAddingNew(false); setNewError(null) }}
                        className="text-xs px-2 py-1 text-gray-500 hover:text-gray-900"
                      >
                        Скасувати
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
