import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { familiesApi } from '../../api/families.api'
import { useAuthStore } from '../../store/auth.store'

export function FamiliesListPage() {
  const [search, setSearch] = useState('')
  const { user } = useAuthStore()
  const canCreate = user?.role && ['owner', 'admin', 'manager'].includes(user.role)

  const { data, isLoading } = useQuery({
    queryKey: ['families', search],
    queryFn: () => familiesApi.list({ search: search || undefined }),
    placeholderData: (prev) => prev,
  })

  const families = data?.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Сім'ї</h1>
          <p className="text-sm text-gray-500">{data?.total ?? 0} записів</p>
        </div>
        {canCreate && (
          <Link
            to="/families/new"
            className="px-4 py-2 bg-iris-600 hover:bg-iris-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + Додати сім'ю
          </Link>
        )}
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Пошук за назвою або контактом..."
        className="w-full max-w-sm rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
      />

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
        ) : families.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">Нічого не знайдено</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Назва сім'ї</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Відповідальний</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Телефон</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {families.map((family) => (
                <tr key={family.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      to={`/families/${family.id}`}
                      className="font-medium text-gray-900 hover:text-iris-600 transition-colors"
                    >
                      {family.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                    {family.primary_parent_name}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                    {family.primary_parent_phone ?? '—'}
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
