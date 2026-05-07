import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { activitiesApi } from '../../api/activities.api'
import { accountsApi } from '../../api/accounts.api'
import { useCanAccess } from '../../hooks/useCanAccess'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('uk-UA')
}

export function ActivityCardPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const canEdit = useCanAccess('owner', 'admin')

  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', account_id: '', tariff_type: 'monthly' as 'monthly' | 'per_lesson', is_rigid: false, note: '' })
  const [saveError, setSaveError] = useState<string | null>(null)

  const [newTariff, setNewTariff] = useState({ base_fee: '', valid_from: new Date().toISOString().slice(0, 10) })
  const [showTariffForm, setShowTariffForm] = useState(false)
  const [tariffError, setTariffError] = useState<string | null>(null)

  const [refundForm, setRefundForm] = useState({
    refund_on_excused: false,
    mode: 'none' as 'none' | 'amount' | 'pct',
    refund_amount: '',
    refund_pct: '',
    note: '',
  })
  const [editingRefund, setEditingRefund] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)

  const { data: activity, isLoading } = useQuery({
    queryKey: ['activity', id],
    queryFn: () => activitiesApi.get(id!),
    enabled: !!id,
  })

  const { data: history = [] } = useQuery({
    queryKey: ['activity-tariffs', id],
    queryFn: () => activitiesApi.getTariffHistory(id!),
    enabled: !!id,
  })

  const { data: refundConfig } = useQuery({
    queryKey: ['activity-refund-config', id],
    queryFn: () => activitiesApi.getRefundConfig(id!),
    enabled: !!id,
  })

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list, enabled: editing })

  const updateMutation = useMutation({
    mutationFn: (payload: typeof editForm) => activitiesApi.update(id!, { ...payload, account_id: payload.account_id || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['activity', id] }); setEditing(false); setSaveError(null) },
    onError: () => setSaveError('Помилка при збереженні'),
  })

  const tariffMutation = useMutation({
    mutationFn: () => activitiesApi.setTariff(id!, { base_fee: Number(newTariff.base_fee), valid_from: newTariff.valid_from }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activity', id] })
      qc.invalidateQueries({ queryKey: ['activity-tariffs', id] })
      setShowTariffForm(false)
      setNewTariff({ base_fee: '', valid_from: new Date().toISOString().slice(0, 10) })
      setTariffError(null)
    },
    onError: () => setTariffError('Помилка при збереженні тарифу'),
  })

  const refundMutation = useMutation({
    mutationFn: () => {
      const payload = {
        refund_on_excused: refundForm.refund_on_excused,
        refund_amount: refundForm.mode === 'amount' && refundForm.refund_amount ? Number(refundForm.refund_amount) : null,
        refund_pct:    refundForm.mode === 'pct'    && refundForm.refund_pct    ? Number(refundForm.refund_pct)    : null,
        note: refundForm.note || null,
      }
      return activitiesApi.setRefundConfig(id!, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activity-refund-config', id] })
      setEditingRefund(false)
      setRefundError(null)
    },
    onError: () => setRefundError('Помилка при збереженні'),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: (is_active: boolean) => activitiesApi.update(id!, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity', id] }),
  })

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
  if (!activity)  return <div className="py-12 text-center text-sm text-gray-400">Активність не знайдена</div>

  const startEdit = () => {
    setEditForm({ name: activity.name, account_id: activity.account_id ?? '', tariff_type: activity.tariff_type, is_rigid: activity.is_rigid, note: activity.note ?? '' })
    setEditing(true)
    setSaveError(null)
  }

  const startEditRefund = () => {
    const mode = refundConfig?.refund_amount != null ? 'amount' : refundConfig?.refund_pct != null ? 'pct' : 'none'
    setRefundForm({
      refund_on_excused: refundConfig?.refund_on_excused ?? false,
      mode,
      refund_amount: refundConfig?.refund_amount ?? '',
      refund_pct:    refundConfig?.refund_pct    ?? '',
      note:          refundConfig?.note          ?? '',
    })
    setEditingRefund(true)
    setRefundError(null)
  }

  const handleSave = () => {
    if (!editForm.name.trim()) { setSaveError('Назва є обовʼязковою'); return }
    updateMutation.mutate(editForm)
  }

  const handleRefundSave = () => {
    if (refundForm.refund_on_excused && refundForm.mode === 'amount' && !refundForm.refund_amount) {
      setRefundError('Вкажіть суму повернення'); return
    }
    if (refundForm.refund_on_excused && refundForm.mode === 'pct' && !refundForm.refund_pct) {
      setRefundError('Вкажіть відсоток повернення'); return
    }
    refundMutation.mutate()
  }

  // Описание текущей конфигурации возврата для view-режима
  const refundSummary = () => {
    if (!refundConfig || !refundConfig.refund_on_excused) return 'Повернення не нараховується'
    if (refundConfig.refund_amount != null) return `${Number(refundConfig.refund_amount).toFixed(2)} грн за пропуск`
    if (refundConfig.refund_pct != null)    return `${Number(refundConfig.refund_pct)}% від тарифу`
    return 'Повернення увімкнено (сума не вказана)'
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/activities" className="hover:text-iris-600 transition-colors">Активності</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{activity.name}</span>
      </div>

      {/* Main info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{activity.name}</h1>
            <p className="text-sm text-gray-500 mt-0.5">{activity.tariff_type === 'monthly' ? 'Місячний тариф' : 'Оплата за заняття'}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${activity.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {activity.is_active ? 'Активна' : 'Архів'}
            </span>
            {canEdit && !editing && (
              <button onClick={startEdit} className="text-sm text-iris-600 hover:text-iris-700 font-medium">Редагувати</button>
            )}
          </div>
        </div>

        {!editing ? (
          <dl className="grid grid-cols-2 gap-4">
            <div><dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Рахунок</dt><dd className="mt-1 text-sm text-gray-900">{activity.account_name ?? '—'}</dd></div>
            <div><dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Поточний тариф</dt>
              <dd className="mt-1 text-sm text-gray-900">{activity.current_tariff ? `${Number(activity.current_tariff.base_fee).toFixed(2)} грн` : '—'}</dd></div>
            <div><dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Жорсткий абонемент</dt><dd className="mt-1 text-sm text-gray-900">{activity.is_rigid ? 'Так' : 'Ні'}</dd></div>
            {activity.note && <div className="col-span-2"><dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Нотатка</dt><dd className="mt-1 text-sm text-gray-900">{activity.note}</dd></div>}
          </dl>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Назва *</label>
              <input type="text" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Тип тарифу</label>
                <select value={editForm.tariff_type} onChange={(e) => setEditForm({ ...editForm, tariff_type: e.target.value as 'monthly' | 'per_lesson' })}
                  className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
                  <option value="monthly">Місячний</option>
                  <option value="per_lesson">За заняття</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Рахунок</label>
                <select value={editForm.account_id} onChange={(e) => setEditForm({ ...editForm, account_id: e.target.value })}
                  className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
                  <option value="">— не вказано —</option>
                  {accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={editForm.is_rigid} onChange={(e) => setEditForm({ ...editForm, is_rigid: e.target.checked })}
                className="rounded border-gray-300 text-iris-600 focus:ring-iris-500" />
              <span className="text-sm text-gray-700">Жорсткий абонемент</span>
            </label>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Нотатка</label>
              <textarea value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                rows={2} className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
            </div>
            {saveError && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveError}</div>}
            <div className="flex gap-3">
              <button onClick={handleSave} disabled={updateMutation.isPending}
                className="px-4 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {updateMutation.isPending ? 'Збереження...' : 'Зберегти'}
              </button>
              <button onClick={() => { setEditing(false); setSaveError(null) }} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm font-medium">Скасувати</button>
              <button onClick={() => toggleActiveMutation.mutate(!activity.is_active)} className="ml-auto text-sm text-gray-400 hover:text-red-600 transition-colors">
                {activity.is_active ? 'Перевести в архів' : 'Відновити'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Refund config */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-medium text-gray-900">Налаштування повернень</h2>
            <p className="text-xs text-gray-400 mt-0.5">При відсутності за поважною причиною</p>
          </div>
          {canEdit && !editingRefund && (
            <button onClick={startEditRefund} className="text-sm text-iris-600 hover:text-iris-700 font-medium">
              {refundConfig ? 'Змінити' : 'Налаштувати'}
            </button>
          )}
        </div>

        {activity.is_rigid && (
          <div className="mb-3 px-3 py-2 bg-amber-50 rounded-lg text-xs text-amber-700">
            Жорсткий абонемент — повернення за основну послугу заблоковано незалежно від налаштувань нижче
          </div>
        )}

        {!editingRefund ? (
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${refundConfig?.refund_on_excused ? 'bg-green-500' : 'bg-gray-300'}`} />
            <span className="text-sm text-gray-700">{refundSummary()}</span>
            {refundConfig?.note && <span className="text-xs text-gray-400 ml-2">· {refundConfig.note}</span>}
          </div>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={refundForm.refund_on_excused}
                onChange={(e) => setRefundForm({ ...refundForm, refund_on_excused: e.target.checked, mode: e.target.checked ? refundForm.mode || 'amount' : 'none' })}
                className="rounded border-gray-300 text-iris-600 focus:ring-iris-500" />
              <span className="text-sm font-medium text-gray-700">Нараховувати повернення при поважній причині</span>
            </label>

            {refundForm.refund_on_excused && (
              <div className="ml-6 space-y-3">
                <div className="flex gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="refund_mode" value="amount" checked={refundForm.mode === 'amount'}
                      onChange={() => setRefundForm({ ...refundForm, mode: 'amount', refund_pct: '' })}
                      className="text-iris-600 focus:ring-iris-500" />
                    <span className="text-sm text-gray-700">Фіксована сума</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="refund_mode" value="pct" checked={refundForm.mode === 'pct'}
                      onChange={() => setRefundForm({ ...refundForm, mode: 'pct', refund_amount: '' })}
                      className="text-iris-600 focus:ring-iris-500" />
                    <span className="text-sm text-gray-700">Відсоток від тарифу</span>
                  </label>
                </div>

                {refundForm.mode === 'amount' && (
                  <div className="flex items-center gap-2">
                    <input type="number" min="0" step="0.01" value={refundForm.refund_amount}
                      onChange={(e) => setRefundForm({ ...refundForm, refund_amount: e.target.value })}
                      placeholder="0.00"
                      className="w-36 rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                    <span className="text-sm text-gray-500">грн</span>
                  </div>
                )}

                {refundForm.mode === 'pct' && (
                  <div className="flex items-center gap-2">
                    <input type="number" min="0" max="100" step="0.1" value={refundForm.refund_pct}
                      onChange={(e) => setRefundForm({ ...refundForm, refund_pct: e.target.value })}
                      placeholder="0"
                      className="w-24 rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                    <span className="text-sm text-gray-500">%</span>
                    {refundForm.refund_pct && activity.current_tariff && (
                      <span className="text-xs text-gray-400">
                        = {(Number(activity.current_tariff.base_fee) * Number(refundForm.refund_pct) / 100).toFixed(2)} грн за поточним тарифом
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Нотатка</label>
              <input type="text" value={refundForm.note}
                onChange={(e) => setRefundForm({ ...refundForm, note: e.target.value })}
                placeholder="Наприклад: повернення за харчування"
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
            </div>

            {refundError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{refundError}</p>}

            <div className="flex gap-3">
              <button onClick={handleRefundSave} disabled={refundMutation.isPending}
                className="px-4 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {refundMutation.isPending ? 'Збереження...' : 'Зберегти'}
              </button>
              <button onClick={() => { setEditingRefund(false); setRefundError(null) }}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm font-medium">
                Скасувати
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Tariff history */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-medium text-gray-900">Історія тарифів</h2>
          {canEdit && !showTariffForm && (
            <button onClick={() => setShowTariffForm(true)} className="text-sm text-iris-600 hover:text-iris-700 font-medium">+ Новий тариф</button>
          )}
        </div>

        {showTariffForm && (
          <div className="mb-4 p-4 bg-iris-50 rounded-lg space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Сума (грн) *</label>
                <input type="number" min="0" step="0.01" value={newTariff.base_fee}
                  onChange={(e) => setNewTariff({ ...newTariff, base_fee: e.target.value })}
                  className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Діє з</label>
                <input type="date" value={newTariff.valid_from}
                  onChange={(e) => setNewTariff({ ...newTariff, valid_from: e.target.value })}
                  className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
              </div>
            </div>
            {tariffError && <p className="text-xs text-red-600">{tariffError}</p>}
            <div className="flex gap-2">
              <button onClick={() => { if (!newTariff.base_fee) { setTariffError('Вкажіть суму'); return } tariffMutation.mutate() }}
                disabled={tariffMutation.isPending}
                className="text-xs px-3 py-1 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-md transition-colors">
                {tariffMutation.isPending ? '...' : 'Зберегти тариф'}
              </button>
              <button onClick={() => { setShowTariffForm(false); setTariffError(null) }} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-900">Скасувати</button>
            </div>
          </div>
        )}

        {history.length === 0 ? (
          <p className="text-sm text-gray-400">Тариф ще не встановлено</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-xs text-gray-500 border-b border-gray-100">
              <th className="text-left pb-2">Сума</th>
              <th className="text-left pb-2">Діє з</th>
              <th className="text-left pb-2">Діє до</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {history.map((t) => (
                <tr key={t.id} className={t.valid_to ? 'text-gray-400' : 'text-gray-900 font-medium'}>
                  <td className="py-2">{Number(t.base_fee).toFixed(2)} грн</td>
                  <td className="py-2">{formatDate(String(t.valid_from))}</td>
                  <td className="py-2">{t.valid_to ? formatDate(String(t.valid_to)) : <span className="text-green-600 text-xs">поточний</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Linked activities */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-medium text-gray-900 mb-3">
          Повʼязані активності ({activity.linked_activities?.length ?? 0})
        </h2>
        {!activity.linked_activities?.length ? (
          <p className="text-sm text-gray-400">Немає повʼязаних активностей</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {activity.linked_activities.map((la) => (
              <li key={la.id} className="py-2 text-sm text-gray-900">{la.name}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
