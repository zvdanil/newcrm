import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { activitiesApi } from '../../api/activities.api'
import { useCanAccess } from '../../hooks/useCanAccess'

export function ActivitiesListPage() {
  const [showArchived, setShowArchived] = useState(false)
  const canEdit = useCanAccess('owner', 'admin')

  const { data: allActivities = [], isLoading } = useQuery({
    queryKey: ['activities', 'all'],
    queryFn: () => activitiesApi.list(true),
    staleTime: 0,
  })

  const active   = allActivities.filter((a) => a.is_active)
  const archived = allActivities.filter((a) => !a.is_active)
  const visible  = showArchived ? allActivities : active

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Активності</h1>
          <p className="text-sm text-gray-500">
            {active.length} активних{archived.length > 0 ? `, ${archived.length} в архіві` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {archived.length > 0 && (
            <button onClick={() => setShowArchived((v) => !v)}
              className={`text-sm font-medium transition-colors ${showArchived ? 'text-iris-600' : 'text-gray-400 hover:text-gray-600'}`}>
              {showArchived ? 'Приховати архів' : `Архів (${archived.length})`}
            </button>
          )}
          {canEdit && (
            <Link to="/activities/new" className="px-4 py-2 bg-iris-600 hover:bg-iris-700 text-white text-sm font-medium rounded-lg transition-colors">
              + Додати активність
            </Link>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">Активностей ще немає</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Назва</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Тип</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Рахунок</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Тариф</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map((activity) => (
                <tr key={activity.id} className={`transition-colors ${activity.is_active ? 'hover:bg-gray-50' : 'bg-gray-50 opacity-60'}`}>
                  <td className="px-4 py-3">
                    <Link to={`/activities/${activity.id}`} className="font-medium text-gray-900 hover:text-iris-600 transition-colors">
                      {activity.name}
                    </Link>
                    {activity.is_rigid && <span className="ml-2 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">жорсткий</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">
                    {activity.tariff_type === 'monthly' ? 'Місячний' : 'За заняття'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{activity.account_name ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-900 hidden md:table-cell">
                    {activity.current_tariff ? `${Number(activity.current_tariff.base_fee).toFixed(2)} грн` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${activity.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {activity.is_active ? 'Активна' : 'Архів'}
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
