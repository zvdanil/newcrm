import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { localDateStr, firstOfMonth } from '../../utils/dateStr'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { accountsApi } from '../../api/accounts.api'
import type { LedgerKind, LedgerRow, PayerSearchResult } from '../../api/accounts.api'
import { billingApi } from '../../api/billing.api'
import { useCanAccess } from '../../hooks/useCanAccess'
import { BankImportTab } from './BankImportTab'

const TYPE_LABELS = { fop: 'ФОП', cash: 'Готівка', bank: 'Банк' } as const

const KIND_LABEL: Record<LedgerKind, string> = {
  payment:        'Оплата від клієнта',
  expense:        'Витрата',
  salary_payment: 'Виплата ЗП',
  transfer_in:    'Переказ (надходження)',
  transfer_out:   'Переказ (вибуття)',
  cross_in:       'Оплата від клієнта',
  income:         'Надходження',
  correction_in:  'Корекція залишку',
  correction_out: 'Корекція залишку',
}

const KIND_SIGN: Record<LedgerKind, '+' | '-'> = {
  payment:        '+',
  expense:        '-',
  salary_payment: '-',
  transfer_in:    '+',
  transfer_out:   '-',
  cross_in:       '+',
  income:         '+',
  correction_in:  '+',
  correction_out: '-',
}

const KIND_COLOR: Record<LedgerKind, string> = {
  payment:        'text-green-700',
  expense:        'text-red-600',
  salary_payment: 'text-purple-700',
  transfer_in:    'text-blue-700',
  transfer_out:   'text-orange-600',
  cross_in:       'text-green-700',
  income:         'text-teal-700',
  correction_in:  'text-gray-600',
  correction_out: 'text-gray-600',
}

function fmtAmount(row: LedgerRow) {
  const sign = KIND_SIGN[row.kind]
  const n = parseFloat(row.amount)
  return sign + n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₴'
}

function fmtBalance(v: string) {
  const n = parseFloat(v)
  return (n >= 0 ? '+' : '') + n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₴'
}

function thisMonthRange() {
  const now = new Date()
  const from = firstOfMonth(now)
  const to   = localDateStr(now)
  return { from, to }
}

const TODAY = localDateStr(new Date())

function PayerSearch({ value, onChange }: { value: PayerSearchResult | null; onChange: (v: PayerSearchResult | null) => void }) {
  const [query, setQuery] = useState(value?.full_name ?? '')
  const [results, setResults] = useState<PayerSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (value) setQuery(value.full_name)
  }, [value])

  useEffect(() => {
    if (query.length < 2) { setResults([]); return }
    if (value && query === value.full_name) return
    const t = setTimeout(async () => {
      const r = await accountsApi.searchPayers(query)
      setResults(r)
      setOpen(r.length > 0)
    }, 250)
    return () => clearTimeout(t)
  }, [query, value])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={query}
        placeholder="Ім'я дитини або батьків..."
        onChange={(e) => { setQuery(e.target.value); onChange(null) }}
        onFocus={() => results.length > 0 && setOpen(true)}
        className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500"
      />
      {value && (
        <button onClick={() => { onChange(null); setQuery('') }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs">✕</button>
      )}
      {open && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
          {results.map((r) => (
            <button key={r.id} onMouseDown={() => { onChange(r); setQuery(r.full_name); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-iris-50 transition-colors">
              <span className="font-medium text-gray-900">{r.full_name}</span>
              {r.parent_name && <span className="ml-1.5 text-gray-400">({r.parent_name})</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type EditRowState = {
  id: string
  kind: 'correction' | 'income'
  amount: string
  date: string
  note: string
  payer_name: string
}

export function AccountCardPage() {
  const { id } = useParams<{ id: string }>()
  const canImport = useCanAccess('owner', 'admin')
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'ledger' | 'import' | 'entry'>('ledger')

  const defaultRange = thisMonthRange()
  const [from, setFrom] = useState(defaultRange.from)
  const [to,   setTo]   = useState(defaultRange.to)
  const [applied, setApplied] = useState(defaultRange)

  const [editRow, setEditRow] = useState<EditRowState | null>(null)

  const { data: account, isLoading: acctLoading } = useQuery({
    queryKey: ['account', id],
    queryFn: () => accountsApi.get(id!),
    enabled: !!id,
  })

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ['account-ledger', id, applied],
    queryFn: () => accountsApi.ledger(id!, { from: applied.from, to: applied.to, limit: 500 }),
    enabled: !!id,
  })

  const { data: allEntries } = useQuery({
    queryKey: ['account-ledger-all', id],
    queryFn: () => accountsApi.ledger(id!, { limit: 500 }),
    enabled: activeTab === 'entry' && !!id,
    staleTime: 0,
  })

  const cancelMutation = useMutation({
    mutationFn: (txId: string) => billingApi.cancelTransaction(txId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-ledger', id] })
      qc.invalidateQueries({ queryKey: ['account', id] })
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['balance'] })
    },
  })

  // ── Entry tab state ──────────────────────────────────────────────────────
  const { data: allAccounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
    enabled: activeTab === 'entry',
    staleTime: 5 * 60 * 1000,
  })

  const EMPTY_PAYMENT = { amount: '', date: TODAY, note: '', cross: false, debt_account_id: '', payer: null as PayerSearchResult | null }
  const EMPTY_INCOME  = { amount: '', date: TODAY, payer_name: '', note: '' }
  const EMPTY_CORR    = { amount: '', date: TODAY, note: '' }

  const [payForm,  setPayForm]  = useState(EMPTY_PAYMENT)
  const [incForm,  setIncForm]  = useState(EMPTY_INCOME)
  const [corrForm, setCorrForm] = useState(EMPTY_CORR)
  const [entryError, setEntryError] = useState<string | null>(null)

  function invalidateEntry() {
    qc.invalidateQueries({ queryKey: ['account-ledger', id] })
    qc.invalidateQueries({ queryKey: ['account-ledger-all', id] })
    qc.invalidateQueries({ queryKey: ['account', id] })
    qc.invalidateQueries({ queryKey: ['balance'] })
  }

  const payMutation = useMutation({
    mutationFn: () => accountsApi.createPayment(id!, {
      child_id:        payForm.payer!.id,
      amount:          parseFloat(payForm.amount),
      transaction_date: payForm.date,
      note:            payForm.note || undefined,
      debt_account_id: payForm.cross && payForm.debt_account_id ? payForm.debt_account_id : undefined,
    }),
    onSuccess: () => { invalidateEntry(); setPayForm(EMPTY_PAYMENT); setEntryError(null) },
    onError:   () => setEntryError('Помилка при збереженні оплати'),
  })

  const incMutation = useMutation({
    mutationFn: () => accountsApi.createIncome(id!, {
      amount:      parseFloat(incForm.amount),
      income_date: incForm.date,
      payer_name:  incForm.payer_name || undefined,
      note:        incForm.note || undefined,
    }),
    onSuccess: () => { invalidateEntry(); setIncForm(EMPTY_INCOME); setEntryError(null) },
    onError:   () => setEntryError('Помилка при збереженні надходження'),
  })

  const corrMutation = useMutation({
    mutationFn: () => accountsApi.createCorrection(id!, {
      amount:          parseFloat(corrForm.amount),
      correction_date: corrForm.date,
      note:            corrForm.note || undefined,
    }),
    onSuccess: () => { invalidateEntry(); setCorrForm(EMPTY_CORR); setEntryError(null) },
    onError:   () => setEntryError('Помилка при збереженні корекції'),
  })

  const updateCorrMutation = useMutation({
    mutationFn: (row: EditRowState) => accountsApi.updateCorrection(id!, row.id, {
      amount:          parseFloat(row.amount),
      correction_date: row.date,
      note:            row.note || undefined,
    }),
    onSuccess: () => { invalidateEntry(); setEditRow(null) },
    onError:   () => setEntryError('Помилка при оновленні корекції'),
  })

  const deleteCorrMutation = useMutation({
    mutationFn: (corrId: string) => accountsApi.deleteCorrection(id!, corrId),
    onSuccess: () => invalidateEntry(),
  })

  const updateIncMutation = useMutation({
    mutationFn: (row: EditRowState) => accountsApi.updateIncome(id!, row.id, {
      amount:      parseFloat(row.amount),
      income_date: row.date,
      payer_name:  row.payer_name || undefined,
      note:        row.note || undefined,
    }),
    onSuccess: () => { invalidateEntry(); setEditRow(null) },
    onError:   () => setEntryError('Помилка при оновленні надходження'),
  })

  const deleteIncMutation = useMutation({
    mutationFn: (incomeId: string) => accountsApi.deleteIncome(id!, incomeId),
    onSuccess: () => invalidateEntry(),
  })

  if (acctLoading) return <div className="py-16 text-center text-sm text-gray-400">Завантаження...</div>
  if (!account)   return <div className="py-16 text-center text-sm text-red-500">Рахунок не знайдено</div>

  const balance = parseFloat(account.balance ?? '0')
  const rows = ledger?.data ?? []

  const periodIn  = rows.filter((r) => KIND_SIGN[r.kind] === '+').reduce((s, r) => s + parseFloat(r.amount), 0)
  const periodOut = rows.filter((r) => KIND_SIGN[r.kind] === '-').reduce((s, r) => s + parseFloat(r.amount), 0)

  return (
    <div className="max-w-4xl space-y-6">

      <div className="flex items-start gap-3">
        <Link to="/accounts" className="mt-1 text-gray-400 hover:text-gray-600 transition-colors text-sm">← Рахунки</Link>
      </div>

      {/* Account info card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{account.name}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {TYPE_LABELS[account.type]} · {account.currency}
              {!account.is_active && <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Архів</span>}
            </p>
            {account.note && <p className="text-sm text-gray-400 mt-1">{account.note}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Поточний баланс</p>
            <p className={`text-2xl font-bold tabular-nums ${balance >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {fmtBalance(account.balance)}
            </p>
          </div>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-gray-200 bg-white rounded-t-xl px-4 pt-3 -mb-6">
        <button
          onClick={() => setActiveTab('ledger')}
          className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
            activeTab === 'ledger'
              ? 'bg-white border border-b-white border-gray-200 text-iris-700 -mb-px'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Рух коштів
        </button>
        {canImport && (
          <>
            <button
              onClick={() => setActiveTab('entry')}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                activeTab === 'entry'
                  ? 'bg-white border border-b-white border-gray-200 text-iris-700 -mb-px'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Внести
            </button>
            <button
              onClick={() => setActiveTab('import')}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                activeTab === 'import'
                  ? 'bg-white border border-b-white border-gray-200 text-iris-700 -mb-px'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Імпорт виписки
            </button>
          </>
        )}
      </div>

      {/* Entry tab */}
      {activeTab === 'entry' && canImport && id && (
        <div className="space-y-4">
          {entryError && (
            <div className="px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">{entryError}</div>
          )}

          {/* ── Payment from child ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Оплата від клієнта</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Дата</label>
                <input type="date" value={payForm.date}
                  onChange={(e) => setPayForm({ ...payForm, date: e.target.value })}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Сума, ₴</label>
                <input type="number" min="0.01" step="0.01" value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-0.5">Надійшло від</label>
                <PayerSearch value={payForm.payer} onChange={(p) => setPayForm({ ...payForm, payer: p })} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Примітка</label>
              <input type="text" value={payForm.note}
                onChange={(e) => setPayForm({ ...payForm, note: e.target.value })}
                placeholder="необов'язково"
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500" />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={payForm.cross}
                onChange={(e) => setPayForm({ ...payForm, cross: e.target.checked, debt_account_id: '' })} />
              Гроші прийшли сюди, але послуга на іншому рахунку
            </label>
            {payForm.cross && (
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Рахунок послуги (де числиться борг)</label>
                <select value={payForm.debt_account_id}
                  onChange={(e) => setPayForm({ ...payForm, debt_account_id: e.target.value })}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500">
                  <option value="">— оберіть —</option>
                  {allAccounts.filter((a) => a.id !== id && a.is_active).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              onClick={() => {
                if (!payForm.payer) { setEntryError('Оберіть клієнта'); return }
                if (!payForm.amount || parseFloat(payForm.amount) <= 0) { setEntryError('Введіть суму'); return }
                if (payForm.cross && !payForm.debt_account_id) { setEntryError('Оберіть рахунок послуги'); return }
                setEntryError(null)
                payMutation.mutate()
              }}
              disabled={payMutation.isPending}
              className="text-xs px-4 py-1.5 bg-iris-600 hover:bg-iris-700 text-white rounded-md disabled:opacity-50 transition-colors"
            >
              {payMutation.isPending ? 'Зберігається...' : 'Зафіксувати оплату'}
            </button>
          </div>

          {/* ── Arbitrary income ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Довільне надходження</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Дата</label>
                <input type="date" value={incForm.date}
                  onChange={(e) => setIncForm({ ...incForm, date: e.target.value })}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Сума, ₴</label>
                <input type="number" min="0.01" step="0.01" value={incForm.amount}
                  onChange={(e) => setIncForm({ ...incForm, amount: e.target.value })}
                  placeholder="0.00"
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-0.5">Від кого</label>
                <input type="text" value={incForm.payer_name}
                  onChange={(e) => setIncForm({ ...incForm, payer_name: e.target.value })}
                  placeholder="необов'язково — ім'я або назва"
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500" />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-0.5">Примітка</label>
              <input type="text" value={incForm.note}
                onChange={(e) => setIncForm({ ...incForm, note: e.target.value })}
                placeholder="необов'язково"
                className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500" />
            </div>
            <button
              onClick={() => {
                if (!incForm.amount || parseFloat(incForm.amount) <= 0) { setEntryError('Введіть суму'); return }
                setEntryError(null)
                incMutation.mutate()
              }}
              disabled={incMutation.isPending}
              className="text-xs px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-md disabled:opacity-50 transition-colors"
            >
              {incMutation.isPending ? 'Зберігається...' : 'Зафіксувати надходження'}
            </button>
          </div>

          {/* ── Balance correction ── */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Корекція залишку</h3>
            <p className="text-xs text-gray-500">Технічне виправлення балансу рахунку. Позитивна сума — збільшення, від'ємна — зменшення.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Дата</label>
                <input type="date" value={corrForm.date}
                  onChange={(e) => setCorrForm({ ...corrForm, date: e.target.value })}
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Сума, ₴ (зі знаком)</label>
                <input type="number" step="0.01" value={corrForm.amount}
                  onChange={(e) => setCorrForm({ ...corrForm, amount: e.target.value })}
                  placeholder="+200 або -150"
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-0.5">Примітка</label>
                <input type="text" value={corrForm.note}
                  onChange={(e) => setCorrForm({ ...corrForm, note: e.target.value })}
                  placeholder="причина корекції"
                  className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:border-iris-500 focus:ring-iris-500" />
              </div>
            </div>
            <button
              onClick={() => {
                if (!corrForm.amount || corrForm.amount === '0') { setEntryError('Введіть суму зі знаком'); return }
                setEntryError(null)
                corrMutation.mutate()
              }}
              disabled={corrMutation.isPending}
              className="text-xs px-4 py-1.5 bg-gray-600 hover:bg-gray-700 text-white rounded-md disabled:opacity-50 transition-colors"
            >
              {corrMutation.isPending ? 'Зберігається...' : 'Зафіксувати корекцію'}
            </button>
          </div>

          {/* ── Existing corrections & income ── */}
          {(() => {
            const managed = (allEntries?.data ?? []).filter(r =>
              r.kind === 'income' || r.kind === 'correction_in' || r.kind === 'correction_out'
            )
            if (managed.length === 0) return null
            return (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 bg-gray-50">
                  <h3 className="text-sm font-semibold text-gray-700">Внесені залишки та корекції</h3>
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Дата</th>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Тип</th>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium hidden sm:table-cell">Деталь / Примітка</th>
                      <th className="text-right px-4 py-2 text-gray-500 font-medium">Сума</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {managed.map((row) => {
                      const isEditingThis = editRow?.id === row.id
                      const isCorr = row.kind === 'correction_in' || row.kind === 'correction_out'

                      if (isEditingThis && editRow) {
                        return (
                          <tr key={row.id} className="bg-iris-50">
                            <td className="px-3 py-2">
                              <input type="date" value={editRow.date}
                                onChange={(e) => setEditRow({ ...editRow, date: e.target.value })}
                                className="w-full text-xs border border-iris-300 rounded px-2 py-1 focus:border-iris-500" />
                            </td>
                            <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{KIND_LABEL[row.kind]}</td>
                            <td className="px-3 py-2 hidden sm:table-cell">
                              <div className="flex gap-2">
                                {editRow.kind === 'income' && (
                                  <input type="text" value={editRow.payer_name}
                                    onChange={(e) => setEditRow({ ...editRow, payer_name: e.target.value })}
                                    placeholder="Від кого"
                                    className="w-32 text-xs border border-gray-300 rounded px-2 py-1 focus:border-iris-500" />
                                )}
                                <input type="text" value={editRow.note}
                                  onChange={(e) => setEditRow({ ...editRow, note: e.target.value })}
                                  placeholder="Примітка"
                                  className="flex-1 text-xs border border-gray-300 rounded px-2 py-1 focus:border-iris-500" />
                              </div>
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-2">
                                <input type="number" step="0.01" value={editRow.amount}
                                  onChange={(e) => setEditRow({ ...editRow, amount: e.target.value })}
                                  className="w-24 text-xs border border-iris-300 rounded px-2 py-1 text-right focus:border-iris-500" />
                                <button
                                  onClick={() => editRow.kind === 'correction'
                                    ? updateCorrMutation.mutate(editRow)
                                    : updateIncMutation.mutate(editRow)
                                  }
                                  disabled={updateCorrMutation.isPending || updateIncMutation.isPending}
                                  className="text-xs px-2 py-1 bg-iris-600 text-white rounded hover:bg-iris-700 disabled:opacity-50"
                                >Зберегти</button>
                                <button onClick={() => setEditRow(null)}
                                  className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                                >✕</button>
                              </div>
                            </td>
                          </tr>
                        )
                      }

                      return (
                        <tr key={row.id} className="hover:bg-gray-50 group">
                          <td className="px-4 py-2.5 text-gray-500 tabular-nums whitespace-nowrap">
                            {new Date(row.date).toLocaleDateString('uk-UA')}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{KIND_LABEL[row.kind]}</td>
                          <td className="px-4 py-2.5 text-gray-400 hidden sm:table-cell">
                            {row.detail && <span className="mr-2 text-gray-600">{row.detail}</span>}
                            {row.note ?? ''}
                          </td>
                          <td className={`px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap ${KIND_COLOR[row.kind]}`}>
                            <div className="flex items-center justify-end gap-2">
                              <span>{fmtAmount(row)}</span>
                              <button
                                onClick={() => setEditRow({
                                  id:         row.id,
                                  kind:       isCorr ? 'correction' : 'income',
                                  amount:     row.amount,
                                  date:       row.date,
                                  note:       row.note ?? '',
                                  payer_name: row.detail ?? '',
                                })}
                                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-iris-500 transition-all"
                                title="Редагувати"
                              >✎</button>
                              <button
                                onClick={() => {
                                  if (window.confirm(`Видалити запис ${fmtAmount(row)}?`)) {
                                    if (isCorr) deleteCorrMutation.mutate(row.id)
                                    else        deleteIncMutation.mutate(row.id)
                                  }
                                }}
                                disabled={deleteCorrMutation.isPending || deleteIncMutation.isPending}
                                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all disabled:opacity-30"
                                title="Видалити"
                              >✕</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })()}
        </div>
      )}

      {/* Import tab */}
      {activeTab === 'import' && canImport && id && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <BankImportTab accountId={id} />
        </div>
      )}

      {/* Ledger */}
      {activeTab === 'ledger' && (
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Toolbar */}
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-gray-700 mr-1">Рух коштів</h2>
          <div className="flex items-center gap-2 ml-auto">
            <label className="text-xs text-gray-500">Від</label>
            <input
              type="date" value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="text-xs border border-gray-300 rounded px-2 py-1 focus:border-iris-500 focus:ring-iris-500"
            />
            <label className="text-xs text-gray-500">До</label>
            <input
              type="date" value={to}
              onChange={(e) => setTo(e.target.value)}
              className="text-xs border border-gray-300 rounded px-2 py-1 focus:border-iris-500 focus:ring-iris-500"
            />
            <button
              onClick={() => setApplied({ from, to })}
              className="text-xs px-3 py-1 bg-iris-600 hover:bg-iris-700 text-white rounded-md transition-colors"
            >
              Застосувати
            </button>
          </div>
        </div>

        {/* Period summary */}
        {rows.length > 0 && (
          <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50 flex gap-6 text-sm">
            <span className="text-gray-500">За період:</span>
            <span className="text-green-700 font-medium">
              +{periodIn.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴ надходження
            </span>
            <span className="text-red-600 font-medium">
              −{periodOut.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴ витрати
            </span>
            <span className={`font-medium ${periodIn - periodOut >= 0 ? 'text-gray-800' : 'text-red-700'}`}>
              = {(periodIn - periodOut).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₴ чисто
            </span>
          </div>
        )}

        {ledgerLoading ? (
          <div className="py-10 text-center text-sm text-gray-400">Завантаження...</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400">Операцій за вибраний період немає</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Дата</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Тип</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600">Деталь</th>
                <th className="text-left px-4 py-2.5 font-medium text-gray-600 hidden sm:table-cell">Примітка</th>
                <th className="text-right px-4 py-2.5 font-medium text-gray-600">Сума</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row, i) => {
                const isEditing = editRow?.id === row.id
                const isCorr    = row.kind === 'correction_in' || row.kind === 'correction_out'
                const isIncome  = row.kind === 'income'
                const canEdit   = canImport && (isCorr || isIncome)

                if (isEditing && editRow) {
                  return (
                    <tr key={`${row.id}-edit`} className="bg-iris-50">
                      <td className="px-3 py-2">
                        <input type="date" value={editRow.date}
                          onChange={(e) => setEditRow({ ...editRow, date: e.target.value })}
                          className="w-full text-xs border border-iris-300 rounded px-2 py-1 focus:border-iris-500" />
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{KIND_LABEL[row.kind]}</td>
                      <td className="px-3 py-2">
                        {editRow.kind === 'income' && (
                          <input type="text" value={editRow.payer_name}
                            onChange={(e) => setEditRow({ ...editRow, payer_name: e.target.value })}
                            placeholder="Від кого"
                            className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:border-iris-500" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input type="text" value={editRow.note}
                          onChange={(e) => setEditRow({ ...editRow, note: e.target.value })}
                          placeholder="Примітка"
                          className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:border-iris-500" />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <input type="number" step="0.01" value={editRow.amount}
                            onChange={(e) => setEditRow({ ...editRow, amount: e.target.value })}
                            className="w-24 text-xs border border-iris-300 rounded px-2 py-1 text-right focus:border-iris-500" />
                          <button
                            onClick={() => editRow.kind === 'correction'
                              ? updateCorrMutation.mutate(editRow)
                              : updateIncMutation.mutate(editRow)
                            }
                            disabled={updateCorrMutation.isPending || updateIncMutation.isPending}
                            className="text-xs px-2 py-1 bg-iris-600 text-white rounded hover:bg-iris-700 disabled:opacity-50"
                          >Зберегти</button>
                          <button onClick={() => setEditRow(null)}
                            className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                          >Скасувати</button>
                        </div>
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr key={`${row.id}-${row.kind}-${i}`} className="hover:bg-gray-50 transition-colors group">
                    <td className="px-4 py-2.5 text-gray-500 tabular-nums whitespace-nowrap">
                      {new Date(row.date).toLocaleDateString('uk-UA')}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {KIND_LABEL[row.kind]}
                        {row.is_advance && (
                          <span className="text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded font-medium whitespace-nowrap">аванс</span>
                        )}
                        {!row.is_advance && row.utilized_advance_amount && Number(row.utilized_advance_amount) > 0 && (
                          <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded whitespace-nowrap">з авансу {Number(row.utilized_advance_amount).toFixed(2)} ₴</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">
                      {row.detail ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-400 hidden sm:table-cell">
                      {row.note ?? ''}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap ${KIND_COLOR[row.kind]}`}>
                      <div className="flex items-center justify-end gap-2">
                        <span>{fmtAmount(row)}</span>
                        {canEdit && (
                          <button
                            onClick={() => setEditRow({
                              id:         row.id,
                              kind:       isCorr ? 'correction' : 'income',
                              amount:     row.amount,
                              date:       row.date,
                              note:       row.note ?? '',
                              payer_name: row.detail ?? '',
                            })}
                            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-iris-500 transition-all text-xs"
                            title="Редагувати"
                          >✎</button>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => {
                              if (window.confirm(`Видалити запис ${fmtAmount(row)}?`)) {
                                if (isCorr) deleteCorrMutation.mutate(row.id)
                                else        deleteIncMutation.mutate(row.id)
                              }
                            }}
                            disabled={deleteCorrMutation.isPending || deleteIncMutation.isPending}
                            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all disabled:opacity-30"
                            title="Видалити"
                          >✕</button>
                        )}
                        {canImport && row.kind === 'payment' && (
                          <button
                            onClick={() => {
                              if (window.confirm(`Скасувати оплату ${fmtAmount(row)} від ${row.detail ?? ''}?\nБаланс ребёнка буде перераховано.`)) {
                                cancelMutation.mutate(row.id)
                              }
                            }}
                            disabled={cancelMutation.isPending}
                            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all disabled:opacity-30"
                            title="Скасувати оплату"
                          >✕</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
      )}
    </div>
  )
}
