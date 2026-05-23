import { useState } from 'react'
import { DividendLedger } from '../../api/dividends.api'

export function LedgerHeader({ ledger, hasPeriod }: { ledger: DividendLedger; hasPeriod?: boolean }) {
  const [showLeveling, setShowLeveling] = useState(false)

  const formatMoney = (val: number) => {
    return val.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 sm:p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Баланс партнерів</h2>
          <p className="text-sm text-gray-500">
            Загальна сума {hasPeriod ? 'за період' : '(еквівалент)'}:{' '}
            <span className="font-medium text-gray-900">{formatMoney(ledger.total_net)} ₴</span>
          </p>
        </div>
        <button
          onClick={() => setShowLeveling(true)}
          className="px-4 py-2 bg-iris-50 text-iris-700 hover:bg-iris-100 rounded-lg font-medium text-sm transition-colors"
        >
          Вирівняти баланс
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {ledger.participants.map(p => (
          <div key={p.id} className="p-4 border border-gray-100 rounded-lg bg-gray-50/50">
            <div className="flex justify-between items-start mb-3">
              <span className="font-semibold text-gray-900">{p.name}</span>
              <span className="text-xs font-semibold bg-gray-200 text-gray-700 px-2 py-1 rounded">
                Доля {p.share_pct}%
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Отримано (еквівалент):</span>
                <span className="font-medium">{formatMoney(p.actual_net)} ₴</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Причиталось:</span>
                <span className="font-medium text-gray-700">{formatMoney(p.target_net)} ₴</span>
              </div>
              <div className="flex justify-between text-sm pt-1 border-t border-gray-100">
                <span className="text-gray-500">Перекос:</span>
                <span className={`font-medium ${p.skew > 0 ? 'text-green-600' : p.skew < 0 ? 'text-red-600' : 'text-gray-600'}`}>
                  {p.skew > 0 ? '+' : ''}{formatMoney(p.skew)} ₴
                  {p.skew < 0 && <span className="ml-1 text-xs font-normal">(недоплата)</span>}
                  {p.skew > 0 && <span className="ml-1 text-xs font-normal">(переплата)</span>}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showLeveling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h3 className="text-lg font-semibold text-gray-900">Вирівнювання балансу</h3>
              <button onClick={() => setShowLeveling(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                Щоб вирівняти частки всіх партнерів без повернення коштів, необхідно виплатити (або зарахувати в еквіваленті) наступні суми:
              </p>

              <div className="space-y-3">
                {ledger.leveling.map(lvl => {
                  const participant = ledger.participants.find(p => p.id === lvl.participant_id)
                  if (!participant || lvl.recommendation_amount <= 0) return null
                  return (
                    <div key={lvl.participant_id} className="flex justify-between items-center p-3 bg-iris-50/50 rounded-lg border border-iris-100">
                      <span className="font-medium text-gray-900">{participant.name}</span>
                      <span className="font-semibold text-iris-700">+{formatMoney(lvl.recommendation_amount)} ₴</span>
                    </div>
                  )
                })}

                {ledger.leveling.every(lvl => lvl.recommendation_amount <= 0) && (
                  <div className="text-center py-4 text-green-600 font-medium bg-green-50 rounded-lg">
                    Усі частки ідеально збалансовані! 🎉
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end">
              <button
                onClick={() => setShowLeveling(false)}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
              >
                Зрозуміло
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
