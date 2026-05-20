import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { usersApi } from '../../api/users.api'

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>()
  const navigate  = useNavigate()

  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const { data: info, error: fetchError, isLoading } = useQuery({
    queryKey: ['reset', token],
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
    mutationFn: () => usersApi.acceptInvite(token!, { password }),
    onSuccess: () => navigate('/login', { state: { passwordReset: true } }),
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
          <h1 className="text-xl font-bold text-gray-900">Встановити новий пароль</h1>
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
            <p className="text-sm text-gray-500">
              Акаунт: <span className="font-medium text-gray-700">{info.email}</span>
            </p>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Новий пароль *</label>
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
                {mutation.isPending ? '...' : 'Зберегти новий пароль'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
