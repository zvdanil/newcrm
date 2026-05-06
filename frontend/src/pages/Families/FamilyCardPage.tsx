import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { familiesApi } from '../../api/families.api'

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
