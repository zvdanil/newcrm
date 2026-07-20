import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { activitiesApi } from '../../api/activities.api'
import { accountsApi } from '../../api/accounts.api'
import { staffApi } from '../../api/staff.api'
import { calendarApi } from '../../api/calendar.api'
import { useCanAccess } from '../../hooks/useCanAccess'
import { today, formatDateStr } from '../../utils/dateStr'

import type { Activity } from '../../types'

function formatDate(iso: string) {
  return formatDateStr(iso)
}

// ─── Linked Activities Block ─────────────────────────────────────────────────

function LinkedActivitiesBlock({
  activityId,
  parentActivity,
  canEdit,
}: {
  activityId: string
  parentActivity: Activity
  canEdit: boolean
}) {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [selectedId, setSelectedId] = useState('')

  // Все активности для выбора (исключаем саму себя и уже привязанные)
  const { data: allActivities = [] } = useQuery({
    queryKey: ['activities'],
    queryFn: () => activitiesApi.list(),
    enabled: showAdd,
  })

  const linked = parentActivity.linked_activities ?? []
  const linkedIds = new Set(linked.map((la) => la.id))

  const available = allActivities.filter(
    (a) => a.id !== activityId && !linkedIds.has(a.id) && a.is_active
  )

  const linkMutation = useMutation({
    mutationFn: () => activitiesApi.link(activityId, selectedId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activity', activityId] })
      setShowAdd(false)
      setSelectedId('')
    },
  })

  const unlinkMutation = useMutation({
    mutationFn: (childId: string) => activitiesApi.unlink(activityId, childId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity', activityId] }),
  })

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-medium text-gray-900">Повʼязані активності</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Відмітка в цьому журналі каскадно ставиться у повʼязаних
          </p>
        </div>
        {canEdit && !showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="text-sm text-iris-600 hover:text-iris-700 font-medium"
          >
            + Додати
          </button>
        )}
      </div>

      {linked.length === 0 && !showAdd && (
        <p className="text-sm text-gray-400">Немає повʼязаних активностей</p>
      )}

      {linked.length > 0 && (
        <ul className="divide-y divide-gray-100 mb-3">
          {linked.map((la) => (
            <li key={la.id} className="py-2.5 flex items-center justify-between">
              <div>
                <span className="text-sm text-gray-900">{la.name}</span>
                <span className="ml-2 text-xs text-gray-400">
                  {la.tariff_type === 'monthly' ? 'місячний' : la.tariff_type === 'per_lesson' ? 'за заняття' : 'смарт'}
                </span>
              </div>
              {canEdit && (
                <button
                  onClick={() => unlinkMutation.mutate(la.id)}
                  disabled={unlinkMutation.isPending}
                  className="text-xs text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                >
                  Відʼєднати
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {showAdd && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="flex-1 rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
          >
            <option value="">— оберіть активність —</option>
            {available.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.tariff_type === 'monthly' ? 'місячний' : a.tariff_type === 'per_lesson' ? 'за заняття' : 'смарт'})
              </option>
            ))}
          </select>
          <button
            onClick={() => { if (selectedId) linkMutation.mutate() }}
            disabled={!selectedId || linkMutation.isPending}
            className="text-xs px-3 py-1.5 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            {linkMutation.isPending ? '...' : 'Додати'}
          </button>
          <button
            onClick={() => { setShowAdd(false); setSelectedId('') }}
            className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-900"
          >
            Скасувати
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Smart Tariff Config Block ───────────────────────────────────────────────

function SmartTariffConfigBlock({ activityId, canEdit }: { activityId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    base_lessons: 20,
    l1_enabled: false,
    l1_threshold_absences: '',
    l1_threshold_fee: '',
    l2_enabled: false,
    l2_max_refunds: '',
    l2_refund_per_absence: '',
  })
  const [error, setError] = useState<string | null>(null)

  const { data: config } = useQuery({
    queryKey: ['activity-smart-tariff', activityId],
    queryFn: () => activitiesApi.getSmartTariff(activityId),
  })

  const saveMutation = useMutation({
    mutationFn: () => activitiesApi.setSmartTariff(activityId, {
      base_lessons: form.base_lessons,
      l1_threshold_absences: form.l1_enabled && form.l1_threshold_absences ? Number(form.l1_threshold_absences) : null,
      l1_threshold_fee: form.l1_enabled && form.l1_threshold_fee ? Number(form.l1_threshold_fee) : null,
      l2_max_refunds: form.l2_enabled && form.l2_max_refunds ? Number(form.l2_max_refunds) : null,
      l2_refund_per_absence: form.l2_enabled && form.l2_refund_per_absence ? Number(form.l2_refund_per_absence) : null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['activity-smart-tariff', activityId] })
      setEditing(false)
      setError(null)
    },
    onError: () => setError('Помилка при збереженні'),
  })

  const startEdit = () => {
    setForm({
      base_lessons: config?.base_lessons ?? 20,
      l1_enabled: config?.l1_threshold_absences != null,
      l1_threshold_absences: config?.l1_threshold_absences?.toString() ?? '',
      l1_threshold_fee: config?.l1_threshold_fee ?? '',
      l2_enabled: config?.l2_max_refunds != null,
      l2_max_refunds: config?.l2_max_refunds?.toString() ?? '',
      l2_refund_per_absence: config?.l2_refund_per_absence ?? '',
    })
    setEditing(true)
    setError(null)
  }

  const handleSave = () => {
    if (form.l1_enabled && (!form.l1_threshold_absences || !form.l1_threshold_fee)) {
      setError('Для логіки 1 вкажіть поріг пропусків і суму'); return
    }
    if (form.l2_enabled && (!form.l2_max_refunds || !form.l2_refund_per_absence)) {
      setError('Для логіки 2 вкажіть ліміт і суму за пропуск'); return
    }
    saveMutation.mutate()
  }

  return (
    <div className="bg-white rounded-xl border border-iris-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-medium text-gray-900">Конфігурація смарт-тарифу</h2>
          <p className="text-xs text-gray-400 mt-0.5">ACCRUAL=B на 1-е число · REFUND=пільга в реальному часі</p>
        </div>
        {canEdit && !editing && (
          <button onClick={startEdit} className="text-sm text-iris-600 hover:text-iris-700 font-medium">
            {config ? 'Змінити' : 'Налаштувати'}
          </button>
        )}
      </div>

      {!editing ? (
        <div className="space-y-3 text-sm">
          {config && (
            <div className="flex items-center gap-2 text-gray-600">
              <span>Базових занять:</span>
              <span className="font-medium text-gray-900">{config.base_lessons}</span>
            </div>
          )}
          {config?.l1_threshold_absences != null && (
            <div className="bg-iris-50 rounded-lg px-3 py-2">
              <span className="font-medium text-iris-700">Логіка 1 · </span>
              <span className="text-gray-700">
                При ≥{config.l1_threshold_absences} пропусків → {Number(config.l1_threshold_fee).toFixed(2)} грн замість повного тарифу
              </span>
            </div>
          )}
          {config?.l2_max_refunds != null && (
            <div className="bg-iris-50 rounded-lg px-3 py-2">
              <span className="font-medium text-iris-700">Логіка 2 · </span>
              <span className="text-gray-700">
                Перші {config.l2_max_refunds} пропусків → {Number(config.l2_refund_per_absence).toFixed(2)} грн кожен
              </span>
            </div>
          )}
          {config?.l1_threshold_absences != null && config.l2_max_refunds != null && (
            <p className="text-xs text-gray-400">При комбінації застосовується правило з більшою пільгою</p>
          )}
          {(!config || (config.l1_threshold_absences == null && config.l2_max_refunds == null)) && (
            <p className="text-sm text-gray-400">Логіки не налаштовано — ACCRUAL=B без автоматичних пільг</p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Базових занять на місяць:</label>
            <input type="number" min="1" max="31" value={form.base_lessons}
              onChange={(e) => setForm({ ...form, base_lessons: Number(e.target.value) })}
              className="w-20 rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          </div>

          <div className="border border-gray-200 rounded-lg p-4 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.l1_enabled}
                onChange={(e) => setForm({ ...form, l1_enabled: e.target.checked })}
                className="rounded border-gray-300 text-iris-600 focus:ring-iris-500" />
              <span className="text-sm font-medium text-gray-700">Логіка 1: знижена абонплата при порозі пропусків</span>
            </label>
            {form.l1_enabled && (
              <div className="ml-6 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Поріг пропусків (≥)</label>
                  <input type="number" min="1" value={form.l1_threshold_absences}
                    onChange={(e) => setForm({ ...form, l1_threshold_absences: e.target.value })}
                    placeholder="напр. 5"
                    className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Сума до нарахування (грн)</label>
                  <input type="number" min="0" step="0.01" value={form.l1_threshold_fee}
                    onChange={(e) => setForm({ ...form, l1_threshold_fee: e.target.value })}
                    placeholder="напр. 1500"
                    className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                </div>
              </div>
            )}
          </div>

          <div className="border border-gray-200 rounded-lg p-4 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.l2_enabled}
                onChange={(e) => setForm({ ...form, l2_enabled: e.target.checked })}
                className="rounded border-gray-300 text-iris-600 focus:ring-iris-500" />
              <span className="text-sm font-medium text-gray-700">Логіка 2: повернення за перші N пропусків</span>
            </label>
            {form.l2_enabled && (
              <div className="ml-6 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Макс. пропусків з поверненням</label>
                  <input type="number" min="1" value={form.l2_max_refunds}
                    onChange={(e) => setForm({ ...form, l2_max_refunds: e.target.value })}
                    placeholder="напр. 4"
                    className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Повернення за пропуск (грн)</label>
                  <input type="number" min="0" step="0.01" value={form.l2_refund_per_absence}
                    onChange={(e) => setForm({ ...form, l2_refund_per_absence: e.target.value })}
                    placeholder="напр. 100"
                    className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saveMutation.isPending}
              className="px-4 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
              {saveMutation.isPending ? 'Збереження...' : 'Зберегти'}
            </button>
            <button onClick={() => { setEditing(false); setError(null) }}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm font-medium">
              Скасувати
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ActivityCardPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const canEdit = useCanAccess('owner', 'admin')

  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', account_id: '', tariff_type: 'monthly' as 'monthly' | 'per_lesson' | 'smart', is_rigid: false, has_group_classes: false, auto_group_classes: false, note: '' })
  const [saveError, setSaveError] = useState<string | null>(null)

  const [newTariff, setNewTariff] = useState({ base_fee: '', valid_from: today() })
  const [showTariffForm, setShowTariffForm] = useState(false)
  const [tariffError, setTariffError] = useState<string | null>(null)
  const [recalcFrom, setRecalcFrom] = useState(today())
  const [recalcResult, setRecalcResult] = useState<{ replaced: number; refunded: number } | null>(null)

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

  useEffect(() => {
    if (history.length > 0) {
      const latest = history.reduce((a, b) => String(a.valid_from) > String(b.valid_from) ? a : b)
      setRecalcFrom(String(latest.valid_from).slice(0, 10))
    }
  }, [history.length])

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
      setNewTariff({ base_fee: '', valid_from: today() })
      setTariffError(null)
    },
    onError: () => setTariffError('Помилка при збереженні тарифу'),
  })

  const recalcMutation = useMutation({
    mutationFn: () => activitiesApi.retroRecalc(id!, recalcFrom),
    onSuccess: (result) => setRecalcResult(result),
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
    setEditForm({ name: activity.name, account_id: activity.account_id ?? '', tariff_type: activity.tariff_type as 'monthly' | 'per_lesson' | 'smart', is_rigid: activity.is_rigid, has_group_classes: activity.has_group_classes, auto_group_classes: activity.auto_group_classes, note: activity.note ?? '' })
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
            <p className="text-sm text-gray-500 mt-0.5">
              {activity.tariff_type === 'monthly' ? 'Місячний тариф' : activity.tariff_type === 'per_lesson' ? 'Оплата за заняття' : 'Смарт-тариф'}
            </p>
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
            <div><dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">Групові заняття</dt><dd className="mt-1 text-sm text-gray-900">{activity.has_group_classes ? (activity.auto_group_classes ? 'Так (авто)' : 'Так (вручну)') : 'Ні'}</dd></div>
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
                <select value={editForm.tariff_type} onChange={(e) => setEditForm({ ...editForm, tariff_type: e.target.value as 'monthly' | 'per_lesson' | 'smart' })}
                  className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
                  <option value="monthly">Місячний</option>
                  <option value="per_lesson">За заняття</option>
                  <option value="smart">Смарт-тариф</option>
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
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editForm.has_group_classes} onChange={(e) => setEditForm({ ...editForm, has_group_classes: e.target.checked, auto_group_classes: e.target.checked ? editForm.auto_group_classes : false })}
                  className="rounded border-gray-300 text-iris-600 focus:ring-iris-500" />
                <span className="text-sm text-gray-700">Є групові заняття</span>
              </label>
              {editForm.has_group_classes && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editForm.auto_group_classes} onChange={(e) => setEditForm({ ...editForm, auto_group_classes: e.target.checked })}
                    className="rounded border-gray-300 text-iris-600 focus:ring-iris-500" />
                  <span className="text-sm text-gray-700">Встановлювати автоматично</span>
                </label>
              )}
            </div>
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

      {/* Smart tariff config — visible only for smart tariff type */}
      {activity.tariff_type === 'smart' && id && (
        <SmartTariffConfigBlock activityId={id} canEdit={canEdit} />
      )}

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

        {canEdit && history.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs font-medium text-gray-600 mb-2">Ретроспективний перерахунок</p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">від</span>
              <input
                type="date"
                value={recalcFrom}
                onChange={(e) => { setRecalcFrom(e.target.value); setRecalcResult(null) }}
                className="rounded border-gray-300 text-xs shadow-sm focus:border-iris-500 focus:ring-iris-500"
              />
              <button
                onClick={() => { setRecalcResult(null); recalcMutation.mutate() }}
                disabled={recalcMutation.isPending}
                className="text-xs px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-md transition-colors"
              >
                {recalcMutation.isPending ? 'Рахує...' : 'Перерахувати'}
              </button>
              {recalcResult && (
                <span className="text-xs text-gray-600">
                  {recalcResult.replaced > 0 || recalcResult.refunded > 0
                    ? <span className="text-green-700 font-medium">
                        Замінено: {recalcResult.replaced} нарахувань
                        {recalcResult.refunded > 0 ? `, ${recalcResult.refunded} повернень` : ''}
                      </span>
                    : <span className="text-gray-400">Нічого не змінилось</span>
                  }
                </span>
              )}
              {recalcMutation.isError && (
                <span className="text-xs text-red-500">Помилка перерахунку</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Linked activities */}
      {id && <LinkedActivitiesBlock activityId={id} parentActivity={activity} canEdit={canEdit} />}

      {/* Schedule */}
      {id && <ScheduleBlock activityId={id} canEdit={canEdit} />}
    </div>
  )
}

// ─── Schedule Block ────────────────────────────────────────────────────────────

const DAY_LABELS: Record<number, string> = { 0: 'Нд', 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб' }
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0]

function rruleToDays(rrule: string): number[] {
  const dayCodeMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }
  const match = rrule.match(/BYDAY=([A-Z,]+)/)
  if (!match) return []
  return match[1].split(',').map(c => dayCodeMap[c] ?? -1).filter(d => d >= 0)
}

interface ScheduleBlockProps {
  activityId: string
  canEdit:    boolean
}

function ScheduleBlock({ activityId, canEdit }: ScheduleBlockProps) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)

  const defaultForm = {
    name:         '',
    days:         [] as number[],
    start_time:   '09:00',
    duration_min: '60',
    staff_id:     '',
    room:         '',
    dtstart:      today(),
    dtend:        '',
    color:        '#6366f1',
    note:         '',
  }
  const [form, setForm] = useState(defaultForm)
  const [formError, setFormError] = useState<string | null>(null)

  const openNewForm = async () => {
    const fresh = { ...defaultForm }
    try {
      const staffForActivity = await calendarApi.getStaffForActivity(activityId)
      if (staffForActivity.length > 0) fresh.staff_id = staffForActivity[0].id
    } catch { /* ignore */ }
    setForm(fresh)
    setShowForm(true)
    setFormError(null)
  }

  const { data: schedules = [] } = useQuery({
    queryKey: ['activity-schedules', activityId],
    queryFn:  () => calendarApi.getSchedulesByActivity(activityId),
  })

  const { data: staffList = [] } = useQuery({
    queryKey: ['staff-list-active'],
    queryFn:  () => staffApi.list({ is_active: true }),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['activity-schedules', activityId] })

  const createMutation = useMutation({
    mutationFn: () => calendarApi.createSchedule({
      activity_id:  activityId,
      name:         form.name      || undefined,
      staff_id:     form.staff_id  || undefined,
      room:         form.room      || undefined,
      start_time:   form.start_time,
      duration_min: Number(form.duration_min),
      days:         form.days,
      dtstart:      form.dtstart,
      dtend:        form.dtend     || undefined,
      color:        form.color     || undefined,
      note:         form.note      || undefined,
    }),
    onSuccess: () => { invalidate(); setShowForm(false); setForm(defaultForm); setFormError(null) },
    onError:   () => setFormError('Помилка при збереженні'),
  })

  const updateMutation = useMutation({
    mutationFn: (id: string) => calendarApi.updateSchedule(id, {
      name:         form.name      || null,
      staff_id:     form.staff_id  || null,
      room:         form.room      || null,
      start_time:   form.start_time,
      duration_min: Number(form.duration_min),
      days:         form.days,
      dtend:        form.dtend     || null,
      color:        form.color     || null,
      note:         form.note      || null,
    }),
    onSuccess: () => { invalidate(); setEditId(null); setForm(defaultForm); setFormError(null) },
    onError:   () => setFormError('Помилка при збереженні'),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => calendarApi.deactivateSchedule(id),
    onSuccess:  invalidate,
  })

  const toggleDay = (day: number) => {
    setForm(f => ({ ...f, days: f.days.includes(day) ? f.days.filter(d => d !== day) : [...f.days, day] }))
  }

  const startEdit = (sched: typeof schedules[number]) => {
    setForm({
      name:         sched.name     ?? '',
      days:         rruleToDays(sched.rrule),
      start_time:   String(sched.start_time).slice(0, 5),
      duration_min: String(sched.duration_min),
      staff_id:     sched.staff_id ?? '',
      room:         sched.room     ?? '',
      dtstart:      String(sched.dtstart).slice(0, 10),
      dtend:        sched.dtend ? String(sched.dtend).slice(0, 10) : '',
      color:        sched.color ?? '#6366f1',
      note:         sched.note  ?? '',
    })
    setEditId(sched.id)
    setShowForm(false)
    setFormError(null)
  }

  const handleSubmit = () => {
    if (form.days.length === 0) { setFormError('Оберіть хоча б один день тижня'); return }
    if (!form.start_time)       { setFormError('Вкажіть час початку'); return }
    if (!form.dtstart)          { setFormError('Вкажіть дату початку'); return }
    if (editId) updateMutation.mutate(editId)
    else createMutation.mutate()
  }

  const cancelForm = () => { setShowForm(false); setEditId(null); setForm(defaultForm); setFormError(null) }

  const isFormOpen = showForm || editId !== null

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Розклад занять</h2>
        {canEdit && !isFormOpen && (
          <button
            onClick={openNewForm}
            className="text-sm text-iris-600 hover:text-iris-800 font-medium"
          >
            + Додати
          </button>
        )}
      </div>

      {/* List of active schedules */}
      {schedules.length === 0 && !isFormOpen && (
        <p className="text-sm text-gray-400">Розклад не налаштований</p>
      )}

      <div className="space-y-2">
        {schedules.map(sched => (
          <div key={sched.id} className={`flex items-start justify-between rounded-lg border p-3 ${editId === sched.id ? 'border-iris-300 bg-iris-50' : 'border-gray-100 bg-gray-50'}`}>
            <div className="space-y-0.5">
              {sched.name && <div className="text-sm font-semibold text-gray-900">{sched.name}</div>}
              <div className="text-sm font-medium text-gray-900">
                {rruleToDays(sched.rrule).map(d => DAY_LABELS[d]).join(', ')}
                <span className="mx-1 text-gray-400">·</span>
                {String(sched.start_time).slice(0, 5)}
                <span className="mx-1 text-gray-400">·</span>
                {sched.duration_min} хв
              </div>
              {sched.staff_name && <div className="text-xs text-gray-500">Педагог: {sched.staff_name}</div>}
              {sched.room       && <div className="text-xs text-gray-500">Кімната: {sched.room}</div>}
              <div className="text-xs text-gray-400">
                {String(sched.dtstart).slice(0, 10)}
                {sched.dtend && ` → ${String(sched.dtend).slice(0, 10)}`}
              </div>
            </div>
            {canEdit && (
              <div className="flex gap-2 ml-3 shrink-0">
                <button onClick={() => startEdit(sched)} className="text-xs text-gray-400 hover:text-iris-600">Ред.</button>
                <button
                  onClick={() => deactivateMutation.mutate(sched.id)}
                  disabled={deactivateMutation.isPending}
                  className="text-xs text-gray-400 hover:text-red-500"
                >
                  Видалити
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add / Edit form */}
      {isFormOpen && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-4 bg-gray-50">
          <p className="text-sm font-medium text-gray-700">{editId ? 'Редагувати розклад' : 'Новий розклад'}</p>

          {/* Name + color */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Назва заняття</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="залишити порожнім — буде назва активності"
                className="flex-1 rounded-lg border-gray-300 text-sm shadow-sm"
              />
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm(f => ({ ...f, color: e.target.value }))}
                className="w-8 h-8 rounded border border-gray-300 cursor-pointer shrink-0 p-0.5"
                title="Колір заняття в календарі"
              />
            </div>
          </div>

          {/* Days of week */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Дні тижня</label>
            <div className="flex gap-1.5">
              {ALL_DAYS.map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`w-9 h-9 rounded-lg text-xs font-medium border transition-colors ${
                    form.days.includes(d)
                      ? 'bg-iris-600 text-white border-iris-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-iris-300'
                  }`}
                >
                  {DAY_LABELS[d]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Час початку</label>
              <input
                type="time"
                value={form.start_time}
                onChange={(e) => setForm(f => ({ ...f, start_time: e.target.value }))}
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Тривалість (хв)</label>
              <input
                type="number"
                min="15"
                step="5"
                value={form.duration_min}
                onChange={(e) => setForm(f => ({ ...f, duration_min: e.target.value }))}
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Педагог</label>
            <select
              value={form.staff_id}
              onChange={(e) => setForm(f => ({ ...f, staff_id: e.target.value }))}
              className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
            >
              <option value="">— без педагога —</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Кімната / кабінет</label>
            <input
              type="text"
              value={form.room}
              onChange={(e) => setForm(f => ({ ...f, room: e.target.value }))}
              placeholder="напр. Кімната 2"
              className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Дата початку</label>
              <input
                type="date"
                value={form.dtstart}
                onChange={(e) => setForm(f => ({ ...f, dtstart: e.target.value }))}
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Дата завершення (необов.)</label>
              <input
                type="date"
                value={form.dtend}
                onChange={(e) => setForm(f => ({ ...f, dtend: e.target.value }))}
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Примітка</label>
            <input
              type="text"
              value={form.note}
              onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))}
              className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
            />
          </div>

          {formError && <p className="text-xs text-red-500">{formError}</p>}

          <div className="flex gap-3">
            <button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="px-4 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {editId ? 'Зберегти' : 'Додати розклад'}
            </button>
            <button onClick={cancelForm} className="px-4 py-2 text-gray-500 hover:text-gray-700 text-sm">Скасувати</button>
          </div>
        </div>
      )}
    </div>
  )
}
