import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { usersApi } from '../../api/users.api'
import { ROLE_LABELS } from '../Users/UsersPage'

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>()
  const navigate  = useNavigate()

  const [name,     setName]     = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const { data: info, error: fetchError, isLoading } = useQuery({
    queryKey: ['invite', token],
    queryFn: () => usersApi.getInviteInfo(token!),
    retry: false,
    enabled: !!token,
  })

  const errorCode = (fetchError as { response?: { data?: { error?: string } } } | null)
    ?.response?.data?.error

  const errorMessage = errorCode === 'TokenUsed'
    ? 'Це посилання вже було використано.'
    : errorCode === 'TokenExpired'
    ? 'Термін дії посилання вичерпано. Попросіть адміна надіслати нове.'
    : fetchError
    ? 'Посилання недійсне або не існує.'
    : null

  const mutation = useMutation({
    mutationFn: () => usersApi.acceptInvite(token!, { password, name: name || undefined }),
    onSuccess: () => navigate('/login', { state: { registered: true } }),
    onError: () => setFormError('Помилка при встановленні пароля. Спробуйте ще раз.'),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    if (password.length < 8) return setFormError('Мінімум 8 символів')
    if (password !== confirm) return setFormError('Паролі не збігаються')
    mutation.mutate()
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8 space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Активація акаунта</h1>
          <p className="text-sm text-gray-500 mt-1">КіндерCRM / IRIS</p>
        </div>

        {isLoading && <p className="text-sm text-gray-400">Завантаження...</p>}

        {errorMessage && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        {info && (
          <>
            <div className="px-4 py-3 bg-iris-50 border border-iris-200 rounded-lg space-y-1">
              <p className="text-xs text-gray-500">Email</p>
              <p className="text-sm font-medium text-gray-800">{info.email}</p>
              <p className="text-xs text-gray-500 mt-1">Роль</p>
              <p className="text-sm font-medium text-gray-800">
                {info.role ? ROLE_LABELS[info.role] : '—'}
                {info.staff_name  && <span className="text-gray-400 ml-1">({info.staff_name})</span>}
                {info.parent_name && <span className="text-gray-400 ml-1">({info.parent_name})</span>}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ваше ім'я</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Прізвище Ім'я Побатькові (необов'язково)"
                  className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Пароль *</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Мінімум 8 символів"
                  className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Підтвердіть пароль *</label>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Повторіть пароль"
                  className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
              </div>

              {formError && <p className="text-xs text-red-600">{formError}</p>}

              <button type="submit" disabled={mutation.isPending}
                className="w-full py-2.5 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">
                {mutation.isPending ? '...' : 'Встановити пароль'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
