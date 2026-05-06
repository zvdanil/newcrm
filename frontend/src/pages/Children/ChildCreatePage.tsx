import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { childrenApi } from '../../api/children.api'
import { groupsApi } from '../../api/groups.api'
import { familiesApi } from '../../api/families.api'

export function ChildCreatePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [form, setForm] = useState({
    full_name: '',
    birth_date: '',
    group_id: '',
    family_id: '',
    note: '',
  })
  const [error, setError] = useState<string | null>(null)

  const { data: groups } = useQuery({ queryKey: ['groups'], queryFn: () => groupsApi.list(), staleTime: 5 * 60 * 1000 })
  const { data: families } = useQuery({ queryKey: ['families'], queryFn: () => familiesApi.list(), staleTime: 30_000 })

  const createMutation = useMutation({
    mutationFn: () => childrenApi.create({
      full_name: form.full_name,
      birth_date: form.birth_date || undefined,
      group_id: form.group_id || undefined,
      family_id: form.family_id || undefined,
      note: form.note || undefined,
    }),
    onSuccess: (child) => {
      qc.invalidateQueries({ queryKey: ['children'] })
      navigate(`/children/${child.id}`)
    },
    onError: () => setError('Помилка при збереженні. Спробуйте ще раз.'),
  })

  const set = (field: string, value: string) => setForm((f) => ({ ...f, [field]: value }))

  return (
    <div className="max-w-lg space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/children" className="hover:text-iris-600 transition-colors">Діти</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Нова дитина</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <h1 className="text-lg font-semibold text-gray-900">Додати дитину</h1>

        <div className="space-y-4">
          {/* ПІБ */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ПІБ <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.full_name}
              onChange={(e) => set('full_name', e.target.value)}
              required
              placeholder="Іваненко Марія Олегівна"
              className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
            />
          </div>

          {/* Дата народження */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Дата народження</label>
            <input
              type="date"
              value={form.birth_date}
              onChange={(e) => set('birth_date', e.target.value)}
              className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
            />
          </div>

          {/* Група */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Група</label>
            <select
              value={form.group_id}
              onChange={(e) => set('group_id', e.target.value)}
              className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
            >
              <option value="">— без групи —</option>
              {groups?.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          {/* Сім'я */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Сім'я</label>
            <select
              value={form.family_id}
              onChange={(e) => set('family_id', e.target.value)}
              className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
            >
              <option value="">— без сім'ї —</option>
              {families?.data.map((f) => (
                <option key={f.id} value={f.id}>{f.name} ({f.primary_parent_name})</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400">
              Якщо сім'ї ще немає — спочатку{' '}
              <Link to="/families/new" className="text-iris-600 hover:underline">створіть її</Link>.
            </p>
          </div>

          {/* Нотатка */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Нотатка</label>
            <textarea
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
              rows={3}
              placeholder="Алергії, особливі умови..."
              className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
            />
          </div>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => createMutation.mutate()}
            disabled={!form.full_name.trim() || createMutation.isPending}
            className="px-4 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {createMutation.isPending ? 'Збереження...' : 'Зберегти'}
          </button>
          <Link
            to="/children"
            className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm font-medium"
          >
            Скасувати
          </Link>
        </div>
      </div>
    </div>
  )
}
