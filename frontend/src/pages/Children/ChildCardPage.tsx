import { BankPayersBlock } from './BankPayersBlock'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { childrenApi } from '../../api/children.api'
import type { IndividualTariff, IndTariffType, OpenAccrual } from '../../api/children.api'
import type { ChildParent, Child } from '../../types'
import { groupsApi } from '../../api/groups.api'
import { parentsApi } from '../../api/parents.api'
import { activitiesApi } from '../../api/activities.api'
import { accountsApi } from '../../api/accounts.api'
import { enrollmentsApi } from '../../api/enrollments.api'
import type { RebindPayment } from '../../api/enrollments.api'
import { billingApi } from '../../api/billing.api'
import type { LedgerEntry, GlobalDiscount } from '../../api/billing.api'
import { useCanAccess } from '../../hooks/useCanAccess'
import { today as todayStr, firstOfMonth } from '../../utils/dateStr'

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('uk-UA')
}

function toDateInputValue(iso: string | null) {
  if (!iso) return ''
  return iso.substring(0, 10)
}

export function ChildCardPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const canEdit = useCanAccess('owner', 'admin', 'manager')
  const isOwner = useCanAccess('owner')

  const [editing, setEditing] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [form, setForm] = useState({
    full_name: '',
    birth_date: '',
    group_id: '',
    note: '',
    is_active: true,
  })

  const { data: child, isLoading } = useQuery({
    queryKey: ['child', id],
    queryFn: () => childrenApi.get(id!),
    enabled: !!id,
  })

  const { data: groups } = useQuery({
    queryKey: ['groups'],
    queryFn: () => groupsApi.list(),
    staleTime: 5 * 60 * 1000,
  })

  const updateMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => childrenApi.update(id!, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['child', id] })
      qc.invalidateQueries({ queryKey: ['children'] })
      setEditing(false)
      setSaveError(null)
    },
    onError: () => setSaveError('Помилка при збереженні. Перевірте дані.'),
  })

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
  if (!child)   return <div className="py-12 text-center text-sm text-gray-400">Дитину не знайдено</div>

  const startEdit = () => {
    setSaveError(null)
    setForm({
      full_name:  child.full_name,
      birth_date: toDateInputValue(child.birth_date),
      group_id:   child.group_id  ?? '',
      note:       child.note      ?? '',
      is_active:  child.is_active,
    })
    setEditing(true)
  }

  const handleSave = () => {
    if (!form.full_name.trim()) {
      setSaveError('ПІБ є обовʼязковим полем')
      return
    }
    updateMutation.mutate({
      full_name:  form.full_name.trim(),
      birth_date: form.birth_date || null,
      group_id:   form.group_id  || null,
      note:       form.note      || null,
      is_active:  form.is_active,
    })
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link to="/children" className="hover:text-iris-600 transition-colors">Діти</Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">{child.full_name}</span>
      </div>

      {/* Main card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{child.full_name}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {child.group_name ?? 'Без групи'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              child.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}>
              {child.is_active ? 'Активна' : 'Архів'}
            </span>
            {canEdit && !editing && (
              <button
                onClick={startEdit}
                className="text-sm text-iris-600 hover:text-iris-700 font-medium"
              >
                Редагувати
              </button>
            )}
          </div>
        </div>

        {/* View mode */}
        {!editing && (
          <dl className="grid grid-cols-2 gap-4">
            <InfoRow label="Дата народження" value={formatDate(child.birth_date)} />
            <InfoRow label="Група"           value={child.group_name ?? '—'} />
            {child.note && <InfoRow label="Нотатка" value={child.note} className="col-span-2" />}
          </dl>
        )}

        {/* Edit mode */}
        {editing && (
          <div className="space-y-4">
            <Field label="ПІБ *">
              <input
                type="text"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
              />
            </Field>

            <Field label="Дата народження">
              <input
                type="date"
                value={form.birth_date}
                onChange={(e) => setForm({ ...form, birth_date: e.target.value })}
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
              />
            </Field>

            <Field label="Група">
              <select
                value={form.group_id}
                onChange={(e) => setForm({ ...form, group_id: e.target.value })}
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
              >
                <option value="">— без групи —</option>
                {groups?.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </Field>

            <Field label="Нотатка">
              <textarea
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                rows={3}
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
              />
            </Field>

            <Field label="Статус">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="rounded border-gray-300 text-iris-600 focus:ring-iris-500"
                />
                <span className="text-sm text-gray-700">Активна</span>
              </label>
            </Field>

            {saveError && (
              <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{saveError}</div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="px-4 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {updateMutation.isPending ? 'Збереження...' : 'Зберегти'}
              </button>
              <button
                onClick={() => { setEditing(false); setSaveError(null) }}
                className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm font-medium"
              >
                Скасувати
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Parents */}
      <ParentsBlock child={child} />

      {/* Known payers from bank statements */}
      {id && <BankPayersBlock childId={id} />}

      {/* Balances */}
      {id && <BalancesBlock childId={id} canEdit={isOwner} />}

      {/* Enrollments (includes individual tariff management) */}
      {id && <EnrollmentsBlock childId={id} canEdit={canEdit} canEditTariffs={isOwner} />}
    </div>
  )
}

// ─── Enrollments Block ──────────────────────────────────────────────────────

const STATUS_LABELS = { active: 'Активна', frozen: 'Заморожена', archived: 'Архів' }
const STATUS_COLORS = {
  active:   'bg-green-50 text-green-700',
  frozen:   'bg-blue-50 text-blue-700',
  archived: 'bg-gray-100 text-gray-500',
}

const TARIFF_TYPE_LABEL: Record<IndTariffType, string> = {
  monthly:    'Місячний',
  per_lesson: 'За заняття',
  smart:      'Смарт',
}

const TODAY = todayStr()

const EMPTY_TARIFF_FORM = {
  tariff_type:           'monthly' as IndTariffType,
  price:                 '',
  valid_from:            TODAY,
  close_date:            firstOfMonth(),
  base_lessons:          '',
  l1_threshold_absences: '',
  l1_threshold_fee:      '',
  l2_max_refunds:        '',
  l2_refund_per_absence: '',
}

function EnrollmentsBlock({ childId, canEdit, canEditTariffs }: { childId: string; canEdit: boolean; canEditTariffs: boolean }) {
  const qc = useQueryClient()
  const [showForm, setShowForm]       = useState(false)
  const [freezeId, setFreezeId]       = useState<string | null>(null)
  const [tariffEnrollId, setTariffEnrollId] = useState<string | null>(null) // enrollment id with open tariff form
  const [freezeForm, setFreezeForm]   = useState({ frozen_from: '', frozen_to: '' })
  const [tariffForm, setTariffForm]   = useState(EMPTY_TARIFF_FORM)
  const [tariffError, setTariffError] = useState<string | null>(null)
  const [discountForm, setDiscountForm]   = useState({ discount_pct: '', valid_from: TODAY })
  const [showDiscountForm, setShowDiscountForm] = useState(false)
  const [discountError, setDiscountError]   = useState<string | null>(null)
  const [enrollForm, setEnrollForm]   = useState({ activity_id: '', account_id: '', start_date: TODAY, note: '' })
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const [archiveState, setArchiveState] = useState<{ enrollmentId: string; date: string; cancelAccruals: boolean } | null>(null)
  const EMPTY_REBIND = { new_account_id: '', from_month: TODAY.slice(0, 7), to_month: '', update_future: false }
  const [rebindId, setRebindId]       = useState<string | null>(null)
  const [rebindForm, setRebindForm]   = useState(EMPTY_REBIND)
  const [rebindWarning, setRebindWarning] = useState<{ payments: RebindPayment[]; message: string } | null>(null)

  const { data: enrollments = [], isLoading } = useQuery({
    queryKey: ['enrollments', childId],
    queryFn:  () => enrollmentsApi.listByChild(childId),
  })

  const { data: individualTariffs = [] } = useQuery<IndividualTariff[]>({
    queryKey: ['individual-tariffs', childId],
    queryFn:  () => childrenApi.listIndividualTariffs(childId),
  })

  const { data: globalDiscount } = useQuery<GlobalDiscount | null>({
    queryKey: ['child-global-discount', childId],
    queryFn:  () => billingApi.getGlobalDiscount(childId),
  })

  const { data: activities = [] } = useQuery({
    queryKey: ['activities'],
    queryFn:  () => activitiesApi.list(),
    enabled:  showForm,
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn:  accountsApi.list,
    enabled:  showForm || rebindId !== null,
  })

  const { data: priceCheck } = useQuery({
    queryKey: ['price-check', childId, enrollForm.activity_id, enrollForm.start_date],
    queryFn:  () => enrollmentsApi.resolvePrice(childId, enrollForm.activity_id, enrollForm.start_date),
    enabled:  showForm && !!enrollForm.activity_id && !!enrollForm.start_date,
    staleTime: 30_000,
  })

  // Active individual tariff by activity_id
  const indTariffByActivity = individualTariffs.reduce<Record<string, IndividualTariff>>((acc, t) => {
    if (t.valid_to === null) acc[t.activity_id] = t
    return acc
  }, {})

  const invalidateTariffs = () => qc.invalidateQueries({ queryKey: ['individual-tariffs', childId] })

  const createMutation = useMutation({
    mutationFn: () => enrollmentsApi.create({ child_id: childId, ...enrollForm, note: enrollForm.note || undefined }),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['enrollments', childId] })
      setShowForm(false)
      setEnrollForm({ activity_id: '', account_id: '', start_date: TODAY, note: '' })
      setEnrollError(null)
    },
    onError: () => setEnrollError('Помилка при записі'),
  })

  const freezeMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => enrollmentsApi.freeze(id, freezeForm),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['enrollments', childId] }); setFreezeId(null) },
  })
  const unfreezeMutation = useMutation({
    mutationFn: enrollmentsApi.unfreeze,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['enrollments', childId] }),
  })
  const archiveMutation = useMutation({
    mutationFn: ({ id, endDate, cancelAccruals }: { id: string; endDate: string; cancelAccruals: boolean }) =>
      enrollmentsApi.archive(id, { end_date: endDate, cancel_month_accruals: cancelAccruals }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enrollments', childId] })
      qc.invalidateQueries({ queryKey: ['balance', childId] })
      qc.invalidateQueries({ queryKey: ['ledger', childId] })
      setArchiveState(null)
    },
  })

  const rebindMutation = useMutation({
    mutationFn: ({ force }: { force: boolean }) =>
      enrollmentsApi.rebindAccount(rebindId!, {
        new_account_id: rebindForm.new_account_id,
        from_month: rebindForm.from_month + '-01',
        to_month:   rebindForm.to_month ? rebindForm.to_month + '-01' : undefined,
        update_future: rebindForm.update_future,
        force,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enrollments', childId] })
      qc.invalidateQueries({ queryKey: ['balance', childId] })
      qc.invalidateQueries({ queryKey: ['ledger', childId] })
      setRebindId(null)
      setRebindForm(EMPTY_REBIND)
      setRebindWarning(null)
    },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: { error?: string; payments?: RebindPayment[]; message?: string } } }).response?.data
      if (data?.error === 'HasPayments') {
        setRebindWarning({ payments: data.payments ?? [], message: data.message ?? '' })
      }
    },
  })

  const setTariffMutation = useMutation({
    mutationFn: (activityId: string) => childrenApi.setIndividualTariff(childId, {
      activity_id:            activityId,
      tariff_type:            tariffForm.tariff_type,
      price:                  Number(tariffForm.price),
      valid_from:             tariffForm.valid_from,
      base_lessons:           tariffForm.base_lessons ? Number(tariffForm.base_lessons) : undefined,
      l1_threshold_absences:  tariffForm.l1_threshold_absences ? Number(tariffForm.l1_threshold_absences) : null,
      l1_threshold_fee:       tariffForm.l1_threshold_fee ? Number(tariffForm.l1_threshold_fee) : null,
      l2_max_refunds:         tariffForm.l2_max_refunds ? Number(tariffForm.l2_max_refunds) : null,
      l2_refund_per_absence:  tariffForm.l2_refund_per_absence ? Number(tariffForm.l2_refund_per_absence) : null,
    }),
    onSuccess: () => {
      invalidateTariffs()
      qc.invalidateQueries({ queryKey: ['balance', childId] })
      qc.invalidateQueries({ queryKey: ['ledger', childId] })
      setTariffEnrollId(null)
      setTariffError(null)
    },
    onError:   () => setTariffError('Помилка збереження'),
  })

  const closeTariffMutation = useMutation({
    mutationFn: ({ tariffId, validTo }: { tariffId: string; validTo: string }) =>
      childrenApi.closeIndividualTariff(childId, tariffId, validTo),
    onSuccess:  () => {
      invalidateTariffs()
      qc.invalidateQueries({ queryKey: ['balance', childId] })
      qc.invalidateQueries({ queryKey: ['ledger', childId] })
      setTariffEnrollId(null)
    },
  })

  const setDiscountMutation = useMutation({
    mutationFn: () => billingApi.setGlobalDiscount(childId, { discount_pct: Number(discountForm.discount_pct), valid_from: discountForm.valid_from }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['child-global-discount', childId] }); setShowDiscountForm(false); setDiscountError(null) },
    onError:    () => setDiscountError('Помилка збереження'),
  })
  const removeDiscountMutation = useMutation({
    mutationFn: () => billingApi.deleteGlobalDiscount(childId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['child-global-discount', childId] }),
  })

  const activeEnrollments   = enrollments.filter((e) => e.status !== 'archived')
  const archivedEnrollments = enrollments.filter((e) => e.status === 'archived')

  const openTariffForm = (enrollmentId: string, activityId: string) => {
    const existing = indTariffByActivity[activityId]
    setTariffForm({
      tariff_type:           (existing?.tariff_type ?? 'monthly') as IndTariffType,
      price:                 existing ? String(Number(existing.price).toFixed(0)) : '',
      valid_from:            TODAY,
      close_date:            firstOfMonth(),
      base_lessons:          existing?.base_lessons != null ? String(existing.base_lessons) : '',
      l1_threshold_absences: existing?.l1_threshold_absences != null ? String(existing.l1_threshold_absences) : '',
      l1_threshold_fee:      existing?.l1_threshold_fee != null ? String(Number(existing.l1_threshold_fee).toFixed(0)) : '',
      l2_max_refunds:        existing?.l2_max_refunds != null ? String(existing.l2_max_refunds) : '',
      l2_refund_per_absence: existing?.l2_refund_per_absence != null ? String(Number(existing.l2_refund_per_absence).toFixed(0)) : '',
    })
    setTariffEnrollId(enrollmentId)
    setTariffError(null)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-gray-900">Підписки на активності ({activeEnrollments.length})</h2>
        <div className="flex items-center gap-3">
          {canEditTariffs && (
            <button onClick={() => setShowDiscountForm(true)}
              className="text-xs text-gray-400 hover:text-amber-600 transition-colors">
              {globalDiscount ? `Знижка ${Number(globalDiscount.discount_pct).toFixed(0)}% ✕` : '+ глоб. знижка'}
            </button>
          )}
          {canEdit && !showForm && (
            <button onClick={() => setShowForm(true)} className="text-sm text-iris-600 hover:text-iris-700 font-medium">+ Записати</button>
          )}
        </div>
      </div>

      {/* Global discount form */}
      {showDiscountForm && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-700">Глобальна знижка на всі активності</p>
            {globalDiscount && (
              <button onClick={() => removeDiscountMutation.mutate()} disabled={removeDiscountMutation.isPending}
                className="text-xs text-red-400 hover:text-red-600">Видалити</button>
            )}
          </div>
          <div className="flex gap-2 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Знижка (%)</label>
              <input type="number" min="1" max="100" value={discountForm.discount_pct}
                onChange={(e) => setDiscountForm({ ...discountForm, discount_pct: e.target.value })}
                placeholder={globalDiscount ? String(Number(globalDiscount.discount_pct).toFixed(0)) : 'напр. 10'}
                className="w-24 rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Діє з</label>
              <input type="date" value={discountForm.valid_from}
                onChange={(e) => setDiscountForm({ ...discountForm, valid_from: e.target.value })}
                className="rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
            </div>
            <button onClick={() => { if (!discountForm.discount_pct) { setDiscountError('Введіть %'); return } setDiscountMutation.mutate() }}
              disabled={setDiscountMutation.isPending}
              className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white rounded-md">
              {setDiscountMutation.isPending ? '...' : 'Зберегти'}
            </button>
            <button onClick={() => { setShowDiscountForm(false); setDiscountError(null) }}
              className="text-xs text-gray-400 hover:text-gray-700">Скасувати</button>
          </div>
          {discountError && <p className="text-xs text-red-600">{discountError}</p>}
        </div>
      )}

      {/* Enrollment form */}
      {showForm && (
        <div className="p-4 bg-iris-50 rounded-lg space-y-3">
          <p className="text-sm font-medium text-gray-700">Нова підписка</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Активність *</label>
              <select value={enrollForm.activity_id}
                onChange={(e) => { const a = activities.find((x) => x.id === e.target.value); setEnrollForm({ ...enrollForm, activity_id: e.target.value, account_id: a?.account_id ?? '' }) }}
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
                <option value="">— оберіть —</option>
                {activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Рахунок *</label>
              <select value={enrollForm.account_id} onChange={(e) => setEnrollForm({ ...enrollForm, account_id: e.target.value })}
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
                <option value="">— оберіть —</option>
                {accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Дата початку *</label>
            <input type="date" value={enrollForm.start_date} onChange={(e) => setEnrollForm({ ...enrollForm, start_date: e.target.value })}
              className="rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          </div>
          {priceCheck && priceCheck.rule === 'base_fee' && priceCheck.detail === null && (
            <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              <span className="shrink-0 mt-0.5">⚠</span>
              <span>
                На вказану дату тариф для цієї активності не визначено.
                Нарахування за цей період створені не будуть.
              </span>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Нотатка</label>
            <input type="text" value={enrollForm.note} onChange={(e) => setEnrollForm({ ...enrollForm, note: e.target.value })}
              className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          </div>
          {enrollError && <p className="text-xs text-red-600">{enrollError}</p>}
          <div className="flex gap-2">
            <button onClick={() => { if (!enrollForm.activity_id || !enrollForm.account_id || !enrollForm.start_date) { setEnrollError('Оберіть активність, рахунок та дату початку'); return } createMutation.mutate() }}
              disabled={createMutation.isPending}
              className="text-xs px-3 py-1.5 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-md transition-colors">
              {createMutation.isPending ? '...' : 'Зберегти'}
            </button>
            <button onClick={() => { setShowForm(false); setEnrollError(null) }} className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-900">Скасувати</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400">Завантаження...</p>
      ) : activeEnrollments.length === 0 && !showForm ? (
        <p className="text-sm text-gray-400">Немає активних підписок</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {activeEnrollments.map((e) => {
            const indTariff = indTariffByActivity[e.activity_id]
            return (
              <li key={e.id} className="py-3">
                {/* Freeze form */}
                {freezeId === e.id ? (
                  <div className="space-y-2 p-3 bg-blue-50 rounded-lg">
                    <p className="text-xs font-medium text-gray-700">Заморозити підписку</p>
                    <div className="flex gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">Від</label>
                        <input type="date" value={freezeForm.frozen_from} onChange={(ev) => setFreezeForm({ ...freezeForm, frozen_from: ev.target.value })}
                          className="rounded border-gray-300 text-xs shadow-sm" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">До</label>
                        <input type="date" value={freezeForm.frozen_to} onChange={(ev) => setFreezeForm({ ...freezeForm, frozen_to: ev.target.value })}
                          className="rounded border-gray-300 text-xs shadow-sm" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => freezeMutation.mutate({ id: e.id })} disabled={freezeMutation.isPending}
                        className="text-xs px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-50">
                        {freezeMutation.isPending ? '...' : 'Заморозити'}
                      </button>
                      <button onClick={() => setFreezeId(null)} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-900">Скасувати</button>
                    </div>
                  </div>

                ) : rebindId === e.id ? (
                  /* ── Rebind account form ── */
                  <div className="space-y-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-xs font-medium text-gray-700">Змінити рахунок · {e.activity_name}</p>

                    <div className="flex gap-2 flex-wrap items-end">
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">Новий рахунок</label>
                        <select
                          value={rebindForm.new_account_id}
                          onChange={(ev) => { setRebindForm({ ...rebindForm, new_account_id: ev.target.value }); setRebindWarning(null) }}
                          className="rounded border-gray-300 text-xs shadow-sm focus:border-iris-500 focus:ring-iris-500"
                        >
                          <option value="">— оберіть —</option>
                          {accounts.filter((a) => a.id !== e.account_id && a.is_active).map((a) => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">З місяця</label>
                        <input
                          type="month"
                          value={rebindForm.from_month}
                          onChange={(ev) => { setRebindForm({ ...rebindForm, from_month: ev.target.value }); setRebindWarning(null) }}
                          className="rounded border-gray-300 text-xs shadow-sm focus:border-iris-500 focus:ring-iris-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">По місяць (необов'язково)</label>
                        <input
                          type="month"
                          value={rebindForm.to_month}
                          onChange={(ev) => { setRebindForm({ ...rebindForm, to_month: ev.target.value }); setRebindWarning(null) }}
                          className="rounded border-gray-300 text-xs shadow-sm focus:border-iris-500 focus:ring-iris-500"
                        />
                      </div>
                    </div>

                    <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rebindForm.update_future}
                        onChange={(ev) => setRebindForm({ ...rebindForm, update_future: ev.target.checked })}
                      />
                      Змінити рахунок підписки для майбутніх місяців
                    </label>

                    {rebindWarning && (
                      <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700 space-y-1">
                        <p className="font-medium">{rebindWarning.message}</p>
                        <ul className="space-y-0.5 pl-2">
                          {rebindWarning.payments.map((p) => (
                            <li key={p.id}>
                              {new Date(p.date).toLocaleDateString('uk-UA')} — {Number(p.amount).toLocaleString('uk-UA', { minimumFractionDigits: 2 })} ₴
                              {p.note && ` (${p.note})`}
                            </li>
                          ))}
                        </ul>
                        <p className="text-red-600 font-medium mt-1">Все одно перенести нарахування?</p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      {rebindWarning ? (
                        <button
                          onClick={() => rebindMutation.mutate({ force: true })}
                          disabled={rebindMutation.isPending}
                          className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded disabled:opacity-50"
                        >
                          {rebindMutation.isPending ? '...' : 'Так, перенести'}
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            if (!rebindForm.new_account_id) return
                            rebindMutation.mutate({ force: false })
                          }}
                          disabled={!rebindForm.new_account_id || rebindMutation.isPending}
                          className="text-xs px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded disabled:opacity-50"
                        >
                          {rebindMutation.isPending ? '...' : 'Перенести'}
                        </button>
                      )}
                      <button
                        onClick={() => { setRebindId(null); setRebindForm(EMPTY_REBIND); setRebindWarning(null) }}
                        className="text-xs px-2 py-1 text-gray-500 hover:text-gray-900"
                      >
                        Скасувати
                      </button>
                    </div>
                  </div>

                ) : tariffEnrollId === e.id ? (
                  /* ── Individual tariff form ── */
                  <div className="space-y-3 p-3 bg-iris-50 border border-iris-200 rounded-lg">
                    <p className="text-xs font-medium text-gray-700">Індивідуальний тариф · {e.activity_name}</p>

                    {/* Tariff type */}
                    <div className="flex gap-4">
                      {(['monthly', 'per_lesson', 'smart'] as IndTariffType[]).map((t) => (
                        <label key={t} className="flex items-center gap-1.5 text-xs cursor-pointer">
                          <input type="radio" checked={tariffForm.tariff_type === t}
                            onChange={() => setTariffForm({ ...tariffForm, tariff_type: t })} />
                          {TARIFF_TYPE_LABEL[t]}
                        </label>
                      ))}
                    </div>

                    {/* Price + valid_from */}
                    <div className="flex gap-2 items-end flex-wrap">
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">Ціна (грн)</label>
                        <input type="number" min="0.01" step="0.01" value={tariffForm.price}
                          onChange={(ev) => setTariffForm({ ...tariffForm, price: ev.target.value })}
                          className="w-28 rounded border-gray-300 text-xs shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">Діє з</label>
                        <input type="date" value={tariffForm.valid_from}
                          onChange={(ev) => setTariffForm({ ...tariffForm, valid_from: ev.target.value })}
                          className="rounded border-gray-300 text-xs shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                      </div>
                      <button
                        onClick={() => { if (!tariffForm.price) { setTariffError('Введіть ціну'); return } setTariffMutation.mutate(e.activity_id) }}
                        disabled={setTariffMutation.isPending}
                        className="text-xs px-3 py-1.5 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-md">
                        {setTariffMutation.isPending ? '...' : 'Зберегти'}
                      </button>
                      <button onClick={() => { setTariffEnrollId(null); setTariffError(null) }} className="text-xs text-gray-400 hover:text-gray-700">Скасувати</button>
                    </div>

                    {/* Smart config */}
                    {tariffForm.tariff_type === 'smart' && (
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-iris-100">
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">Базових занять</label>
                          <input type="number" min="0" value={tariffForm.base_lessons}
                            onChange={(ev) => setTariffForm({ ...tariffForm, base_lessons: ev.target.value })}
                            className="w-full rounded border-gray-300 text-xs shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">Поріг пропусків (L1)</label>
                          <input type="number" min="0" value={tariffForm.l1_threshold_absences}
                            onChange={(ev) => setTariffForm({ ...tariffForm, l1_threshold_absences: ev.target.value })}
                            className="w-full rounded border-gray-300 text-xs shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">Сума при порозі (L1, грн)</label>
                          <input type="number" min="0" step="0.01" value={tariffForm.l1_threshold_fee}
                            onChange={(ev) => setTariffForm({ ...tariffForm, l1_threshold_fee: ev.target.value })}
                            className="w-full rounded border-gray-300 text-xs shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">Макс. повернень (L2)</label>
                          <input type="number" min="0" value={tariffForm.l2_max_refunds}
                            onChange={(ev) => setTariffForm({ ...tariffForm, l2_max_refunds: ev.target.value })}
                            className="w-full rounded border-gray-300 text-xs shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-500 mb-0.5">Повернення за пропуск (L2, грн)</label>
                          <input type="number" min="0" step="0.01" value={tariffForm.l2_refund_per_absence}
                            onChange={(ev) => setTariffForm({ ...tariffForm, l2_refund_per_absence: ev.target.value })}
                            className="w-full rounded border-gray-300 text-xs shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                        </div>
                      </div>
                    )}

                    {/* Close tariff */}
                    {indTariff && (
                      <div className="pt-2 border-t border-iris-100 flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-500">Скасувати тариф з</span>
                        <input type="date" value={tariffForm.close_date}
                          onChange={(ev) => setTariffForm({ ...tariffForm, close_date: ev.target.value })}
                          className="rounded border-gray-300 text-xs shadow-sm" />
                        <button
                          onClick={() => closeTariffMutation.mutate({ tariffId: indTariff.id, validTo: tariffForm.close_date })}
                          disabled={closeTariffMutation.isPending}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors underline underline-offset-2">
                          {closeTariffMutation.isPending ? '...' : '→ повернути базову ціну'}
                        </button>
                      </div>
                    )}

                    {tariffError && <p className="text-xs text-red-600">{tariffError}</p>}
                  </div>

                ) : (
                  /* Normal row */
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
                        {e.activity_name}
                        {e.tariff_valid_from && e.start_date < e.tariff_valid_from && (
                          <span
                            title={`Тариф діє з ${new Date(e.tariff_valid_from).toLocaleDateString('uk-UA')}. Нарахування до цієї дати відсутні.`}
                            className="text-amber-500 cursor-help text-xs">⚠</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 flex items-center gap-1.5 flex-wrap">
                        <span>{e.account_name} · з {new Date(e.start_date).toLocaleDateString('uk-UA')}</span>
                        {indTariff ? (
                          <>
                            {e.base_fee && <span className="line-through">{Number(e.base_fee).toFixed(0)} грн</span>}
                            <span className="text-iris-600 font-medium">
                              {TARIFF_TYPE_LABEL[indTariff.tariff_type]} · {Number(indTariff.price).toFixed(0)} грн
                            </span>
                          </>
                        ) : (
                          e.base_fee && <span>· {Number(e.base_fee).toFixed(0)} грн</span>
                        )}
                        {e.status === 'frozen' && e.frozen_to && (
                          <span>· заморожена до {new Date(e.frozen_to).toLocaleDateString('uk-UA')}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[e.status]}`}>
                        {STATUS_LABELS[e.status]}
                      </span>
                      <div className="flex gap-2 text-xs text-gray-400">
                        {canEditTariffs && (
                          <button onClick={() => openTariffForm(e.id, e.activity_id)}
                            className="hover:text-iris-600 transition-colors">
                            {indTariff ? 'тариф' : '+ тариф'}
                          </button>
                        )}
                        {canEdit && (
                          <>
                            {e.status !== 'archived' && (
                              <button
                                onClick={() => { setRebindId(e.id); setRebindForm({ ...EMPTY_REBIND, from_month: TODAY.slice(0, 7) }); setRebindWarning(null) }}
                                className="hover:text-amber-600 transition-colors">рахунок</button>
                            )}
                            {e.status === 'active' && (
                              <button onClick={() => { setFreezeId(e.id); setFreezeForm({ frozen_from: TODAY, frozen_to: '' }) }}
                                className="hover:text-blue-600 transition-colors">заморозити</button>
                            )}
                            {e.status === 'frozen' && (
                              <button onClick={() => unfreezeMutation.mutate(e.id)} className="hover:text-green-600 transition-colors">розморозити</button>
                            )}
                            {archiveState?.enrollmentId === e.id ? (
                              <span className="flex items-center gap-2 flex-wrap">
                                <input
                                  type="date"
                                  value={archiveState.date}
                                  onChange={(ev) => setArchiveState({ ...archiveState, date: ev.target.value })}
                                  className="border rounded px-1 py-0.5 text-xs text-gray-700"
                                />
                                <label className="flex items-center gap-1 text-xs text-gray-600 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={archiveState.cancelAccruals}
                                    onChange={(ev) => setArchiveState({ ...archiveState, cancelAccruals: ev.target.checked })}
                                  />
                                  скасувати нарахування
                                </label>
                                <button
                                  onClick={() => archiveMutation.mutate({ id: e.id, endDate: archiveState.date, cancelAccruals: archiveState.cancelAccruals })}
                                  disabled={archiveMutation.isPending}
                                  className="text-red-600 hover:text-red-800 font-medium transition-colors">
                                  підтвердити
                                </button>
                                <button onClick={() => setArchiveState(null)} className="hover:text-gray-600 transition-colors">скасувати</button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setArchiveState({ enrollmentId: e.id, date: TODAY, cancelAccruals: false })}
                                className="hover:text-red-600 transition-colors">архів</button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {archivedEnrollments.length > 0 && (
        <details className="text-sm">
          <summary className="text-gray-400 cursor-pointer hover:text-gray-600">Архів ({archivedEnrollments.length})</summary>
          <ul className="mt-2 divide-y divide-gray-100">
            {archivedEnrollments.map((e) => (
              <li key={e.id} className="py-2 flex items-center justify-between text-gray-400">
                <span>{e.activity_name}</span>
                <span className="text-xs">
                  {e.end_date
                    ? `відписка ${new Date(e.end_date).toLocaleDateString('uk-UA')}`
                    : 'архів'}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}


// ─── Audit helpers ──────────────────────────────────────────────────────────

const TX_LABEL: Record<string, string> = {
  ACCRUAL:    'Нарахування',
  PAYMENT:    'Оплата',
  REFUND:     'Повернення',
  REVERSAL:   'Сторно',
  ADJUSTMENT: 'Коригування',
}

const TX_BADGE: Record<string, string> = {
  ACCRUAL:    'bg-red-50 text-red-700',
  PAYMENT:    'bg-green-50 text-green-700',
  REFUND:     'bg-blue-50 text-blue-700',
  REVERSAL:   'bg-gray-100 text-gray-500',
  ADJUSTMENT: 'bg-amber-50 text-amber-700',
}

type EnrichedAccrual = LedgerEntry & { _orig: number; _eff: number; _adjusted: boolean }

function enrichAccruals(accruals: LedgerEntry[], adjustments: LedgerEntry[]): {
  enriched: EnrichedAccrual[]
  unlinkedAdjs: LedgerEntry[]
} {
  const linkedIds = new Set<string>()
  const enriched: EnrichedAccrual[] = accruals.map(accrual => {
    const related = adjustments.filter(adj => {
      const m = adj.metadata_json
      if (!m) return false
      if (m['source'] === 'retro_recalc' && m['original_accrual_id'] === accrual.id) return true
      if (m['adjustment_reason'] === 'tariff_changed' &&
          adj.enrollment_id === accrual.enrollment_id &&
          String(adj.billing_month ?? '').slice(0, 7) === String(accrual.billing_month ?? '').slice(0, 7)) return true
      return false
    })
    related.forEach(a => linkedIds.add(a.id))
    const delta = related.reduce((s, a) => s + Number(a.amount), 0)
    const orig  = Number(accrual.amount)
    return { ...accrual, _orig: orig, _eff: orig + delta, _adjusted: related.length > 0 }
  })
  return { enriched, unlinkedAdjs: adjustments.filter(a => !linkedIds.has(a.id)) }
}

function amountSign(type: string, amount: string) {
  const n = Number(amount)
  if (['PAYMENT', 'REFUND', 'REVERSAL'].includes(type)) return { sign: '+', color: 'text-green-600' as const, value: n }
  return { sign: '−', color: 'text-red-500' as const, value: n }
}

function AuditView({
  entries, canEdit, onCancel, cancelPending,
}: {
  entries: LedgerEntry[]
  canEdit: boolean
  onCancel: (tx: LedgerEntry) => void
  cancelPending: boolean
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-gray-400 text-center py-4">Рухів за цей місяць немає</p>
  }
  return (
    <div className="space-y-1">
      {entries.map((tx) => {
        const { sign, color, value } = amountSign(tx.type, tx.amount)
        const deleted = tx.is_deleted
        return (
          <div key={tx.id} className={`rounded-lg px-3 py-2 text-xs ${deleted ? 'bg-gray-50 opacity-60' : 'bg-white border border-gray-100'}`}>
            <div className="flex items-start justify-between gap-2">
              {/* Left: badge + description */}
              <div className="flex items-start gap-2 min-w-0">
                <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${TX_BADGE[tx.type] ?? 'bg-gray-100 text-gray-600'} ${deleted ? 'line-through' : ''}`}>
                  {TX_LABEL[tx.type] ?? tx.type}
                </span>
                <div className="min-w-0">
                  <p className={`font-medium text-gray-700 ${deleted ? 'line-through' : ''}`}>
                    {tx.activity_name ?? tx.account_name}
                  </p>
                  {tx.note && (
                    <p className="text-gray-400 mt-0.5 break-words">{tx.note}</p>
                  )}
                  {/* Audit trail */}
                  <p className="text-gray-300 mt-0.5">
                    {formatDate(tx.transaction_date)}
                    {tx.created_by_email && ` · додав ${tx.created_by_email}`}
                  </p>
                  {deleted && tx.deleted_by_email && (
                    <p className="text-amber-500 mt-0.5">
                      скасовано {tx.deleted_at ? formatDate(tx.deleted_at) : ''}
                      {` · ${tx.deleted_by_email}`}
                    </p>
                  )}
                </div>
              </div>
              {/* Right: amount + cancel */}
              <div className="flex items-center gap-2 shrink-0">
                <span className={`font-mono font-medium ${deleted ? 'line-through text-gray-400' : color}`}>
                  {sign}{value.toFixed(2)}
                </span>
                {canEdit && !deleted && tx.type !== 'REVERSAL' && (
                  <button
                    onClick={() => onCancel(tx)}
                    disabled={cancelPending}
                    className="text-gray-300 hover:text-red-500 px-1 py-0.5 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                    title="Скасувати транзакцію"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Balances + Monthly Breakdown Block ─────────────────────────────────────

function monthLabel(ym: string) {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleString('uk-UA', { month: 'long', year: 'numeric' })
}
function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const last = new Date(y, m, 0).getDate()
  const to   = `${y}-${String(m).padStart(2, '0')}-${last}`
  return { from, to }
}
function prevMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function nextMonth(ym: string) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function currentYM() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const UA_MONTHS = ['Січ', 'Лют', 'Бер', 'Квіт', 'Трав', 'Черв', 'Лип', 'Серп', 'Вер', 'Жовт', 'Лист', 'Груд']

function formatBillingMonth(iso: string): string {
  const [y, m] = iso.slice(0, 7).split('-')
  return `${UA_MONTHS[Number(m) - 1]} ${y}`
}

function computePreview(amount: number, accruals: OpenAccrual[]) {
  let pool = amount
  return accruals.map((acc) => {
    const cover = Math.min(pool, acc.remaining)
    pool = Math.max(0, pool - acc.remaining)
    return { ...acc, willCover: cover }
  })
}

function BalancesBlock({ childId, canEdit }: { childId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const [ym, setYm] = useState(currentYM())
  const [showInitForm, setShowInitForm] = useState(false)
  const [showPayForm, setShowPayForm] = useState(false)
  const [initForm, setInitForm] = useState({ account_id: '', amount: '', note: '' })
  const [payForm, setPayForm]   = useState({
    account_id: '',
    payment_account_id: '',
    cross_account: false,
    amount: '',
    date: todayStr(),
    note: '',
  })
  const [initError, setInitError] = useState<string | null>(null)
  const [payError, setPayError]   = useState<string | null>(null)
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null)
  const [showAudit, setShowAudit] = useState(false)

  const { from, to } = monthRange(ym)

  const { data: balances = [], isLoading: balLoading } = useQuery({
    queryKey: ['balance', childId],
    queryFn: () => billingApi.getBalance(childId),
  })

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ['ledger', childId, ym, showAudit],
    queryFn: () => billingApi.getLedger(childId, { from, to, limit: 500, include_deleted: showAudit }),
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
    staleTime: 5 * 60 * 1000,
  })

  const { data: imbalances = [] } = useQuery({
    queryKey: ['imbalances', childId],
    queryFn: () => billingApi.getImbalances(childId),
    enabled: canEdit,
  })

  const { data: openAccruals = [] } = useQuery({
    queryKey: ['open-accruals', childId, payForm.account_id],
    queryFn: () => childrenApi.getOpenAccruals(childId, payForm.account_id),
    enabled: showPayForm && !!payForm.account_id,
    staleTime: 0,
  })

  const initMutation = useMutation({
    mutationFn: () => billingApi.setInitialBalance(childId, {
      account_id: initForm.account_id, amount: Number(initForm.amount), note: initForm.note || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance', childId] })
      setShowInitForm(false); setInitForm({ account_id: '', amount: '', note: '' }); setInitError(null)
    },
    onError: () => setInitError('Помилка збереження'),
  })

  const resetPayForm = () => {
    setPayForm({
      account_id: '', payment_account_id: '', cross_account: false,
      amount: '', date: todayStr(), note: '',
    })
    setEditingPaymentId(null)
  }

  const openEditPayment = (tx: LedgerEntry) => {
    // 1st priority: metadata_json (stored at creation time — works even if imbalance was resolved)
    const metaPayAccountId = (tx.metadata_json as { payment_account_id?: string } | null)?.payment_account_id
    // 2nd priority: unresolved imbalance (fallback for payments created before this fix)
    const linkedImbalance = imbalances.find((im) => im.transaction_id === tx.id)
    const resolvedPayAccountId = metaPayAccountId ?? linkedImbalance?.from_account_id ?? ''
    const isCrossAccount = !!(metaPayAccountId || linkedImbalance)

    setEditingPaymentId(tx.id)
    setPayForm({
      account_id: tx.account_id,
      payment_account_id: resolvedPayAccountId,
      cross_account: isCrossAccount,
      amount: Number(tx.amount).toFixed(2),
      date: tx.transaction_date.slice(0, 10),
      note: tx.note ?? '',
    })
    setShowPayForm(true)
    setPayError(null)
    // Scroll to form (it renders above the monthly breakdown)
    setTimeout(() => {
      document.getElementById('pay-form-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 50)
  }

  const cancelTxMutation = useMutation({
    mutationFn: ({ txId, reason }: { txId: string; reason?: string }) =>
      billingApi.cancelTransaction(txId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance', childId] })
      qc.invalidateQueries({ queryKey: ['ledger', childId] })
      qc.invalidateQueries({ queryKey: ['imbalances', childId] })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message ?? 'Помилка скасування'
      setPayError(msg)
    },
  })

  const [filterAccountId, setFilterAccountId] = useState('')
  const [clearError, setClearError] = useState<string | null>(null)
  const clearMonthMutation = useMutation({
    mutationFn: ({ activityId, billingMonth, isPerLesson, reason }: { activityId: string; billingMonth: string; isPerLesson: boolean; reason?: string }) =>
      billingApi.clearMonthAccruals(childId, activityId, billingMonth, isPerLesson, reason),
    onSuccess: () => {
      setClearError(null)
      qc.invalidateQueries({ queryKey: ['balance', childId] })
      qc.invalidateQueries({ queryKey: ['ledger', childId] })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Помилка скасування'
      setClearError(msg)
    },
  })

  // Alias for payment rows in normal view
  const cancelPayMutation = cancelTxMutation

  const payMutation = useMutation({
    mutationFn: async () => {
      if (editingPaymentId) {
        await billingApi.cancelTransaction(editingPaymentId)
      }
      return billingApi.registerPayment(childId, {
        account_id: payForm.account_id,
        payment_account_id: payForm.cross_account && payForm.payment_account_id ? payForm.payment_account_id : undefined,
        amount: Number(payForm.amount),
        transaction_date: payForm.date || undefined,
        note: payForm.note || undefined,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance', childId] })
      qc.invalidateQueries({ queryKey: ['ledger', childId] })
      qc.invalidateQueries({ queryKey: ['imbalances', childId] })
      setShowPayForm(false)
      resetPayForm()
      setPayError(null)
    },
    onError: () => setPayError('Помилка при збереженні оплати'),
  })

  // Группировка транзакций по аккаунту
  const groupedByAccount = (ledger?.data ?? []).reduce<Record<string, {
    account_name: string
    accruals: LedgerEntry[]
    payments: LedgerEntry[]
    refunds: LedgerEntry[]
    adjustments: LedgerEntry[]
  }>>((acc, tx) => {
    if (!acc[tx.account_id]) {
      acc[tx.account_id] = { account_name: tx.account_name, accruals: [], payments: [], refunds: [], adjustments: [] }
    }
    if (tx.type === 'ACCRUAL')    acc[tx.account_id].accruals.push(tx)
    if (tx.type === 'PAYMENT')    acc[tx.account_id].payments.push(tx)
    if (tx.type === 'REFUND')     acc[tx.account_id].refunds.push(tx)
    if (tx.type === 'ADJUSTMENT') acc[tx.account_id].adjustments.push(tx)
    return acc
  }, {})

  const activeAccounts = balances

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-gray-900">Фінанси</h2>
        {canEdit && (
          <div className="flex gap-3">
            <button onClick={() => { setShowPayForm(true); setShowInitForm(false) }}
              className="text-sm text-iris-600 hover:text-iris-700 font-medium">
              + Оплата
            </button>
            <button onClick={() => { setShowInitForm(true); setShowPayForm(false) }}
              className="text-xs text-gray-400 hover:text-gray-600">
              Поч. залишок
            </button>
          </div>
        )}
      </div>

      {/* Inline error (cancel mutation errors show here, outside the pay form) */}
      {payError && !showPayForm && (
        <div className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2 flex items-center justify-between">
          <span>{payError}</span>
          <button onClick={() => setPayError(null)} className="ml-2 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Balance cards */}
      {balLoading ? (
        <p className="text-sm text-gray-400">Завантаження...</p>
      ) : activeAccounts.length === 0 ? (
        <p className="text-sm text-gray-400">Немає підписок</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {activeAccounts.map((b) => {
            const num = Number(b.balance)
            const color = num > 0 ? 'text-green-700' : num < 0 ? 'text-red-600' : 'text-gray-500'
            return (
              <div key={b.account_id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="text-xs text-gray-500 mb-1">{b.account_name}</p>
                <p className={`text-lg font-semibold ${color}`}>
                  {num > 0 ? '+' : ''}{num.toFixed(2)} грн
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{num > 0 ? 'аванс' : num < 0 ? 'борг' : 'нуль'}</p>
                {(Number(b.initial_balance) !== 0 || b.initial_balance_note) && (
                  <div className="mt-2 pt-2 border-t border-gray-200 flex items-center justify-between">
                    <div>
                      <span className="text-xs text-gray-500">Поч. залишок: </span>
                      <span className="text-xs font-medium text-gray-700">{Number(b.initial_balance).toFixed(2)}</span>
                    </div>
                    {canEdit && (
                      <button 
                        onClick={() => {
                          setInitForm({ account_id: b.account_id, amount: String(b.initial_balance), note: b.initial_balance_note ?? '' })
                          setShowInitForm(true)
                          setShowPayForm(false)
                        }}
                        className="text-xs text-iris-600 hover:text-iris-700 transition-colors"
                      >
                        Ред.
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Payment form */}
      {showPayForm && (
        <div id="pay-form-anchor" className="p-4 bg-green-50 rounded-lg space-y-3 border border-green-200">
          <p className="text-sm font-medium text-gray-700">
            {editingPaymentId ? 'Редагування оплати' : 'Внести оплату'}
          </p>

          {/* Service account + amount */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                {payForm.cross_account ? 'Рахунок послуги (де борг) *' : 'Рахунок *'}
              </label>
              <select value={payForm.account_id} onChange={(e) => setPayForm({ ...payForm, account_id: e.target.value })}
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
                <option value="">— оберіть —</option>
                {accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Сума (грн) *</label>
              <input type="number" min="0.01" step="0.01" value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                placeholder="0.00"
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
            </div>
          </div>

          {/* Payment preview */}
          {payForm.account_id && Number(payForm.amount) > 0 && openAccruals.length > 0 && (() => {
            const preview = computePreview(Number(payForm.amount), openAccruals)
            const totalDebt = openAccruals.reduce((s, a) => s + a.remaining, 0)
            const remainder = Math.max(0, Number(payForm.amount) - totalDebt)
            return (
              <div className="text-xs space-y-1.5">
                <p className="text-gray-500 font-medium">Буде погашено:</p>
                <div className="bg-white rounded border border-gray-200 divide-y divide-gray-100">
                  {preview.map((acc) => {
                    const full = acc.willCover >= acc.remaining
                    const partial = acc.willCover > 0 && !full
                    return (
                      <div key={acc.id} className="flex items-center justify-between px-3 py-1.5 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={full ? 'text-green-500' : partial ? 'text-amber-500' : 'text-gray-300'}>
                            {full ? '✓' : partial ? '◑' : '○'}
                          </span>
                          <span className="truncate text-gray-700">
                            {acc.activity_name ?? 'Нарахування'}
                            {acc.billing_month && ` · ${formatBillingMonth(acc.billing_month)}`}
                          </span>
                        </div>
                        <div className="shrink-0 font-mono text-gray-600">
                          {acc.willCover > 0 ? acc.willCover.toFixed(2) : '—'} / {acc.remaining.toFixed(2)}
                        </div>
                      </div>
                    )
                  })}
                </div>
                {remainder > 0.005 && (
                  <p className="text-gray-400">Залишок авансу: <span className="font-mono text-green-600">+{remainder.toFixed(2)} грн</span></p>
                )}
              </div>
            )
          })()}

          {/* Cross-account toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={payForm.cross_account}
              onChange={(e) => setPayForm({ ...payForm, cross_account: e.target.checked, payment_account_id: '' })}
              className="rounded border-gray-300 text-iris-600 focus:ring-iris-500" />
            <span className="text-xs text-gray-600">Гроші надійшли на інший рахунок</span>
          </label>

          {/* Payment account selector (cross-account only) */}
          {payForm.cross_account && (
            <div className="ml-5 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <label className="block text-xs font-medium text-amber-700 mb-1">Рахунок зарахування (куди реально прийшли гроші) *</label>
              <select value={payForm.payment_account_id}
                onChange={(e) => setPayForm({ ...payForm, payment_account_id: e.target.value })}
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
                <option value="">— оберіть —</option>
                {accounts.filter((a) => a.is_active && a.id !== payForm.account_id).map((a) =>
                  <option key={a.id} value={a.id}>{a.name}</option>
                )}
              </select>
              <p className="text-xs text-amber-600 mt-1.5">
                Борг закриється по рахунку послуги · Міжрахунковий дисбаланс буде зафіксовано
              </p>
            </div>
          )}

          {/* Date + note */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Дата</label>
              <input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })}
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Нотатка</label>
              <input type="text" value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })}
                placeholder="необов'язково"
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
            </div>
          </div>

          {payError && <p className="text-xs text-red-600">{payError}</p>}
          <div className="flex gap-2">
            <button onClick={() => {
              if (!payForm.account_id || !payForm.amount) { setPayError('Оберіть рахунок та суму'); return }
              if (payForm.cross_account && !payForm.payment_account_id) { setPayError('Оберіть рахунок зарахування'); return }
              payMutation.mutate()
            }}
              disabled={payMutation.isPending}
              className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-md">
              {payMutation.isPending ? '...' : editingPaymentId ? 'Зберегти зміни' : 'Зберегти оплату'}
            </button>
            <button onClick={() => { setShowPayForm(false); resetPayForm(); setPayError(null) }}
              className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-900">Скасувати</button>
          </div>
        </div>
      )}

      {/* Initial balance form */}
      {showInitForm && (
        <div className="p-4 bg-amber-50 rounded-lg space-y-3 border border-amber-200">
          <p className="text-sm font-medium text-gray-700">Початковий залишок</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Рахунок *</label>
              <select value={initForm.account_id} onChange={(e) => setInitForm({ ...initForm, account_id: e.target.value })}
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500">
                <option value="">— оберіть —</option>
                {accounts.filter((a) => a.is_active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Сума (+аванс / −борг) *</label>
              <input type="number" step="0.01" value={initForm.amount}
                onChange={(e) => setInitForm({ ...initForm, amount: e.target.value })}
                placeholder="напр. 1500 або -800"
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
            </div>
          </div>
          <input type="text" placeholder="Нотатка" value={initForm.note} onChange={(e) => setInitForm({ ...initForm, note: e.target.value })}
            className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
          {initError && <p className="text-xs text-red-600">{initError}</p>}
          <div className="flex gap-2">
            <button onClick={() => { if (!initForm.account_id || !initForm.amount) { setInitError('Оберіть рахунок та суму'); return } initMutation.mutate() }}
              disabled={initMutation.isPending}
              className="text-xs px-3 py-1.5 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-md">
              {initMutation.isPending ? '...' : 'Зберегти'}
            </button>
            <button onClick={() => { setShowInitForm(false); setInitError(null) }} className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-900">Скасувати</button>
          </div>
        </div>
      )}

      {/* Monthly breakdown */}
      <div className="border-t border-gray-100 pt-4">
        {/* Month navigation + audit toggle */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setYm(prevMonth(ym))} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            ‹
          </button>
          <span className="text-sm font-medium text-gray-700 capitalize">{monthLabel(ym)}</span>
          <div className="flex items-center gap-2">
            {showAudit && (() => {
              const txAccounts = [...new Map((ledger?.data ?? []).map((tx) => [tx.account_id, tx.account_name])).entries()]
              if (txAccounts.length < 2) return null
              return (
                <select
                  value={filterAccountId}
                  onChange={(e) => setFilterAccountId(e.target.value)}
                  className="text-xs border border-gray-200 rounded px-1.5 py-0.5 text-gray-600 bg-white focus:outline-none focus:border-iris-400"
                >
                  <option value="">Усі рахунки</option>
                  {txAccounts.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              )
            })()}
            <button
              onClick={() => { setShowAudit((v) => !v); setFilterAccountId('') }}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                showAudit
                  ? 'border-amber-400 bg-amber-50 text-amber-700'
                  : 'border-gray-200 text-gray-400 hover:text-gray-600'
              }`}
              title="Журнал змін — показати всі транзакції включно зі скасованими"
            >
              аудит
            </button>
            <button onClick={() => setYm(nextMonth(ym))} disabled={ym >= currentYM()}
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-30">
              ›
            </button>
          </div>
        </div>

        {ledgerLoading ? (
          <p className="text-sm text-gray-400 text-center py-4">Завантаження...</p>
        ) : showAudit ? (
          /* ── Audit view: flat list of all transactions ── */
          <AuditView
            entries={(ledger?.data ?? []).filter((tx) => !filterAccountId || tx.account_id === filterAccountId)}
            canEdit={canEdit}
            onCancel={(tx) => {
              if (tx.type === 'PAYMENT') {
                if (window.confirm('Скасувати цю оплату?')) {
                  cancelTxMutation.mutate({ txId: tx.id })
                }
              } else {
                const reason = window.prompt(`Причина скасування (${TX_LABEL[tx.type] ?? tx.type}):`)
                if (reason !== null) {
                  cancelTxMutation.mutate({ txId: tx.id, reason: reason || undefined })
                }
              }
            }}
            cancelPending={cancelTxMutation.isPending}
          />
        ) : Object.keys(groupedByAccount).length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Рухів за цей місяць немає</p>
        ) : (
          <div className="space-y-4">
            {/* Accounts without enrollment but with transactions (e.g. bank import payments) */}
            {Object.entries(groupedByAccount)
              .filter(([accId]) => !activeAccounts.find((b) => b.account_id === accId))
              .map(([accId, group]) => {
                const totalPayments = group.payments.reduce((s, t) => s + Number(t.amount), 0)
                const totalAccruals = group.accruals.reduce((s, t) => s + Number(t.amount), 0)
                const totalRefunds  = group.refunds.reduce((s, t) => s + Number(t.amount), 0)
                const totalAdj      = group.adjustments.reduce((s, t) => s + Number(t.amount), 0)
                const monthNet      = totalPayments + totalRefunds - totalAccruals + totalAdj
                return (
                  <div key={accId} className="rounded-lg border border-gray-100 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{group.account_name}</span>
                      <span className={`text-xs font-mono font-medium ${monthNet >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {monthNet >= 0 ? '+' : ''}{monthNet.toFixed(2)} грн
                      </span>
                    </div>
                    <div className="px-4 py-3 space-y-2 text-xs">
                      {group.payments.length > 0 && (
                        <div>
                          <p className="text-gray-400 mb-1">Оплати</p>
                          {group.payments.map((tx) => {
                            const metaPayId = (tx.metadata_json as { payment_account_id?: string } | null)?.payment_account_id
                            const linkedImbalance = imbalances.find((im) => im.transaction_id === tx.id)
                            const crossName = metaPayId
                              ? (accounts.find((a) => a.id === metaPayId)?.name ?? null)
                              : (linkedImbalance?.from_account_name ?? null)
                            return (
                              <div key={tx.id} className="flex items-center justify-between py-0.5">
                                <div className="flex items-center gap-1.5 text-gray-600 min-w-0">
                                  <span className="shrink-0">{formatDate(tx.transaction_date)}</span>
                                  {tx.note && <span className="text-gray-400 truncate">· {tx.note}</span>}
                                  {crossName && (
                                    <span className="shrink-0 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-medium">
                                      ← {crossName}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 ml-2 shrink-0">
                                  <span className="font-mono text-green-600">+{Number(tx.amount).toFixed(2)}</span>
                                  {canEdit && (
                                    <button
                                      onClick={() => { if (window.confirm('Скасувати цю оплату?')) cancelPayMutation.mutate({ txId: tx.id }) }}
                                      disabled={cancelPayMutation.isPending}
                                      className="text-gray-300 hover:text-red-500 text-xs px-1 py-0.5 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                                      title="Скасувати оплату"
                                    >✕</button>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                          {group.payments.length > 1 && (
                            <div className="flex justify-between py-0.5 border-t border-gray-100 mt-1 pt-1">
                              <span className="text-gray-400">Разом оплат</span>
                              <span className="font-mono text-green-600">+{totalPayments.toFixed(2)}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

            {activeAccounts.map((bal) => {
              const group = groupedByAccount[bal.account_id]
              if (!group && !balances.find(b => b.account_id === bal.account_id)) return null

              const totalAccruals  = (group?.accruals  ?? []).reduce((s, t) => s + Number(t.amount), 0)
              const totalPayments  = (group?.payments  ?? []).reduce((s, t) => s + Number(t.amount), 0)
              const totalRefunds   = (group?.refunds   ?? []).reduce((s, t) => s + Number(t.amount), 0)
              const totalAdj       = (group?.adjustments ?? []).reduce((s, t) => s + Number(t.amount), 0)
              const monthNet       = totalPayments + totalRefunds - totalAccruals + totalAdj

              return (
                <div key={bal.account_id} className="rounded-lg border border-gray-100 overflow-hidden">
                  {/* Account header */}
                  <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-100">
                    <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">{bal.account_name}</span>
                    <span className={`text-xs font-mono font-medium ${monthNet >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {monthNet >= 0 ? '+' : ''}{monthNet.toFixed(2)} грн
                    </span>
                  </div>

                  {(() => {
                    const { enriched, unlinkedAdjs } = enrichAccruals(group?.accruals ?? [], group?.adjustments ?? [])
                    const byActivity = enriched.reduce<Record<string, { orig: number; eff: number; adjusted: boolean; activityId: string | null; billingMonth: string | null; isPerLesson: boolean }>>((acc, tx) => {
                      const key = tx.activity_name ?? '—'
                      if (!acc[key]) acc[key] = { orig: 0, eff: 0, adjusted: false, activityId: tx.activity_id, billingMonth: tx.billing_month, isPerLesson: tx.billing_month == null }
                      acc[key].orig += tx._orig
                      acc[key].eff  += tx._eff
                      acc[key].adjusted = acc[key].adjusted || tx._adjusted
                      return acc
                    }, {})
                    const unlinkedTotal = unlinkedAdjs.reduce((s, a) => s + Number(a.amount), 0)
                    // billing_month for the selected month (used as fallback for per_lesson)
                    const selectedBillingMonth = `${ym}-01`
                    return (
                  <div className="px-4 py-3 space-y-2 text-xs">
                    {/* Accruals grouped by activity — with before→after for adjusted ones */}
                    {enriched.length > 0 && (
                      <div>
                        <p className="text-gray-400 mb-1">Нарахування</p>
                        {Object.entries(byActivity).map(([name, { orig, eff, adjusted, activityId, billingMonth, isPerLesson }]) => (
                          <div key={name} className="flex justify-between py-0.5 gap-2 group/accrual">
                            <span className="text-gray-600 min-w-0 truncate">{name}</span>
                            <span className="font-mono shrink-0 flex items-center gap-1">
                              {adjusted ? (
                                <>
                                  <span className="text-gray-400 line-through">{orig.toFixed(2)}</span>
                                  <span className="text-gray-400">→</span>
                                  <span className="text-red-500">−{eff.toFixed(2)}</span>
                                </>
                              ) : (
                                <span className="text-red-500">−{orig.toFixed(2)}</span>
                              )}
                              {canEdit && activityId && (
                                <button
                                  onClick={() => {
                                    const bm = billingMonth ?? selectedBillingMonth
                                    if (isPerLesson) {
                                      if (!window.confirm(`Скасувати всі нарахування по «${name}» за цей місяць?\nВсі відмітки в журналі за цей місяць будуть видалені.`)) return
                                      clearMonthMutation.mutate({ activityId, billingMonth: bm, isPerLesson: true })
                                    } else {
                                      const reason = window.prompt(`Причина скасування нарахування по «${name}»:`)
                                      if (reason === null) return
                                      clearMonthMutation.mutate({ activityId, billingMonth: bm, isPerLesson: false, reason: reason || undefined })
                                    }
                                  }}
                                  disabled={clearMonthMutation.isPending}
                                  className="ml-1 text-gray-300 hover:text-red-500 opacity-0 group-hover/accrual:opacity-100 transition-opacity disabled:opacity-30"
                                  title="Скасувати нарахування"
                                >✕</button>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Refunds grouped by activity */}
                    {(group?.refunds ?? []).length > 0 && (
                      <div>
                        <p className="text-gray-400 mb-1">Повернення</p>
                        {Object.entries(
                          (group?.refunds ?? []).reduce<Record<string, number>>((acc, tx) => {
                            const key = tx.activity_name ?? tx.note ?? '—'
                            acc[key] = (acc[key] ?? 0) + Number(tx.amount)
                            return acc
                          }, {})
                        ).map(([name, total]) => (
                          <div key={name} className="flex justify-between py-0.5">
                            <span className="text-gray-600">{name}</span>
                            <span className="font-mono text-green-500">+{total.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Unlinked adjustments only */}
                    {unlinkedAdjs.length > 0 && (
                      <div className="flex justify-between py-0.5">
                        <span className="text-gray-400">Коригування</span>
                        <span className="font-mono text-amber-500">{unlinkedTotal >= 0 ? '+' : ''}{unlinkedTotal.toFixed(2)}</span>
                      </div>
                    )}

                    {/* Payments — individual rows */}
                    {(group?.payments ?? []).length > 0 && (
                      <div>
                        <p className="text-gray-400 mb-1">Оплати</p>
                        {group.payments.map((tx) => {
                          const metaPayId = (tx.metadata_json as { payment_account_id?: string } | null)?.payment_account_id
                          const linkedImbalance = imbalances.find((im) => im.transaction_id === tx.id)
                          const crossName = metaPayId
                            ? (accounts.find((a) => a.id === metaPayId)?.name ?? null)
                            : (linkedImbalance?.from_account_name ?? null)
                          return (
                          <div key={tx.id} className="flex items-center justify-between py-0.5">
                            <div className="flex items-center gap-1.5 text-gray-600 min-w-0">
                              <span className="shrink-0">{formatDate(tx.transaction_date)}</span>
                              {tx.note && <span className="text-gray-400 truncate">· {tx.note}</span>}
                              {crossName && (
                                <span className="shrink-0 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-medium">
                                  ← {crossName}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 ml-2 shrink-0">
                              <span className="font-mono text-green-600">+{Number(tx.amount).toFixed(2)}</span>
                              {canEdit && (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => openEditPayment(tx)}
                                    className="text-gray-300 hover:text-iris-600 text-xs px-1 py-0.5 rounded hover:bg-iris-50 transition-colors"
                                    title="Редагувати"
                                  >
                                    ред.
                                  </button>
                                  <button
                                    onClick={() => {
                                      if (window.confirm('Скасувати цю оплату?')) {
                                        cancelPayMutation.mutate({ txId: tx.id })
                                      }
                                    }}
                                    disabled={cancelPayMutation.isPending}
                                    className="text-gray-300 hover:text-red-500 text-xs px-1 py-0.5 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                                    title="Скасувати оплату"
                                  >
                                    ✕
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                        })}
                        {(group?.payments ?? []).length > 1 && (
                          <div className="flex justify-between py-0.5 border-t border-gray-100 mt-1 pt-1">
                            <span className="text-gray-400">Разом оплат</span>
                            <span className="font-mono text-green-600">+{totalPayments.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {!group && (
                      <p className="text-gray-400 py-1">Рухів за цей рахунок немає</p>
                    )}
                  </div>
                  )
                })()}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {clearError && (
        <p className="text-xs text-red-600 mt-2">{clearError}</p>
      )}
    </div>
  )
}

// ─── Parents Block ───────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: '',     label: '— роль —' },
  { value: 'мама', label: 'Мама' },
  { value: 'тато', label: 'Тато' },
  { value: 'опікун', label: 'Опікун' },
]

function ParentsBlock({ child }: { child: Child }) {
  const qc = useQueryClient()
  const canEdit = useCanAccess('owner', 'admin', 'manager')
  const parents: ChildParent[] = child.child_parents ?? []
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedParentId, setSelectedParentId] = useState('')
  const [selectedRole, setSelectedRole] = useState('')

  const { data: parentsData } = useQuery({
    queryKey: ['parents-search', search],
    queryFn: () => parentsApi.list({ search: search || undefined }),
    staleTime: 30_000,
    enabled: showAdd,
  })

  const addMutation = useMutation({
    mutationFn: () => childrenApi.addParent(child.id, selectedParentId, selectedRole || null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['child', child.id] })
      setShowAdd(false)
      setSelectedParentId('')
      setSelectedRole('')
      setSearch('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (parentId: string) => childrenApi.removeParent(child.id, parentId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['child', child.id] }),
  })

  const updateRoleMutation = useMutation({
    mutationFn: ({ parentId, role }: { parentId: string; role: string | null }) =>
      childrenApi.addParent(child.id, parentId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['child', child.id] }),
  })

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-gray-900">Батьки / Опікуни</h2>
        {canEdit && !showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="text-sm text-iris-600 hover:text-iris-700 font-medium"
          >
            + Додати
          </button>
        )}
      </div>

      {parents.length === 0 && !showAdd && (
        <p className="text-sm text-gray-400">Батьків не вказано</p>
      )}

      {parents.length > 0 && (
        <div className="space-y-2">
          {parents.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {canEdit ? (
                <select
                  value={p.role ?? ''}
                  onChange={(e) => updateRoleMutation.mutate({ parentId: p.id, role: e.target.value || null })}
                  className="rounded border-gray-200 text-xs text-gray-500 py-0.5 focus:border-iris-400 focus:ring-iris-400"
                >
                  {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                p.role && <span className="text-xs font-medium text-iris-600">{p.role}</span>
              )}
              <span className="font-medium text-gray-900">{p.full_name}</span>
              {p.phone && <span className="text-gray-500">{p.phone}</span>}
              {p.email && <span className="text-gray-400">{p.email}</span>}
              {canEdit && (
                <button
                  onClick={() => { if (confirm(`Відʼєднати ${p.full_name}?`)) removeMutation.mutate(p.id) }}
                  className="ml-auto text-xs text-red-400 hover:text-red-600"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
          <input
            type="text"
            placeholder="Пошук батька/матері..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelectedParentId('') }}
            className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
          />
          {parentsData && parentsData.data.length > 0 && (
            <select
              size={Math.min(parentsData.data.length, 5)}
              value={selectedParentId}
              onChange={(e) => setSelectedParentId(e.target.value)}
              className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
            >
              {parentsData.data
                .filter((p) => !parents.some((cp) => cp.id === p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}{p.phone ? ` · ${p.phone}` : ''}
                  </option>
                ))}
            </select>
          )}
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
          >
            {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="flex gap-2">
            <button
              onClick={() => addMutation.mutate()}
              disabled={!selectedParentId || addMutation.isPending}
              className="px-3 py-1.5 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm rounded-lg"
            >
              Додати
            </button>
            <button
              onClick={() => { setShowAdd(false); setSearch(''); setSelectedParentId('') }}
              className="px-3 py-1.5 text-gray-600 hover:text-gray-900 text-sm"
            >
              Скасувати
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  )
}

function InfoRow({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value}</dd>
    </div>
  )
}
