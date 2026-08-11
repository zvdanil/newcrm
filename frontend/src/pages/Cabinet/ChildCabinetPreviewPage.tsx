import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { parentApi } from '../../api/parent.api'
import { ChildPanel } from './CabinetPage'
import type { ParentChild } from '../../api/parent.api'

export function ChildCabinetPreviewPage() {
  const { childId } = useParams<{ childId: string }>()
  const navigate = useNavigate()

  const { data: child, isLoading, error } = useQuery<ParentChild>({
    queryKey: ['parent-child-info', childId],
    queryFn: () => parentApi.getChildInfo(childId!),
    enabled: !!childId,
  })

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-400">Завантаження кабінету батьків...</div>
  }

  if (error || !child) {
    return (
      <div className="py-12 text-center space-y-4">
        <p className="text-gray-500 text-sm">Помилка завантаження даних кабінету дитини.</p>
        <button
          onClick={() => navigate(`/children/${childId}`)}
          className="text-xs text-iris-600 hover:text-iris-700 font-medium underline"
        >
          ← Повернутися до картки дитини
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl space-y-5">
      {/* Employee preview notification bar */}
      <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between shadow-sm no-print">
        <div className="flex items-center gap-2.5 text-amber-900 text-sm font-medium">
          <span className="text-base">👁️</span>
          <span>
            Режим перегляду кабінету батьків для: <strong className="font-bold">{child.full_name}</strong>
          </span>
        </div>
        <button
          onClick={() => navigate(`/children/${childId}`)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 text-xs font-semibold rounded-lg transition-colors border border-amber-300"
        >
          ← Назад до картки дитини
        </button>
      </div>

      {/* Render Parent Cabinet Panel */}
      <ChildPanel child={child} />
    </div>
  )
}
