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
  DailyMarkDialog,
  VacationMarkDialog,
  dailyRate,
  workingDaysInMonth,
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

function AddRateForm({ staffId, activities, allRates, onDone }: {
  staffId: string
  activities: { id: string; name: string }[]
  allRates: StaffRate[]
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
  const [smartPCConfig, setSmartPCConfig] = useState({
    starter_rate:         '',
    attendance_threshold: '5',
    threshold_rate:       '',
    base_lessons:         '8',
    extra_lesson_price:   '0',
    trial_lesson_price:   '0',
  })
  const [vacationConfig, setVacationConfig] = useState({
    monthly_base_salary:   '',
    vacation_days_limit:   '24',
    period_start_date:     '',
    period_end_date:       '',
    calculation_base_type: 'CALENDAR_DAYS' as 'CALENDAR_DAYS' | 'WORKING_DAYS',
    salary_calc_mode:      'fixed' as 'fixed' | 'actual',
    included_rate_ids:     [] as string[],
  })
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => staffApi.createRate(staffId, {
      activity_id:   form.activity_id || undefined,
      rate_category: (form.rate_type === 'monthly_by_day' || form.rate_type === 'vacation') ? 'manual' : form.rate_category,
      rate_type:     form.rate_type,
      value_mode:    (form.rate_type === 'monthly_by_day' || form.rate_type === 'vacation') ? 'fixed' : form.value_mode,
      rate_value:    (form.rate_type === 'smart_per_child' || form.rate_type === 'vacation') ? 0 : parseFloat(form.rate_value),
      deduction_pct: parseFloat(form.deduction_pct) || 0,
      valid_from:    form.valid_from,
      note:          form.note || undefined,
      smart_config:  form.rate_type === 'smart' ? {
        base_lessons:      parseInt(smartConfig.base_lessons) || 8,
        absence_threshold: parseInt(smartConfig.absence_threshold),
        threshold_rate:    parseFloat(smartConfig.threshold_rate),
      } : form.rate_type === 'smart_per_child' ? {
        base_lessons:         parseInt(smartPCConfig.base_lessons) || 8,
        absence_threshold:    0,
        threshold_rate:       parseFloat(smartPCConfig.threshold_rate),
        attendance_threshold: parseInt(smartPCConfig.attendance_threshold) || 5,
        starter_rate:         parseFloat(smartPCConfig.starter_rate),
        extra_lesson_price:   parseFloat(smartPCConfig.extra_lesson_price) || 0,
        trial_lesson_price:   parseFloat(smartPCConfig.trial_lesson_price) || 0,
      } : undefined,
      vacation_config: form.rate_type === 'vacation' ? {
        monthly_base_salary:   parseFloat(vacationConfig.monthly_base_salary) || 0,
        vacation_days_limit:   parseInt(vacationConfig.vacation_days_limit) || 24,
        period_start_date:     vacationConfig.period_start_date,
        period_end_date:       vacationConfig.period_end_date,
        calculation_base_type: vacationConfig.calculation_base_type,
        salary_calc_mode:      vacationConfig.salary_calc_mode,
        included_rate_ids:     vacationConfig.salary_calc_mode === 'actual' ? vacationConfig.included_rate_ids : undefined,
      } : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['staff-rates', staffId] }); onDone() },
    onError: () => setError('Помилка збереження'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null)
    if (form.rate_type !== 'smart_per_child' && form.rate_type !== 'vacation' && (!form.rate_value || parseFloat(form.rate_value) < 0)) return setError('Введіть суму ставки')
    if (form.rate_type === 'smart') {
      if (!smartConfig.absence_threshold || !smartConfig.threshold_rate) return setError('Заповніть параметри смарт-ставки')
    }
    if (form.rate_type === 'smart_per_child') {
      if (!smartPCConfig.starter_rate || !smartPCConfig.threshold_rate) return setError('Заповніть стартову та базову ставку')
      if (!smartPCConfig.attendance_threshold) return setError('Вкажіть мінімальну кількість відвідувань (поріг)')
    }
    if (form.rate_type === 'vacation') {
      if (!vacationConfig.period_start_date || !vacationConfig.period_end_date) return setError('Вкажіть розрахунковий період')
      if (vacationConfig.period_start_date >= vacationConfig.period_end_date) return setError('Кінець періоду має бути пізніше початку')
      if (vacationConfig.salary_calc_mode === 'fixed' && (!vacationConfig.monthly_base_salary || parseFloat(vacationConfig.monthly_base_salary) <= 0)) return setError('Введіть базовий оклад')
      if (vacationConfig.salary_calc_mode === 'actual' && vacationConfig.included_rate_ids.length === 0) return setError('Оберіть хоча б одну ставку для розрахунку')
    }
    mutation.mutate()
  }

  const needsActivity    = ['per_lesson', 'per_child', 'group_lesson', 'fixed_monthly', 'smart', 'smart_per_child'].includes(form.rate_type)
  const isSmartPC        = form.rate_type === 'smart_per_child'
  const isMonthlyByDay   = form.rate_type === 'monthly_by_day'
  const isVacation       = form.rate_type === 'vacation'

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
        {!isSmartPC && !isMonthlyByDay && !isVacation && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Режим значення</label>
            <select value={form.value_mode} onChange={e => setForm(f => ({ ...f, value_mode: e.target.value as ValueMode }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="fixed">Фіксована сума</option>
              <option value="percent_of_revenue">% від виручки батьків</option>
            </select>
          </div>
        )}
        {!isSmartPC && !isVacation && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {isMonthlyByDay
                ? 'Ставка за місяць (грн)'
                : form.value_mode === 'percent_of_revenue'
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
            {isMonthlyByDay && form.rate_value && (() => {
              const wd = workingDaysInMonth(form.valid_from)
              const dr = Math.round(parseFloat(form.rate_value) / wd * 100) / 100
              return <p className="text-xs text-gray-400 mt-0.5">≈ {fmt(dr)} грн/день ({wd} роб. днів у місяці)</p>
            })()}
            {!isMonthlyByDay && form.value_mode === 'percent_of_revenue' && (
              <p className="text-xs text-gray-400 mt-0.5">Система розрахує суму від нарахувань батьків за цю активність</p>
            )}
          </div>
        )}
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
          <p className="text-xs font-medium text-gray-700">Параметри смарт-ставки (за пропусками)</p>
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

      {form.rate_type === 'smart_per_child' && (
        <div className="bg-white rounded-lg border border-blue-200 p-3 space-y-2">
          <p className="text-xs font-medium text-gray-700">Параметри «Смарт за дитину»</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Стартова ставка (грн)</label>
              <input type="number" min="0" step="0.01" placeholder="1000" value={smartPCConfig.starter_rate}
                onChange={e => setSmartPCConfig(s => ({ ...s, starter_rate: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-gray-400 mt-0.5">1 до (поріг-1) відвідувань</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Мін. відвідувань (поріг)</label>
              <input type="number" min="1" placeholder="5" value={smartPCConfig.attendance_threshold}
                onChange={e => setSmartPCConfig(s => ({ ...s, attendance_threshold: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-gray-400 mt-0.5">Перехід на базову ставку</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Базова ставка (грн)</label>
              <input type="number" min="0" step="0.01" placeholder="2000" value={smartPCConfig.threshold_rate}
                onChange={e => setSmartPCConfig(s => ({ ...s, threshold_rate: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-gray-400 mt-0.5">Від порогу до базових занять</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Базових занять</label>
              <input type="number" min="1" placeholder="8" value={smartPCConfig.base_lessons}
                onChange={e => setSmartPCConfig(s => ({ ...s, base_lessons: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-gray-400 mt-0.5">Стеля базової ставки</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Ціна за надпл. заняття</label>
              <input type="number" min="0" step="0.01" placeholder="250" value={smartPCConfig.extra_lesson_price}
                onChange={e => setSmartPCConfig(s => ({ ...s, extra_lesson_price: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-gray-400 mt-0.5">Після базових занять</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Ціна за пробне заняття</label>
              <input type="number" min="0" step="0.01" placeholder="0" value={smartPCConfig.trial_lesson_price}
                onChange={e => setSmartPCConfig(s => ({ ...s, trial_lesson_price: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-gray-400 mt-0.5">Відмітки з ручною ціною (&lt;{smartPCConfig.attendance_threshold||5} відв.)</p>
            </div>
          </div>
          <p className="text-xs text-gray-400 bg-gray-50 rounded p-2">
            Пробний режим (&lt;{smartPCConfig.attendance_threshold||5} відм. з ціною): {smartPCConfig.trial_lesson_price||0} грн/відм. ·
            {' '}Стандарт (≥{smartPCConfig.attendance_threshold||5}): 1–{(parseInt(smartPCConfig.attendance_threshold)||5)-1} відв → {smartPCConfig.starter_rate||'Старт'} грн ·
            {' '}{smartPCConfig.attendance_threshold||5}–{smartPCConfig.base_lessons||8} → {smartPCConfig.threshold_rate||'База'} грн ·
            {' '}&gt;{smartPCConfig.base_lessons||8} → {smartPCConfig.threshold_rate||'База'} + N×{smartPCConfig.extra_lesson_price||0} грн
          </p>
        </div>
      )}

      {isVacation && (
        <div className="bg-white rounded-lg border border-blue-200 p-3 space-y-3">
          <p className="text-xs font-medium text-gray-700">Параметри ставки «Відпустка»</p>

          {/* Режим расчёта */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">Режим розрахунку ставки/день</label>
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
              {(['fixed', 'actual'] as const).map(m => (
                <button key={m} type="button"
                  onClick={() => setVacationConfig(s => ({ ...s, salary_calc_mode: m }))}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                    vacationConfig.salary_calc_mode === m
                      ? 'bg-white text-iris-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {m === 'fixed' ? 'Фіксований оклад' : 'За фактичними нарахуваннями'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Базовий оклад — показывается всегда (обязателен для fixed, опционален для actual) */}
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Базовий оклад (грн/міс){vacationConfig.salary_calc_mode === 'actual' && <span className="text-gray-400 ml-1">— резервний</span>}
              </label>
              <input type="number" min="0" step="0.01" placeholder="20000.00"
                value={vacationConfig.monthly_base_salary}
                onChange={e => setVacationConfig(s => ({ ...s, monthly_base_salary: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Ліміт днів на рік</label>
              <input type="number" min="1" step="1" placeholder="24"
                value={vacationConfig.vacation_days_limit}
                onChange={e => setVacationConfig(s => ({ ...s, vacation_days_limit: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Початок розрахункового періоду</label>
              <input type="date" value={vacationConfig.period_start_date}
                onChange={e => setVacationConfig(s => ({ ...s, period_start_date: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-gray-400 mt-0.5">1-е число місяця</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Кінець розрахункового періоду</label>
              <input type="date" value={vacationConfig.period_end_date}
                onChange={e => setVacationConfig(s => ({ ...s, period_end_date: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-xs text-gray-400 mt-0.5">Останній день місяця</p>
            </div>

            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">База розрахунку днів</label>
              <div className="flex gap-3">
                {(['CALENDAR_DAYS', 'WORKING_DAYS'] as const).map(v => (
                  <label key={v} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="calc_base_type" value={v}
                      checked={vacationConfig.calculation_base_type === v}
                      onChange={() => setVacationConfig(s => ({ ...s, calculation_base_type: v }))}
                    />
                    {v === 'CALENDAR_DAYS' ? 'Календарні дні' : 'Робочі дні (Пн–Пт)'}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Список ставок для actual режима */}
          {vacationConfig.salary_calc_mode === 'actual' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Ставки для розрахунку середньої ЗП <span className="text-red-500">*</span>
              </label>
              <div className="space-y-1 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2">
                {allRates.filter(r => r.rate_type !== 'vacation').length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Немає доступних ставок</p>
                ) : allRates.filter(r => r.rate_type !== 'vacation').map(r => {
                  const checked = vacationConfig.included_rate_ids.includes(r.id)
                  const isActive = !r.valid_to || new Date(r.valid_to) >= new Date()
                  return (
                    <label key={r.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                      <input type="checkbox" checked={checked}
                        onChange={e => {
                          const ids = e.target.checked
                            ? [...vacationConfig.included_rate_ids, r.id]
                            : vacationConfig.included_rate_ids.filter(id => id !== r.id)
                          setVacationConfig(s => ({ ...s, included_rate_ids: ids }))
                        }}
                      />
                      <span className={isActive ? 'text-gray-800' : 'text-gray-400'}>
                        {RATE_TYPE_LABELS[r.rate_type]}
                        {r.activity_name ? ` (${r.activity_name})` : ''}
                        {' — '}{r.valid_from.slice(0, 10)}{r.valid_to ? ` → ${r.valid_to.slice(0, 10)}` : ' (активна)'}
                      </span>
                    </label>
                  )
                })}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                Система підсумує ACCRUAL + CORRECTION за вибраними ставками у вказаному періоді.
              </p>
            </div>
          )}

          {vacationConfig.period_start_date && vacationConfig.period_end_date && (() => {
            const start  = new Date(vacationConfig.period_start_date + 'T00:00:00')
            const end    = new Date(vacationConfig.period_end_date + 'T00:00:00')
            const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1
            return months > 0 ? (
              <p className="text-xs text-gray-400">
                Розрахунковий період: {months} міс. · Ставка за день розраховується автоматично при збереженні.
              </p>
            ) : null
          })()}
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

// ── Vacation History ───────────────────────────────────────────────────────

interface VacationPeriod {
  date_from:  string
  date_to:    string
  days:       number
  total:      number
}

function groupConsecutivePeriods(
  txs: { date: string; gross_amount: number }[],
): VacationPeriod[] {
  if (!txs.length) return []
  const sorted = [...txs].sort((a, b) => a.date.localeCompare(b.date))
  const result: VacationPeriod[] = []
  let start = sorted[0].date
  let end   = sorted[0].date
  let total = sorted[0].gross_amount
  let days  = 1

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(end       + 'T00:00:00')
    const curr = new Date(sorted[i].date + 'T00:00:00')
    if (Math.round((curr.getTime() - prev.getTime()) / 86400000) === 1) {
      end    = sorted[i].date
      total += sorted[i].gross_amount
      days++
    } else {
      result.push({ date_from: start, date_to: end, days, total: Math.round(total * 100) / 100 })
      start = sorted[i].date
      end   = sorted[i].date
      total = sorted[i].gross_amount
      days  = 1
    }
  }
  result.push({ date_from: start, date_to: end, days, total: Math.round(total * 100) / 100 })
  return result.reverse() // newest first
}

function VacationHistorySection({ staffId }: { staffId: string }) {
  const year = new Date().getFullYear()
  const [expanded,  setExpanded]  = useState(false)
  const [dateFrom,  setDateFrom]  = useState(`${year}-01-01`)
  const [dateTo,    setDateTo]    = useState(`${year}-12-31`)

  const { data = [], isFetching } = useQuery({
    queryKey: ['vacation-history', staffId, dateFrom, dateTo],
    queryFn:  () => staffApi.getVacationHistory(staffId, { date_from: dateFrom, date_to: dateTo }),
    enabled:  expanded,
    staleTime: 30_000,
  })

  const periods   = groupConsecutivePeriods(data)
  const totalDays = data.length
  const totalSum  = Math.round(data.reduce((s, r) => s + r.gross_amount, 0) * 100) / 100

  function fmtDate(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' })
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1 text-xs text-iris-600 hover:text-iris-800 transition-colors"
      >
        <span>{expanded ? '▾' : '▸'}</span>
        <span>Історія відпусток</span>
      </button>

      {expanded && (
        <div className="mt-2 border border-gray-100 rounded-lg bg-gray-50 p-3 space-y-3">
          {/* Date range filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Період:</span>
            <input type="date" value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-iris-400"
            />
            <span className="text-xs text-gray-400">—</span>
            <input type="date" value={dateTo} min={dateFrom}
              onChange={e => setDateTo(e.target.value)}
              className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-iris-400"
            />
            {isFetching && <span className="text-xs text-gray-400">...</span>}
          </div>

          {/* Results */}
          {!isFetching && periods.length === 0 && (
            <p className="text-xs text-gray-400 italic">Відпускних нарахувань за цей період немає</p>
          )}

          {periods.length > 0 && (
            <>
              <div className="space-y-1">
                {periods.map((p, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-gray-700">
                      {fmtDate(p.date_from)}
                      {p.date_from !== p.date_to && <> — {fmtDate(p.date_to)}</>}
                      <span className="text-gray-400 ml-1">({p.days} {p.days === 1 ? 'день' : p.days < 5 ? 'дні' : 'днів'})</span>
                    </span>
                    <span className="font-mono text-iris-700 font-medium">{fmt(p.total)} грн</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-1.5 border-t border-gray-200 text-xs font-medium">
                <span className="text-gray-600">Разом: {totalDays} дн.</span>
                <span className="font-mono text-iris-800">{fmt(totalSum)} грн</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
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
    const currentYear = new Date().getFullYear()

    const { data: vacDays } = useQuery({
      queryKey: ['vacation-days', staffId, currentYear],
      queryFn:  () => staffApi.getVacationDays(staffId, currentYear),
      enabled:  rate.rate_type === 'vacation' && isActive,
      staleTime: 60_000,
    })
    const [editForm, setEditForm] = useState({
      deduction_pct:      fmt(rate.deduction_pct),
      valid_to:           rate.valid_to ? String(rate.valid_to).slice(0, 10) : '',
      note:               rate.note ?? '',
      base_lessons:       String(rate.base_lessons ?? ''),
      absence_threshold:  String(rate.absence_threshold ?? ''),
      threshold_rate:     rate.threshold_rate ? fmt(rate.threshold_rate) : '',
      attendance_threshold: String(rate.attendance_threshold ?? '5'),
      starter_rate:       rate.starter_rate ? fmt(rate.starter_rate) : '',
      extra_lesson_price: rate.extra_lesson_price ? fmt(rate.extra_lesson_price) : '0',
      trial_lesson_price: rate.trial_lesson_price ? fmt(rate.trial_lesson_price) : '0',
      // vacation
      vac_monthly_base_salary:   rate.monthly_base_salary ? fmt(rate.monthly_base_salary) : '',
      vac_vacation_days_limit:   String(rate.vacation_days_limit ?? '24'),
      vac_period_start_date:     rate.period_start_date ? String(rate.period_start_date).slice(0, 10) : '',
      vac_period_end_date:       rate.period_end_date ? String(rate.period_end_date).slice(0, 10) : '',
      vac_calculation_base_type: (rate.calculation_base_type ?? 'CALENDAR_DAYS') as 'CALENDAR_DAYS' | 'WORKING_DAYS',
      vac_salary_calc_mode:      (rate.salary_calc_mode ?? 'fixed') as 'fixed' | 'actual',
      vac_included_rate_ids:     (rate.included_rate_ids ?? []) as string[],
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
        if (rate.rate_type === 'smart_per_child' && editForm.base_lessons) {
          payload.smart_config = {
            base_lessons:         parseInt(editForm.base_lessons),
            absence_threshold:    0,
            threshold_rate:       parseFloat(editForm.threshold_rate),
            attendance_threshold: parseInt(editForm.attendance_threshold) || 5,
            starter_rate:         parseFloat(editForm.starter_rate) || 0,
            extra_lesson_price:   parseFloat(editForm.extra_lesson_price) || 0,
            trial_lesson_price:   parseFloat(editForm.trial_lesson_price) || 0,
          }
        }
        if (rate.rate_type === 'vacation') {
          payload.vacation_config = {
            monthly_base_salary:   parseFloat(editForm.vac_monthly_base_salary) || 0,
            vacation_days_limit:   parseInt(editForm.vac_vacation_days_limit) || undefined,
            period_start_date:     editForm.vac_period_start_date || undefined,
            period_end_date:       editForm.vac_period_end_date || undefined,
            calculation_base_type: editForm.vac_calculation_base_type,
            salary_calc_mode:      editForm.vac_salary_calc_mode,
            included_rate_ids:     editForm.vac_salary_calc_mode === 'actual' ? editForm.vac_included_rate_ids : undefined,
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
          {rate.rate_type === 'smart_per_child' && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Ціна пробного заняття</label>
                <input type="number" min="0" step="0.01" value={editForm.trial_lesson_price}
                  onChange={e => setEditForm(f => ({ ...f, trial_lesson_price: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Мін. відвідувань (поріг)</label>
                <input type="number" min="1" value={editForm.attendance_threshold}
                  onChange={e => setEditForm(f => ({ ...f, attendance_threshold: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Стартова ставка</label>
                <input type="number" min="0" step="0.01" value={editForm.starter_rate}
                  onChange={e => setEditForm(f => ({ ...f, starter_rate: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Базова ставка</label>
                <input type="number" min="0" step="0.01" value={editForm.threshold_rate}
                  onChange={e => setEditForm(f => ({ ...f, threshold_rate: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Базових занять</label>
                <input type="number" min="1" value={editForm.base_lessons}
                  onChange={e => setEditForm(f => ({ ...f, base_lessons: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Ціна надпл. заняття</label>
                <input type="number" min="0" step="0.01" value={editForm.extra_lesson_price}
                  onChange={e => setEditForm(f => ({ ...f, extra_lesson_price: e.target.value }))}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
              </div>
            </div>
          )}
          {rate.rate_type === 'vacation' && (
            <div className="space-y-2">
              {/* Переключатель режима */}
              <div>
                <label className="block text-xs text-gray-600 mb-1">Режим розрахунку</label>
                <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
                  {(['fixed', 'actual'] as const).map(m => (
                    <button key={m} type="button"
                      onClick={() => setEditForm(f => ({ ...f, vac_salary_calc_mode: m }))}
                      className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                        editForm.vac_salary_calc_mode === m
                          ? 'bg-white text-iris-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {m === 'fixed' ? 'Фіксований оклад' : 'За фактичними'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">
                    Базовий оклад (грн/міс){editForm.vac_salary_calc_mode === 'actual' && <span className="text-gray-400 ml-1">— резервний</span>}
                  </label>
                  <input type="number" min="0" step="0.01" value={editForm.vac_monthly_base_salary}
                    onChange={e => setEditForm(f => ({ ...f, vac_monthly_base_salary: e.target.value }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Ліміт днів на рік</label>
                  <input type="number" min="1" step="1" value={editForm.vac_vacation_days_limit}
                    onChange={e => setEditForm(f => ({ ...f, vac_vacation_days_limit: e.target.value }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Початок розрахункового періоду</label>
                  <input type="date" value={editForm.vac_period_start_date}
                    onChange={e => setEditForm(f => ({ ...f, vac_period_start_date: e.target.value }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Кінець розрахункового періоду</label>
                  <input type="date" value={editForm.vac_period_end_date}
                    onChange={e => setEditForm(f => ({ ...f, vac_period_end_date: e.target.value }))}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-gray-600 mb-1">База розрахунку днів</label>
                  <div className="flex gap-3">
                    {(['CALENDAR_DAYS', 'WORKING_DAYS'] as const).map(v => (
                      <label key={v} className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <input type="radio" name={`edit_calc_type_${rate.id}`}
                          value={v}
                          checked={editForm.vac_calculation_base_type === v}
                          onChange={() => setEditForm(f => ({ ...f, vac_calculation_base_type: v }))}
                        />
                        {v === 'CALENDAR_DAYS' ? 'Календарні' : 'Робочі (Пн–Пт)'}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* Список ставок для actual режима в edit */}
              {editForm.vac_salary_calc_mode === 'actual' && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Ставки для розрахунку середньої ЗП</label>
                  <div className="space-y-1 max-h-36 overflow-y-auto border border-gray-200 rounded-lg p-2">
                    {rates.filter(r => r.id !== rate.id && r.rate_type !== 'vacation').map(r => {
                      const checked  = editForm.vac_included_rate_ids.includes(r.id)
                      const isActive = !r.valid_to || new Date(r.valid_to) >= new Date()
                      return (
                        <label key={r.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                          <input type="checkbox" checked={checked}
                            onChange={e => {
                              const ids = e.target.checked
                                ? [...editForm.vac_included_rate_ids, r.id]
                                : editForm.vac_included_rate_ids.filter(id => id !== r.id)
                              setEditForm(f => ({ ...f, vac_included_rate_ids: ids }))
                            }}
                          />
                          <span className={isActive ? 'text-gray-800' : 'text-gray-400'}>
                            {RATE_TYPE_LABELS[r.rate_type]}
                            {r.activity_name ? ` (${r.activity_name})` : ''}
                            {' — '}{r.valid_from.slice(0, 10)}{r.valid_to ? ` → ${r.valid_to.slice(0, 10)}` : ' (активна)'}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )}
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
          {rate.rate_type === 'smart_per_child' && rate.base_lessons !== null && (
            <div className="mt-1 text-xs text-gray-400">
              Проб: {fmt(rate.trial_lesson_price ?? 0)} грн (&lt;{rate.attendance_threshold} відм.) · Старт: {fmt(rate.starter_rate ?? 0)} грн · Поріг: {rate.attendance_threshold} відв · База: {fmt(rate.threshold_rate ?? 0)} грн · Max: {rate.base_lessons} зан · Надпл: {fmt(rate.extra_lesson_price ?? 0)} грн/зан
            </div>
          )}
          {rate.rate_type === 'vacation' && rate.day_rate_cached !== null && (
            <div className="mt-1 text-xs text-gray-400 flex items-center gap-3 flex-wrap">
              <span>
                {rate.salary_calc_mode === 'actual'
                  ? <span className="text-amber-600 font-medium">За фактичними нарахуваннями</span>
                  : <>Оклад: {fmt(rate.monthly_base_salary ?? 0)} грн</>
                }
                {' · '}{rate.calculation_base_type === 'WORKING_DAYS' ? 'Робочі дні' : 'Календарні дні'} ·{' '}
                Ставка/день: <span className="font-semibold text-iris-700">{fmt(rate.day_rate_cached)} грн</span>
              </span>
              {vacDays !== undefined && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                  vacDays.remaining === 0
                    ? 'bg-red-100 text-red-700'
                    : vacDays.remaining <= 5
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-green-100 text-green-700'
                }`}>
                  Залишок: {vacDays.remaining} / {vacDays.limit} дн. ({currentYear})
                </span>
              )}
            </div>
          )}
          {rate.note && <p className="text-xs text-gray-400 mt-0.5">{rate.note}</p>}
          {rate.rate_type === 'vacation' && (
            <VacationHistorySection staffId={staffId} />
          )}
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

      {showAdd && <AddRateForm staffId={staffId} activities={activities} allRates={rates} onDone={() => setShowAdd(false)} />}

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
  const [form, setForm] = useState({ gross_amount: '', transaction_date: initialDate ?? today, billing_month: '', account_id: '', note: '', commission: '' })
  const [error, setError] = useState<string | null>(null)

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => import('../../api/accounts.api').then(m => m.accountsApi.list()),
  })

  const commissionAmt = parseFloat(form.commission) || 0
  const hasCommission = commissionAmt > 0

  const mutation = useMutation({
    mutationFn: () => staffApi.pay(staffId, {
      gross_amount:     parseFloat(form.gross_amount),
      transaction_date: form.transaction_date,
      billing_month:    form.billing_month || undefined,
      account_id:       form.account_id || undefined,
      note:             form.note || undefined,
      commission:       commissionAmt > 0 ? commissionAmt : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['salary', staffId] }); qc.invalidateQueries({ queryKey: ['salary-total', staffId] }); onDone() },
    onError: () => setError('Помилка збереження'),
  })

  const canSubmit = !!form.gross_amount && (!hasCommission || !!form.account_id)

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
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Комісія (грн)
            <span className="ml-1 text-gray-400 font-normal">— окремий розхід з рахунку</span>
          </label>
          <input type="number" min="0" step="0.01" placeholder="0.00" value={form.commission}
            onChange={e => setForm(f => ({ ...f, commission: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-green-500" />
          {hasCommission && !form.account_id && (
            <p className="text-xs text-amber-600 mt-1">Для запису комісії необхідно вказати рахунок списання</p>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending || !canSubmit}
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
    r.rate_type !== 'vacation' &&
    r.rate_type !== 'monthly_by_day' &&
    r.valid_from.slice(0, 10) <= form.transaction_date &&
    (!r.valid_to || r.valid_to.slice(0, 10) > form.transaction_date)
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

  const selectedRate      = rates.find(r => r.id === form.rate_id)
  const isMonthlyByDayR   = selectedRate?.rate_type === 'monthly_by_day'
  const isPctMode         = !isMonthlyByDayR && selectedRate?.value_mode === 'percent_of_revenue'
  const usesQuantity      = !isPctMode && !isMonthlyByDayR && selectedRate && (selectedRate.rate_type in QUANTITY_LABEL)

  const computedDailyRate = isMonthlyByDayR && selectedRate
    ? dailyRate(selectedRate, form.transaction_date)
    : null

  // When monthly_by_day is selected, pre-fill gross_amount with daily rate on date/rate change
  useEffect(() => {
    if (isMonthlyByDayR && computedDailyRate !== null) {
      setForm(f => ({ ...f, gross_amount: fmt(computedDailyRate) }))
    }
  }, [isMonthlyByDayR, computedDailyRate])

  const computedGross = (() => {
    const q = parseFloat(form.quantity)
    if (!selectedRate || form.quantity === '' || isNaN(q) || q < 0) return null
    if (isPctMode)    return Math.round(q * Number(selectedRate.rate_value) / 100 * 100) / 100
    if (usesQuantity) return Math.round(q * Number(selectedRate.rate_value) * 100) / 100
    return null
  })()

  const isValid = isMonthlyByDayR
    ? form.gross_amount !== '' && !isNaN(parseFloat(form.gross_amount)) && parseFloat(form.gross_amount) >= 0
    : (usesQuantity || isPctMode)
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['salary', staffId] }); qc.invalidateQueries({ queryKey: ['salary-total', staffId] }); onDone() },
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

        {isMonthlyByDayR ? (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Сума за день *
            </label>
            <input type="number" min="0" step="0.01" placeholder="0.00"
              value={form.gross_amount}
              onChange={e => setForm(f => ({ ...f, gross_amount: e.target.value }))}
              autoFocus
              onFocus={e => e.target.select()}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
            {computedDailyRate !== null && (
              <p className="text-xs text-gray-400 mt-0.5">
                Розрахункова: {fmt(computedDailyRate)} грн ({workingDaysInMonth(form.transaction_date)} роб. дн.)
              </p>
            )}
          </div>
        ) : isPctMode ? (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Виручка (база, грн) × {Number(selectedRate.rate_value).toFixed(1)}% *
            </label>
            <input type="number" min="0" step="0.01" placeholder="0.00"
              value={form.quantity}
              onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
              autoFocus
              onFocus={e => e.target.select()}
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
              autoFocus
              onFocus={e => e.target.select()}
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
              autoFocus
              onFocus={e => e.target.select()}
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
  const [recalcPending, setRecalcPending] = useState(false)
  const [dailyDialog, setDailyDialog] = useState<{
    rate: StaffRate; date: string; existingTx: SalaryTransaction | null
  } | null>(null)

  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['salary', staffId, month],
    queryFn: () => staffApi.getSalary(staffId, month),
  })

  async function handleRecalc() {
    setRecalcPending(true)
    try {
      await staffApi.recalc(staffId, month)
      await qc.invalidateQueries({ queryKey: ['salary', staffId, month] })
      qc.invalidateQueries({ queryKey: ['salary-total', staffId] })
    } finally {
      setRecalcPending(false)
    }
  }

  const { data: rates = [] } = useQuery({
    queryKey: ['staff-rates', staffId],
    queryFn: () => staffApi.getRates(staffId),
  })

  const { data: totalSummary } = useQuery({
    queryKey: ['salary-total', staffId],
    queryFn:  () => staffApi.getSalaryTotal(staffId),
    staleTime: 60_000,
  })

  const txs     = data?.transactions ?? []
  const summary = data?.summary ?? { gross: 0, deduction: 0, net: 0, paid: 0, balance: 0 }
  const days    = daysInMonth(month)

  // Active daily/vacation rates for current month — key: rowKey, value: rate
  const dailyRateMap = useMemo(() => {
    const map = new Map<string, StaffRate>()
    const monthStart = month + '-01'
    const monthEnd   = month + '-' + String(days).padStart(2, '0')
    for (const rate of rates) {
      if (rate.rate_type !== 'monthly_by_day' && rate.rate_type !== 'vacation') continue
      const rateStart = rate.valid_from.slice(0, 10)
      const rateEnd   = rate.valid_to ? rate.valid_to.slice(0, 10) : '9999-12-31'
      if (rateStart > monthEnd || rateEnd < monthStart) continue
      const rowKey = `${rate.activity_id ?? ''}::${rate.rate_type}`
      // Keep most recent active rate per rowKey
      const cur = map.get(rowKey)
      if (!cur || cur.valid_from < rate.valid_from) map.set(rowKey, rate)
    }
    return map
  }, [rates, month, days])

  // Build grid: rows from transactions + active daily/vacation rates (even if no txs yet)
  const activities = useMemo(() => {
    const seen = new Map<string, string>()
    seen.set('', 'Загальне')
    for (const [rowKey, rate] of dailyRateMap) {
      seen.set(rowKey, RATE_TYPE_LABELS[rate.rate_type])
    }
    for (const tx of txs) {
      if (tx.type === 'PAYMENT') continue
      const rowKey = `${tx.activity_id ?? ''}::${tx.rate_type ?? ''}`
      if (!seen.has(rowKey)) {
        const typeSuffix = tx.rate_type ? ` · ${RATE_TYPE_LABELS[tx.rate_type]}` : ''
        seen.set(rowKey, (tx.activity_name ?? 'Невідома') + typeSuffix)
      }
    }
    return Array.from(seen.entries()).map(([key, name]) => ({ key, name }))
  }, [txs, dailyRateMap])

  // Map: activityId::rateType → day → transactions[]
  const grid = useMemo(() => {
    const map = new Map<string, Map<number, SalaryTransaction[]>>()
    for (const tx of txs) {
      if (tx.type === 'PAYMENT') continue
      const rowKey = `${tx.activity_id ?? ''}::${tx.rate_type ?? ''}`
      if (!map.has(rowKey)) map.set(rowKey, new Map())
      const day = new Date(tx.transaction_date).getUTCDate()
      const dayMap = map.get(rowKey)!
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
          {isAdmin && (
            <button
              onClick={handleRecalc}
              disabled={recalcPending}
              title="Перерахувати всі нарахування за місяць"
              className="text-xs px-2 py-1 text-gray-400 hover:text-iris-600 disabled:opacity-40 transition-colors border border-gray-200 rounded-lg hover:border-iris-300"
            >
              {recalcPending ? '...' : '↻'}
            </button>
          )}
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
      {dailyDialog && dailyDialog.rate.rate_type === 'monthly_by_day' && (
        <DailyMarkDialog
          staffId={staffId}
          date={dailyDialog.date}
          rate={dailyDialog.rate}
          existingTx={dailyDialog.existingTx}
          onClose={() => { setDailyDialog(null); qc.invalidateQueries({ queryKey: ['salary', staffId, month] }); qc.invalidateQueries({ queryKey: ['salary-total', staffId] }) }}
        />
      )}
      {dailyDialog && dailyDialog.rate.rate_type === 'vacation' && (
        <VacationMarkDialog
          staffId={staffId}
          date={dailyDialog.date}
          rate={dailyDialog.rate}
          existingTx={dailyDialog.existingTx}
          onClose={() => { setDailyDialog(null); qc.invalidateQueries({ queryKey: ['salary', staffId, month] }); qc.invalidateQueries({ queryKey: ['salary-total', staffId] }) }}
        />
      )}
      
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
                {activities.map(({ key: rowKey, name: actName }) => {
                  const dayMap = grid.get(rowKey) ?? new Map<number, SalaryTransaction[]>()
                  let rowTotal = 0
                  return (
                    <tr key={rowKey} className="hover:bg-gray-50">
                      <td className="px-2 py-1.5 text-gray-700 font-medium whitespace-nowrap">{actName}</td>
                      {Array.from({ length: days }, (_, i) => i + 1).map(d => {
                        const cellTxs = dayMap.get(d) ?? []
                        const cellNet = cellTxs.reduce((s, t) => {
                          const gross = Number(t.gross_amount)
                          const ded = Math.round(gross * Number(t.deduction_pct) / 100 * 100) / 100
                          return s + gross - ded
                        }, 0)
                        if (cellNet) rowTotal += cellNet
                        const dateStr    = `${month}-${String(d).padStart(2, '0')}`
                        const dailyRate_ = dailyRateMap.get(rowKey)
                        return (
                          <td key={d} className="px-0.5 py-1 text-center">
                            {cellTxs.length > 0 ? (
                              <button
                                onClick={() => {
                                  if (dailyRate_) {
                                    setDailyDialog({ rate: dailyRate_, date: dateStr, existingTx: cellTxs[0] })
                                  } else {
                                    cellTxs.length === 1 ? setSelectedTx(cellTxs[0]) : setSelectedAccrualGroup(cellTxs)
                                  }
                                }}
                                className={`w-full rounded px-0.5 py-0.5 font-mono transition-colors ${
                                  dailyRate_?.rate_type === 'vacation'
                                    ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                    : cellTxs.some(t => t.type === 'CORRECTION')
                                      ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                                      : 'bg-iris-50 text-iris-700 hover:bg-iris-100'
                                }`}
                                title={cellTxs.map(t => {
                                  const g = Number(t.gross_amount)
                                  const d = Math.round(g * Number(t.deduction_pct) / 100 * 100) / 100
                                  return `${TX_TYPE_LABELS[t.type]}: ${fmt(g - d)} (gross ${fmt(g)})`
                                }).join('\n')}
                              >
                                {dailyRate_?.rate_type === 'vacation'
                                  ? 'В'
                                  : cellNet % 1 === 0 ? cellNet : cellNet.toFixed(0)}
                              </button>
                            ) : dailyRate_ && isAdmin ? (
                              <button
                                onClick={() => setDailyDialog({ rate: dailyRate_, date: dateStr, existingTx: null })}
                                className="w-full rounded px-0.5 py-0.5 text-gray-200 hover:text-gray-400 hover:bg-gray-50 transition-colors"
                              >·</button>
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

          {/* Monthly summary */}
          <div className="grid grid-cols-5 gap-3 pt-2 border-t border-gray-100">
            <div className="col-span-5 mb-0.5">
              <span className="text-xs text-gray-400 font-medium">Поточний місяць</span>
            </div>
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

          {/* All-time total summary */}
          {totalSummary && (
            <div className="grid grid-cols-5 gap-3 pt-2 border-t border-gray-200 bg-gray-50 -mx-5 px-5 pb-2 rounded-b-xl">
              <div className="col-span-5 mb-0.5">
                <span className="text-xs text-gray-500 font-medium">За весь час</span>
              </div>
              {[
                { label: 'Нараховано (gross)', value: totalSummary.gross, color: 'text-gray-700' },
                { label: 'Утримання', value: -totalSummary.deduction, color: 'text-red-500' },
                { label: 'До виплати (net)', value: totalSummary.net, color: 'text-iris-700 font-semibold' },
                { label: 'Виплачено', value: totalSummary.paid, color: 'text-green-700' },
                {
                  label: 'Поточний борг',
                  value: totalSummary.balance,
                  color: totalSummary.balance > 0
                    ? 'text-amber-700 font-bold'
                    : totalSummary.balance < 0
                      ? 'text-red-600 font-bold'
                      : 'text-gray-400',
                },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center">
                  <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                  <p className={`text-sm font-mono ${color}`}>
                    {value < 0 ? '−' : ''}{fmt(Math.abs(value))}
                  </p>
                </div>
              ))}
            </div>
          )}
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
