import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { staffApi, type StaffMember, type StaffRate, type SalaryTransaction, type RateType, type RateCategory, type ValueMode } from '../../api/staff.api'
import { useCanAccess } from '../../hooks/useCanAccess'
import { today as todayStr, localMonthStr } from '../../utils/dateStr'
import { activitiesApi } from '../../api/activities.api'
import {
  fmt,
  RATE_TYPE_LABELS,
  TX_TYPE_LABELS,
  TxPopup,
  AccrualGroupPopup,
  PaymentGroupPopup,
} from '../../components/SalaryTransactionPopups'

// ── helpers ────────────────────────────────────────────────────────────────

const RATE_CAT_LABELS: Record<RateCategory, string> = {
  auto:   'Авто',
  manual: 'Ручна',
}

function monthNav(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

// ── Block 1: Staff Info ────────────────────────────────────────────────────

function StaffInfoBlock({ staff }: { staff: StaffMember }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    full_name:      staff.full_name,
    specialization: staff.specialization ?? '',
    type:           staff.type,
    phone:          staff.phone ?? '',
    start_date:     staff.start_date?.slice(0, 10) ?? '',
    is_active:      staff.is_active,
    note:           staff.note ?? '',
  })

  const mutation = useMutation({
    mutationFn: (payload: Parameters<typeof staffApi.update>[1]) => staffApi.update(staff.id, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff', staff.id] }); setEditing(false) },
  })

  if (!editing) return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{staff.full_name}</h2>
          <p className="text-sm text-gray-500">{staff.specialization ?? '—'}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
            staff.type === 'partner' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
          }`}>
            {staff.type === 'partner' ? 'Партнер / ФОП' : 'Співробітник'}
          </span>
          <span className={`text-xs px-2.5 py-1 rounded-full ${
            staff.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'
          }`}>
            {staff.is_active ? 'Активний' : 'Архів'}
          </span>
          <button onClick={() => setEditing(true)}
            className="text-xs text-gray-400 hover:text-iris-600 transition-colors">
            ред.
          </button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div><span className="text-gray-500">Телефон:</span> <span className="text-gray-900">{staff.phone ?? '—'}</span></div>
        <div><span className="text-gray-500">Дата початку:</span> <span className="text-gray-900">{staff.start_date?.slice(0, 10) ?? '—'}</span></div>
        {staff.note && <div className="col-span-3"><span className="text-gray-500">Нотатка:</span> <span className="text-gray-700">{staff.note}</span></div>}
      </div>
    </div>
  )

  return (
    <form onSubmit={e => { e.preventDefault(); mutation.mutate({ ...form, start_date: form.start_date || null }) }}
      className="bg-iris-50 border border-iris-200 rounded-xl p-5 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">ПІБ *</label>
          <input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Тип</label>
          <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as 'employee' | 'partner' }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500">
            <option value="employee">Співробітник</option>
            <option value="partner">Партнер / ФОП</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Спеціалізація</label>
          <input value={form.specialization} onChange={e => setForm(f => ({ ...f, specialization: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Телефон</label>
          <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Дата початку</label>
          <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Нотатка</label>
          <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
        <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="rounded" />
        Активний
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending}
          className="px-4 py-2 bg-iris-600 text-white text-sm rounded-lg hover:bg-iris-700 disabled:opacity-50">
          {mutation.isPending ? '...' : 'Зберегти'}
        </button>
        <button type="button" onClick={() => setEditing(false)}
          className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">
          Скасувати
        </button>
      </div>
    </form>
  )
}

// ── Add Rate Form ──────────────────────────────────────────────────────────

function AddRateForm({ staffId, activities, onDone }: {
  staffId: string
  activities: { id: string; name: string }[]
  onDone: () => void
}) {
  const qc = useQueryClient()
  const today = todayStr()
  const [form, setForm] = useState({
    activity_id:   '',
    rate_category: 'auto' as RateCategory,
    rate_type:     'per_lesson' as RateType,
    value_mode:    'fixed' as ValueMode,
    rate_value:    '',
    deduction_pct: '0',
    valid_from:    today,
    note:          '',
  })
  const [smartConfig, setSmartConfig] = useState({ base_lessons: '8', absence_threshold: '', threshold_rate: '' })
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => staffApi.createRate(staffId, {
      activity_id:   form.activity_id || undefined,
      rate_category: form.rate_category,
      rate_type:     form.rate_type,
      value_mode:    form.value_mode,
      rate_value:    parseFloat(form.rate_value),
      deduction_pct: parseFloat(form.deduction_pct) || 0,
      valid_from:    form.valid_from,
      note:          form.note || undefined,
      smart_config:  form.rate_type === 'smart' ? {
        base_lessons:      parseInt(smartConfig.base_lessons) || 8,
        absence_threshold: parseInt(smartConfig.absence_threshold),
        threshold_rate:    parseFloat(smartConfig.threshold_rate),
      } : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff-rates', staffId] }); onDone() },
    onError: () => setError('Помилка збереження'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    if (!form.rate_value || parseFloat(form.rate_value) < 0) return setError('Введіть суму ставки')
    if (form.rate_type === 'smart') {
      if (!smartConfig.absence_threshold || !smartConfig.threshold_rate) return setError('Заповніть параметри смарт-ставки')
    }
    mutation.mutate()
  }

  const needsActivity = ['per_lesson', 'per_child', 'group_lesson', 'fixed_monthly', 'smart'].includes(form.rate_type)

  return (
    <form onSubmit={handleSubmit} className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">Нова ставка</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Категорія</label>
          <select value={form.rate_category} onChange={e => setForm(f => ({ ...f, rate_category: e.target.value as RateCategory }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="auto">Авто (від журналу)</option>
            <option value="manual">Ручна</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Тип ставки</label>
          <select value={form.rate_type} onChange={e => setForm(f => ({ ...f, rate_type: e.target.value as RateType }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            {Object.entries(RATE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        {needsActivity && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Активність</label>
            <select value={form.activity_id} onChange={e => setForm(f => ({ ...f, activity_id: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— оберіть —</option>
              {activities.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Режим значення</label>
          <select value={form.value_mode} onChange={e => setForm(f => ({ ...f, value_mode: e.target.value as ValueMode }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="fixed">Фіксована сума</option>
            <option value="percent_of_revenue">% від виручки батьків</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            {form.value_mode === 'percent_of_revenue'
              ? '% від виручки'
              : form.rate_type === 'smart' ? 'Базова ставка (B)' : 'Ставка / Сума'}
          </label>
          <input
            type="number"
            min="0"
            max={form.value_mode === 'percent_of_revenue' ? 100 : undefined}
            step={form.value_mode === 'percent_of_revenue' ? '0.1' : '0.01'}
            placeholder={form.value_mode === 'percent_of_revenue' ? '0–100' : '0.00'}
            value={form.rate_value}
            onChange={e => setForm(f => ({ ...f, rate_value: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {form.value_mode === 'percent_of_revenue' && (
            <p className="text-xs text-gray-400 mt-0.5">Система розрахує суму від нарахувань батьків за цю активність</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">% утримання</label>
          <input type="number" min="0" max="100" step="0.01" placeholder="0" value={form.deduction_pct}
            onChange={e => setForm(f => ({ ...f, deduction_pct: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Діє з</label>
          <input type="date" value={form.valid_from} onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Нотатка</label>
          <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {form.rate_type === 'smart' && (
        <div className="bg-white rounded-lg border border-blue-200 p-3 space-y-2">
          <p className="text-xs font-medium text-gray-700">Параметри смарт-ставки</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Базових занять (N)</label>
              <input type="number" min="1" value={smartConfig.base_lessons}
                onChange={e => setSmartConfig(s => ({ ...s, base_lessons: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Поріг пропусків (P)</label>
              <input type="number" min="0" value={smartConfig.absence_threshold}
                onChange={e => setSmartConfig(s => ({ ...s, absence_threshold: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Ставка при ≥P (BN)</label>
              <input type="number" min="0" step="0.01" value={smartConfig.threshold_rate}
                onChange={e => setSmartConfig(s => ({ ...s, threshold_rate: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <p className="text-xs text-gray-400">
            Нарахування 1-го числа = B × N = {(parseFloat(form.rate_value) || 0) * (parseInt(smartConfig.base_lessons) || 8)} грн.
            При пропусках ≥ {smartConfig.absence_threshold || 'P'} — виплата: {smartConfig.threshold_rate || 'BN'} грн.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending}
          className="px-4 py-2 bg-iris-600 text-white text-sm rounded-lg hover:bg-iris-700 disabled:opacity-50">
          {mutation.isPending ? '...' : 'Зберегти'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">
          Скасувати
        </button>
      </div>
    </form>
  )
}

// ── Block 2: Rates ─────────────────────────────────────────────────────────

function RatesBlock({ staffId, isAdmin }: { staffId: string; isAdmin: boolean }) {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)

  const { data: rates = [] } = useQuery({
    queryKey: ['staff-rates', staffId],
    queryFn: () => staffApi.getRates(staffId),
  })

  const { data: activities = [] } = useQuery({
    queryKey: ['activities-list'],
    queryFn: () => activitiesApi.list(),
    staleTime: 60_000,
  })

  const closeMutation = useMutation({
    mutationFn: (rateId: string) => staffApi.closeRate(staffId, rateId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff-rates', staffId] }),
  })

  const active   = rates.filter(r => !r.valid_to || new Date(r.valid_to) >= new Date())
  const archived = rates.filter(r => r.valid_to && new Date(r.valid_to) < new Date())

  function RateRow({ rate }: { rate: StaffRate }) {
    const isActive = !rate.valid_to || new Date(rate.valid_to) >= new Date()
    const [editing, setEditing] = useState(false)
    const [editForm, setEditForm] = useState({
      deduction_pct:    fmt(rate.deduction_pct),
      valid_to:         rate.valid_to ? String(rate.valid_to).slice(0, 10) : '',
      note:             rate.note ?? '',
      base_lessons:     String(rate.base_lessons ?? ''),
      absence_threshold: String(rate.absence_threshold ?? ''),
      threshold_rate:   rate.threshold_rate ? fmt(rate.threshold_rate) : '',
    })
    const [editError, setEditError] = useState<string | null>(null)

    const editMutation = useMutation({
      mutationFn: () => {
        const payload: Parameters<typeof staffApi.updateRate>[2] = {
          deduction_pct: parseFloat(editForm.deduction_pct) || 0,
          valid_to:      editForm.valid_to || null,
          note:          editForm.note || null,
        }
        if (rate.rate_type === 'smart' && editForm.base_lessons) {
          payload.smart_config = {
            base_lessons:      parseInt(editForm.base_lessons),
            absence_threshold: parseInt(editForm.absence_threshold),
            threshold_rate:    parseFloat(editForm.threshold_rate),
          }
        }
        return staffApi.updateRate(staffId, rate.id, payload)
      },
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: ['staff-rates', staffId] })
        setEditing(false)
        setEditError(null)
      },
      onError: () => setEditError('Помилка збереження'),
    })

    if (editing) {
      return (
        <div className="p-3 rounded-lg bg-iris-50 border border-iris-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-800">
              {RATE_TYPE_LABELS[rate.rate_type]}
              {rate.activity_name && <span className="text-iris-600 ml-1">({rate.activity_name})</span>}
            </span>
            <span className="text-xs text-gray-400 font-mono">{fmt(rate.rate_value)} грн · незмінна</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-600 mb-1">% утримання</label>
              <input type="number" min="0" max="100" step="0.01"
                value={editForm.deduction_pct}
                onChange={e => setEditForm(f => ({ ...f, deduction_pct: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Діє до (порожньо = безстроково)</label>
              <input type="date"
                value={editForm.valid_to}
                onChange={e => setEditForm(f => ({ ...f, valid_to: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-600 mb-1">Нотатка</label>
              <input value={editForm.note}
                onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
            </div>
          </div>
          {rate.rate_type === 'smart' && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Базових занять (N)</label>
                <input type="number" min="1" value={editForm.base_lessons}
                  onChange={e => setEditForm(f => ({ ...f, base_lessons: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Поріг пропусків (P)</label>
                <input type="number" min="0" value={editForm.absence_threshold}
                  onChange={e => setEditForm(f => ({ ...f, absence_threshold: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Ставка при ≥P (BN)</label>
                <input type="number" min="0" step="0.01" value={editForm.threshold_rate}
                  onChange={e => setEditForm(f => ({ ...f, threshold_rate: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
              </div>
            </div>
          )}
          {editError && <p className="text-xs text-red-600">{editError}</p>}
          <div className="flex gap-2">
            <button onClick={() => editMutation.mutate()} disabled={editMutation.isPending}
              className="px-4 py-1.5 bg-iris-600 text-white text-sm rounded-lg hover:bg-iris-700 disabled:opacity-50">
              {editMutation.isPending ? '...' : 'Зберегти'}
            </button>
            <button onClick={() => { setEditing(false); setEditError(null) }}
              className="px-4 py-1.5 text-sm text-gray-600 rounded-lg hover:bg-gray-100">
              Скасувати
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className={`flex items-start gap-3 p-3 rounded-lg ${isActive ? 'bg-white border border-gray-200' : 'bg-gray-50 border border-gray-100 opacity-60'}`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-900">{RATE_TYPE_LABELS[rate.rate_type]}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              rate.rate_category === 'auto' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'
            }`}>{RATE_CAT_LABELS[rate.rate_category]}</span>
            {rate.activity_name && (
              <span className="text-xs text-iris-600 bg-iris-50 px-1.5 py-0.5 rounded">{rate.activity_name}</span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-xs text-gray-500">
            {rate.value_mode === 'percent_of_revenue' ? (
              <span>
                <span className="font-mono font-medium text-iris-700">{fmt(rate.rate_value)}%</span>
                {' '}від виручки
              </span>
            ) : (
              <span>Ставка: <span className="font-mono font-medium text-gray-900">{fmt(rate.rate_value)}</span> грн</span>
            )}
            {Number(rate.deduction_pct) > 0 && (
              <span>Утримання: {fmt(rate.deduction_pct)}%</span>
            )}
            <span>
              {rate.valid_from.slice(0, 10)} → {rate.valid_to ? rate.valid_to.slice(0, 10) : 'зараз'}
            </span>
          </div>
          {rate.rate_type === 'smart' && rate.base_lessons !== null && (
            <div className="mt-1 text-xs text-gray-400">
              N={rate.base_lessons} · P={rate.absence_threshold} · BN={fmt(rate.threshold_rate ?? 0)}
            </div>
          )}
          {rate.note && <p className="text-xs text-gray-400 mt-0.5">{rate.note}</p>}
        </div>
        {isAdmin && (
          <div className="flex gap-2 flex-shrink-0">
            {isActive && (
              <button onClick={() => setEditing(true)}
                className="text-xs text-gray-400 hover:text-iris-600 transition-colors">
                ред.
              </button>
            )}
            {isActive && (
              <button onClick={() => { if (window.confirm('Закрити ставку (встановити valid_to = сьогодні)?')) closeMutation.mutate(rate.id) }}
                className="text-xs text-gray-300 hover:text-red-500 transition-colors">
                закрити
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Ставки та умови</h3>
        {isAdmin && !showAdd && (
          <button onClick={() => setShowAdd(true)}
            className="text-sm text-iris-600 hover:text-iris-800 font-medium transition-colors">
            + Нова ставка
          </button>
        )}
      </div>

      {showAdd && <AddRateForm staffId={staffId} activities={activities} onDone={() => setShowAdd(false)} />}

      {active.length === 0 && !showAdd && (
        <p className="text-sm text-gray-400">Ставок не налаштовано</p>
      )}

      <div className="space-y-2">
        {active.map(r => <RateRow key={r.id} rate={r} />)}
      </div>

      {archived.length > 0 && (
        <details className="mt-2">
          <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
            Архів ставок ({archived.length})
          </summary>
          <div className="space-y-2 mt-2">
            {archived.map(r => <RateRow key={r.id} rate={r} />)}
          </div>
        </details>
      )}
    </div>
  )
}

// ── Pay Form ───────────────────────────────────────────────────────────────

export function PayForm({ staffId, onDone, initialDate }: { staffId: string; onDone: () => void; initialDate?: string }) {
  const qc = useQueryClient()
  const today = todayStr()
  const [form, setForm] = useState({ gross_amount: '', transaction_date: initialDate ?? today, billing_month: '', account_id: '', note: '' })
  const [error, setError] = useState<string | null>(null)

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => import('../../api/accounts.api').then(m => m.accountsApi.list()),
  })

  const mutation = useMutation({
    mutationFn: () => staffApi.pay(staffId, {
      gross_amount:     parseFloat(form.gross_amount),
      transaction_date: form.transaction_date,
      billing_month:    form.billing_month || undefined,
      account_id:       form.account_id || undefined,
      note:             form.note || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['salary', staffId] }); onDone() },
    onError: () => setError('Помилка збереження'),
  })

  return (
    <form onSubmit={e => { e.preventDefault(); setError(null); mutation.mutate() }}
      className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">Виплата ЗП</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Сума *</label>
          <input type="number" min="0.01" step="0.01" placeholder="0.00" value={form.gross_amount}
            onChange={e => setForm(f => ({ ...f, gross_amount: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Дата виплати</label>
          <input type="date" value={form.transaction_date}
            onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Рахунок списання</label>
          <select value={form.account_id} onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">— не вказано —</option>
            {accounts.filter(a => a.is_active).map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Період (місяць, необов.)</label>
          <input type="month" value={form.billing_month}
            onChange={e => setForm(f => ({ ...f, billing_month: e.target.value ? e.target.value + '-01' : '' }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Нотатка</label>
          <input value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            placeholder="За травень 2026..."
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending || !form.gross_amount}
          className="px-4 py-2 bg-green-700 text-white text-sm rounded-lg hover:bg-green-800 disabled:opacity-50">
          {mutation.isPending ? '...' : 'Виплатити'}
        </button>
        <button type="button" onClick={onDone} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">
          Скасувати
        </button>
      </div>
    </form>
  )
}

// ── Manual Accrual Form ────────────────────────────────────────────────────

const QUANTITY_LABEL: Partial<Record<RateType, string>> = {
  hourly:       'Годин',
  per_lesson:   'Занять',
  per_child:    'Дітей',
  group_lesson: 'Занять',
}


export function ManualAccrualForm({ staffId, rates, onDone, initialDate, initialRateId }: {
  staffId: string
  rates: StaffRate[]
  onDone: () => void
  initialDate?: string
  initialRateId?: string
}) {
  const qc = useQueryClient()
  const today = todayStr()
  const [form, setForm] = useState({
    rate_id:          initialRateId ?? '',
    quantity:         '',
    gross_amount:     '',
    deduction_pct:    '0',
    transaction_date: initialDate ?? today,
    note:             '',
  })
  const [error, setError] = useState<string | null>(null)

  const manualRates = rates.filter(r => 
    r.rate_category === 'manual' && 
    r.valid_from <= form.transaction_date && 
    (!r.valid_to || r.valid_to > form.transaction_date)
  )

  useEffect(() => {
    if (manualRates.length > 0 && !manualRates.find(r => r.id === form.rate_id)) {
      const fallback = initialRateId && manualRates.find(r => r.id === initialRateId) 
        ? manualRates.find(r => r.id === initialRateId)! 
        : manualRates[0]
      setForm(f => ({ ...f, rate_id: fallback.id, deduction_pct: fmt(fallback.deduction_pct) }))
    } else if (form.rate_id === '' && manualRates.length > 0) {
      const fallback = manualRates[0]
      setForm(f => ({ ...f, rate_id: fallback.id, deduction_pct: fmt(fallback.deduction_pct) }))
    }
  }, [form.transaction_date, rates])

  const selectedRate    = rates.find(r => r.id === form.rate_id)
  const isPctMode       = selectedRate?.value_mode === 'percent_of_revenue'
  const usesQuantity    = !isPctMode && selectedRate && (selectedRate.rate_type in QUANTITY_LABEL)

  const computedGross = (() => {
    const q = parseFloat(form.quantity)
    if (!selectedRate || form.quantity === '' || isNaN(q) || q < 0) return null
    if (isPctMode)    return Math.round(q * Number(selectedRate.rate_value) / 100 * 100) / 100
    if (usesQuantity) return Math.round(q * Number(selectedRate.rate_value) * 100) / 100
    return null
  })()

  const isValid = (usesQuantity || isPctMode)
    ? form.quantity !== '' && !isNaN(parseFloat(form.quantity)) && parseFloat(form.quantity) >= 0
    : form.gross_amount !== '' && !isNaN(parseFloat(form.gross_amount)) && parseFloat(form.gross_amount) >= 0

  const mutation = useMutation({
    mutationFn: () => staffApi.addManualAccrual(staffId, {
      rate_id:          form.rate_id || undefined,
      ...((usesQuantity || isPctMode)
        ? { quantity: parseFloat(form.quantity) }
        : { gross_amount: parseFloat(form.gross_amount) }
      ),
      deduction_pct:    parseFloat(form.deduction_pct) || 0,
      transaction_date: form.transaction_date,
      note:             form.note || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['salary', staffId] }); onDone() },
    onError: () => setError('Помилка збереження'),
  })

  function handleRateChange(rateId: string) {
    const rate = rates.find(r => r.id === rateId)
    setForm(f => ({
      ...f,
      rate_id:       rateId,
      quantity:      '',
      gross_amount:  '',
      deduction_pct: rate ? fmt(rate.deduction_pct) : '0',
    }))
  }

  return (
    <form onSubmit={e => { e.preventDefault(); setError(null); mutation.mutate() }}
      className="bg-iris-50 border border-iris-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">Ручне нарахування</h3>
      <div className="grid grid-cols-2 gap-3">
        {manualRates.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Ставка</label>
            <select value={form.rate_id} onChange={e => handleRateChange(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500">
              <option value="">— без прив'язки —</option>
              {manualRates.map(r => (
                <option key={r.id} value={r.id}>
                  {RATE_TYPE_LABELS[r.rate_type]} {r.activity_name ? `(${r.activity_name})` : ''}
                  {' — '}{Number(r.rate_value).toFixed(2)} грн
                </option>
              ))}
            </select>
          </div>
        )}

        {isPctMode ? (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Виручка (база, грн) × {Number(selectedRate.rate_value).toFixed(1)}% *
            </label>
            <input type="number" min="0" step="0.01" placeholder="0.00"
              value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
            {computedGross !== null && (
              <p className="text-xs text-gray-500 mt-0.5">= {computedGross.toFixed(2)} грн</p>
            )}
          </div>
        ) : usesQuantity ? (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {QUANTITY_LABEL[selectedRate.rate_type as RateType]} × {Number(selectedRate.rate_value).toFixed(2)} грн *
            </label>
            <input type="number" min="0" step="0.01" placeholder="0"
              value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
            {computedGross !== null && (
              <p className="text-xs text-gray-500 mt-0.5">= {computedGross.toFixed(2)} грн</p>
            )}
          </div>
        ) : (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Сума (gross) *</label>
            <input type="number" min="0" step="0.01" placeholder="0.00"
              value={form.gross_amount}
              onChange={e => setForm(f => ({ ...f, gross_amount: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">% утримання</label>
          <input type="number" min="0" max="100" step="0.01" value={form.deduction_pct}
            onChange={e => setForm(f => ({ ...f, deduction_pct: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Дата</label>
          <input type="date" value={form.transaction_date}
            onChange={e => setForm(f => ({ ...f, transaction_date: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Нотатка</label>
          <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending || !isValid}
          className="px-4 py-2 bg-iris-600 text-white text-sm rounded-lg hover:bg-iris-700 disabled:opacity-50">
          {mutation.isPending ? '...' : 'Додати'}
        </button>
        <button type="button" onClick={onDone} className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">
          Скасувати
        </button>
      </div>
    </form>
  )
}

// ── Block 3: Financial History (calendar grid) ─────────────────────────────

function FinancialHistoryBlock({ staffId, isAdmin }: { staffId: string; isAdmin: boolean }) {
  const currentMonth = localMonthStr()
  const [month, setMonth] = useState(currentMonth)
  const [selectedTx, setSelectedTx] = useState<SalaryTransaction | null>(null)
  const [selectedTxGroup, setSelectedTxGroup] = useState<SalaryTransaction[] | null>(null)
  const [selectedAccrualGroup, setSelectedAccrualGroup] = useState<SalaryTransaction[] | null>(null)
  const [showPay, setShowPay]             = useState(false)
  const [showManual, setShowManual]       = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['salary', staffId, month],
    queryFn: () => staffApi.getSalary(staffId, month),
  })

  const { data: rates = [] } = useQuery({
    queryKey: ['staff-rates', staffId],
    queryFn: () => staffApi.getRates(staffId),
  })

  const txs     = data?.transactions ?? []
  const summary = data?.summary ?? { gross: 0, deduction: 0, net: 0, paid: 0, balance: 0 }
  const days    = daysInMonth(month)

  // Build grid: rows = unique activities, cols = days
  const activities = useMemo(() => {
    const seen = new Map<string, string>()
    seen.set('', 'Загальне')
    for (const tx of txs) {
      if (tx.type === 'PAYMENT') continue
      const key = tx.activity_id ?? ''
      if (!seen.has(key)) seen.set(key, tx.activity_name ?? 'Невідома')
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }))
  }, [txs])

  // Map: activityId → day → transactions[]
  const grid = useMemo(() => {
    const map = new Map<string, Map<number, SalaryTransaction[]>>()
    for (const tx of txs) {
      if (tx.type === 'PAYMENT') continue
      const actKey = tx.activity_id ?? ''
      if (!map.has(actKey)) map.set(actKey, new Map())
      const day = new Date(tx.transaction_date).getUTCDate()
      const dayMap = map.get(actKey)!
      if (!dayMap.has(day)) dayMap.set(day, [])
      dayMap.get(day)!.push(tx)
    }
    return map
  }, [txs])

  const payments = txs.filter(t => t.type === 'PAYMENT')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
      {/* Header with month nav */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Фінансова Iсторія</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth(m => monthNav(m, -1))} className="text-gray-400 hover:text-gray-700 px-2 py-1">←</button>
          <span className="text-sm font-medium text-gray-800 min-w-[90px] text-center">
            {new Date(month + '-01').toLocaleString('uk', { month: 'long', year: 'numeric' })}
          </span>
          <button onClick={() => setMonth(m => monthNav(m, 1))} disabled={month >= currentMonth}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-30 px-2 py-1">→</button>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {!showManual && !showPay && (
              <>
                <button onClick={() => setShowManual(true)}
                  className="text-xs px-3 py-1.5 border border-iris-200 text-iris-600 rounded-lg hover:bg-iris-50">
                  + Нарахування
                </button>
                <button onClick={() => setShowPay(true)}
                  className="text-xs px-3 py-1.5 bg-green-700 text-white rounded-lg hover:bg-green-800">
                  Виплатити ЗП
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {showPay && <PayForm staffId={staffId} onDone={() => setShowPay(false)} />}
      {showManual && <ManualAccrualForm staffId={staffId} rates={rates} onDone={() => setShowManual(false)} />}
      
      {selectedTx && (
        <TxPopup
          tx={selectedTx}
          staffId={staffId}
          onClose={() => setSelectedTx(null)}
        />
      )}
      
      {selectedTxGroup && (
        <PaymentGroupPopup
          txs={selectedTxGroup}
          staffId={staffId}
          onClose={() => setSelectedTxGroup(null)}
        />
      )}
      
      {selectedAccrualGroup && (
        <AccrualGroupPopup
          txs={selectedAccrualGroup}
          onClose={() => setSelectedAccrualGroup(null)}
          onSelectTx={(tx) => {
            setSelectedAccrualGroup(null)
            setSelectedTx(tx)
          }}
        />
      )}

      {isLoading ? (
        <div className="py-8 text-center text-sm text-gray-400">Завантаження...</div>
      ) : (
        <>
          {/* Calendar grid */}
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse min-w-full">
              <thead>
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium text-gray-600 min-w-[140px] border-b border-gray-200">
                    Активність
                  </th>
                  {Array.from({ length: days }, (_, i) => i + 1).map(d => (
                    <th key={d} className="px-1 py-1.5 font-medium text-gray-400 min-w-[28px] text-center border-b border-gray-200">
                      {d}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 font-medium text-gray-600 border-b border-gray-200 text-right">Разом</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activities.map(({ id: actId, name: actName }) => {
                  const dayMap = grid.get(actId) ?? new Map<number, SalaryTransaction[]>()
                  let rowTotal = 0
                  return (
                    <tr key={actId} className="hover:bg-gray-50">
                      <td className="px-2 py-1.5 text-gray-700 font-medium whitespace-nowrap">{actName}</td>
                      {Array.from({ length: days }, (_, i) => i + 1).map(d => {
                        const cellTxs = dayMap.get(d) ?? []
                        const cellNet = cellTxs.reduce((s, t) => {
                          const gross = Number(t.gross_amount)
                          const ded = Math.round(gross * Number(t.deduction_pct) / 100 * 100) / 100
                          return s + gross - ded
                        }, 0)
                        if (cellNet) rowTotal += cellNet
                        return (
                          <td key={d} className="px-0.5 py-1 text-center">
                            {cellTxs.length > 0 ? (
                              <button
                                onClick={() => cellTxs.length === 1 ? setSelectedTx(cellTxs[0]) : setSelectedAccrualGroup(cellTxs)}
                                className={`w-full rounded px-0.5 py-0.5 font-mono transition-colors ${
                                  cellTxs.some(t => t.type === 'CORRECTION')
                                    ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                    : 'bg-iris-50 text-iris-700 hover:bg-iris-100'
                                }`}
                                title={cellTxs.map(t => {
                                  const g = Number(t.gross_amount)
                                  const d = Math.round(g * Number(t.deduction_pct) / 100 * 100) / 100
                                  return `${TX_TYPE_LABELS[t.type]}: ${fmt(g - d)} (gross ${fmt(g)})`
                                }).join('\n')}
                              >
                                {cellNet % 1 === 0 ? cellNet : cellNet.toFixed(0)}
                              </button>
                            ) : (
                              <span className="text-gray-200">·</span>
                            )}
                          </td>
                        )
                      })}
                      <td className="px-2 py-1.5 text-right font-mono text-gray-700">
                        {rowTotal > 0 ? fmt(rowTotal) : '—'}
                      </td>
                    </tr>
                  )
                })}

                {/* Payments row */}
                {payments.length > 0 && (
                  <tr className="bg-green-50/40">
                    <td className="px-2 py-1.5 text-green-700 font-medium">Виплати</td>
                    {Array.from({ length: days }, (_, i) => i + 1).map(d => {
                      const dayPays = payments.filter(p => new Date(p.transaction_date).getUTCDate() === d)
                      const total = dayPays.reduce((s, p) => s + Number(p.gross_amount), 0)
                      return (
                        <td key={d} className="px-0.5 py-1 text-center">
                          {total > 0 ? (
                            <button
                              onClick={() => dayPays.length === 1 ? setSelectedTx(dayPays[0]) : setSelectedTxGroup(dayPays)}
                              className="w-full rounded px-0.5 py-0.5 font-mono bg-green-100 text-green-800 hover:bg-green-200">
                              {total % 1 === 0 ? total : total.toFixed(0)}
                            </button>
                          ) : <span className="text-gray-200">·</span>}
                        </td>
                      )
                    })}
                    <td className="px-2 py-1.5 text-right font-mono text-green-700">
                      {fmt(payments.reduce((s, p) => s + Number(p.gross_amount), 0))}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-5 gap-3 pt-2 border-t border-gray-100">
            {[
              { label: 'Нараховано (gross)', value: summary.gross, color: 'text-gray-900' },
              { label: 'Утримання', value: -summary.deduction, color: 'text-red-600' },
              { label: 'До виплати (net)', value: summary.net, color: 'text-iris-700 font-semibold' },
              { label: 'Виплачено', value: summary.paid, color: 'text-green-700' },
              { label: 'Залишок', value: summary.balance, color: summary.balance > 0 ? 'text-amber-700 font-semibold' : 'text-gray-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center">
                <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                <p className={`text-sm font-mono ${color}`}>
                  {value < 0 ? '−' : ''}{fmt(Math.abs(value))}
                </p>
              </div>
            ))}
          </div>
        </>
      )}

    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────

export function StaffCardPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isAdmin = useCanAccess('owner', 'admin')

  const { data: staff, isLoading } = useQuery({
    queryKey: ['staff', id],
    queryFn: () => staffApi.get(id!),
    enabled: !!id,
  })

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
  if (!staff)   return <div className="py-12 text-center text-sm text-gray-400">Не знайдено</div>

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/staff')} className="text-gray-400 hover:text-gray-600 text-sm">← Персонал</button>
      </div>

      <StaffInfoBlock staff={staff} />
      <RatesBlock staffId={staff.id} isAdmin={isAdmin} />
      <FinancialHistoryBlock staffId={staff.id} isAdmin={isAdmin} />
    </div>
  )
}
