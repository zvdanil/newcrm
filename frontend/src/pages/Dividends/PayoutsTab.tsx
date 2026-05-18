import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { dividendsApi } from '../../api/dividends.api'
import { CreatePayoutModal } from './CreatePayoutModal'

export function PayoutsTab({ 
  prefillExpenseId, 
  onClearPrefill 
}: { 
  prefillExpenseId?: string | null
  onClearPrefill?: () => void 
}) {
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(!!prefillExpenseId)

  // Open modal automatically if prefillExpenseId is provided after initial render
  useEffect(() => {
    if (prefillExpenseId) {
      setIsModalOpen(true)
    }
  }, [prefillExpenseId])

  const { data: payouts = [], isLoading } = useQuery({
    queryKey: ['dividends', 'payouts'],
    queryFn: dividendsApi.getPayouts,
  })

  const deleteMut = useMutation({
    mutationFn: dividendsApi.deletePayout,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dividends'] })
    }
  })

  const formatMoney = (val: number | string) => {
    return Number(val).toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('uk-UA')
  }

  if (isLoading) return <div className="py-8 text-center text-gray-500">Завантаження журналу...</div>

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button
          onClick={() => setIsModalOpen(true)}
          className="px-4 py-2 bg-gray-900 text-white rounded-lg font-medium text-sm hover:bg-gray-800 transition-colors"
        >
          Зафіксувати виплату
        </button>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Дата</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Партнер</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Тип</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Gross (Списано)</th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Податок</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Net (В залік)</th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Дії</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {payouts.map((p: any) => (
              <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatDate(p.date)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {p.participant_name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                    p.type === 'cash' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {p.type === 'cash' ? 'Готівка' : 'Безготівка'}
                  </span>
                  {p.note && <div className="text-xs text-gray-500 mt-1 max-w-[150px] truncate" title={p.note}>{p.note}</div>}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-right">
                  {formatMoney(p.gross_amount)} ₴
                  <div className="text-xs text-gray-400 mt-1">
                    {p.sources.map((s: any) => s.account_name ?? 'Без рахунку').join(', ')}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 text-center">
                  {p.type === 'cashless' ? `${p.tax_pct}%` : '—'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-right">
                  {formatMoney(p.net_amount)} ₴
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                  <button
                    onClick={() => {
                      if (confirm('Видалити виплату? Повʼязані витрати залишаться в базі.')) {
                        deleteMut.mutate(p.id)
                      }
                    }}
                    className="text-red-600 hover:text-red-900"
                  >
                    Видалити
                  </button>
                </td>
              </tr>
            ))}
            {payouts.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-gray-500 text-sm">
                  Журнал виплат порожній.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <CreatePayoutModal 
          prefillExpenseId={prefillExpenseId}
          onClose={() => {
            setIsModalOpen(false)
            if (onClearPrefill) onClearPrefill()
          }} 
        />
      )}
    </div>
  )
}
