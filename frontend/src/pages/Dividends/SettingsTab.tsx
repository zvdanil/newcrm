import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { dividendsApi } from '../../api/dividends.api'

export function SettingsTab() {
  const queryClient = useQueryClient()
  
  const { data: participants = [], isLoading: pLoading } = useQuery({
    queryKey: ['dividends', 'participants'],
    queryFn: dividendsApi.getParticipants,
  })

  const { data: settings, isLoading: sLoading } = useQuery({
    queryKey: ['dividends', 'settings'],
    queryFn: dividendsApi.getSettings,
  })

  const [newName, setNewName] = useState('')
  const [newShare, setNewShare] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editShare, setEditShare] = useState('')

  const [taxPct, setTaxPct] = useState('')
  const [isEditingTax, setIsEditingTax] = useState(false)

  const [skewAmount, setSkewAmount] = useState('')
  const [skewFavoredId, setSkewFavoredId] = useState('')
  const [isEditingSkew, setIsEditingSkew] = useState(false)

  const addMut = useMutation({
    mutationFn: dividendsApi.createParticipant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dividends'] })
      setNewName('')
      setNewShare('')
    }
  })

  const updateMut = useMutation({
    mutationFn: (args: { id: string, share_pct: number }) => dividendsApi.updateParticipant(args.id, { share_pct: args.share_pct }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dividends'] })
      setEditingId(null)
    }
  })

  const deleteMut = useMutation({
    mutationFn: dividendsApi.deleteParticipant,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dividends'] })
  })

  const updateSettingsMut = useMutation({
    mutationFn: dividendsApi.updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dividends'] })
      setIsEditingTax(false)
      setIsEditingSkew(false)
    }
  })

  const totalShare = participants.reduce((acc: number, p: any) => acc + Number(p.share_pct), 0)

  if (pLoading || sLoading) return <div className="py-8 text-center text-gray-500">Завантаження...</div>

  return (
    <div className="space-y-8 max-w-3xl">
      
      {/* Settings section */}
      <section>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Глобальні налаштування</h3>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 flex items-center justify-between">
          <div>
            <div className="font-medium text-gray-900">Податок на обнал за замовчуванням</div>
            <div className="text-sm text-gray-500">Застосовується при оформленні виведення коштів на особисті потреби (безготівково).</div>
          </div>
          
          <div className="flex items-center gap-2">
            {isEditingTax ? (
              <>
                <input
                  type="number"
                  min="0" max="100"
                  className="w-20 px-3 py-1.5 rounded border border-gray-300 text-sm"
                  value={taxPct}
                  onChange={e => setTaxPct(e.target.value)}
                  placeholder="%"
                />
                <button
                  onClick={() => updateSettingsMut.mutate({ default_tax_pct: Number(taxPct) })}
                  className="px-3 py-1.5 bg-gray-900 text-white rounded font-medium text-sm hover:bg-gray-800"
                >
                  Зберегти
                </button>
                <button
                  onClick={() => setIsEditingTax(false)}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded font-medium text-sm hover:bg-gray-300"
                >
                  Скасувати
                </button>
              </>
            ) : (
              <>
                <div className="font-semibold text-lg">{settings?.default_tax_pct}%</div>
                <button
                  onClick={() => {
                    setTaxPct(String(settings?.default_tax_pct || 0))
                    setIsEditingTax(true)
                  }}
                  className="ml-4 text-iris-600 hover:text-iris-700 text-sm font-medium"
                >
                  Змінити
                </button>
              </>
            )}
          </div>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg border border-gray-100 flex items-center justify-between mt-4">
          <div>
            <div className="font-medium text-gray-900">Початковий перекіс дивідендів</div>
            <div className="text-sm text-gray-500">Застосовується при перенесенні даних з іншої системи для коригування балансу.</div>
          </div>
          
          <div className="flex items-center gap-2">
            {isEditingSkew ? (
              <>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    placeholder="Сума"
                    className="w-32 px-3 py-1.5 rounded border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-iris-500/20 focus:border-iris-500"
                    value={skewAmount}
                    onChange={e => setSkewAmount(e.target.value)}
                  />
                  <span className="absolute right-3 top-2 text-gray-400 text-sm">грн</span>
                </div>
                <select
                  className="px-3 py-1.5 rounded border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-iris-500/20 focus:border-iris-500"
                  value={skewFavoredId}
                  onChange={e => setSkewFavoredId(e.target.value)}
                >
                  <option value="">-- На чию користь --</option>
                  {participants.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => updateSettingsMut.mutate({
                    initial_skew_amount: Number(skewAmount) || 0,
                    initial_skew_participant_id: skewFavoredId || null
                  })}
                  className="px-3 py-1.5 bg-gray-900 text-white rounded font-medium text-sm hover:bg-gray-800"
                >
                  Зберегти
                </button>
                <button
                  onClick={() => setIsEditingSkew(false)}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded font-medium text-sm hover:bg-gray-300"
                >
                  Скасувати
                </button>
              </>
            ) : (
              <>
                <div className="text-right">
                  {Number(settings?.initial_skew_amount) > 0 && settings?.initial_skew_participant_id ? (
                    <>
                      <div className="font-semibold text-lg">{Number(settings.initial_skew_amount).toLocaleString('uk-UA')} ₴</div>
                      <div className="text-xs text-gray-500">
                        на користь: {participants.find((p: any) => p.id === settings.initial_skew_participant_id)?.name || 'Невідомо'}
                      </div>
                    </>
                  ) : (
                    <div className="text-gray-500 text-sm">Не налаштовано</div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setSkewAmount(String(settings?.initial_skew_amount || 0))
                    setSkewFavoredId(settings?.initial_skew_participant_id || '')
                    setIsEditingSkew(true)
                  }}
                  className="ml-4 text-iris-600 hover:text-iris-700 text-sm font-medium"
                >
                  Змінити
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Participants section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Учасники (Партнери)</h3>
          <div className={`text-sm font-medium px-3 py-1 rounded-full ${totalShare === 100 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            Всього: {totalShare}%
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Ім'я</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">Доля (%)</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-32">Дії</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {participants.map((p: any) => (
                <tr key={p.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {p.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {editingId === p.id ? (
                      <input
                        type="number"
                        min="0" max="100"
                        className="w-20 px-2 py-1 border rounded text-sm"
                        value={editShare}
                        onChange={e => setEditShare(e.target.value)}
                        autoFocus
                      />
                    ) : (
                      <span>{p.share_pct}%</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    {editingId === p.id ? (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => updateMut.mutate({ id: p.id, share_pct: Number(editShare) })}
                          className="text-iris-600 hover:text-iris-900"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-gray-400 hover:text-gray-600"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => {
                            setEditingId(p.id)
                            setEditShare(String(p.share_pct))
                          }}
                          className="text-iris-600 hover:text-iris-900 transition-colors"
                        >
                          Ред.
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Видалити учасника?')) deleteMut.mutate(p.id)
                          }}
                          className="text-red-600 hover:text-red-900 transition-colors"
                        >
                          Вид.
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {participants.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-gray-500 text-sm">
                    Немає учасників. Додайте першого партнера нижче.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          
          <div className="bg-gray-50 p-4 border-t border-gray-200">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Додати партнера</h4>
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="Ім'я"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-iris-500 focus:border-iris-500"
              />
              <div className="relative">
                <input
                  type="number"
                  placeholder="Доля"
                  value={newShare}
                  onChange={e => setNewShare(e.target.value)}
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-iris-500 focus:border-iris-500"
                />
                <span className="absolute right-3 top-2 text-gray-400 text-sm">%</span>
              </div>
              <button
                onClick={() => addMut.mutate({ name: newName, share_pct: Number(newShare) })}
                disabled={!newName.trim() || !newShare}
                className="px-4 py-2 bg-gray-900 text-white rounded-lg font-medium text-sm hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                Додати
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
