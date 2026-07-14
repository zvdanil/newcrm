import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { childrenApi } from '../../api/children.api'
import { groupsApi } from '../../api/groups.api'
import { useCanAccess } from '../../hooks/useCanAccess'

export function ChildrenListPage() {
  const [search, setSearch] = useState('')
  const [groupId, setGroupId] = useState('')
  const [showActive, setShowActive] = useState<boolean | undefined>(true)
  const canCreate = useCanAccess('owner', 'admin', 'manager')

  const { data: groupsData } = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupsApi.list(),
    staleTime: 5 * 60 * 1000,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['children', search, groupId, showActive],
    queryFn: () => childrenApi.list({
      search: search || undefined,
      group_id: groupId || undefined,
      is_active: showActive,
    }),
    placeholderData: (prev) => prev,
  })

  const children = data?.data ?? []
  const total = data?.total ?? 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Діти</h1>
          <p className="text-sm text-gray-500">{total} записів</p>
        </div>
        {canCreate && (
          <Link
            to="/children/new"
            className="px-4 py-2 bg-iris-600 hover:bg-iris-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            + Додати дитину
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Пошук за ім'ям дитини, батьків або телефоном..."
          className="flex-1 min-w-48 rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
        />

        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
        >
          <option value="">Усі групи</option>
          {groupsData?.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>

        <select
          value={showActive === undefined ? '' : String(showActive)}
          onChange={(e) => {
            const v = e.target.value
            setShowActive(v === '' ? undefined : v === 'true')
          }}
          className="rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
        >
          <option value="true">Активні</option>
          <option value="false">Архів</option>
          <option value="">Усі</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
        ) : children.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">Нічого не знайдено</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">ПІБ</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Група</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Сім'я</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Контакт</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {children.map((child) => (
                <tr key={child.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      to={`/children/${child.id}`}
                      className="font-medium text-gray-900 hover:text-iris-600 transition-colors"
                    >
                      {child.full_name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                    {child.group_name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                    {child.family_name ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">
                    {child.primary_parent_phone ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      child.is_active
                        ? 'bg-green-50 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {child.is_active ? 'Активна' : 'Архів'}
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
