import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { familiesApi, type ChildDebt } from '../../api/families.api'
import { accountsApi } from '../../api/accounts.api'

// ── Debt breakdown + payment form ──────────────────────────────────────────

interface PayFormState {
  account_id: string
  payment_account_id: string
  amount: string
  transaction_date: string
  note: string
  mode: 'auto' | 'manual'
  manual: Record<string, string>  // child_id → amount string
  advance_child_id: string
}

function WaterfallBlock({ familyId }: { familyId: string }) {
  const qc = useQueryClient()

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
    staleTime: 5 * 60 * 1000,
  })

  const [form, setForm] = useState<PayFormState>({
    account_id: '',
    payment_account_id: '',
    amount: '',
    transaction_date: new Date().toISOString().slice(0, 10),
    note: '',
    mode: 'auto',
    manual: {},
    advance_child_id: '',
  })
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: debtsData, isLoading: debtsLoading } = useQuery({
    queryKey: ['family-debts', familyId, form.account_id],
    queryFn: () => familiesApi.getDebts(familyId, form.account_id),
    enabled: !!form.account_id,
    staleTime: 10_000,
  })

  const payMutation = useMutation({
    mutationFn: (payload: Parameters<typeof familiesApi.payment>[1]) =>
      familiesApi.payment(familyId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['family-debts', familyId] })
      qc.invalidateQueries({ queryKey: ['family', familyId] })
      setShowForm(false)
      setError(null)
      setForm(f => ({ ...f, amount: '', note: '', manual: {}, payment_account_id: '' }))
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      setError(e.response?.data?.message ?? 'Помилка при збереженні платежу')
    },
  })

  // Auto-preview waterfall based on entered amount
  function previewWaterfall(debts: ChildDebt[], totalAmount: number, advChildId: string) {
    const debtors = [...debts]
      .filter(c => c.debt > 0)
      .sort((a, b) => {
        const da = a.oldest_accrual_date ?? '9999-12-31'
        const db = b.oldest_accrual_date ?? '9999-12-31'
        if (da < db) return -1
        if (da > db) return 1
        return b.debt - a.debt
      })

    const preview: Record<string, number> = {}
    let remaining = totalAmount

    for (const c of debtors) {
      if (remaining <= 0) break
      const pay = Math.round(Math.min(c.debt, remaining) * 100) / 100
      preview[c.child_id] = pay
      remaining = Math.round((remaining - pay) * 100) / 100
    }

    if (remaining > 0.009) {
      const target = advChildId
        ? debts.find(c => c.child_id === advChildId)
        : debts[0]
      if (target) {
        preview[target.child_id] = Math.round(((preview[target.child_id] ?? 0) + remaining) * 100) / 100
      }
    }

    return preview
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const amount = parseFloat(form.amount)
    if (!form.account_id) return setError('Оберіть рахунок')
    if (!amount || amount <= 0) return setError('Введіть суму')

    const payload: Parameters<typeof familiesApi.payment>[1] = {
      account_id: form.account_id,
      amount,
      transaction_date: form.transaction_date || undefined,
      note: form.note || undefined,
      advance_child_id: form.advance_child_id || undefined,
    }

    if (form.payment_account_id && form.payment_account_id !== form.account_id) {
      payload.payment_account_id = form.payment_account_id
    }

    if (form.mode === 'manual' && debtsData) {
      const manual = debtsData.debts
        .map(c => ({ child_id: c.child_id, amount: parseFloat(form.manual[c.child_id] ?? '0') || 0 }))
        .filter(m => m.amount > 0)
      if (manual.length === 0) return setError('Вкажіть суму хоча б для однієї дитини')
      payload.manual_match = manual
    }

    payMutation.mutate(payload)
  }

  const debts = debtsData?.debts ?? []
  const totalDebt = debtsData?.total_debt ?? 0
  const totalAmount = parseFloat(form.amount) || 0
  const preview = form.mode === 'auto' && debts.length > 0 && totalAmount > 0
    ? previewWaterfall(debts, totalAmount, form.advance_child_id)
    : null

  const isCross = !!form.payment_account_id && form.payment_account_id !== form.account_id

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-gray-900">Баланс та оплати</h2>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="text-sm px-3 py-1.5 bg-iris-600 text-white rounded-lg hover:bg-iris-700 transition-colors"
          >
            Внести оплату
          </button>
        )}
      </div>

      {/* Account selector (always visible) */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-gray-500 whitespace-nowrap">Рахунок:</label>
        <select
          value={form.account_id}
          onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}
          className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500"
        >
          <option value="">— оберіть рахунок —</option>
          {accounts.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* Debt breakdown */}
      {form.account_id && (
        debtsLoading ? (
          <p className="text-xs text-gray-400">Завантаження...</p>
        ) : debts.length === 0 ? (
          <p className="text-xs text-gray-400">Дітей немає</p>
        ) : (
          <div className="rounded-lg border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-3 py-2">Дитина</th>
                  <th className="text-right px-3 py-2">Баланс</th>
                  <th className="text-right px-3 py-2">Борг</th>
                  {form.mode === 'auto' && preview && <th className="text-right px-3 py-2 text-iris-600">Буде сплачено</th>}
                  {form.mode === 'manual' && <th className="text-right px-3 py-2 text-iris-600">Сума</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {debts.map(c => (
                  <tr key={c.child_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <Link to={`/children/${c.child_id}`} className="text-gray-900 hover:text-iris-600">
                        {c.child_name}
                      </Link>
                    </td>
                    <td className={`px-3 py-2 text-right font-mono text-sm ${
                      c.balance >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {c.balance >= 0 ? '+' : ''}{c.balance.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm">
                      {c.debt > 0 ? (
                        <span className="text-red-600 font-medium">{c.debt.toFixed(2)}</span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    {form.mode === 'auto' && preview && (
                      <td className="px-3 py-2 text-right font-mono text-sm text-iris-700">
                        {preview[c.child_id] ? preview[c.child_id].toFixed(2) : '—'}
                      </td>
                    )}
                    {form.mode === 'manual' && (
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0"
                          value={form.manual[c.child_id] ?? ''}
                          onChange={e => setForm(f => ({
                            ...f,
                            manual: { ...f.manual, [c.child_id]: e.target.value }
                          }))}
                          className="w-24 text-right text-sm border border-gray-200 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-iris-500"
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              {totalDebt > 0 && (
                <tfoot>
                  <tr className="bg-gray-50 text-xs font-medium text-gray-600">
                    <td className="px-3 py-2" colSpan={2}>Загальний борг</td>
                    <td className="px-3 py-2 text-right font-mono text-red-600">{totalDebt.toFixed(2)}</td>
                    {(form.mode === 'auto' && preview || form.mode === 'manual') && <td />}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )
      )}

      {/* Payment form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-4 pt-2 border-t border-gray-100">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Сума</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                placeholder="0.00"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iris-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Дата</label>
              <input
                type="date"
                value={form.transaction_date}
                onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iris-500"
              />
            </div>
          </div>

          {/* Cross-account */}
          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isCross}
                onChange={e => setForm(f => ({
                  ...f,
                  payment_account_id: e.target.checked ? '' : '',
                }))}
                className="rounded"
              />
              Гроші надійшли на інший рахунок
            </label>
            {isCross && (
              <select
                value={form.payment_account_id}
                onChange={e => setForm(f => ({ ...f, payment_account_id: e.target.value }))}
                className="mt-2 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
              >
                <option value="">— рахунок зарахування —</option>
                {accounts.filter(a => a.id !== form.account_id).map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Mode toggle */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg w-fit">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, mode: 'auto' }))}
              className={`text-xs px-3 py-1 rounded-md transition-colors ${
                form.mode === 'auto' ? 'bg-white text-iris-700 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Авто (Waterfall)
            </button>
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, mode: 'manual' }))}
              className={`text-xs px-3 py-1 rounded-md transition-colors ${
                form.mode === 'manual' ? 'bg-white text-iris-700 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Ручний розподіл
            </button>
          </div>

          {/* Advance child selector (auto mode, payment > debt) */}
          {form.mode === 'auto' && totalAmount > totalDebt && totalDebt > 0 && debts.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Аванс зарахувати на:
              </label>
              <select
                value={form.advance_child_id}
                onChange={e => setForm(f => ({ ...f, advance_child_id: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
              >
                <option value="">— першій дитині у списку —</option>
                {debts.map(c => (
                  <option key={c.child_id} value={c.child_id}>{c.child_name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Нотатка</label>
            <input
              type="text"
              placeholder="Коментар (необов'язково)"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-iris-500"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={payMutation.isPending}
              className="px-4 py-2 bg-iris-600 text-white text-sm rounded-lg hover:bg-iris-700 disabled:opacity-50 transition-colors"
            >
              {payMutation.isPending ? 'Збереження...' : 'Зберегти'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null) }}
              className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Скасувати
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

export function FamilyCardPage() {
  const { id } = useParams<{ id: string }>()

  const { data: family, isLoading } = useQuery({
    queryKey: ['family', id],
    queryFn: () => familiesApi.get(id!),
    enabled: !!id,
  })

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
  if (!family)   return <div className="py-12 text-center text-sm text-gray-400">Сім'ю не знайдено</div>

  return (
    <div className="max-w-2xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/families" className="hover:text-iris-600 transition-colors">Сім'ї</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{family.name}</span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h1 className="text-xl font-semibold text-gray-900">{family.name}</h1>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Відповідальний</dt>
            <dd className="mt-1 text-sm text-gray-900">{family.primary_parent_name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Телефон</dt>
            <dd className="mt-1 text-sm text-gray-900">{family.primary_parent_phone ?? '—'}</dd>
          </div>
          {family.note && (
            <div className="col-span-2">
              <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Нотатка</dt>
              <dd className="mt-1 text-sm text-gray-900">{family.note}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Balance & payment waterfall */}
      <WaterfallBlock familyId={id!} />

      {/* Children */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-medium text-gray-900 mb-4">
          Діти ({family.children?.length ?? 0})
        </h2>
        {!family.children?.length ? (
          <p className="text-sm text-gray-400">Дітей ще немає.{' '}
            <Link to="/children/new" className="text-iris-600 hover:underline">Додати дитину</Link>
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {family.children.map((child) => (
              <li key={child.id} className="py-3 flex items-center justify-between">
                <div>
                  <Link
                    to={`/children/${child.id}`}
                    className="text-sm font-medium text-gray-900 hover:text-iris-600 transition-colors"
                  >
                    {child.full_name}
                  </Link>
                  {child.group_name && (
                    <span className="ml-2 text-xs text-gray-400">{child.group_name}</span>
                  )}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  child.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {child.is_active ? 'Активна' : 'Архів'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Members */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-medium text-gray-900 mb-4">
          Учасники ({family.members?.length ?? 0})
        </h2>
        {!family.members?.length ? (
          <p className="text-sm text-gray-400">Немає учасників.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {family.members.map((member) => (
              <li key={member.id} className="py-3">
                <p className="text-sm font-medium text-gray-900">{member.full_name}</p>
                <p className="text-xs text-gray-400">{member.phone ?? member.email ?? '—'}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
