import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { usersApi } from '../../api/users.api'
import { staffApi } from '../../api/staff.api'
import { parentsApi } from '../../api/parents.api'
import { useAuthStore } from '../../store/auth.store'
import type { UserRole } from '../../types'
import { ROLE_LABELS } from './UsersPage'

const ALL_ROLES: UserRole[] = ['owner', 'admin', 'manager', 'accountant', 'teacher', 'parent', 'duty_admin']
const ADMIN_ROLES: UserRole[] = ['manager', 'accountant', 'teacher', 'parent', 'duty_admin']

interface Props {
  onClose: () => void
  onSuccess: (url: string) => void
}

export function InviteModal({ onClose, onSuccess }: Props) {
  const me = useAuthStore((s) => s.user)
  const availableRoles = me?.role === 'owner' ? ALL_ROLES : ADMIN_ROLES

  const [email,    setEmail]    = useState('')
  const [role,     setRole]     = useState<UserRole>(availableRoles[0])
  const [staffId,  setStaffId]  = useState('')
  const [parentId, setParentId] = useState('')
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
    mutationFn: () => usersApi.invite({
      email,
      role,
      staff_id:  role === 'teacher' ? staffId  || null : null,
      parent_id: role === 'parent'  ? parentId || null : null,
    }),
    onSuccess: ({ inviteUrl }) => { onSuccess(inviteUrl); onClose() },
    onError: (err: unknown) => {
      const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      if (code === 'EmailAlreadyExists') setError('Користувач з таким email вже активний')
      else setError('Помилка створення запрошення')
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!email) return setError('Введіть email')
    if (role === 'teacher' && !staffId) return setError('Оберіть співробітника')
    if (role === 'parent' && !parentId) return setError('Оберіть батька/матір')
    mutation.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Запросити користувача</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="user@example.com"
              className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Роль *</label>
            <select value={role} onChange={(e) => { setRole(e.target.value as UserRole); setStaffId(''); setParentId('') }}
              className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
              {availableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>

          {role === 'teacher' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Співробітник *</label>
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)}
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
                <option value="">— оберіть —</option>
                {staffList.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
          )}

          {role === 'parent' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Батько / мати *</label>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)}
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
                <option value="">— оберіть —</option>
                {parentsList.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={mutation.isPending}
              className="flex-1 text-sm py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors">
              {mutation.isPending ? '...' : 'Створити запрошення'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 text-sm text-gray-500 hover:text-gray-900">
              Скасувати
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
