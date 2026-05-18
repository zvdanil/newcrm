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
  
  // If we have an add_expense param, we want to force the payouts tab to be active initially
  const [activeTab, setActiveTab] = useState<'payouts' | 'settings'>(addExpenseId ? 'payouts' : 'payouts')

  const ledgerQuery = useQuery({
    queryKey: ['dividends', 'ledger'],
    queryFn: dividendsApi.getLedger,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Дивіденди</h1>
      </div>

      {ledgerQuery.data && <LedgerHeader ledger={ledgerQuery.data} />}

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
          />
        )}
        {activeTab === 'settings' && <SettingsTab />}
      </div>
    </div>
  )
}
