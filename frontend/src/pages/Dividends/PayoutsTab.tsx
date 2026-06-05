import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { dividendsApi } from '../../api/dividends.api'
import { CreatePayoutModal } from './CreatePayoutModal'

export function PayoutsTab({
  prefillExpenseId,
  prefillPayoutType,
  prefillTaxPct,
  onClearPrefill,
  periodFrom,
  periodTo,
}: {
  prefillExpenseId?: string | null
  prefillPayoutType?: 'cash' | 'cashless'
  prefillTaxPct?: string
  onClearPrefill?: () => void
  periodFrom?: string
  periodTo?: string
}) {
  const queryClient = useQueryClient()
  const [isModalOpen, setIsModalOpen] = useState(!!prefillExpenseId)

  // Open modal automatically if prefillExpenseId is provided after initial render
  useEffect(() => {
    if (prefillExpenseId) {
      setIsModalOpen(true)
    }
  }, [prefillExpenseId])

  const filters = { from: periodFrom || undefined, to: periodTo || undefined }

  const { data: payouts = [], isLoading } = useQuery({
    queryKey: ['dividends', 'payouts', periodFrom, periodTo],
    queryFn: () => dividendsApi.getPayouts(filters),
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
                <td className="px-6 py-4 text-sm text-gray-500 text-right">
                  {formatMoney(p.gross_amount)} ₴
                  <div className="text-xs text-gray-400 mt-1 space-y-0.5">
                    {p.sources.map((s: any, i: number) => {
                      const isPartial = s.dividend_amount != null && Number(s.dividend_amount) !== Number(s.amount)
                      return (
                        <div key={i} className="flex items-center justify-end gap-1 flex-wrap">
                          {!s.is_salary && isPartial && (
                            <span className="bg-amber-100 text-amber-700 text-[10px] px-1 py-0.5 rounded font-medium whitespace-nowrap" title={`Повна сума витрати: ${Number(s.amount).toFixed(2)} ₴`}>
                              частково ({Number(s.dividend_amount).toFixed(2)} ₴ з {Number(s.amount).toFixed(2)} ₴)
                            </span>
                          )}
                          <span>{s.account_name ?? 'Без рахунку'}</span>
                          {s.note && <span className="text-gray-300">·</span>}
                          {s.note && <span className="text-gray-400 truncate max-w-[160px]" title={s.note}>{s.note}</span>}
                        </div>
                      )
                    })}
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
          prefillPayoutType={prefillPayoutType}
          prefillTaxPct={prefillTaxPct}
          onClose={() => {
            setIsModalOpen(false)
            if (onClearPrefill) onClearPrefill()
          }}
        />
      )}
    </div>
  )
}
