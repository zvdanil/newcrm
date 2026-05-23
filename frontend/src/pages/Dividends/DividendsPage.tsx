import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { dividendsApi } from '../../api/dividends.api'
import { PayoutsTab } from './PayoutsTab'
import { SettingsTab } from './SettingsTab'
import { LedgerHeader } from './LedgerHeader'
import { useSearchParams } from 'react-router-dom'

export function DividendsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const addExpenseId = searchParams.get('add_expense')

  const [activeTab, setActiveTab] = useState<'payouts' | 'settings'>(addExpenseId ? 'payouts' : 'payouts')
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')

  const filters = {
    from: periodFrom || undefined,
    to: periodTo || undefined,
  }

  const ledgerQuery = useQuery({
    queryKey: ['dividends', 'ledger', periodFrom, periodTo],
    queryFn: () => dividendsApi.getLedger(filters),
  })

  const hasPeriod = !!periodFrom || !!periodTo

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Дивіденди</h1>

        {/* Period selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500 whitespace-nowrap">Період:</span>
          <input
            type="date"
            value={periodFrom}
            onChange={e => setPeriodFrom(e.target.value)}
            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-iris-500/30 focus:border-iris-500"
          />
          <span className="text-sm text-gray-400">—</span>
          <input
            type="date"
            value={periodTo}
            onChange={e => setPeriodTo(e.target.value)}
            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-iris-500/30 focus:border-iris-500"
          />
          {hasPeriod && (
            <button
              onClick={() => { setPeriodFrom(''); setPeriodTo('') }}
              className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Скинути
            </button>
          )}
        </div>
      </div>

      {ledgerQuery.data && (
        <LedgerHeader ledger={ledgerQuery.data} hasPeriod={hasPeriod} />
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('payouts')}
            className={`whitespace-nowrap py-3 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'payouts'
                ? 'border-iris-500 text-iris-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Журнал виплат
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`whitespace-nowrap py-3 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'settings'
                ? 'border-iris-500 text-iris-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Налаштування
          </button>
        </nav>
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6">
        {activeTab === 'payouts' && (
          <PayoutsTab
            prefillExpenseId={addExpenseId}
            onClearPrefill={() => {
              searchParams.delete('add_expense')
              setSearchParams(searchParams)
            }}
            periodFrom={periodFrom}
            periodTo={periodTo}
          />
        )}
        {activeTab === 'settings' && <SettingsTab />}
      </div>
    </div>
  )
}
