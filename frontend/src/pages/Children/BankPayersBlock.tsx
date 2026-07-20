import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { bankPayersApi, type BankPayerProfile } from '../../api/import_templates.api'

interface Props {
  childId: string
  canEdit?: boolean
}

function fmtDate(iso: string) {
  if (!iso) return '—'
  const clean = String(iso).slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const [y, m, d] = clean.split('-')
    return `${d}.${m}.${y.slice(2)}`
  }
  return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function PayerRow({
  payer,
  childId,
  canEdit,
}: {
  payer: BankPayerProfile
  childId: string
  canEdit: boolean
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    counterparty_name: payer.counterparty_name,
    inn: payer.inn ?? '',
    iban: payer.iban ?? '',
    note: payer.note ?? '',
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['child-bank-payers', childId] })
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      bankPayersApi.update(childId, payer.id, {
        counterparty_name: form.counterparty_name.trim(),
        inn: form.inn.trim() || null,
        iban: form.iban.trim() || null,
        note: form.note.trim() || null,
      }),
    onSuccess: () => {
      setError(null)
      setEditing(false)
      invalidate()
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Помилка збереження'
      setError(msg)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => bankPayersApi.delete(childId, payer.id),
    onSuccess: invalidate,
  })

  const startEdit = () => {
    setError(null)
    setForm({
      counterparty_name: payer.counterparty_name,
      inn: payer.inn ?? '',
      iban: payer.iban ?? '',
      note: payer.note ?? '',
    })
    setEditing(true)
  }

  if (editing) {
    return (
      <tr>
        <td colSpan={canEdit ? 6 : 5} className="px-4 py-3 bg-gray-50">
          <div className="space-y-2 max-w-lg">
            <input
              type="text"
              value={form.counterparty_name}
              onChange={(e) => setForm({ ...form, counterparty_name: e.target.value })}
              placeholder="Назва платника *"
              className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={form.inn}
                onChange={(e) => setForm({ ...form, inn: e.target.value })}
                placeholder="ІНН / ЄДРПОУ"
                className="w-full rounded border-gray-300 text-sm font-mono shadow-sm focus:border-iris-500 focus:ring-iris-500"
              />
              <input
                type="text"
                value={form.iban}
                onChange={(e) => setForm({ ...form, iban: e.target.value })}
                placeholder="IBAN (UA...)"
                className="w-full rounded border-gray-300 text-sm font-mono shadow-sm focus:border-iris-500 focus:ring-iris-500"
              />
            </div>
            <input
              type="text"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Нотатка"
              className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
            />
            <p className="text-xs text-gray-400">Потрібен ІНН (мін. 8 цифр) або IBAN</p>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (!form.counterparty_name.trim()) return
                  updateMutation.mutate()
                }}
                disabled={!form.counterparty_name.trim() || updateMutation.isPending}
                className="px-3 py-1.5 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm rounded-lg"
              >
                {updateMutation.isPending ? '...' : 'Зберегти'}
              </button>
              <button
                onClick={() => { setEditing(false); setError(null) }}
                className="px-3 py-1.5 text-gray-600 hover:text-gray-900 text-sm"
              >
                Скасувати
              </button>
            </div>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr className="hover:bg-gray-50/50">
      <td className="px-4 py-2 text-gray-800">{payer.counterparty_name}</td>
      <td className="px-4 py-2 text-gray-500 font-mono text-xs">{payer.inn ?? '—'}</td>
      <td className="px-4 py-2 text-gray-500 font-mono text-xs max-w-[140px] truncate" title={payer.iban ?? undefined}>
        {payer.iban ?? '—'}
      </td>
      <td className="px-4 py-2 text-right text-gray-600 tabular-nums">{payer.import_count}</td>
      <td className="px-4 py-2 text-right text-gray-400 whitespace-nowrap">{fmtDate(payer.last_import_date)}</td>
      {canEdit && (
        <td className="px-4 py-2 text-right whitespace-nowrap">
          <button
            onClick={startEdit}
            className="text-xs text-iris-500 hover:text-iris-700 mr-2"
          >
            Ред.
          </button>
          <button
            onClick={() => {
              if (window.confirm(`Видалити платника «${payer.counterparty_name}»?`)) {
                deleteMutation.mutate()
              }
            }}
            disabled={deleteMutation.isPending}
            className="text-xs text-red-400 hover:text-red-600 disabled:opacity-50"
          >
            ×
          </button>
        </td>
      )}
    </tr>
  )
}

export function BankPayersBlock({ childId, canEdit = false }: Props) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['child-bank-payers', childId],
    queryFn: () => bankPayersApi.listForChild(childId),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4">
        <p className="text-sm text-gray-400">Завантаження платників...</p>
      </div>
    )
  }

  if (data.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">Відомі платники</h3>
        <p className="text-xs text-gray-400 mt-0.5">
          Дані з банківської виписки{canEdit ? ' · можна редагувати' : ''}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Платник</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">ІНН</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">IBAN</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">К-ть</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap">Остання дата</th>
              {canEdit && (
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 w-20"></th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.map((p) => (
              <PayerRow key={p.id} payer={p} childId={childId} canEdit={canEdit} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
