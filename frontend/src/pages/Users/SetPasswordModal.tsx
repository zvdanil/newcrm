import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { usersApi } from '../../api/users.api'

interface Props {
  userId: string
  userName: string
  onClose: () => void
}

export function SetPasswordModal({ userId, userName, onClose }: Props) {
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [error,    setError]    = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => usersApi.setPassword(userId, password),
    onSuccess: onClose,
    onError: () => setError('Помилка при встановленні пароля'),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Мінімум 8 символів')
    if (password !== confirm) return setError('Паролі не збігаються')
    mutation.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Задати пароль</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>
        <p className="text-xs text-gray-400">{userName}</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Новий пароль *</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="Мінімум 8 символів"
              className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Підтвердження *</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
              placeholder="Повторіть пароль"
              className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          </div>

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
