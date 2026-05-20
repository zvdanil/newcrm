import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { usersApi, type CrmUser } from '../../api/users.api'
import { staffApi } from '../../api/staff.api'
import { parentsApi } from '../../api/parents.api'
import { useAuthStore } from '../../store/auth.store'
import type { UserRole } from '../../types'
import { ROLE_LABELS } from './UsersPage'

const ALL_ROLES: UserRole[] = ['owner', 'admin', 'manager', 'accountant', 'teacher', 'parent']
const ADMIN_ROLES: UserRole[] = ['manager', 'accountant', 'teacher', 'parent']

interface Props {
  user: CrmUser
  onClose: () => void
  onSaved: () => void
}

export function EditUserModal({ user, onClose, onSaved }: Props) {
  const me = useAuthStore((s) => s.user)
  const availableRoles = me?.role === 'owner' ? ALL_ROLES : ADMIN_ROLES

  const [name,     setName]     = useState(user.name ?? '')
  const [role,     setRole]     = useState<UserRole>(user.role)
  const [isActive, setIsActive] = useState(user.is_active)
  const [staffId,  setStaffId]  = useState(user.staff_id ?? '')
  const [parentId, setParentId] = useState(user.parent_id ?? '')
  const [error,    setError]    = useState<string | null>(null)

  const { data: staffList = [] } = useQuery({
    queryKey: ['staff', 'active'],
    queryFn: () => staffApi.list({ is_active: true }),
    enabled: role === 'teacher',
  })
  const { data: parentsData } = useQuery({
    queryKey: ['parents', 'all'],
    queryFn: () => parentsApi.list(),
    enabled: role === 'parent',
  })
  const parentsList = parentsData?.data ?? []

  const mutation = useMutation({
    mutationFn: () => usersApi.update(user.id, {
      name:      name || null,
      role,
      is_active: isActive,
      staff_id:  role === 'teacher' ? (staffId || null) : null,
      parent_id: role === 'parent'  ? (parentId || null) : null,
    }),
    onSuccess: () => { onSaved(); onClose() },
    onError: (err: unknown) => {
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      if (code === 'StaffAlreadyLinked')  setError('Цей співробітник вже прив\'язаний до іншого акаунта')
      else if (code === 'ParentAlreadyLinked') setError('Цей батько вже прив\'язаний до іншого акаунта')
      else setError('Помилка збереження')
    },
  })

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole)
    if (newRole !== 'teacher') setStaffId('')
    if (newRole !== 'parent')  setParentId('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Редагування користувача</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>
        <p className="text-xs text-gray-400">{user.email}</p>

        <form onSubmit={(e) => { e.preventDefault(); setError(null); mutation.mutate() }} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Ім'я</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Прізвище Ім'я Побатькові"
              className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Роль</label>
            <select value={role} onChange={(e) => handleRoleChange(e.target.value as UserRole)}
              className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
              {availableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>

          {role === 'teacher' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Співробітник</label>
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)}
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
                <option value="">— не прив'язаний —</option>
                {staffList.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
          )}

          {role === 'parent' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Батько / мати</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)}
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
                <option value="">— не прив'язаний —</option>
                {parentsList.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-gray-300 text-iris-600 focus:ring-iris-500" />
            Активний акаунт
          </label>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={mutation.isPending}
              className="flex-1 text-sm py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors">
              {mutation.isPending ? '...' : 'Зберегти'}
            </button>
            <button type="button" onClick={onClose} className="px-4 text-sm text-gray-500 hover:text-gray-900">
              Скасувати
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
