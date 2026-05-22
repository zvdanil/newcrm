import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, type CrmUser } from '../../api/users.api'
import { useAuthStore } from '../../store/auth.store'
import type { UserRole } from '../../types'
import { InviteModal } from './InviteModal'
import { EditUserModal } from './EditUserModal'
import { SetPasswordModal } from './SetPasswordModal'
import { GeneratedLinkModal } from './GeneratedLinkModal'

export const ROLE_LABELS: Record<UserRole, string> = {
  owner:      'Власник',
  admin:      'Адміністратор',
  manager:    'Менеджер',
  accountant: 'Бухгалтер',
  teacher:    'Вчитель',
  parent:     'Батьки',
  duty_admin: 'Адмін зміни',
}

const ROLE_COLORS: Record<UserRole, string> = {
  owner:      'bg-purple-100 text-purple-700',
  admin:      'bg-red-100 text-red-700',
  manager:    'bg-blue-100 text-blue-700',
  accountant: 'bg-yellow-100 text-yellow-700',
  teacher:    'bg-green-100 text-green-700',
  parent:     'bg-gray-100 text-gray-700',
  duty_admin: 'bg-orange-100 text-orange-700',
}

export default function UsersPage() {
  const me = useAuthStore((s) => s.user)
  const qc = useQueryClient()

  const [inviteOpen,   setInviteOpen]   = useState(false)
  const [editUser,     setEditUser]     = useState<CrmUser | null>(null)
  const [setPassUser,  setSetPassUser]  = useState<CrmUser | null>(null)
  const [generatedUrl, setGeneratedUrl] = useState<{ url: string; type: 'invite' | 'reset' } | null>(null)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      usersApi.update(id, { is_active }),
    onSuccess: invalidate,
  })

  const resetLinkMutation = useMutation({
    mutationFn: (id: string) => usersApi.resetLink(id),
    onSuccess: ({ resetUrl }) => setGeneratedUrl({ url: resetUrl, type: 'reset' }),
  })

  if (me?.role !== 'owner' && me?.role !== 'admin') {
    return (
      <div className="p-8 text-center text-gray-400">
        Доступ заборонено
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Користувачі</h1>
        <button
          onClick={() => setInviteOpen(true)}
          className="text-sm px-4 py-2 bg-iris-600 hover:bg-iris-700 text-white rounded-lg font-medium transition-colors"
        >
          + Запросити
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Завантаження...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3 font-medium">Ім'я / Email</th>
                <th className="text-left px-4 py-3 font-medium">Роль</th>
                <th className="text-left px-4 py-3 font-medium">Зв'язок</th>
                <th className="text-left px-4 py-3 font-medium">Статус</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((u) => {
                const isSelf = u.id === me?.id
                const canAct = me?.role === 'owner' || (['manager', 'accountant', 'teacher', 'parent'] as UserRole[]).includes(u.role)
                return (
                  <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      {u.name && <p className="font-medium text-gray-900">{u.name}</p>}
                      <p className={u.name ? 'text-xs text-gray-400' : 'text-gray-700'}>{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[u.role]}`}>
                        {ROLE_LABELS[u.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {u.staff_name ?? u.parent_name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {u.is_active ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">Активний</span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">Неактивний</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {canAct && !isSelf && (
                        <div className="flex items-center gap-3 justify-end text-xs text-gray-400">
                          <button onClick={() => setEditUser(u)} className="hover:text-iris-600 transition-colors">
                            Редагувати
                          </button>
                          <button onClick={() => setSetPassUser(u)} className="hover:text-iris-600 transition-colors">
                            Задати пароль
                          </button>
                          <button
                            onClick={() => resetLinkMutation.mutate(u.id)}
                            disabled={resetLinkMutation.isPending}
                            className="hover:text-amber-600 transition-colors"
                          >
                            Скинути пароль
                          </button>
                          <button
                            onClick={() => toggleActiveMutation.mutate({ id: u.id, is_active: !u.is_active })}
                            disabled={toggleActiveMutation.isPending}
                            className={`hover:text-red-500 transition-colors ${!u.is_active ? 'text-green-500 hover:text-green-700' : ''}`}
                          >
                            {u.is_active ? 'Деактивувати' : 'Активувати'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {users.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">Немає користувачів</p>
          )}
        </div>
      )}

      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onSuccess={(url) => { setGeneratedUrl({ url, type: 'invite' }); invalidate() }}
        />
      )}
      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={invalidate}
        />
      )}
      {setPassUser && (
        <SetPasswordModal
          userId={setPassUser.id}
          userName={setPassUser.name ?? setPassUser.email}
          onClose={() => setSetPassUser(null)}
        />
      )}
      {generatedUrl && (
        <GeneratedLinkModal
          url={generatedUrl.url}
          type={generatedUrl.type}
          onClose={() => setGeneratedUrl(null)}
        />
      )}
    </div>
  )
}
