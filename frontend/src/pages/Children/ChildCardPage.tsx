import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { childrenApi } from '../../api/children.api'
import { groupsApi } from '../../api/groups.api'
import { familiesApi } from '../../api/families.api'
import { activitiesApi } from '../../api/activities.api'
import { accountsApi } from '../../api/accounts.api'
import { enrollmentsApi } from '../../api/enrollments.api'
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

      {/* Balances placeholder */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="font-medium text-gray-900 mb-3">Баланси</h2>
        <p className="text-sm text-gray-400">Буде доступно після Етапу 4 (Billing Engine)</p>
      </div>

      {/* Enrollments */}
      {id && <EnrollmentsBlock childId={id} canEdit={canEdit} />}
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

function EnrollmentsBlock({ childId, canEdit }: { childId: string; canEdit: boolean }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [freezeId, setFreezeId] = useState<string | null>(null)
  const [freezeForm, setFreezeForm] = useState({ frozen_from: '', frozen_to: '' })
  const [enrollForm, setEnrollForm] = useState({ activity_id: '', account_id: '', start_date: new Date().toISOString().slice(0, 10), note: '' })
  const [enrollError, setEnrollError] = useState<string | null>(null)

  const { data: enrollments = [], isLoading } = useQuery({
    queryKey: ['enrollments', childId],
    queryFn: () => enrollmentsApi.listByChild(childId),
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

  const handleCreate = () => {
    if (!enrollForm.activity_id || !enrollForm.account_id || !enrollForm.start_date) {
      setEnrollError('Оберіть активність, рахунок та дату початку')
      return
    }
    createMutation.mutate()
  }

  const activeEnrollments   = enrollments.filter((e) => e.status !== 'archived')
  const archivedEnrollments = enrollments.filter((e) => e.status === 'archived')

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-gray-900">Підписки на активності ({activeEnrollments.length})</h2>
        {canEdit && !showForm && (
          <button onClick={() => setShowForm(true)} className="text-sm text-iris-600 hover:text-iris-700 font-medium">+ Записати</button>
        )}
      </div>

      {/* Форма запису */}
      {showForm && (
        <div className="p-4 bg-iris-50 rounded-lg space-y-3">
          <p className="text-sm font-medium text-gray-700">Нова підписка</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Активність *</label>
              <select value={enrollForm.activity_id} onChange={(e) => setEnrollForm({ ...enrollForm, activity_id: e.target.value })}
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
            <button onClick={handleCreate} disabled={createMutation.isPending}
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
          {activeEnrollments.map((e) => (
            <li key={e.id} className="py-3">
              {freezeId === e.id ? (
                <div className="space-y-2 p-3 bg-blue-50 rounded-lg">
                  <p className="text-xs font-medium text-gray-700">Заморозити підписку</p>
                  <div className="flex gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Від</label>
                      <input type="date" value={freezeForm.frozen_from} onChange={(e) => setFreezeForm({ ...freezeForm, frozen_from: e.target.value })}
                        className="rounded border-gray-300 text-xs shadow-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">До</label>
                      <input type="date" value={freezeForm.frozen_to} onChange={(e) => setFreezeForm({ ...freezeForm, frozen_to: e.target.value })}
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
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{e.activity_name}</p>
                    <p className="text-xs text-gray-400">
                      {e.account_name} · з {new Date(e.start_date).toLocaleDateString('uk-UA')}
                      {e.base_fee ? ` · ${Number(e.base_fee).toFixed(0)} грн` : ''}
                      {e.status === 'frozen' && e.frozen_from && e.frozen_to && (
                        <> · заморожена до {new Date(e.frozen_to).toLocaleDateString('uk-UA')}</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[e.status]}`}>
                      {STATUS_LABELS[e.status]}
                    </span>
                    {canEdit && (
                      <div className="flex gap-2 text-xs text-gray-400">
                        {e.status === 'active' && (
                          <button onClick={() => { setFreezeId(e.id); setFreezeForm({ frozen_from: new Date().toISOString().slice(0, 10), frozen_to: '' }) }}
                            className="hover:text-blue-600 transition-colors">Заморозити</button>
                        )}
                        {e.status === 'frozen' && (
                          <button onClick={() => unfreezeMutation.mutate(e.id)} className="hover:text-green-600 transition-colors">Розморозити</button>
                        )}
                        <button onClick={() => archiveMutation.mutate(e.id)} className="hover:text-red-600 transition-colors">Архів</button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
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
