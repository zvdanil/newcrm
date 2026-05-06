import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { familiesApi } from '../../api/families.api'
import { parentsApi } from '../../api/parents.api'

export function FamilyCreatePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [form, setForm] = useState({ name: '', note: '' })
  const [parentSearch, setParentSearch] = useState('')
  const [selectedParentId, setSelectedParentId] = useState('')
  const [selectedParentName, setSelectedParentName] = useState('')
  const [showNewParent, setShowNewParent] = useState(false)
  const [newParent, setNewParent] = useState({ full_name: '', phone: '', email: '' })
  const [error, setError] = useState<string | null>(null)

  const { data: parentsData } = useQuery({
    queryKey: ['parents', parentSearch],
    queryFn: () => parentsApi.list({ search: parentSearch || undefined }),
    enabled: parentSearch.length > 1,
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      let parentId = selectedParentId

      // Якщо обрали "новий контакт" — спочатку створюємо батька
      if (showNewParent) {
        const parent = await parentsApi.create({
          full_name: newParent.full_name,
          phone: newParent.phone || undefined,
          email: newParent.email || undefined,
        })
        parentId = parent.id
      }

      return familiesApi.create({
        name: form.name,
        primary_parent_id: parentId,
        note: form.note || undefined,
      })
    },
    onSuccess: (family) => {
      qc.invalidateQueries({ queryKey: ['families'] })
      navigate(`/families/${family.id}`)
    },
    onError: () => setError('Помилка при збереженні. Перевірте дані.'),
  })

  const isValid = form.name.trim() &&
    (showNewParent ? newParent.full_name.trim() : selectedParentId)

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/families" className="hover:text-iris-600 transition-colors">Сім'ї</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Нова сім'я</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <h1 className="text-lg font-semibold text-gray-900">Додати сім'ю</h1>

        {/* Назва */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Назва сім'ї <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Сім'я Іваненків"
            className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
          />
        </div>

        {/* Відповідальний */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Відповідальний контакт <span className="text-red-500">*</span>
          </label>

          {!showNewParent ? (
            <div className="space-y-2">
              <input
                type="text"
                value={parentSearch}
                onChange={(e) => { setParentSearch(e.target.value); setSelectedParentId('') }}
                placeholder="Пошук за іменем або телефоном..."
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
              />

              {/* Результати пошуку */}
              {parentsData && parentsData.data.length > 0 && !selectedParentId && (
                <ul className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                  {parentsData.data.map((p) => (
                    <li
                      key={p.id}
                      onClick={() => { setSelectedParentId(p.id); setSelectedParentName(p.full_name); setParentSearch(p.full_name) }}
                      className="px-3 py-2 text-sm hover:bg-iris-50 cursor-pointer"
                    >
                      <span className="font-medium">{p.full_name}</span>
                      {p.phone && <span className="text-gray-400 ml-2">{p.phone}</span>}
                    </li>
                  ))}
                </ul>
              )}

              {selectedParentId && (
                <div className="flex items-center gap-2 px-3 py-2 bg-iris-50 rounded-lg text-sm">
                  <span className="font-medium text-iris-700">{selectedParentName}</span>
                  <button onClick={() => { setSelectedParentId(''); setSelectedParentName(''); setParentSearch('') }} className="text-gray-400 hover:text-gray-600 ml-auto">✕</button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowNewParent(true)}
                className="text-sm text-iris-600 hover:underline"
              >
                + Створити новий контакт
              </button>
            </div>
          ) : (
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm font-medium text-gray-700">Новий контакт</p>
              <input
                type="text"
                value={newParent.full_name}
                onChange={(e) => setNewParent({ ...newParent, full_name: e.target.value })}
                placeholder="ПІБ *"
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
              />
              <input
                type="tel"
                value={newParent.phone}
                onChange={(e) => setNewParent({ ...newParent, phone: e.target.value })}
                placeholder="Телефон"
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
              />
              <input
                type="email"
                value={newParent.email}
                onChange={(e) => setNewParent({ ...newParent, email: e.target.value })}
                placeholder="Email"
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
              />
              <button
                type="button"
                onClick={() => setShowNewParent(false)}
                className="text-sm text-gray-500 hover:underline"
              >
                ← Обрати існуючий контакт
              </button>
            </div>
          )}
        </div>

        {/* Нотатка */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Нотатка</label>
          <textarea
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            rows={2}
            className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
          />
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={() => createMutation.mutate()}
            disabled={!isValid || createMutation.isPending}
            className="px-4 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {createMutation.isPending ? 'Збереження...' : 'Зберегти'}
          </button>
          <Link to="/families" className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm font-medium">
            Скасувати
          </Link>
        </div>
      </div>
    </div>
  )
}
