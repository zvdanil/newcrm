import { useState } from 'react'

interface Props {
  url: string
  type: 'invite' | 'reset'
  onClose: () => void
}

export function GeneratedLinkModal({ url, type, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const label  = type === 'invite' ? 'Посилання для запрошення' : 'Посилання для скидання пароля'
  const expiry = type === 'invite' ? '72 годин' : '1 годину'

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">{label}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>

        <p className="text-xs text-gray-500">Термін дії: <strong>{expiry}</strong></p>

        <div className="flex gap-2">
          <input
            readOnly value={url}
            className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 font-mono text-gray-700 select-all"
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <button
            onClick={handleCopy}
            className={`shrink-0 px-4 py-2 text-sm rounded-lg font-medium transition-colors ${
              copied
                ? 'bg-green-100 text-green-700'
                : 'bg-iris-600 hover:bg-iris-700 text-white'
            }`}
          >
            {copied ? 'Скопійовано!' : 'Скопіювати'}
          </button>
        </div>

        <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <span className="shrink-0 mt-0.5">⚠</span>
          <span>
            Посилання одноразове. Після переходу за ним воно стане недійсним.
            Надішліть його отримувачу вручну.
          </span>
        </div>

        <div className="flex justify-end">
          <button onClick={onClose}
            className="text-sm px-4 py-2 border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
            Закрити
          </button>
        </div>
      </div>
    </div>
  )
}
