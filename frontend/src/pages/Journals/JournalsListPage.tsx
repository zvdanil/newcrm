import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { activitiesApi } from '../../api/activities.api'
import { mergedJournalsApi } from '../../api/mergedJournals.api'
import type { MergedJournal, MergedJournalActivity } from '../../api/mergedJournals.api'

// ─── Merged journal management panel ─────────────────────────────────────────

function MergedJournalManagePanel({ journal, onClose }: { journal: MergedJournal; onClose: () => void }) {
  const qc = useQueryClient()
  const [addingId, setAddingId] = useState('')

  const { data: activities = [] } = useQuery<MergedJournalActivity[]>({
    queryKey: ['merged-journal-activities', journal.id],
    queryFn:  () => mergedJournalsApi.getActivities(journal.id),
  })
  const { data: allActivities = [] } = useQuery({
    queryKey: ['activities'],
    queryFn:  () => activitiesApi.list(false),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['merged-journal-activities', journal.id] })

  const addMutation = useMutation({
    mutationFn: (actId: string) => mergedJournalsApi.addActivity(journal.id, actId),
    onSuccess: () => { invalidate(); setAddingId('') },
  })
  const removeMutation = useMutation({
    mutationFn: (actId: string) => mergedJournalsApi.removeActivity(journal.id, actId),
    onSuccess:  invalidate,
  })

  const linkedIds = new Set(activities.map(a => a.id))
  const available = allActivities.filter(a => !linkedIds.has(a.id))

  return (
    <div className="border-t border-gray-100 bg-gray-50 px-5 py-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Активності у журналі</span>
        <button onClick={onClose} className="text-xs text-gray-400 hover:text-gray-600">Згорнути</button>
      </div>

      {activities.length === 0 && (
        <p className="text-xs text-gray-400">Ще немає активностей</p>
      )}

      <ul className="space-y-1">
        {activities.map(a => (
          <li key={a.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-1.5 border border-gray-200">
            <span className="text-sm text-gray-800">{a.name}</span>
            <button
              onClick={() => removeMutation.mutate(a.id)}
              disabled={removeMutation.isPending}
              className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40"
            >
              Видалити
            </button>
          </li>
        ))}
      </ul>

      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            value={addingId}
            onChange={e => setAddingId(e.target.value)}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500"
          >
            <option value="">Додати активність...</option>
            {available.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button
            onClick={() => addingId && addMutation.mutate(addingId)}
            disabled={!addingId || addMutation.isPending}
            className="px-3 py-1.5 text-sm bg-iris-600 text-white rounded-lg hover:bg-iris-700 disabled:opacity-40 transition-colors"
          >
            Додати
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function JournalsListPage() {
  const qc = useQueryClient()
  const [managingId, setManagingId]   = useState<string | null>(null)
  const [creating, setCreating]       = useState(false)
  const [newName, setNewName]         = useState('')
  const [editingId, setEditingId]     = useState<string | null>(null)
  const [editName, setEditName]       = useState('')

  const { data: activities = [], isLoading: actLoading } = useQuery({
    queryKey: ['activities'],
    queryFn:  () => activitiesApi.list(false),
  })
  const { data: mergedJournals = [], isLoading: mjLoading } = useQuery<MergedJournal[]>({
    queryKey: ['merged-journals'],
    queryFn:  mergedJournalsApi.list,
  })

  const invalidateMj = () => qc.invalidateQueries({ queryKey: ['merged-journals'] })

  const createMutation = useMutation({
    mutationFn: (name: string) => mergedJournalsApi.create({ name }),
    onSuccess: () => { invalidateMj(); setCreating(false); setNewName('') },
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => mergedJournalsApi.update(id, { name }),
    onSuccess: () => { invalidateMj(); setEditingId(null) },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => mergedJournalsApi.delete(id),
    onSuccess:  invalidateMj,
  })

  const isLoading = actLoading || mjLoading
  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Журнали</h1>
        <p className="text-sm text-gray-500">Оберіть активність або об'єднаний журнал</p>
      </div>

      {/* Individual activity journals */}
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
                      {activity.tariff_type === 'monthly' ? 'Місячний' : activity.tariff_type === 'smart' ? 'Смарт' : 'За заняття'}
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

      {/* Merged journals section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Об'єднані журнали</h2>
          <button
            onClick={() => { setCreating(true); setNewName('') }}
            className="text-sm text-iris-600 hover:text-iris-700 font-medium transition-colors"
          >
            + Створити
          </button>
        </div>

        {/* Create form */}
        {creating && (
          <div className="bg-white rounded-xl border border-iris-200 px-5 py-4 flex items-center gap-3">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) createMutation.mutate(newName.trim()) }}
              placeholder="Назва об'єднаного журналу"
              className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500"
            />
            <button
              onClick={() => newName.trim() && createMutation.mutate(newName.trim())}
              disabled={!newName.trim() || createMutation.isPending}
              className="px-3 py-1.5 text-sm bg-iris-600 text-white rounded-lg hover:bg-iris-700 disabled:opacity-40 transition-colors"
            >
              Зберегти
            </button>
            <button onClick={() => setCreating(false)} className="text-sm text-gray-400 hover:text-gray-600">Скасувати</button>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {mergedJournals.length === 0 && !creating ? (
            <div className="py-8 text-center text-sm text-gray-400">
              Об'єднаних журналів ще немає
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {mergedJournals.map(mj => (
                <li key={mj.id}>
                  <div className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
                    {editingId === mj.id ? (
                      <div className="flex items-center gap-2 flex-1 mr-3">
                        <input
                          autoFocus
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter' && editName.trim()) updateMutation.mutate({ id: mj.id, name: editName.trim() }) }}
                          className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1 focus:outline-none focus:ring-2 focus:ring-iris-500"
                        />
                        <button
                          onClick={() => editName.trim() && updateMutation.mutate({ id: mj.id, name: editName.trim() })}
                          disabled={!editName.trim() || updateMutation.isPending}
                          className="text-xs text-iris-600 hover:text-iris-700 font-medium disabled:opacity-40"
                        >
                          Зберегти
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:text-gray-600">Скасувати</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 flex-1">
                        <Link
                          to={`/journals/merged/${mj.id}`}
                          className="font-medium text-gray-900 hover:text-iris-600 transition-colors"
                        >
                          {mj.name}
                        </Link>
                        <span className="text-xs text-gray-400">{mj.activity_count} активн.</span>
                      </div>
                    )}

                    {editingId !== mj.id && (
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <button
                          onClick={() => setManagingId(managingId === mj.id ? null : mj.id)}
                          className="hover:text-iris-600 transition-colors"
                        >
                          {managingId === mj.id ? 'Згорнути' : 'Керувати'}
                        </button>
                        <button
                          onClick={() => { setEditingId(mj.id); setEditName(mj.name) }}
                          className="hover:text-gray-700 transition-colors"
                        >
                          Перейменувати
                        </button>
                        <button
                          onClick={() => { if (confirm(`Видалити "${mj.name}"?`)) deleteMutation.mutate(mj.id) }}
                          disabled={deleteMutation.isPending}
                          className="hover:text-red-500 transition-colors disabled:opacity-40"
                        >
                          Видалити
                        </button>
                        <Link to={`/journals/merged/${mj.id}`} className="hover:text-iris-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </Link>
                      </div>
                    )}
                  </div>

                  {managingId === mj.id && (
                    <MergedJournalManagePanel journal={mj} onClose={() => setManagingId(null)} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
