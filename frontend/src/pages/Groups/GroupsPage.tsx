import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { groupsApi } from '../../api/groups.api'
import { useCanAccess } from '../../hooks/useCanAccess'
import type { Group } from '../../types'

export function GroupsPage() {
  const qc = useQueryClient()
  const canEdit = useCanAccess('owner', 'admin')

  const [showArchived, setShowArchived] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ name: '', sort_order: 0 })
  const [editError, setEditError] = useState<string | null>(null)

  const [addingNew, setAddingNew] = useState(false)
  const [newForm, setNewForm] = useState({ name: '', sort_order: 0 })
  const [newError, setNewError] = useState<string | null>(null)

  // Always load all groups (including archived) to know the counts
  const { data: allGroups = [], isLoading } = useQuery({
    queryKey: ['groups', 'all'],
    queryFn: () => groupsApi.list(true),
    staleTime: 0,
  })

  const activeGroups   = allGroups.filter((g) => g.is_active)
  const archivedGroups = allGroups.filter((g) => !g.is_active)
  const visibleGroups  = showArchived ? allGroups : activeGroups

  const updateMutation = useMutation({
    mutationFn: ({ id, ...payload }: { id: string; name: string; sort_order: number }) =>
      groupsApi.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      setEditingId(null)
      setEditError(null)
    },
    onError: () => setEditError('Помилка при збереженні'),
  })

  const createMutation = useMutation({
    mutationFn: groupsApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['groups'] })
      setAddingNew(false)
      setNewForm({ name: '', sort_order: 0 })
      setNewError(null)
    },
    onError: () => setNewError('Помилка при збереженні'),
  })

  const archiveMutation = useMutation({
    mutationFn: groupsApi.archive,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  })

  const restoreMutation = useMutation({
    mutationFn: groupsApi.restore,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['groups'] }),
  })

  const startEdit = (group: Group) => {
    setEditingId(group.id)
    setEditForm({ name: group.name, sort_order: group.sort_order })
    setEditError(null)
  }

  const handleUpdate = () => {
    if (!editForm.name.trim() || !editingId) return
    updateMutation.mutate({ id: editingId, name: editForm.name.trim(), sort_order: editForm.sort_order })
  }

  const handleCreate = () => {
    if (!newForm.name.trim()) { setNewError('Назва є обовʼязковою'); return }
    createMutation.mutate({ name: newForm.name.trim(), sort_order: newForm.sort_order })
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Групи</h1>
          <p className="text-sm text-gray-500">
            {activeGroups.length} активних
            {archivedGroups.length > 0 && `, ${archivedGroups.length} в архіві`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {archivedGroups.length > 0 && (
            <button
              onClick={() => setShowArchived((v) => !v)}
              className={`text-sm font-medium transition-colors ${
                showArchived ? 'text-iris-600' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {showArchived ? 'Приховати архів' : `Архів (${archivedGroups.length})`}
            </button>
          )}
          {canEdit && !addingNew && (
            <button
              onClick={() => {
                setAddingNew(true)
                setNewForm({ name: '', sort_order: activeGroups.length + 1 })
              }}
              className="px-4 py-2 bg-iris-600 hover:bg-iris-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              + Додати групу
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
        ) : visibleGroups.length === 0 && !addingNew ? (
          <div className="py-12 text-center text-sm text-gray-400">Груп ще немає</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600 w-12">#</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Назва</th>
                {canEdit && <th className="px-4 py-3 w-40" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleGroups.map((group) => (
                <tr
                  key={group.id}
                  className={`transition-colors ${
                    group.is_active ? 'hover:bg-gray-50' : 'bg-gray-50'
                  }`}
                >
                  {editingId === group.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          value={editForm.sort_order}
                          onChange={(e) => setEditForm({ ...editForm, sort_order: Number(e.target.value) })}
                          className="w-16 rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                            onKeyDown={(e) => { if (e.key === 'Enter') handleUpdate(); if (e.key === 'Escape') setEditingId(null) }}
                            autoFocus
                            className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                          />
                          {editError && <p className="text-xs text-red-600">{editError}</p>}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={handleUpdate}
                            disabled={updateMutation.isPending}
                            className="text-xs px-3 py-1 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-md transition-colors"
                          >
                            {updateMutation.isPending ? '...' : 'Зберегти'}
                          </button>
                          <button
                            onClick={() => { setEditingId(null); setEditError(null) }}
                            className="text-xs px-2 py-1 text-gray-500 hover:text-gray-900"
                          >
                            Скасувати
                          </button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 text-gray-400 tabular-nums">{group.sort_order}</td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${group.is_active ? 'text-gray-900' : 'text-gray-400'}`}>
                          {group.name}
                        </span>
                        {!group.is_active && (
                          <span className="ml-2 text-xs text-gray-400">архів</span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3 justify-end">
                            {group.is_active ? (
                              <>
                                <button
                                  onClick={() => startEdit(group)}
                                  className="text-xs text-iris-600 hover:text-iris-700 font-medium"
                                >
                                  Редагувати
                                </button>
                                <button
                                  onClick={() => archiveMutation.mutate(group.id)}
                                  disabled={archiveMutation.isPending}
                                  className="text-xs text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                                >
                                  В архів
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => restoreMutation.mutate(group.id)}
                                disabled={restoreMutation.isPending}
                                className="text-xs text-iris-600 hover:text-iris-700 font-medium disabled:opacity-50"
                              >
                                Відновити
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </>
                  )}
                </tr>
              ))}

              {addingNew && (
                <tr className="bg-iris-50">
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      value={newForm.sort_order}
                      onChange={(e) => setNewForm({ ...newForm, sort_order: Number(e.target.value) })}
                      className="w-16 rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <div className="space-y-1">
                      <input
                        type="text"
                        value={newForm.name}
                        onChange={(e) => { setNewForm({ ...newForm, name: e.target.value }); setNewError(null) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setAddingNew(false) }}
                        placeholder="Назва групи"
                        autoFocus
                        className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
                      />
                      {newError && <p className="text-xs text-red-600">{newError}</p>}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={handleCreate}
                        disabled={createMutation.isPending}
                        className="text-xs px-3 py-1 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-md transition-colors"
                      >
                        {createMutation.isPending ? '...' : 'Додати'}
                      </button>
                      <button
                        onClick={() => { setAddingNew(false); setNewError(null) }}
                        className="text-xs px-2 py-1 text-gray-500 hover:text-gray-900"
                      >
                        Скасувати
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
