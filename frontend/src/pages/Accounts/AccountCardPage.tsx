import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { localDateStr, firstOfMonth } from '../../utils/dateStr'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { accountsApi } from '../../api/accounts.api'
import type { LedgerKind, LedgerRow } from '../../api/accounts.api'
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
}

const KIND_SIGN: Record<LedgerKind, '+' | '-'> = {
  payment:        '+',
  expense:        '-',
  salary_payment: '-',
  transfer_in:    '+',
  transfer_out:   '-',
  cross_in:       '+',
}

const KIND_COLOR: Record<LedgerKind, string> = {
  payment:        'text-green-700',
  expense:        'text-red-600',
  salary_payment: 'text-purple-700',
  transfer_in:    'text-blue-700',
  transfer_out:   'text-orange-600',
  cross_in:       'text-green-700',
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

export function AccountCardPage() {
  const { id } = useParams<{ id: string }>()
  const canImport = useCanAccess('owner', 'admin')
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'ledger' | 'import'>('ledger')

  const defaultRange = thisMonthRange()
  const [from, setFrom] = useState(defaultRange.from)
  const [to,   setTo]   = useState(defaultRange.to)
  const [applied, setApplied] = useState(defaultRange)

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

  const cancelMutation = useMutation({
    mutationFn: (txId: string) => billingApi.cancelTransaction(txId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-ledger', id] })
      qc.invalidateQueries({ queryKey: ['account', id] })
      qc.invalidateQueries({ queryKey: ['ledger'] })
      qc.invalidateQueries({ queryKey: ['balance'] })
    },
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
        )}
      </div>

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
              {rows.map((row, i) => (
                <tr key={`${row.id}-${row.kind}-${i}`} className="hover:bg-gray-50 transition-colors group">
                  <td className="px-4 py-2.5 text-gray-500 tabular-nums whitespace-nowrap">
                    {new Date(row.date).toLocaleDateString('uk-UA')}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">
                    {KIND_LABEL[row.kind]}
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
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}
    </div>
  )
}
