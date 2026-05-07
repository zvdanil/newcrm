import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { activitiesApi } from '../../api/activities.api'

export function JournalsListPage() {
  const { data: activities = [], isLoading } = useQuery({
    queryKey: ['activities'],
    queryFn: () => activitiesApi.list(false),
  })

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Журнали</h1>
        <p className="text-sm text-gray-500">Оберіть активність для перегляду журналу</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {activities.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-400">
            Активностей ще немає.{' '}
            <Link to="/activities/new" className="text-iris-600 hover:underline">Додати активність</Link>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {activities.map((activity) => (
              <li key={activity.id}>
                <Link
                  to={`/journals/${activity.id}`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors group"
                >
                  <div>
                    <span className="font-medium text-gray-900 group-hover:text-iris-600 transition-colors">
                      {activity.name}
                    </span>
                    <span className="ml-2 text-xs text-gray-400">
                      {activity.tariff_type === 'monthly' ? 'Місячний' : 'За заняття'}
                      {activity.is_rigid && ' · жорсткий'}
                    </span>
                    {activity.account_name && (
                      <span className="ml-2 text-xs text-gray-400">· {activity.account_name}</span>
                    )}
                  </div>
                  <svg className="w-4 h-4 text-gray-300 group-hover:text-iris-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
