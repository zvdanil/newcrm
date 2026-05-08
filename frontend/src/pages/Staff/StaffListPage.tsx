import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { staffApi, type StaffType } from '../../api/staff.api'

const TYPE_LABELS: Record<StaffType, string> = {
  employee: 'Співробітник',
  partner:  'Партнер / ФОП',
}

const RATE_TYPE_LABELS: Record<string, string> = {
  per_lesson:    'За заняття',
  per_child:     'За дитину',
  fixed_monthly: 'Фіксований оклад',
  hourly:        'Погодинна',
  smart:         'Смарт',
  bonus:         'Бонус',
}

function AddStaffForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    full_name: '', specialization: '', type: 'employee' as StaffType,
    phone: '', start_date: '', note: '',
  })
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: staffApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff'] }); onDone() },
    onError: () => setError('Помилка збереження'),
  })

  return (
    <form
      onSubmit={e => { e.preventDefault(); setError(null); mutation.mutate(form) }}
      className="bg-iris-50 border border-iris-200 rounded-xl p-4 space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">ПІБ *</label>
          <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
            placeholder="Іванов Іван Іванович"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Тип</label>
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as StaffType }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500">
            <option value="employee">Співробітник</option>
            <option value="partner">Партнер / ФОП</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Спеціалізація</label>
          <input value={form.specialization} onChange={e => setForm(f => ({ ...f, specialization: e.target.value }))}
            placeholder="Педагог, хореограф..."
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Телефон</label>
          <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Дата початку</label>
          <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Нотатка</label>
          <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending || !form.full_name.trim()}
          className="px-4 py-2 bg-iris-600 text-white text-sm rounded-lg hover:bg-iris-700 disabled:opacity-50">
          {mutation.isPending ? 'Збереження...' : 'Додати'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">
          Скасувати
        </button>
      </div>
    </form>
  )
}

export function StaffListPage() {
  const [showAdd, setShowAdd]           = useState(false)
  const [filterType, setFilterType]     = useState<'' | StaffType>('')
  const [filterActive, setFilterActive] = useState<'true' | 'false' | ''>('true')

  const { data: staff = [], isLoading } = useQuery({
    queryKey: ['staff', filterType, filterActive],
    queryFn: () => staffApi.list({
      type:      filterType || undefined,
      is_active: filterActive ? filterActive === 'true' : undefined,
    }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Персонал</h1>
          <p className="text-sm text-gray-500">{staff.length} записів</p>
        </div>
        {!showAdd && (
          <button onClick={() => setShowAdd(true)}
            className="px-4 py-2 bg-iris-600 hover:bg-iris-700 text-white text-sm font-medium rounded-lg transition-colors">
            + Додати
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <select value={filterType} onChange={e => setFilterType(e.target.value as '' | StaffType)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500">
          <option value="">Всі типи</option>
          <option value="employee">Співробітники</option>
          <option value="partner">Партнери / ФОП</option>
        </select>
        <select value={filterActive} onChange={e => setFilterActive(e.target.value as 'true' | 'false' | '')}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500">
          <option value="true">Активні</option>
          <option value="false">Архів</option>
          <option value="">Всі</option>
        </select>
      </div>

      {showAdd && <AddStaffForm onDone={() => setShowAdd(false)} />}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
        ) : staff.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">Персоналу не знайдено</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ПІБ</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Тип</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Спеціалізація</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Дата початку</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Телефон</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {staff.map(s => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link to={`/staff/${s.id}`} className="font-medium text-iris-700 hover:text-iris-900">
                      {s.full_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    <span className={`px-2 py-0.5 rounded-full ${
                      s.type === 'partner' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                    }`}>
                      {TYPE_LABELS[s.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{s.specialization ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{s.start_date?.slice(0, 10) ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{s.phone ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      s.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'
                    }`}>
                      {s.is_active ? 'Активний' : 'Архів'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export { RATE_TYPE_LABELS }
