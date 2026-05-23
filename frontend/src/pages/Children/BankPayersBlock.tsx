import { useQuery } from '@tanstack/react-query'
import { bankPayersApi } from '../../api/import_templates.api'

interface Props {
  childId: string
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export function BankPayersBlock({ childId }: Props) {
  const { data = [] } = useQuery({
    queryKey: ['child-bank-payers', childId],
    queryFn: () => bankPayersApi.listForChild(childId),
    staleTime: 60_000,
  })

  if (data.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-800">Відомі платники</h3>
        <p className="text-xs text-gray-400 mt-0.5">Дані з банківської виписки</p>
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
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50/50">
                <td className="px-4 py-2 text-gray-800">{p.counterparty_name}</td>
                <td className="px-4 py-2 text-gray-500 font-mono text-xs">{p.inn ?? '—'}</td>
                <td className="px-4 py-2 text-gray-500 font-mono text-xs">{p.iban ?? '—'}</td>
                <td className="px-4 py-2 text-right text-gray-600 tabular-nums">{p.import_count}</td>
                <td className="px-4 py-2 text-right text-gray-400 whitespace-nowrap">{fmtDate(p.last_import_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
