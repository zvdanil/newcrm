import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { expensesApi, salaryPaymentsApi, type Expense, type ExpenseCategory, type StaffAdvancePool, type SalaryPayment } from '../../api/expenses.api'
import { staffApi, type StaffMember } from '../../api/staff.api'
import { accountsApi } from '../../api/accounts.api'
import { useCanAccess } from '../../hooks/useCanAccess'
import { today as todayStr, firstOfMonth } from '../../utils/dateStr'

// ── helpers ────────────────────────────────────────────────────────────────

function fmt(v: string | number) { return Number(v).toFixed(2) }

function fmtNote(note: string | null | undefined): string {
  if (!note) return ''
  if (note.startsWith('bank_ref:')) {
    const human = note.split('\n').slice(1).join(' ').trim()
    return human || 'Імпорт виписки'
  }
  return note
}

function useCategoryTree(categories: ExpenseCategory[]) {
  return useMemo(() => {
    const parents = categories.filter(c => !c.parent_id)
    const childrenOf = (id: string) => categories.filter(c => c.parent_id === id)
    return { parents, childrenOf }
  }, [categories])
}

function categoryLabel(expense: Expense) {
  if (expense.parent_category_name && expense.category_name) {
    return `${expense.parent_category_name} › ${expense.category_name}`
  }
  return expense.category_name ?? '—'
}


// ── Default account (localStorage) ────────────────────────────────────────

const LS_KEY = 'iris_expenses_default_account'

function useDefaultAccount() {
  const [defaultAccountId, setDefaultAccountIdState] = useState<string>(
    () => localStorage.getItem(LS_KEY) ?? ''
  )

  function setDefaultAccountId(id: string) {
    setDefaultAccountIdState(id)
    if (id) localStorage.setItem(LS_KEY, id)
    else     localStorage.removeItem(LS_KEY)
  }

  return { defaultAccountId, setDefaultAccountId }
}

function DefaultAccountBadge({ accounts, defaultAccountId, onChange }: {
  accounts: { id: string; name: string }[]
  defaultAccountId: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = accounts.find(a => a.id === defaultAccountId)

  return (
    <div className="relative flex items-center gap-1.5">
      <span className="text-xs text-gray-400">Рахунок за замовч.:</span>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`text-xs px-2.5 py-1 rounded-full border transition-colors flex items-center gap-1 ${
          current
            ? 'border-iris-300 bg-iris-50 text-iris-700 hover:bg-iris-100'
            : 'border-gray-200 bg-gray-50 text-gray-400 hover:bg-gray-100'
        }`}
      >
        📌 {current?.name ?? 'не вибрано'}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg py-1 min-w-[180px]">
            <button
              onClick={() => { onChange(''); setOpen(false) }}
              className="w-full text-left text-xs px-3 py-2 text-gray-400 hover:bg-gray-50"
            >
              — не вибрано —
            </button>
            {accounts.map(a => (
              <button
                key={a.id}
                onClick={() => { onChange(a.id); setOpen(false) }}
                className={`w-full text-left text-xs px-3 py-2 hover:bg-iris-50 transition-colors ${
                  a.id === defaultAccountId ? 'text-iris-700 font-medium' : 'text-gray-700'
                }`}
              >
                {a.id === defaultAccountId && '✓ '}{a.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Two-level CategoryPicker ───────────────────────────────────────────────

interface CategoryPickerProps {
  categories: ExpenseCategory[]
  value: string        // category_id (parent or child)
  onChange: (id: string) => void
  onNewSubcategory?: (parentId: string, name: string) => Promise<ExpenseCategory>
}

function CategoryPicker({ categories, value, onChange, onNewSubcategory }: CategoryPickerProps) {
  const { parents, childrenOf } = useCategoryTree(categories)

  // Determine current parent and child selection from value
  const selectedCat = categories.find(c => c.id === value)
  const initParentId = selectedCat
    ? (selectedCat.parent_id ?? selectedCat.id)
    : ''
  const initChildId = selectedCat?.parent_id ? selectedCat.id : ''

  const [parentId, setParentId] = useState(initParentId)
  const [childId,  setChildId]  = useState(initChildId)
  const [addingChild, setAddingChild] = useState(false)
  const [newChildName, setNewChildName] = useState('')
  const [saving, setSaving] = useState(false)

  const subs = parentId ? childrenOf(parentId) : []

  function handleParentChange(pid: string) {
    setParentId(pid)
    setChildId('')
    setAddingChild(false)
    setNewChildName('')
    // If parent has no subcategories → use parent as the value directly
    const kids = pid ? childrenOf(pid) : []
    onChange(kids.length === 0 ? pid : '')
  }

  function handleChildChange(cid: string) {
    setChildId(cid)
    // Empty child means "use parent category as-is"
    onChange(cid || parentId)
  }

  async function handleAddChild() {
    if (!newChildName.trim() || !parentId || !onNewSubcategory) return
    setSaving(true)
    try {
      const created = await onNewSubcategory(parentId, newChildName.trim())
      setChildId(created.id)
      onChange(created.id)
      setAddingChild(false)
      setNewChildName('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      {/* Parent category */}
      <select
        value={parentId}
        onChange={e => handleParentChange(e.target.value)}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
      >
        <option value="">— без категорії —</option>
        {parents.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      {/* Subcategory (shown only when parent is selected and has children) */}
      {parentId && subs.length > 0 && !addingChild && (
        <div className="flex gap-2 pl-4">
          <select
            value={childId}
            onChange={e => handleChildChange(e.target.value)}
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
          >
            <option value="">— ця категорія (загальне) —</option>
            {subs.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {onNewSubcategory && (
            <button
              type="button"
              onClick={() => setAddingChild(true)}
              className="text-xs text-iris-600 hover:text-iris-800 px-2 whitespace-nowrap"
              title="Додати підкатегорію"
            >
              + нова
            </button>
          )}
        </div>
      )}

      {/* When parent has no subcategories yet — show option to add one */}
      {parentId && subs.length === 0 && onNewSubcategory && !addingChild && (
        <div className="pl-4">
          <button
            type="button"
            onClick={() => setAddingChild(true)}
            className="text-xs text-gray-400 hover:text-iris-600 transition-colors"
          >
            + додати підкатегорію
          </button>
        </div>
      )}

      {/* Inline new subcategory input */}
      {addingChild && parentId && (
        <div className="pl-4 flex gap-2">
          <input
            autoFocus
            type="text"
            placeholder="Назва підкатегорії"
            value={newChildName}
            onChange={e => setNewChildName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddChild(); if (e.key === 'Escape') { setAddingChild(false); setNewChildName('') } }}
            className="flex-1 text-sm border border-iris-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500"
          />
          <button type="button" onClick={handleAddChild} disabled={saving || !newChildName.trim()}
            className="text-xs px-3 py-1.5 bg-iris-600 text-white rounded-lg hover:bg-iris-700 disabled:opacity-50">
            {saving ? '...' : 'Додати'}
          </button>
          <button type="button" onClick={() => { setAddingChild(false); setNewChildName('') }}
            className="text-xs text-gray-500 hover:text-gray-700">
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

// ── Categories Manager Tab ─────────────────────────────────────────────────

function CategoriesManager() {
  const qc = useQueryClient()
  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: expensesApi.getCategories,
  })
  const { parents, childrenOf } = useCategoryTree(categories)

  const [editingId, setEditingId]   = useState<string | null>(null)
  const [editName, setEditName]     = useState('')
  const [addingChildOf, setAddingChildOf] = useState<string | null>(null)
  const [addingParent, setAddingParent]   = useState(false)
  const [newName, setNewName]       = useState('')
  const [error, setError]           = useState<string | null>(null)

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      expensesApi.updateCategory(id, { name }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expense-categories'] }); setEditingId(null) },
  })

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof expensesApi.createCategory>[0]) =>
      expensesApi.createCategory(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-categories'] })
      setAddingChildOf(null)
      setAddingParent(false)
      setNewName('')
      setError(null)
    },
    onError: () => setError('Помилка збереження'),
  })

  const deleteMutation = useMutation({
    mutationFn: expensesApi.deleteCategory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expense-categories'] }),
    onError: (e: { response?: { data?: { message?: string } } }) =>
      alert(e.response?.data?.message ?? 'Помилка видалення'),
  })

  function startEdit(cat: ExpenseCategory) {
    setEditingId(cat.id)
    setEditName(cat.name)
  }

  function confirmDelete(cat: ExpenseCategory, hasChildren: boolean) {
    const warn = hasChildren
      ? 'Неможливо видалити: спочатку видаліть підкатегорії.'
      : `Видалити категорію "${cat.name}"? Витрати перейдуть в "без категорії".`
    if (hasChildren) { alert(warn); return }
    if (window.confirm(warn)) deleteMutation.mutate(cat.id)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
      {parents.length === 0 && (
        <div className="py-8 text-center text-sm text-gray-400">Категорій ще немає</div>
      )}

      {parents.map(parent => {
        const subs = childrenOf(parent.id)
        return (
          <div key={parent.id} className="p-4 space-y-2">
            {/* Parent row */}
            <div className="flex items-center gap-2">
              {editingId === parent.id ? (
                <>
                  <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') updateMutation.mutate({ id: parent.id, name: editName }); if (e.key === 'Escape') setEditingId(null) }}
                    className="flex-1 text-sm border border-iris-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
                  <button onClick={() => updateMutation.mutate({ id: parent.id, name: editName })}
                    disabled={updateMutation.isPending}
                    className="text-xs px-3 py-1.5 bg-iris-600 text-white rounded-lg hover:bg-iris-700 disabled:opacity-50">
                    Зберегти
                  </button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-gray-500 hover:text-gray-700">Скасувати</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-gray-900">{parent.name}</span>
                  <span className="text-xs text-gray-400">{subs.length > 0 ? `${subs.length} підкатегорій` : ''}</span>
                  <button onClick={() => startEdit(parent)}
                    className="text-xs text-gray-400 hover:text-iris-600 transition-colors">ред.</button>
                  <button onClick={() => confirmDelete(parent, subs.length > 0)}
                    className="text-xs text-gray-300 hover:text-red-500 transition-colors">видалити</button>
                </>
              )}
            </div>

            {/* Subcategories */}
            {subs.map(sub => (
              <div key={sub.id} className="flex items-center gap-2 pl-6">
                <span className="text-gray-300 text-xs mr-1">↳</span>
                {editingId === sub.id ? (
                  <>
                    <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') updateMutation.mutate({ id: sub.id, name: editName }); if (e.key === 'Escape') setEditingId(null) }}
                      className="flex-1 text-sm border border-iris-300 rounded-lg px-3 py-1 focus:outline-none focus:ring-2 focus:ring-iris-500" />
                    <button onClick={() => updateMutation.mutate({ id: sub.id, name: editName })}
                      disabled={updateMutation.isPending}
                      className="text-xs px-3 py-1 bg-iris-600 text-white rounded-lg hover:bg-iris-700 disabled:opacity-50">
                      Зберегти
                    </button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-gray-500">Скасувати</button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-gray-700">{sub.name}</span>
                    <button onClick={() => startEdit(sub)}
                      className="text-xs text-gray-400 hover:text-iris-600 transition-colors">ред.</button>
                    <button onClick={() => confirmDelete(sub, false)}
                      className="text-xs text-gray-300 hover:text-red-500 transition-colors">видалити</button>
                  </>
                )}
              </div>
            ))}

            {/* Add subcategory */}
            {addingChildOf === parent.id ? (
              <div className="flex items-center gap-2 pl-6">
                <span className="text-gray-300 text-xs mr-1">↳</span>
                <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                  placeholder="Назва підкатегорії"
                  onKeyDown={e => {
                    if (e.key === 'Enter') createMutation.mutate({ name: newName.trim(), parent_id: parent.id })
                    if (e.key === 'Escape') { setAddingChildOf(null); setNewName('') }
                  }}
                  className="flex-1 text-sm border border-iris-300 rounded-lg px-3 py-1 focus:outline-none focus:ring-2 focus:ring-iris-500" />
                <button onClick={() => { if (newName.trim()) createMutation.mutate({ name: newName.trim(), parent_id: parent.id }) }}
                  disabled={createMutation.isPending || !newName.trim()}
                  className="text-xs px-3 py-1 bg-iris-600 text-white rounded-lg hover:bg-iris-700 disabled:opacity-50">
                  Додати
                </button>
                <button onClick={() => { setAddingChildOf(null); setNewName('') }}
                  className="text-xs text-gray-500">✕</button>
              </div>
            ) : (
              <button onClick={() => { setAddingChildOf(parent.id); setAddingParent(false); setNewName('') }}
                className="pl-6 text-xs text-gray-400 hover:text-iris-600 transition-colors">
                + підкатегорія
              </button>
            )}
          </div>
        )
      })}

      {/* Add parent category */}
      <div className="p-4">
        {addingParent ? (
          <div className="flex items-center gap-2">
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Назва категорії"
              onKeyDown={e => {
                if (e.key === 'Enter') createMutation.mutate({ name: newName.trim() })
                if (e.key === 'Escape') { setAddingParent(false); setNewName('') }
              }}
              className="flex-1 text-sm border border-iris-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-500" />
            <button onClick={() => { if (newName.trim()) createMutation.mutate({ name: newName.trim() }) }}
              disabled={createMutation.isPending || !newName.trim()}
              className="text-xs px-3 py-1.5 bg-iris-600 text-white rounded-lg hover:bg-iris-700 disabled:opacity-50">
              Додати
            </button>
            <button onClick={() => { setAddingParent(false); setNewName('') }}
              className="text-xs text-gray-500">Скасувати</button>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        ) : (
          <button onClick={() => { setAddingParent(true); setAddingChildOf(null); setNewName('') }}
            className="text-sm text-iris-600 hover:text-iris-800 font-medium transition-colors">
            + Нова категорія
          </button>
        )}
      </div>
    </div>
  )
}

// ── Add/Edit Expense Form ──────────────────────────────────────────────────

interface ExpenseFormProps {
  categories: ExpenseCategory[]
  accounts: { id: string; name: string }[]
  initial?: Partial<Expense>
  defaultAccountId?: string
  onSave: (usedAccountId?: string) => void
  onCancel: () => void
}

function ExpenseForm({ categories, accounts, initial, defaultAccountId = '', onSave, onCancel }: ExpenseFormProps) {
  const qc = useQueryClient()
  const today = todayStr()
  const isEdit = !!initial?.id

  const [form, setForm] = useState({
    account_id:       initial?.account_id ?? defaultAccountId,
    category_id:      initial?.category_id ?? '',
    amount:           initial ? fmt(initial.amount ?? 0) : '',
    accrual_date:     initial?.accrual_date?.slice(0, 10) ?? today,
    is_instant:       initial?.is_instant ?? true,
    is_dividend:      initial?.is_dividend ?? false,
    note:             initial?.note ?? '',
    is_advance:       initial?.is_advance ?? false,
    staff_id:         initial?.staff_id ?? '',
    advance_staff_id: '',   // staff whose pool to deduct from when creating an expense
  })
  const [editNote, setEditNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Завантажуємо пули авансів по сотрудниках для обраної категорії
  const { data: advancePools = [] } = useQuery<StaffAdvancePool[]>({
    queryKey: ['advances', form.category_id],
    queryFn: () => expensesApi.getAdvances(form.category_id),
    enabled: !!form.category_id && !form.is_advance && !isEdit,
  })

  // Завантажуємо активних співробітників для видачі авансу
  const { data: staffList = [] } = useQuery<StaffMember[]>({
    queryKey: ['staff', 'active'],
    queryFn: () => staffApi.list({ is_active: true }),
    enabled: form.is_advance && !isEdit,
  })

  // Авто-вибір першого пулу при завантаженні
  useEffect(() => {
    if (!form.is_advance && advancePools.length > 0 && !form.advance_staff_id) {
      const firstPool = advancePools[0]
      setForm(f => ({ ...f, advance_staff_id: firstPool.staff_id ?? '__no_staff__' }))
    }
  }, [advancePools])

  const selectedPool = advancePools.find(p =>
    form.advance_staff_id === '__no_staff__' ? p.staff_id === null : p.staff_id === form.advance_staff_id
  )
  const totalBill = Number(form.amount) || 0
  const advanceCoverage = selectedPool ? Math.min(totalBill, selectedPool.remaining_balance) : 0
  const amountFromAccount = totalBill - advanceCoverage

  async function handleNewSubcategory(parentId: string, name: string): Promise<ExpenseCategory> {
    const created = await expensesApi.createCategory({ name, parent_id: parentId })
    qc.invalidateQueries({ queryKey: ['expense-categories'] })
    return created
  }

  const createMutation = useMutation({
    mutationFn: expensesApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); onSave(form.account_id) },
    onError: () => setError('Помилка збереження'),
  })

  const updateMutation = useMutation({
    mutationFn: (p: Parameters<typeof expensesApi.update>[1]) => expensesApi.update(initial!.id!, p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); onSave(form.account_id) },
    onError: () => setError('Помилка збереження'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const amount = parseFloat(form.amount)
    if (!form.account_id) return setError('Оберіть рахунок')
    if (!amount || amount <= 0) return setError('Введіть суму')

    if (isEdit) {
      updateMutation.mutate({
        account_id:   form.account_id,
        category_id:  form.category_id || null,
        amount,
        accrual_date: form.accrual_date,
        note:      form.note || null,
        edit_note: editNote.trim() || undefined,
      })
    } else {
      const usePool = !form.is_advance && !!form.advance_staff_id && !!selectedPool
      createMutation.mutate({
        account_id:       form.account_id,
        category_id:      form.category_id || undefined,
        amount:           totalBill,
        accrual_date:     form.accrual_date,
        is_instant:       form.is_instant,
        is_dividend:      form.is_dividend,
        note:             form.note || undefined,
        is_advance:       form.is_advance,
        staff_id:         form.is_advance ? (form.staff_id || undefined) : undefined,
        advance_staff_id: usePool
          ? (form.advance_staff_id === '__no_staff__' ? null : form.advance_staff_id)
          : undefined,
      })
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <form onSubmit={handleSubmit} className="bg-iris-50 border border-iris-200 rounded-xl p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Рахунок *</label>
          <select value={form.account_id}
            onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500">
            <option value="">— оберіть —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Сума *</label>
          <input type="number" min="0.01" step="0.01" placeholder="0.00" value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Категорія</label>
        <CategoryPicker
          categories={categories}
          value={form.category_id}
          onChange={id => setForm(f => ({ ...f, category_id: id, advance_staff_id: '' }))}
          onNewSubcategory={handleNewSubcategory}
        />

        {/* Аванс під категорією — пули по співробітниках */}
        {!isEdit && !form.is_advance && advancePools.length > 0 && (
          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-blue-800">💳 Є аванс на цій категорії</h4>
              {selectedPool && (
                <span className="text-xs text-blue-600 font-medium">залишок: {selectedPool.remaining_balance} ₴</span>
              )}
            </div>
            <select
              value={form.advance_staff_id}
              onChange={e => setForm(f => ({ ...f, advance_staff_id: e.target.value }))}
              className="w-full text-sm border border-blue-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— не використовувати аванс —</option>
              {advancePools.map(p => {
                const key = p.staff_id ?? '__no_staff__'
                const label = p.staff_name ? `${p.staff_name} — ${p.remaining_balance} ₴` : `Без співробітника — ${p.remaining_balance} ₴`
                return <option key={key} value={key}>{label}</option>
              })}
            </select>

            {selectedPool && totalBill > 0 && (
              <div className="mt-2 text-xs text-blue-900 space-y-1 bg-white/60 p-2 rounded border border-blue-100">
                <div className="flex justify-between">
                  <span>Сума чеку:</span>
                  <span className="font-medium">{totalBill} ₴</span>
                </div>
                <div className="flex justify-between">
                  <span>З авансу:</span>
                  <span className="font-medium text-green-700">−{advanceCoverage} ₴</span>
                </div>
                <div className="flex justify-between border-t border-blue-200/50 pt-1 font-semibold">
                  <span>З рахунку:</span>
                  <span className={amountFromAccount > 0 ? 'text-red-600' : 'text-gray-500'}>{amountFromAccount} ₴</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Дата нарахування</label>
          <input type="date" value={form.accrual_date}
            onChange={e => setForm(f => ({ ...f, accrual_date: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Нотатка</label>
          <input type="text" placeholder="Опис витрати" value={form.note}
            onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
        </div>
      </div>

      {isEdit ? (
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Причина правки</label>
          <input type="text" value={editNote}
            onChange={e => setEditNote(e.target.value)}
            placeholder="Хто, що і чому змінено..."
            className="w-full text-sm border border-amber-200 bg-amber-50 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
        </div>
      ) : (
        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.is_instant}
              onChange={e => setForm(f => ({ ...f, is_instant: e.target.checked }))}
              className="rounded" />
            Миттєвий (одразу оплачено)
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={form.is_dividend}
              onChange={e => setForm(f => ({ ...f, is_dividend: e.target.checked }))}
              className="rounded" />
            Дивіденд / вивід коштів
          </label>
        </div>
      )}

      {!isEdit && (
        <div className="pt-2 border-t border-iris-100">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer font-medium mb-3">
            <input type="checkbox" checked={form.is_advance}
              onChange={e => setForm(f => ({ ...f, is_advance: e.target.checked, advance_staff_id: '' }))}
              className="rounded text-iris-600 focus:ring-iris-500" />
            💰 Це видача авансу на майбутні витрати
          </label>

          {form.is_advance && (
            <div className="mb-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Співробітник (кому видано аванс)</label>
              <select value={form.staff_id} onChange={e => setForm(f => ({ ...f, staff_id: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500">
                <option value="">— без співробітника —</option>
                {staffList.map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={isPending}
          className="px-4 py-2 bg-iris-600 text-white text-sm rounded-lg hover:bg-iris-700 disabled:opacity-50 transition-colors">
          {isPending ? 'Збереження...' : isEdit ? 'Зберегти' : 'Додати'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
          Скасувати
        </button>
      </div>
    </form>
  )
}

// ── Transfer Form ──────────────────────────────────────────────────────────

function TransferForm({ accounts, onSave, onCancel }: {
  accounts: { id: string; name: string }[]
  onSave: () => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const today = todayStr()
  const [form, setForm] = useState({
    from_account_id: '', to_account_id: '',
    amount: '', commission: '0', transfer_date: today, note: '',
  })
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: expensesApi.createTransfer,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transfers'] }); onSave() },
    onError: () => setError('Помилка збереження'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.from_account_id || !form.to_account_id) return setError('Оберіть рахунки')
    if (form.from_account_id === form.to_account_id) return setError('Рахунки повинні різнитися')
    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) return setError('Введіть суму')
    mutation.mutate({
      from_account_id: form.from_account_id,
      to_account_id:   form.to_account_id,
      amount,
      commission: parseFloat(form.commission) || 0,
      transfer_date: form.transfer_date,
      note: form.note || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-medium text-gray-900">Переказ між рахунками</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">З рахунку</label>
          <select value={form.from_account_id} onChange={e => setForm(f => ({ ...f, from_account_id: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500">
            <option value="">— оберіть —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">На рахунок</label>
          <select value={form.to_account_id} onChange={e => setForm(f => ({ ...f, to_account_id: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500">
            <option value="">— оберіть —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Сума</label>
          <input type="number" min="0.01" step="0.01" placeholder="0.00" value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Комісія</label>
          <input type="number" min="0" step="0.01" placeholder="0.00" value={form.commission}
            onChange={e => setForm(f => ({ ...f, commission: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Дата</label>
          <input type="date" value={form.transfer_date}
            onChange={e => setForm(f => ({ ...f, transfer_date: e.target.value }))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </div>
      </div>
      <input type="text" placeholder="Нотатка" value={form.note}
        onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500" />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending}
          className="px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors">
          {mutation.isPending ? '...' : 'Зберегти'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
          Скасувати
        </button>
      </div>
    </form>
  )
}

// ── Withdrawal Dialog ──────────────────────────────────────────────────────

function WithdrawalDialog({ expense, accounts, onClose, onSuccess }: {
  expense: Expense
  accounts: { id: string; name: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const qc = useQueryClient()
  const amount = Number(expense.amount)
  const today  = todayStr()

  const [form, setForm] = useState({
    target_account_id: '',
    withdrawal_amount: String(amount),
    commission: '0',
    transfer_date: today,
  })
  const [error, setError] = useState<string | null>(null)

  const withdrawalAmount = parseFloat(form.withdrawal_amount) || 0
  const commissionPct      = parseFloat(form.commission) || 0
  const commissionUah    = Math.round(withdrawalAmount * commissionPct * 100) / 10000
  const returnAmount     = Math.round((withdrawalAmount - commissionUah) * 100) / 100

  const mutation = useMutation({
    mutationFn: () => expensesApi.withdraw(expense.id, {
      target_account_id: form.target_account_id,
      withdrawal_amount: withdrawalAmount,
      commission: commissionPct,
      transfer_date: form.transfer_date,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      qc.invalidateQueries({ queryKey: ['transfers'] })
      qc.invalidateQueries({ queryKey: ['account-ledger'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      onSuccess()
      onClose()
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      setError(e.response?.data?.message ?? 'Помилка виконання')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.target_account_id) return setError('Оберіть рахунок зарахування')
    if (form.target_account_id === expense.account_id) return setError('Рахунок зарахування повинен відрізнятись від рахунку списання')
    if (withdrawalAmount <= 0) return setError('Введіть суму виводу')
    if (withdrawalAmount > amount + 0.001) return setError('Сума виводу не може перевищувати суму витрати')
    if (commissionPct < 0 || commissionPct > 100) return setError('Комісія має бути від 0 до 100 %')
    if (commissionUah >= withdrawalAmount) return setError('Комісія не може перевищувати суму виводу')
    mutation.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Обналичування</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {/* Source info */}
        <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Рахунок списання</span>
            <span className="font-medium">{expense.account_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Сума витрати</span>
            <span className="font-mono font-medium">{fmt(expense.amount)}</span>
          </div>
          {expense.note && (
            <div className="flex justify-between gap-4">
              <span className="text-gray-500 shrink-0">Опис</span>
              <span className="text-gray-700 text-right">{fmtNote(expense.note)}</span>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Рахунок зарахування (куди повертаються кошти) *
            </label>
            <select
              value={form.target_account_id}
              onChange={e => setForm(f => ({ ...f, target_account_id: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
            >
              <option value="">— оберіть рахунок —</option>
              {accounts
                .filter(a => a.id !== expense.account_id)
                .map(a => <option key={a.id} value={a.id}>{a.name}</option>)
              }
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Сума виводу на інший рахунок, ₴ *
            </label>
            <input
              type="number" min="0.01" step="0.01" max={amount}
              value={form.withdrawal_amount}
              onChange={e => setForm(f => ({ ...f, withdrawal_amount: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
            />
            <p className="text-xs text-gray-400 mt-0.5">Максимум — повна сума витрати ({amount.toFixed(2)} ₴)</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Комісія, %</label>
              <input
                type="number" min="0" max="100" step="0.01" placeholder="0"
                value={form.commission}
                onChange={e => setForm(f => ({ ...f, commission: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Дата</label>
              <input
                type="date" value={form.transfer_date}
                onChange={e => setForm(f => ({ ...f, transfer_date: e.target.value }))}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
              />
            </div>
          </div>

          {/* Summary */}
          <div className="bg-iris-50 rounded-xl p-3 text-sm space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-600">Переказ на рахунок</span>
              <span className="font-mono font-medium">+{withdrawalAmount.toFixed(2)} ₴</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Буде зараховано (після комісії)</span>
              <span className="font-mono font-semibold text-green-700">+{returnAmount.toFixed(2)} ₴</span>
            </div>
            {commissionUah > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-600">Окремий витрат «Комісія» ({commissionPct}%)</span>
                <span className="font-mono text-red-600">−{commissionUah.toFixed(2)} ₴</span>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 py-2 bg-iris-600 text-white text-sm rounded-lg hover:bg-iris-700 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? 'Виконання...' : 'Підтвердити'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Скасувати
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Expense Row ────────────────────────────────────────────────────────────

function ExpenseRow({ expense, isOwner, isAdmin, categories, accounts, onRefresh }: {
  expense: Expense
  isOwner: boolean
  isAdmin: boolean
  categories: ExpenseCategory[]
  accounts: { id: string; name: string }[]
  onRefresh: () => void
}) {
  const qc = useQueryClient()
  const [editing, setEditing]       = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const payMutation = useMutation({
    mutationFn: () => expensesApi.pay(expense.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); onRefresh() },
  })
  const deleteMutation = useMutation({
    mutationFn: () => expensesApi.delete(expense.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); onRefresh() },
  })
  const navigate = useNavigate()
  const dividendMutation = useMutation({
    mutationFn: (val: boolean) => expensesApi.toggleDividend(expense.id, val),
    onSuccess: (data, val) => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      onRefresh()
      if (val) {
        navigate(`/dividends?add_expense=${expense.id}`)
      }
    },
  })

  if (editing) {
    return (
      <tr>
        <td colSpan={6} className="px-4 py-2">
          <ExpenseForm
            categories={categories} accounts={accounts} initial={expense}
            onSave={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </td>
      </tr>
    )
  }

  return (
    <tr className={`hover:bg-gray-50 transition-colors ${expense.is_dividend ? 'bg-purple-50/40' : ''}`}>
      <td className="px-4 py-2.5 text-sm text-gray-500 whitespace-nowrap">
        {expense.accrual_date.slice(0, 10)}
      </td>
      <td className="px-4 py-2.5 text-sm text-gray-700">
        <div className="flex items-center gap-1.5">
          {expense.is_dividend && (
            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">дивіденд</span>
          )}
          {expense.is_advance && (
            <span className="text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded font-medium">
              аванс{expense.staff_name ? ` → ${expense.staff_name}` : ''}
            </span>
          )}
          {(expense.advance_staff_id || expense.utilized_advance_id || Number(expense.pool_advance_amount) > 0) && !expense.is_advance_return && (
            <span className="text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded font-medium">
              з авансу{
                Number(expense.pool_advance_amount) > 0
                  ? ` (${Number(expense.pool_advance_amount).toFixed(2)} ₴)`
                  : expense.utilized_advance_amount
                    ? ` (${expense.utilized_advance_amount} ₴)`
                    : ''
              }
            </span>
          )}
          {expense.is_advance_return && (
            <span className="text-xs bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-medium">повернення авансу</span>
          )}
          <span>{categoryLabel(expense)}</span>
        </div>
        {(expense.note || expense.staff_name) && (
          <p className="text-xs text-gray-400 mt-0.5 break-words">
            {fmtNote(expense.note)}{expense.staff_name ? ` (${expense.staff_name})` : ''}
          </p>
        )}
      </td>
      <td className="px-4 py-2.5 text-sm text-gray-500">{expense.account_name}</td>
      <td className="px-4 py-2.5 text-sm font-mono font-medium text-gray-900 text-right">
        {fmt(expense.amount)}
      </td>
      <td className="px-4 py-2.5">
        {expense.status === 'paid' ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700">
            {expense.is_instant ? 'миттєво' : `оплачено ${expense.payment_date?.slice(0, 10) ?? ''}`}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
            очікує оплати
          </span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2 justify-end">
          {expense.is_advance && (
            <button onClick={async () => {
              const amountStr = window.prompt('Введіть суму повернення залишку (₴):')
              if (!amountStr) return
              const amount = parseFloat(amountStr)
              if (amount > 0) {
                await expensesApi.returnAdvance(expense.id, { amount, account_id: expense.account_id })
                qc.invalidateQueries({ queryKey: ['expenses'] })
                onRefresh()
              }
            }}
              className="text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-1.5 py-1 rounded transition-colors"
              title="Повернути залишок у касу">⮌ повернення
            </button>
          )}
          {expense.status === 'pending' && (isOwner || isAdmin) && (
            <button onClick={() => { if (window.confirm('Оплатити витрату?')) payMutation.mutate() }}
              disabled={payMutation.isPending}
              className="text-xs px-2 py-1 bg-green-50 text-green-700 hover:bg-green-100 rounded transition-colors">
              Оплатити
            </button>
          )}
          {isOwner && (
            <button
              onClick={() => dividendMutation.mutate(!expense.is_dividend)}
              disabled={dividendMutation.isPending}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                expense.is_dividend
                  ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                  : 'text-gray-400 hover:text-purple-600 hover:bg-purple-50'
              }`}
              title={expense.is_dividend ? 'Зняти позначку дивіденду' : 'Позначити як дивіденд'}
            >
              ₴↑
            </button>
          )}
          {isOwner && (
            expense.withdrawal_transfer_id ? (
              <span className="text-xs text-amber-700 font-medium" title="Обналичено">
                ↗ обнал.{expense.withdrawal_amount ? ` ${Number(expense.withdrawal_amount).toFixed(2)} ₴` : ''}
              </span>
            ) : (
              <button
                onClick={() => setWithdrawing(true)}
                className="text-xs text-gray-400 hover:text-amber-600 hover:bg-amber-50 px-1.5 py-1 rounded transition-colors"
                title="Обналичування"
              >
                ↗
              </button>
            )
          )}
          {(isOwner || isAdmin) && (
            <button onClick={() => setEditing(true)}
              className="text-xs text-gray-400 hover:text-iris-600 transition-colors">ред.</button>
          )}
          {(isOwner || isAdmin) && (
            <button onClick={() => setShowHistory(true)}
              className="text-xs text-gray-300 hover:text-gray-500 transition-colors" title="Історія змін">
              📋
            </button>
          )}
          {(isOwner || isAdmin) && (
            <button onClick={() => { if (window.confirm('Видалити витрату?')) deleteMutation.mutate() }}
              disabled={deleteMutation.isPending}
              className="text-xs text-gray-300 hover:text-red-500 transition-colors">✕</button>
          )}
        </div>
        {withdrawing && (
          <WithdrawalDialog
            expense={expense}
            accounts={accounts}
            onClose={() => setWithdrawing(false)}
            onSuccess={onRefresh}
          />
        )}
        {showHistory && (
          <ExpenseHistoryPopup expenseId={expense.id} onClose={() => setShowHistory(false)} />
        )}
      </td>
    </tr>
  )
}

// ── Expense History Popup ──────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  amount:       'Сума',
  note:         'Нотатка',
  category_id:  'Категорія',
  accrual_date: 'Дата нарахування',
  account_id:   'Рахунок',
}

function ExpenseHistoryPopup({ expenseId, onClose }: { expenseId: string; onClose: () => void }) {
  const { data: edits = [], isLoading } = useQuery({
    queryKey: ['expense-edits', expenseId],
    queryFn: () => expensesApi.getEdits(expenseId),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Історія змін</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <p className="text-sm text-gray-400 py-4 text-center">Завантаження...</p>
          ) : edits.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">Змін не знайдено</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Дата</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Хто</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Поле</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Було</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Стало</th>
                  <th className="text-left px-3 py-2 text-gray-500 font-medium">Причина</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {edits.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{String(e.edited_at).slice(0, 16).replace('T', ' ')}</td>
                    <td className="px-3 py-2 text-gray-600">{e.editor_email ?? '—'}</td>
                    <td className="px-3 py-2 font-medium">{FIELD_LABELS[e.field_name] ?? e.field_name}</td>
                    <td className="px-3 py-2 text-red-600 line-through">{e.old_value ?? '—'}</td>
                    <td className="px-3 py-2 text-green-700 font-medium">{e.new_value ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-400 italic">{e.edit_note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Salary Withdrawal Dialog ───────────────────────────────────────────────

function SalaryWithdrawalDialog({ payment, accounts, onClose, onSuccess }: {
  payment: SalaryPayment
  accounts: { id: string; name: string }[]
  onClose: () => void
  onSuccess: () => void
}) {
  const qc = useQueryClient()
  const amount = Number(payment.gross_amount)
  const today  = todayStr()

  const [form, setForm] = useState({
    target_account_id: '',
    commission: '0',
    transfer_date: today,
  })
  const [error, setError] = useState<string | null>(null)

  const commissionPct   = parseFloat(form.commission) || 0
  const commissionUah   = Math.round(amount * commissionPct * 100) / 10000
  const returnAmount    = Math.round((amount - commissionUah) * 100) / 100

  const mutation = useMutation({
    mutationFn: () => salaryPaymentsApi.withdraw(payment.id, {
      target_account_id: form.target_account_id,
      commission: commissionPct,
      transfer_date: form.transfer_date,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['salary-payments'] })
      qc.invalidateQueries({ queryKey: ['transfers'] })
      onSuccess()
      onClose()
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      setError(e.response?.data?.message ?? 'Помилка виконання')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.target_account_id) return setError('Оберіть рахунок зарахування')
    if (form.target_account_id === payment.account_id) return setError('Рахунок зарахування повинен відрізнятись від рахунку списання')
    if (commissionPct < 0 || commissionPct > 100) return setError('Комісія має бути від 0 до 100 %')
    if (commissionUah >= amount) return setError('Комісія не може перевищувати суму')
    mutation.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Обналичування</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-gray-500">Співробітник</span>
            <span className="font-medium">{payment.staff_name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Рахунок списання</span>
            <span className="font-medium">{payment.account_name ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Сума</span>
            <span className="font-mono font-medium">{fmt(payment.gross_amount)}</span>
          </div>
          {payment.note && (
            <div className="flex justify-between">
              <span className="text-gray-500">Опис</span>
              <span className="text-gray-700">{payment.note}</span>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Рахунок зарахування (куди повертаються кошти) *
            </label>
            <select
              value={form.target_account_id}
              onChange={e => setForm(f => ({ ...f, target_account_id: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
            >
              <option value="">— оберіть рахунок —</option>
              {accounts
                .filter(a => a.id !== payment.account_id)
                .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Комісія, %</label>
            <input
              type="number" min="0" max="100" step="0.01"
              value={form.commission}
              onChange={e => setForm(f => ({ ...f, commission: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Дата переказу</label>
            <input
              type="date"
              value={form.transfer_date}
              onChange={e => setForm(f => ({ ...f, transfer_date: e.target.value }))}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500"
            />
          </div>

          <div className="bg-gray-50 rounded-xl p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Буде зараховано на рахунок</span>
              <span className="font-mono font-medium text-green-700">{returnAmount.toFixed(2)} ₴</span>
            </div>
            {commissionUah > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Окремий витрат «Комісія» ({commissionPct}%)</span>
                <span className="font-mono text-red-600">−{commissionUah.toFixed(2)} ₴</span>
              </div>
            )}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={mutation.isPending}
              className="flex-1 px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50 transition-colors">
              {mutation.isPending ? '...' : 'Обналичити'}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
              Скасувати
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── SalaryPaymentRow ───────────────────────────────────────────────────────

function SalaryPaymentRow({ payment, isOwner, accounts, onRefresh }: {
  payment: SalaryPayment
  isOwner: boolean
  accounts: { id: string; name: string }[]
  onRefresh: () => void
  navigate: (to: string) => void
}) {
  const qc = useQueryClient()
  const [withdrawing, setWithdrawing] = useState(false)

  const dividendMutation = useMutation({
    mutationFn: (val: boolean) => salaryPaymentsApi.toggleDividend(payment.id, val),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['salary-payments'] })
      if (variables === true) {
        navigate(`/dividends?add_expense=${payment.id}`)
      }
    },
  })

  const rowClass = payment.is_dividend ? 'bg-purple-50/40 hover:bg-purple-50' : 'hover:bg-gray-50'

  return (
    <tr className={rowClass}>
      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
        {String(payment.transaction_date).slice(0, 10)}
      </td>
      <td className="px-4 py-2.5 text-gray-800 font-medium">
        {payment.staff_name}
        {payment.is_dividend && (
          <span className="ml-2 text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-medium">дивіденд</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-gray-600">{payment.account_name ?? '—'}</td>
      <td className="px-4 py-2.5 text-right font-mono font-medium">{fmt(payment.gross_amount)}</td>
      <td className="px-4 py-2.5 text-gray-400 text-sm">{payment.note ?? '—'}</td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2 justify-end">
          {isOwner && (
            <button
              onClick={() => dividendMutation.mutate(!payment.is_dividend)}
              disabled={dividendMutation.isPending}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                payment.is_dividend
                  ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                  : 'text-gray-400 hover:text-purple-600 hover:bg-purple-50'
              }`}
              title={payment.is_dividend ? 'Зняти позначку дивіденду' : 'Позначити як дивіденд'}
            >
              ₴↑
            </button>
          )}
          {isOwner && (
            payment.withdrawal_transfer_id ? (
              <span className="text-xs text-green-600 font-medium" title="Обналичено">↗ обнал.</span>
            ) : (
              <button
                onClick={() => setWithdrawing(true)}
                disabled={!payment.account_id}
                className="text-xs text-gray-400 hover:text-amber-600 hover:bg-amber-50 px-1.5 py-1 rounded transition-colors disabled:opacity-30"
                title={payment.account_id ? 'Обналичування' : 'Рахунок не вказано'}
              >
                ↗
              </button>
            )
          )}
        </div>
        {withdrawing && (
          <SalaryWithdrawalDialog
            payment={payment}
            accounts={accounts}
            onClose={() => setWithdrawing(false)}
            onSuccess={onRefresh}
          />
        )}
      </td>
    </tr>
  )
}

// ── Filter CategoryPicker (read-only, no add option) ──────────────────────

function FilterCategoryPicker({ categories, value, onChange }: {
  categories: ExpenseCategory[]
  value: string
  onChange: (id: string) => void
}) {
  const { parents, childrenOf } = useCategoryTree(categories)
  const selectedCat = categories.find(c => c.id === value)
  const initParentId = selectedCat
    ? (selectedCat.parent_id ?? selectedCat.id)
    : ''
  const [parentId, setParentId] = useState(initParentId)

  const subs = parentId ? childrenOf(parentId) : []

  function handleParent(pid: string) {
    setParentId(pid)
    onChange(pid)
  }

  return (
    <div className="flex gap-2">
      <select value={parentId} onChange={e => handleParent(e.target.value)}
        className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500">
        <option value="">Всі категорії</option>
        {parents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {subs.length > 0 && (
        <select value={value === parentId ? '' : value}
          onChange={e => onChange(e.target.value || parentId)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500">
          <option value="">Всі підкатегорії</option>
          {subs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
    </div>
  )
}

function AccountMultiSelect({ accounts, selected, onChange }: {
  accounts: { id: string; name: string }[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter(x => x !== id))
    else onChange([...selected, id])
  }
  const toggleAll = () => {
    if (selected.length === accounts.length || selected.length === 0) onChange([])
    else onChange(accounts.map(a => a.id))
  }
  
  let label = 'Всі рахунки'
  if (selected.length > 0 && selected.length < accounts.length) {
    label = selected.length === 1 
      ? (accounts.find(a => a.id === selected[0])?.name || '1 рахунок') 
      : `${selected.length} рахунки`
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white flex items-center justify-between min-w-[140px] focus:outline-none focus:ring-2 focus:ring-iris-500">
        <span className="truncate">{label}</span>
        <span className="ml-2 text-gray-400 text-xs">▼</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-gray-200 shadow-lg rounded-lg py-1 z-20 max-h-60 overflow-auto">
            <label className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100">
              <input type="checkbox" checked={selected.length === 0 || selected.length === accounts.length} onChange={toggleAll} className="rounded" />
              <span className="text-sm font-medium">Всі рахунки</span>
            </label>
            {accounts.map(a => (
              <label key={a.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                <input type="checkbox" checked={selected.length === 0 || selected.includes(a.id)} onChange={() => toggle(a.id)} className="rounded" />
                <span className="text-sm text-gray-700">{a.name}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────

type Tab = 'expenses' | 'salary' | 'transfers' | 'categories'

export function ExpensesPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const isOwner = useCanAccess('owner')
  const isAdmin = useCanAccess('owner', 'admin')

  const [filters, setFilters] = useState({
    account_ids: [] as string[],
    category_id: '',
    status:      '' as '' | 'pending' | 'paid',
    from:        firstOfMonth(),
    to:          '',
    is_dividend: undefined as boolean | undefined,
    search:      '',
  })
  const { defaultAccountId, setDefaultAccountId } = useDefaultAccount()
  const [showAddForm, setShowAddForm]           = useState(false)
  const [showTransferForm, setShowTransferForm] = useState(false)
  const [tab, setTab] = useState<Tab>('expenses')

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
    staleTime: 5 * 60_000,
  })
  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: expensesApi.getCategories,
    staleTime: 60_000,
  })

  const { data: expensesData, isLoading } = useQuery({
    queryKey: ['expenses', filters],
    queryFn: () => expensesApi.list({
      ...filters,
      status: filters.status || undefined,
      is_dividend: filters.is_dividend,
      // Omit account_id to fetch all, we filter locally
      account_id: undefined,
    }),
    enabled: tab === 'expenses',
  })

  const [salaryFilters, setSalaryFilters] = useState({
    account_id:  '',
    from:        '',
    to:          '',
    is_dividend: undefined as boolean | undefined,
  })

  const { data: salaryData, isLoading: salaryLoading } = useQuery({
    queryKey: ['salary-payments', salaryFilters],
    queryFn: () => salaryPaymentsApi.list({
      account_id:  salaryFilters.account_id || undefined,
      from:        salaryFilters.from || undefined,
      to:          salaryFilters.to || undefined,
      is_dividend: salaryFilters.is_dividend,
    }),
    enabled: tab === 'salary',
  })

  const { data: transfersData = [], isLoading: transfersLoading } = useQuery({
    queryKey: ['transfers', filters.from, filters.to],
    queryFn: () => expensesApi.getTransfers({
      from: filters.from || undefined,
      to:   filters.to   || undefined,
    }),
    enabled: tab === 'transfers',
  })

  const deleteTransferMutation = useMutation({
    mutationFn: expensesApi.deleteTransfer,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transfers'] }),
  })

  let expenses = expensesData?.data ?? []
  let transfers = transfersData

  // Local filtering
  if (filters.account_ids.length > 0) {
    expenses = expenses.filter(e => filters.account_ids.includes(e.account_id))
    transfers = transfers.filter(t => 
      filters.account_ids.includes(t.from_account_id) || 
      filters.account_ids.includes(t.to_account_id)
    )
  }
  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase()
    expenses = expenses.filter(e =>
      fmtNote(e.note).toLowerCase().includes(q) ||
      e.note?.toLowerCase().includes(q) ||
      (categoryLabel(e) || '').toLowerCase().includes(q) ||
      e.account_name.toLowerCase().includes(q) ||
      String(e.amount).includes(q)
    )
    transfers = transfers.filter(t =>
      t.note?.toLowerCase().includes(q) ||
      t.from_account_name.toLowerCase().includes(q) ||
      t.to_account_name.toLowerCase().includes(q) ||
      String(t.amount).includes(q)
    )
  }

  const totalAmount = expenses.reduce((sum, e) => sum + Number(e.amount), 0)
  const totalCount  = expenses.length

  const hasFilters = !!(filters.account_ids.length > 0 || filters.category_id || filters.status || filters.from !== firstOfMonth() || filters.to || filters.is_dividend !== undefined || filters.search)

  const salaryPayments   = salaryData?.data ?? []
  const salaryTotal      = salaryData?.total_amount ?? 0
  const salaryCount      = salaryData?.total ?? 0
  const hasSalaryFilters = !!(salaryFilters.account_id || salaryFilters.from || salaryFilters.to || salaryFilters.is_dividend !== undefined)

  const TABS: { key: Tab; label: string }[] = [
    { key: 'expenses',   label: 'Журнал витрат' },
    { key: 'salary',     label: 'Зарплата' },
    { key: 'transfers',  label: 'Перекази' },
    ...(isAdmin ? [{ key: 'categories' as Tab, label: 'Категорії' }] : []),
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Витрати</h1>
          {tab === 'expenses' && !isLoading && (
            <p className="text-sm text-gray-500">{totalCount} записів · {totalAmount.toFixed(2)} грн</p>
          )}
          {tab === 'salary' && !salaryLoading && (
            <p className="text-sm text-gray-500">{salaryCount} записів · {salaryTotal.toFixed(2)} грн</p>
          )}
        </div>
        {isAdmin && (
          <div className="flex items-center gap-3">
            {tab === 'expenses' && (
              <DefaultAccountBadge
                accounts={accounts}
                defaultAccountId={defaultAccountId}
                onChange={setDefaultAccountId}
              />
            )}
            {tab === 'expenses' && !showAddForm && (
              <button onClick={() => setShowAddForm(true)}
                className="px-4 py-2 bg-iris-600 hover:bg-iris-700 text-white text-sm font-medium rounded-lg transition-colors">
                + Додати витрату
              </button>
            )}
            {tab === 'transfers' && !showTransferForm && (
              <button onClick={() => setShowTransferForm(true)}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors">
                + Переказ
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`text-sm px-4 py-1.5 rounded-md transition-colors ${
              tab === t.key
                ? 'bg-white text-iris-700 shadow-sm font-medium'
                : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters (expenses + transfers) */}
      {tab !== 'categories' && tab !== 'salary' && (
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Рахунки</label>
            <AccountMultiSelect
              accounts={accounts}
              selected={filters.account_ids}
              onChange={ids => setFilters(f => ({ ...f, account_ids: ids }))}
            />
          </div>

          {tab === 'expenses' && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">Пошук</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
                <input type="text" value={filters.search} placeholder="Сума, нотатка..."
                  onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                  className="text-sm border border-gray-200 rounded-lg pl-8 pr-3 py-2 w-48 focus:outline-none focus:ring-2 focus:ring-iris-500" />
              </div>
            </div>
          )}

          {tab === 'expenses' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Категорія</label>
                <FilterCategoryPicker
                  categories={categories}
                  value={filters.category_id}
                  onChange={id => setFilters(f => ({ ...f, category_id: id }))}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Статус</label>
                <select value={filters.status}
                  onChange={e => setFilters(f => ({ ...f, status: e.target.value as typeof filters.status }))}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500">
                  <option value="">Всі</option>
                  <option value="pending">Очікує оплати</option>
                  <option value="paid">Оплачено</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Тип</label>
                <select
                  value={filters.is_dividend === undefined ? '' : String(filters.is_dividend)}
                  onChange={e => setFilters(f => ({
                    ...f,
                    is_dividend: e.target.value === '' ? undefined : e.target.value === 'true',
                  }))}
                  className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500">
                  <option value="">Всі</option>
                  <option value="false">Звичайні</option>
                  <option value="true">Дивіденди</option>
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs text-gray-500 mb-1">З</label>
            <input type="date" value={filters.from}
              onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">По</label>
            <input type="date" value={filters.to}
              onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
          </div>

          {hasFilters && (
            <button onClick={() => setFilters({ account_ids: [], category_id: '', status: '', from: firstOfMonth(), to: '', is_dividend: undefined, search: '' })}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-2">
              Скинути
            </button>
          )}
        </div>
      )}

      {/* Filters (salary) */}
      {tab === 'salary' && (
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Рахунок</label>
            <select value={salaryFilters.account_id}
              onChange={e => setSalaryFilters(f => ({ ...f, account_id: e.target.value }))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500">
              <option value="">Всі рахунки</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Тип</label>
            <select
              value={salaryFilters.is_dividend === undefined ? '' : String(salaryFilters.is_dividend)}
              onChange={e => setSalaryFilters(f => ({
                ...f,
                is_dividend: e.target.value === '' ? undefined : e.target.value === 'true',
              }))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500">
              <option value="">Всі</option>
              <option value="false">Звичайні</option>
              <option value="true">Дивіденди</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">З</label>
            <input type="date" value={salaryFilters.from}
              onChange={e => setSalaryFilters(f => ({ ...f, from: e.target.value }))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">По</label>
            <input type="date" value={salaryFilters.to}
              onChange={e => setSalaryFilters(f => ({ ...f, to: e.target.value }))}
              className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-iris-500" />
          </div>
          {hasSalaryFilters && (
            <button onClick={() => setSalaryFilters({ account_id: '', from: '', to: '', is_dividend: undefined })}
              className="text-xs text-gray-400 hover:text-gray-600 px-2 py-2">
              Скинути
            </button>
          )}
        </div>
      )}

      {/* Add Expense Form */}
      {tab === 'expenses' && showAddForm && (
        <ExpenseForm
          categories={categories}
          accounts={accounts}
          defaultAccountId={defaultAccountId}
          onSave={(usedAccountId) => {
            setShowAddForm(false)
            qc.invalidateQueries({ queryKey: ['expenses'] })
            if (usedAccountId) setDefaultAccountId(usedAccountId)
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Transfer Form */}
      {tab === 'transfers' && showTransferForm && (
        <TransferForm accounts={accounts}
          onSave={() => setShowTransferForm(false)}
          onCancel={() => setShowTransferForm(false)}
        />
      )}

      {/* Categories tab */}
      {tab === 'categories' && <CategoriesManager />}

      {/* Expenses table */}
      {tab === 'expenses' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
          ) : expenses.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">Витрат не знайдено</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Дата</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Категорія</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Рахунок</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Сума</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Статус</th>
                  <th className="px-4 py-3 w-44" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expenses.map(e => (
                  <ExpenseRow key={e.id} expense={e} isOwner={isOwner} isAdmin={isAdmin}
                    categories={categories} accounts={accounts}
                    onRefresh={() => qc.invalidateQueries({ queryKey: ['expenses'] })} />
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 text-sm font-medium text-gray-700 border-t border-gray-200">
                  <td colSpan={3} className="px-4 py-2">Разом</td>
                  <td className="px-4 py-2 text-right font-mono">{totalAmount.toFixed(2)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* Salary Payments table */}
      {tab === 'salary' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {salaryLoading ? (
            <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
          ) : salaryPayments.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">Виплат зарплати не знайдено</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap">Дата</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Співробітник</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Рахунок</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Сума</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Нотатка</th>
                  <th className="px-4 py-3 w-28" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {salaryPayments.map(p => (
                  <SalaryPaymentRow
                    key={p.id}
                    payment={p}
                    isOwner={isOwner}
                    accounts={accounts}
                    onRefresh={() => qc.invalidateQueries({ queryKey: ['salary-payments'] })}
                    navigate={navigate}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 text-sm font-medium text-gray-700 border-t border-gray-200">
                  <td colSpan={3} className="px-4 py-2">Разом</td>
                  <td className="px-4 py-2 text-right font-mono">{salaryTotal.toFixed(2)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {/* Transfers table */}
      {tab === 'transfers' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {transfersLoading ? (
            <div className="py-12 text-center text-sm text-gray-400">Завантаження...</div>
          ) : transfers.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">Переказів не знайдено</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Дата</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">З рахунку</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">На рахунок</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Сума</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Комісія</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Нотатка</th>
                  {isOwner && <th className="px-4 py-3 w-16" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {transfers.map(t => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{String(t.transfer_date).slice(0, 10)}</td>
                    <td className="px-4 py-2.5 text-gray-700">{t.from_account_name}</td>
                    <td className="px-4 py-2.5 text-gray-700">{t.to_account_name}</td>
                    <td className="px-4 py-2.5 text-right font-mono font-medium">{fmt(t.amount)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-gray-400">
                      {Number(t.commission) > 0 ? fmt(t.commission) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400">{t.note ?? '—'}</td>
                    {isOwner && (
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => { if (window.confirm('Видалити переказ?')) deleteTransferMutation.mutate(t.id) }}
                          className="text-xs text-gray-300 hover:text-red-500 transition-colors">✕
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
