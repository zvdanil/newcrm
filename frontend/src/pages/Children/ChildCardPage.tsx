import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { childrenApi } from '../../api/children.api'
import { groupsApi } from '../../api/groups.api'
import { familiesApi } from '../../api/families.api'
import { activitiesApi } from '../../api/activities.api'
import { accountsApi } from '../../api/accounts.api'
import { enrollmentsApi } from '../../api/enrollments.api'
import { billingApi } from '../../api/billing.api'
import type { LedgerEntry, ChildPrice, GlobalDiscount } from '../../api/billing.api'
import { useCanAccess } from '../../hooks/useCanAccess'

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
    family_id: '',
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

  const { data: familiesData } = useQuery({
    queryKey: ['families'],
    queryFn: () => familiesApi.list(),
    staleTime: 5 * 60 * 1000,
    enabled: editing,
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
      family_id:  child.family_id ?? '',
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
      family_id:  form.family_id || null,
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
              {child.group_name ?? 'Без групи'} · {child.family_name ?? 'Без сімʼї'}
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
            <InfoRow label="Група"           value={child.group_name  ?? '—'} />
            <InfoRow label="Сімʼя"           value={child.family_name ?? '—'} />
            <InfoRow label="Відповідальний"  value={child.primary_parent_name  ?? '—'} />
            <InfoRow label="Контакт"         value={child.primary_parent_phone ?? '—'} />
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

            <Field label="Сімʼя">
              <select
                value={form.family_id}
                onChange={(e) => setForm({ ...form, family_id: e.target.value })}
                className="w-full rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500"
              >
                <option value="">— без сімʼї —</option>
                {familiesData?.data.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
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

function EnrollmentsBlock({ childId, canEdit, canEditTariffs }: { childId: string; canEdit: boolean; canEditTariffs: boolean }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [freezeId, setFreezeId] = useState<string | null>(null)
  const [tariffId, setTariffId] = useState<string | null>(null) // enrollment id with open tariff form
  const [freezeForm, setFreezeForm] = useState({ frozen_from: '', frozen_to: '' })
  const [tariffForm, setTariffForm] = useState({ mode: 'price' as 'price' | 'discount', value: '', valid_from: new Date().toISOString().slice(0, 10), reset_date: new Date().toISOString().slice(0, 10) })
  const [tariffError, setTariffError] = useState<string | null>(null)
  const [discountForm, setDiscountForm] = useState({ discount_pct: '', valid_from: new Date().toISOString().slice(0, 10) })
  const [showDiscountForm, setShowDiscountForm] = useState(false)
  const [discountError, setDiscountError] = useState<string | null>(null)
  const [enrollForm, setEnrollForm] = useState({ activity_id: '', account_id: '', start_date: new Date().toISOString().slice(0, 10), note: '' })
  const [enrollError, setEnrollError] = useState<string | null>(null)

  const { data: enrollments = [], isLoading } = useQuery({
    queryKey: ['enrollments', childId],
    queryFn: () => enrollmentsApi.listByChild(childId),
  })

  const { data: prices = [] } = useQuery<ChildPrice[]>({
    queryKey: ['child-prices', childId],
    queryFn: () => billingApi.getPrices(childId),
  })

  const { data: globalDiscount } = useQuery<GlobalDiscount | null>({
    queryKey: ['child-global-discount', childId],
    queryFn: () => billingApi.getGlobalDiscount(childId),
  })

  const { data: activities = [] } = useQuery({
    queryKey: ['activities'],
    queryFn: () => activitiesApi.list(),
    enabled: showForm,
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
    enabled: showForm,
  })

  // Index active prices by activity_id for quick lookup
  const priceByActivity = prices.reduce<Record<string, ChildPrice>>((acc, p) => {
    if (p.valid_to === null) acc[p.activity_id] = p
    return acc
  }, {})

  const createMutation = useMutation({
    mutationFn: () => enrollmentsApi.create({ child_id: childId, ...enrollForm, note: enrollForm.note || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enrollments', childId] })
      setShowForm(false)
      setEnrollForm({ activity_id: '', account_id: '', start_date: new Date().toISOString().slice(0, 10), note: '' })
      setEnrollError(null)
    },
    onError: () => setEnrollError('Помилка при записі'),
  })

  const freezeMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => enrollmentsApi.freeze(id, freezeForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['enrollments', childId] }); setFreezeId(null) },
  })

  const unfreezeMutation = useMutation({
    mutationFn: enrollmentsApi.unfreeze,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enrollments', childId] }),
  })

  const archiveMutation = useMutation({
    mutationFn: enrollmentsApi.archive,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enrollments', childId] }),
  })

  const setTariffMutation = useMutation({
    mutationFn: (activityId: string) => billingApi.setPrice(childId, {
      activity_id: activityId,
      price: tariffForm.mode === 'price' ? Number(tariffForm.value) : null,
      discount_pct: tariffForm.mode === 'discount' ? Number(tariffForm.value) : null,
      valid_from: tariffForm.valid_from,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['child-prices', childId] })
      setTariffId(null)
      setTariffError(null)
    },
    onError: () => setTariffError('Помилка збереження'),
  })

  const removeTariffMutation = useMutation({
    mutationFn: ({ priceId, validTo }: { priceId: string; validTo: string }) =>
      billingApi.deletePrice(childId, priceId, validTo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['child-prices', childId] }),
  })

  const setDiscountMutation = useMutation({
    mutationFn: () => billingApi.setGlobalDiscount(childId, {
      discount_pct: Number(discountForm.discount_pct),
      valid_from: discountForm.valid_from,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['child-global-discount', childId] })
      setShowDiscountForm(false)
      setDiscountError(null)
    },
    onError: () => setDiscountError('Помилка збереження'),
  })

  const removeDiscountMutation = useMutation({
    mutationFn: () => billingApi.deleteGlobalDiscount(childId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['child-global-discount', childId] }),
  })

  const activeEnrollments   = enrollments.filter((e) => e.status !== 'archived')
  const archivedEnrollments = enrollments.filter((e) => e.status === 'archived')

  const openTariffForm = (enrollmentId: string, activityId: string) => {
    const existing = priceByActivity[activityId]
    const today = new Date().toISOString().slice(0, 10)
    setTariffForm({
      mode: existing?.price != null ? 'price' : 'discount',
      value: existing ? (existing.price != null ? String(Number(existing.price).toFixed(0)) : String(Number(existing.discount_pct).toFixed(0))) : '',
      valid_from: today,
      reset_date: today,
    })
    setTariffId(enrollmentId)
    setTariffError(null)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-gray-900">Підписки на активності ({activeEnrollments.length})</h2>
        <div className="flex items-center gap-3">
          {canEditTariffs && (
            <button onClick={() => { setShowDiscountForm(true) }}
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
              <select
                value={enrollForm.activity_id}
                onChange={(e) => {
                  const activityId = e.target.value
                  const selected = activities.find((a) => a.id === activityId)
                  setEnrollForm({ ...enrollForm, activity_id: activityId, account_id: selected?.account_id ?? '' })
                }}
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
            const indPrice = priceByActivity[e.activity_id]
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
                ) : /* Inline tariff form */ tariffId === e.id ? (
                  <div className="space-y-2 p-3 bg-iris-50 border border-iris-200 rounded-lg">
                    <p className="text-xs font-medium text-gray-700">Індивідуальний тариф · {e.activity_name}</p>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input type="radio" checked={tariffForm.mode === 'price'} onChange={() => setTariffForm({ ...tariffForm, mode: 'price' })} />
                        Ціна (грн)
                      </label>
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <input type="radio" checked={tariffForm.mode === 'discount'} onChange={() => setTariffForm({ ...tariffForm, mode: 'discount' })} />
                        Знижка (%)
                      </label>
                    </div>
                    <div className="flex gap-2 items-end">
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">{tariffForm.mode === 'price' ? 'Сума (грн)' : 'Знижка (%)'}</label>
                        <input type="number" min="0.01" step="0.01" value={tariffForm.value}
                          onChange={(ev) => setTariffForm({ ...tariffForm, value: ev.target.value })}
                          className="w-28 rounded border-gray-300 text-xs shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-0.5">Діє з</label>
                        <input type="date" value={tariffForm.valid_from}
                          onChange={(ev) => setTariffForm({ ...tariffForm, valid_from: ev.target.value })}
                          className="rounded border-gray-300 text-xs shadow-sm focus:border-iris-500 focus:ring-iris-500" />
                      </div>
                      <button onClick={() => { if (!tariffForm.value) { setTariffError('Введіть значення'); return } setTariffMutation.mutate(e.activity_id) }}
                        disabled={setTariffMutation.isPending}
                        className="text-xs px-3 py-1.5 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white rounded-md">
                        {setTariffMutation.isPending ? '...' : 'Зберегти'}
                      </button>
                      <button onClick={() => { setTariffId(null); setTariffError(null) }} className="text-xs text-gray-400 hover:text-gray-700">Скасувати</button>
                    </div>
                    {priceByActivity[e.activity_id] && (
                      <div className="pt-2 border-t border-iris-100 flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-500">Скинути тариф з</span>
                        <input
                          type="date"
                          value={tariffForm.reset_date}
                          onChange={(ev) => setTariffForm({ ...tariffForm, reset_date: ev.target.value })}
                          className="rounded border-gray-300 text-xs shadow-sm focus:border-red-400 focus:ring-red-300"
                        />
                        <button
                          onClick={() => {
                            removeTariffMutation.mutate({ priceId: priceByActivity[e.activity_id].id, validTo: tariffForm.reset_date })
                            setTariffId(null)
                          }}
                          disabled={removeTariffMutation.isPending}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors underline underline-offset-2">
                          {removeTariffMutation.isPending ? '...' : '→ повернути базову ціну'}
                        </button>
                      </div>
                    )}
                    {tariffError && <p className="text-xs text-red-600">{tariffError}</p>}
                  </div>
                ) : (
                  /* Normal row */
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{e.activity_name}</p>
                      <p className="text-xs text-gray-400 flex items-center gap-1.5 flex-wrap">
                        <span>{e.account_name} · з {new Date(e.start_date).toLocaleDateString('uk-UA')}</span>
                        {/* Price display: individual overrides base */}
                        {indPrice ? (
                          <>
                            {e.base_fee && <span className="line-through">{Number(e.base_fee).toFixed(0)} грн</span>}
                            <span className="text-iris-600 font-medium">
                              {indPrice.price != null
                                ? `${Number(indPrice.price).toFixed(0)} грн`
                                : `−${Number(indPrice.discount_pct).toFixed(0)}%`}
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
                            className={`transition-colors ${indPrice ? 'hover:text-iris-600' : 'hover:text-iris-600'}`}>
                            {indPrice ? 'тариф' : '+ тариф'}
                          </button>
                        )}
                        {canEdit && (
                          <>
                            {e.status === 'active' && (
                              <button onClick={() => { setFreezeId(e.id); setFreezeForm({ frozen_from: new Date().toISOString().slice(0, 10), frozen_to: '' }) }}
                                className="hover:text-blue-600 transition-colors">заморозити</button>
                            )}
                            {e.status === 'frozen' && (
                              <button onClick={() => unfreezeMutation.mutate(e.id)} className="hover:text-green-600 transition-colors">розморозити</button>
                            )}
                            <button onClick={() => archiveMutation.mutate(e.id)} className="hover:text-red-600 transition-colors">архів</button>
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
                <span className="text-xs">архів</span>
              </li>
            ))}
          </ul>
        </details>
      )}
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

function BalancesBlock({ childId, canEdit }: { childId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const [ym, setYm] = useState(currentYM())
  const [showInitForm, setShowInitForm] = useState(false)
  const [showPayForm, setShowPayForm] = useState(false)
  const [initForm, setInitForm] = useState({ account_id: '', amount: '', note: '' })
  const [payForm, setPayForm]   = useState({ account_id: '', amount: '', date: new Date().toISOString().slice(0, 10), note: '' })
  const [initError, setInitError] = useState<string | null>(null)
  const [payError, setPayError]   = useState<string | null>(null)

  const { from, to } = monthRange(ym)

  const { data: balances = [], isLoading: balLoading } = useQuery({
    queryKey: ['balance', childId],
    queryFn: () => billingApi.getBalance(childId),
  })

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ['ledger', childId, ym],
    queryFn: () => billingApi.getLedger(childId, { from, to, limit: 500 }),
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
    enabled: showInitForm || showPayForm,
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

  const payMutation = useMutation({
    mutationFn: () => billingApi.registerPayment(childId, {
      account_id: payForm.account_id, amount: Number(payForm.amount),
      transaction_date: payForm.date || undefined, note: payForm.note || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['balance', childId] })
      qc.invalidateQueries({ queryKey: ['ledger', childId] })
      setShowPayForm(false); setPayForm({ account_id: '', amount: '', date: new Date().toISOString().slice(0, 10), note: '' }); setPayError(null)
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
              </div>
            )
          })}
        </div>
      )}

      {/* Payment form */}
      {showPayForm && (
        <div className="p-4 bg-green-50 rounded-lg space-y-3 border border-green-200">
          <p className="text-sm font-medium text-gray-700">Внести оплату</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Рахунок *</label>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Дата</label>
              <input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })}
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Нотатка</label>
              <input type="text" value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })}
                className="w-full rounded border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500" />
            </div>
          </div>
          {payError && <p className="text-xs text-red-600">{payError}</p>}
          <div className="flex gap-2">
            <button onClick={() => { if (!payForm.account_id || !payForm.amount) { setPayError('Оберіть рахунок та суму'); return } payMutation.mutate() }}
              disabled={payMutation.isPending}
              className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-md">
              {payMutation.isPending ? '...' : 'Зберегти оплату'}
            </button>
            <button onClick={() => { setShowPayForm(false); setPayError(null) }} className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-900">Скасувати</button>
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
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setYm(prevMonth(ym))} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            ‹
          </button>
          <span className="text-sm font-medium text-gray-700 capitalize">{monthLabel(ym)}</span>
          <button onClick={() => setYm(nextMonth(ym))} disabled={ym >= currentYM()}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-30">
            ›
          </button>
        </div>

        {ledgerLoading ? (
          <p className="text-sm text-gray-400 text-center py-4">Завантаження...</p>
        ) : Object.keys(groupedByAccount).length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Рухів за цей місяць немає</p>
        ) : (
          <div className="space-y-4">
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

                  <div className="px-4 py-3 space-y-2 text-xs">
                    {/* Accruals grouped by activity */}
                    {(group?.accruals ?? []).length > 0 && (
                      <div>
                        <p className="text-gray-400 mb-1">Нарахування</p>
                        {Object.entries(
                          group.accruals.reduce<Record<string, number>>((acc, tx) => {
                            const key = tx.activity_name ?? '—'
                            acc[key] = (acc[key] ?? 0) + Number(tx.amount)
                            return acc
                          }, {})
                        ).map(([name, total]) => (
                          <div key={name} className="flex justify-between py-0.5">
                            <span className="text-gray-600">{name}</span>
                            <span className="font-mono text-red-500">−{total.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Refunds grouped by activity */}
                    {(group?.refunds ?? []).length > 0 && (
                      <div>
                        <p className="text-gray-400 mb-1">Повернення</p>
                        {Object.entries(
                          group.refunds.reduce<Record<string, number>>((acc, tx) => {
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

                    {/* Adjustments — single total line */}
                    {(group?.adjustments ?? []).length > 0 && (
                      <div className="flex justify-between py-0.5">
                        <span className="text-gray-400">Коригування</span>
                        <span className="font-mono text-amber-500">{totalAdj >= 0 ? '+' : ''}{totalAdj.toFixed(2)}</span>
                      </div>
                    )}

                    {/* Payments — single total line */}
                    {(group?.payments ?? []).length > 0 && (
                      <div className="flex justify-between py-0.5">
                        <span className="text-gray-400">Оплата</span>
                        <span className="font-mono text-green-600">+{totalPayments.toFixed(2)}</span>
                      </div>
                    )}

                    {!group && (
                      <p className="text-gray-400 py-1">Рухів за цей рахунок немає</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
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
