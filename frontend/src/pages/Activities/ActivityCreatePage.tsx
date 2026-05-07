import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { activitiesApi } from '../../api/activities.api'
import { accountsApi } from '../../api/accounts.api'

export function ActivityCreatePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [form, setForm] = useState({
    name: '',
    account_id: '',
    tariff_type: 'monthly' as 'monthly' | 'per_lesson',
    is_rigid: false,
    base_fee: '',
    note: '',
  })
  const [error, setError] = useState<string | null>(null)

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list })

  const createMutation = useMutation({
    mutationFn: () => activitiesApi.create({
      name: form.name.trim(),
      account_id: form.account_id || undefined,
      tariff_type: form.tariff_type,
      is_rigid: form.is_rigid,
      base_fee: form.base_fee ? Number(form.base_fee) : undefined,
      note: form.note || undefined,
    }),
    onSuccess: (activity) => {
      qc.invalidateQueries({ queryKey: ['activities'] })
      navigate(`/activities/${activity.id}`)
    },
    onError: () => setError('Помилка при збереженні'),
  })

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/activities" className="hover:text-iris-600 transition-colors">Активності</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Нова активність</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <h1 className="text-lg font-semibold text-gray-900">Додати активність</h1>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Назва <span className="text-red-500">*</span></label>
          <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Садик, Англійська, Танці..."
            className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Тип тарифу</label>
            <select value={form.tariff_type} onChange={(e) => setForm({ ...form, tariff_type: e.target.value as 'monthly' | 'per_lesson' })}
              className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
              <option value="monthly">Місячний</option>
              <option value="per_lesson">За заняття</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Рахунок</label>
            <select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}
              className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
              <option value="">— не вказано —</option>
              {accounts.filter((a) => a.is_active).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Базовий тариф (грн)</label>
          <input type="number" min="0" step="0.01" value={form.base_fee}
            onChange={(e) => setForm({ ...form, base_fee: e.target.value })}
            placeholder="0.00"
            className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          <p className="mt-1 text-xs text-gray-400">Можна залишити порожнім і встановити пізніше</p>
        </div>

        <div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_rigid} onChange={(e) => setForm({ ...form, is_rigid: e.target.checked })}
              className="rounded border-gray-300 text-iris-600 focus:ring-iris-500" />
            <span className="text-sm font-medium text-gray-700">Жорсткий абонемент</span>
          </label>
          <p className="mt-1 ml-6 text-xs text-gray-400">Відсутність за поважною причиною не генерує повернення коштів</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Нотатка</label>
          <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
            rows={2} className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex gap-3 pt-2">
          <button onClick={() => createMutation.mutate()} disabled={!form.name.trim() || createMutation.isPending}
            className="px-4 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {createMutation.isPending ? 'Збереження...' : 'Зберегти'}
          </button>
          <Link to="/activities" className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm font-medium">Скасувати</Link>
        </div>
      </div>
    </div>
  )
}
