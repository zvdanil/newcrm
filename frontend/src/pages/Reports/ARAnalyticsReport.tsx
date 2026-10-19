import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { reportsApi } from '../../api/reports.api'
import type { ARAnalyticsFilters, ARAnalyticsRow, OtherAccountBalance } from '../../api/reports.api'
import { accountsApi } from '../../api/accounts.api'
import { TransferBalanceModal } from '../Children/TransferBalanceModal'

// ─── helpers ────────────────────────────────────────────────────────────────

function currentYM() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtMoney(n: number) {
  return n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtMonth(ymd: string) {
  // 'YYYY-MM-01' → 'Місяць РРРР'
  const d = new Date(ymd)
  return d.toLocaleDateString('uk-UA', { month: 'long', year: 'numeric' })
}

function balanceClass(n: number) {
  if (n < -0.005) return 'text-red-600'
  if (n >  0.005) return 'text-emerald-600'
  return 'text-gray-500'
}

const EMPTY_FILTERS: ARAnalyticsFilters = {
  from_month:      currentYM(),
  to_month:        currentYM(),
  account_ids:     [],
  balance_mode:    'all',
  is_active:       'true',
  only_imbalances: false,
}

// ─── sub-components ─────────────────────────────────────────────────────────

function MoneyCell({ value, className = '' }: { value: number; className?: string }) {
  return (
    <td className={`px-3 py-2 text-right tabular-nums text-sm ${balanceClass(value)} ${className}`}>
      {fmtMoney(value)}
    </td>
  )
}

interface TransferModalState {
  childId: string
  childName: string
  balances: Array<{ account_id: string; account_name: string; balance: string | number }>
  defaultFromAccountId?: string
  defaultToAccountId?: string
  defaultAmount?: number
}

// ─── Row Component for Flat View (Single or Flat accounts) ────────────────────

interface FlatRowProps {
  row: ARAnalyticsRow
  isExpanded: boolean
  onToggle: () => void
  onOpenTransfer: (row: ARAnalyticsRow) => void
}

function FlatAnalyticsRow({ row, isExpanded, onToggle, onOpenTransfer }: FlatRowProps) {
  return (
    <>
      {/* Summary row */}
      <tr
        className="hover:bg-iris-50/70 border-b border-gray-100 transition-colors"
      >
        <td
          className="pl-3 pr-1 py-2 w-6 text-gray-400 text-xs select-none cursor-pointer"
          onClick={onToggle}
        >
          {isExpanded ? '▼' : '▶'}
        </td>
        <td className="px-3 py-2 text-sm font-medium text-gray-900">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link
              to={`/children/${row.child_id}`}
              className="text-iris-600 hover:text-iris-800 hover:underline font-medium"
              title="Перейти в картку дитини"
            >
              {row.child_name}
            </Link>
            {!row.is_active && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">архів</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-sm text-gray-500">{row.family_name ?? '—'}</td>
        <td className="px-3 py-2 text-sm text-gray-600 font-medium">{row.account_name}</td>

        {/* Other accounts & cross-prepayment info */}
        <td className="px-3 py-2 text-xs">
          {row.other_accounts && row.other_accounts.length > 0 ? (
            <div className="space-y-1">
              <div className="flex flex-wrap gap-1">
                {row.other_accounts.map((o: OtherAccountBalance) => (
                  <span
                    key={o.account_id}
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium border ${
                      o.current_balance > 0.005
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : o.current_balance < -0.005
                        ? 'bg-red-50 text-red-800 border-red-200'
                        : 'bg-gray-50 text-gray-600 border-gray-200'
                    }`}
                  >
                    {o.account_name}: {o.current_balance > 0 ? '+' : ''}{fmtMoney(o.current_balance)} ₴
                  </span>
                ))}
              </div>
              {row.has_cross_imbalance && (
                <div className="text-[11px] font-medium text-amber-700 flex items-center gap-1">
                  <span>⚡ Всього:</span>
                  <span className={`font-semibold ${balanceClass(row.net_balance ?? 0)}`}>
                    {(row.net_balance ?? 0) > 0 ? '+' : ''}{fmtMoney(row.net_balance ?? 0)} ₴
                  </span>
                </div>
              )}
            </div>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </td>

        <MoneyCell value={row.balance_start} />
        <MoneyCell value={row.accrued_in_period} className="text-gray-700" />
        <MoneyCell value={row.paid_in_period} className="text-gray-700" />
        <MoneyCell value={row.balance_end} />
        <MoneyCell value={row.current_balance} />

        {/* Actions */}
        <td className="px-3 py-2 text-right whitespace-nowrap text-xs">
          <div className="flex items-center justify-end gap-1.5">
            {row.has_cross_imbalance && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenTransfer(row)
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white font-medium text-xs rounded shadow-xs transition-colors"
                title="Переброс балансу між рахунками"
              >
                <span>⚡</span>
                <span>Переброс</span>
              </button>
            )}
            <Link
              to={`/children/${row.child_id}`}
              className="text-gray-400 hover:text-iris-600 p-1"
              title="Відкрити картку дитини"
            >
              ↗
            </Link>
          </div>
        </td>
      </tr>

      {/* Monthly breakdown rows */}
      {isExpanded && row.months.map(m => (
        <tr key={m.month} className="bg-iris-50/60 border-b border-iris-100">
          <td />
          <td colSpan={4} className="pl-8 pr-3 py-1.5 text-xs text-iris-700 italic">
            {fmtMonth(m.month)}
          </td>
          <MoneyCell value={m.balance_start_month} className="text-xs" />
          <td className="px-3 py-1.5 text-right tabular-nums text-xs text-gray-600">
            {fmtMoney(m.accrued_in_month)}
          </td>
          <td className="px-3 py-1.5 text-right tabular-nums text-xs text-gray-600">
            {fmtMoney(m.paid_in_month)}
          </td>
          <MoneyCell value={m.balance_end_month} className="text-xs" />
          <td colSpan={2} />
        </tr>
      ))}
    </>
  )
}

// ─── Grouped Child Row Component (Child -> Accounts -> Months) ───────────────

interface ChildGroupData {
  child_id: string
  child_name: string
  is_active: boolean
  family_name: string | null
  net_balance: number
  has_cross_imbalance: boolean
  cross_prepayment_total: number
  balance_start: number
  accrued_in_period: number
  paid_in_period: number
  balance_end: number
  current_balance: number
  account_rows: ARAnalyticsRow[]
}

interface GroupedChildRowProps {
  group: ChildGroupData
  isExpanded: boolean
  onToggle: () => void
  expandedAccounts: Set<string>
  onToggleAccount: (key: string) => void
  onOpenTransfer: (group: ChildGroupData) => void
}

function GroupedChildRow({
  group,
  isExpanded,
  onToggle,
  expandedAccounts,
  onToggleAccount,
  onOpenTransfer,
}: GroupedChildRowProps) {
  return (
    <>
      {/* Child Summary Row */}
      <tr className="hover:bg-iris-50/70 border-b border-gray-200 bg-white font-medium transition-colors">
        <td
          className="pl-3 pr-1 py-2.5 w-6 text-gray-500 text-xs select-none cursor-pointer"
          onClick={onToggle}
        >
          {isExpanded ? '▼' : '▶'}
        </td>
        <td className="px-3 py-2.5 text-sm text-gray-900">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link
              to={`/children/${group.child_id}`}
              className="text-iris-600 hover:text-iris-800 hover:underline font-semibold"
              title="Перейти в картку дитини"
            >
              {group.child_name}
            </Link>
            {!group.is_active && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">архів</span>
            )}
            <span className="text-xs text-gray-400 font-normal">
              ({group.account_rows.length} {group.account_rows.length === 1 ? 'рахунок' : 'рахунки'})
            </span>
          </div>
        </td>
        <td className="px-3 py-2.5 text-sm text-gray-500 font-normal">{group.family_name ?? '—'}</td>

        {/* Imbalance badge & account summary */}
        <td colSpan={2} className="px-3 py-2.5 text-xs">
          {group.has_cross_imbalance ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                <span>⚠️</span>
                <span>Перекос між рахунками</span>
              </span>
              <div className="flex gap-1 flex-wrap">
                {group.account_rows.map(ar => (
                  <span
                    key={ar.account_id}
                    className={`px-1.5 py-0.5 rounded text-[11px] font-medium border ${
                      ar.current_balance > 0.005
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : ar.current_balance < -0.005
                        ? 'bg-red-50 text-red-800 border-red-200'
                        : 'bg-gray-50 text-gray-600 border-gray-200'
                    }`}
                  >
                    {ar.account_name}: {ar.current_balance > 0 ? '+' : ''}{fmtMoney(ar.current_balance)} ₴
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex gap-1 flex-wrap">
              {group.account_rows.map(ar => (
                <span key={ar.account_id} className="text-gray-500 text-xs bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">
                  {ar.account_name}
                </span>
              ))}
            </div>
          )}
        </td>

        <MoneyCell value={group.balance_start} className="font-semibold" />
        <MoneyCell value={group.accrued_in_period} className="text-gray-800 font-semibold" />
        <MoneyCell value={group.paid_in_period} className="text-gray-800 font-semibold" />
        <MoneyCell value={group.balance_end} className="font-semibold" />
        <MoneyCell value={group.current_balance} className="font-semibold" />

        {/* Action column */}
        <td className="px-3 py-2.5 text-right whitespace-nowrap text-xs">
          <div className="flex items-center justify-end gap-1.5">
            {group.has_cross_imbalance && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenTransfer(group)
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white font-medium text-xs rounded shadow-xs transition-colors"
                title="Переброс балансу між рахунками"
              >
                <span>⚡</span>
                <span>Переброс</span>
              </button>
            )}
            <Link
              to={`/children/${group.child_id}`}
              className="text-gray-400 hover:text-iris-600 p-1"
              title="Відкрити картку дитини"
            >
              ↗
            </Link>
          </div>
        </td>
      </tr>

      {/* Expanded Account Rows */}
      {isExpanded && group.account_rows.map(accRow => {
        const accKey = `${accRow.child_id}:${accRow.account_id}`
        const isAccExpanded = expandedAccounts.has(accKey)
        return (
          <AccountSubRow
            key={accKey}
            row={accRow}
            isExpanded={isAccExpanded}
            onToggle={() => onToggleAccount(accKey)}
          />
        )
      })}
    </>
  )
}

function AccountSubRow({
  row,
  isExpanded,
  onToggle,
}: {
  row: ARAnalyticsRow
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr className="bg-gray-50/70 border-b border-gray-100 hover:bg-gray-100/60 transition-colors text-xs">
        <td className="pl-6 pr-1 py-1.5 select-none text-gray-400 cursor-pointer" onClick={onToggle}>
          {isExpanded ? '▾' : '▸'}
        </td>
        <td colSpan={3} className="px-3 py-1.5 text-gray-700 font-medium">
          <span className="text-gray-400 mr-1.5">└</span>
          <span className="text-iris-800 font-semibold">{row.account_name}</span>
        </td>
        <td className="px-3 py-1.5 text-gray-400">
          {/* spacer */}
        </td>
        <MoneyCell value={row.balance_start} className="text-xs" />
        <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
          {fmtMoney(row.accrued_in_period)}
        </td>
        <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">
          {fmtMoney(row.paid_in_period)}
        </td>
        <MoneyCell value={row.balance_end} className="text-xs" />
        <MoneyCell value={row.current_balance} className="text-xs font-medium" />
        <td />
      </tr>

      {/* Monthly detail */}
      {isExpanded && row.months.map(m => (
        <tr key={m.month} className="bg-iris-50/40 border-b border-iris-100 text-[11px]">
          <td />
          <td colSpan={4} className="pl-12 pr-3 py-1 text-iris-700 italic">
            {fmtMonth(m.month)}
          </td>
          <MoneyCell value={m.balance_start_month} className="text-[11px]" />
          <td className="px-3 py-1 text-right tabular-nums text-gray-600">
            {fmtMoney(m.accrued_in_month)}
          </td>
          <td className="px-3 py-1 text-right tabular-nums text-gray-600">
            {fmtMoney(m.paid_in_month)}
          </td>
          <MoneyCell value={m.balance_end_month} className="text-[11px]" />
          <td colSpan={2} />
        </tr>
      ))}
    </>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ARAnalyticsReport() {
  const [filters, setFilters]     = useState<ARAnalyticsFilters>(EMPTY_FILTERS)
  const [committed, setCommitted] = useState<ARAnalyticsFilters | null>(null)
  const [viewModeOverride, setViewModeOverride] = useState<'auto' | 'grouped' | 'flat'>('auto')

  // Expanded keys
  const [expandedFlat, setExpandedFlat]       = useState<Set<string>>(new Set())
  const [expandedChildren, setExpandedChildren] = useState<Set<string>>(new Set())
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())

  // Transfer Balance Modal state
  const [transferModal, setTransferModal] = useState<TransferModalState | null>(null)

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn:  accountsApi.list,
    staleTime: 5 * 60 * 1000,
  })

  const { data, isFetching, isError } = useQuery({
    queryKey: ['report-ar-analytics', committed],
    queryFn:  () => reportsApi.getARAnalytics(committed!),
    enabled:  !!committed,
    staleTime: 0,
  })

  const handleGenerate = () => {
    setCommitted({ ...filters })
    setExpandedFlat(new Set())
    setExpandedChildren(new Set())
    setExpandedAccounts(new Set())
  }

  const handleReset = () => {
    setFilters(EMPTY_FILTERS)
    setCommitted(null)
    setExpandedFlat(new Set())
    setExpandedChildren(new Set())
    setExpandedAccounts(new Set())
  }

  const toggleAccount = (id: string) =>
    setFilters(f => ({
      ...f,
      account_ids: f.account_ids.includes(id)
        ? f.account_ids.filter(x => x !== id)
        : [...f.account_ids, id],
    }))

  const rows = data?.rows ?? []
  const totals = data?.totals

  // Determine effective view mode
  const effectiveViewMode = useMemo<'grouped' | 'flat'>(() => {
    if (viewModeOverride !== 'auto') return viewModeOverride
    // When exactly 1 account is filtered, flat view is optimal (Variant A).
    // Otherwise, grouped by child is optimal (Variant B).
    return committed?.account_ids.length === 1 ? 'flat' : 'grouped'
  }, [viewModeOverride, committed])

  // Group rows by child for grouped view
  const childGroups = useMemo<ChildGroupData[]>(() => {
    const map = new Map<string, ChildGroupData>()
    for (const r of rows) {
      if (!map.has(r.child_id)) {
        map.set(r.child_id, {
          child_id: r.child_id,
          child_name: r.child_name,
          is_active: r.is_active,
          family_name: r.family_name,
          net_balance: r.net_balance ?? 0,
          has_cross_imbalance: !!r.has_cross_imbalance,
          cross_prepayment_total: r.cross_prepayment_total ?? 0,
          balance_start: 0,
          accrued_in_period: 0,
          paid_in_period: 0,
          balance_end: 0,
          current_balance: 0,
          account_rows: [],
        })
      }
      const g = map.get(r.child_id)!
      g.balance_start     += r.balance_start
      g.accrued_in_period += r.accrued_in_period
      g.paid_in_period    += r.paid_in_period
      g.balance_end       += r.balance_end
      g.current_balance   += r.current_balance
      g.account_rows.push(r)
    }

    // In grouped view, cross-account imbalance strictly requires at least 2 accounts with opposing balances
    for (const g of map.values()) {
      const hasDebt = g.account_rows.some(ar => ar.current_balance < -0.005)
      const hasAdvance = g.account_rows.some(ar => ar.current_balance > 0.005)
      g.has_cross_imbalance = g.account_rows.length > 1 && hasDebt && hasAdvance
    }

    return Array.from(map.values())
  }, [rows])

  // Count children with cross-account imbalance in current result
  const imbalanceCount = useMemo(() => {
    if (effectiveViewMode === 'flat') {
      const seen = new Set<string>()
      for (const r of rows) {
        if (r.has_cross_imbalance) seen.add(r.child_id)
      }
      return seen.size
    } else {
      return childGroups.filter(g => g.has_cross_imbalance).length
    }
  }, [rows, childGroups, effectiveViewMode])

  // Expand / collapse handlers
  const toggleFlatRow = (key: string) => {
    setExpandedFlat(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleChildGroup = (childId: string) => {
    setExpandedChildren(prev => {
      const next = new Set(prev)
      if (next.has(childId)) next.delete(childId)
      else next.add(childId)
      return next
    })
  }

  const toggleAccountSub = (key: string) => {
    setExpandedAccounts(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleExpandAll = () => {
    if (effectiveViewMode === 'flat') {
      const allKeys = rows.map(r => `${r.child_id}:${r.account_id}`)
      if (expandedFlat.size === allKeys.length) setExpandedFlat(new Set())
      else setExpandedFlat(new Set(allKeys))
    } else {
      const allChildIds = childGroups.map(g => g.child_id)
      if (expandedChildren.size === allChildIds.length) {
        setExpandedChildren(new Set())
        setExpandedAccounts(new Set())
      } else {
        setExpandedChildren(new Set(allChildIds))
      }
    }
  }

  // Open transfer modal from flat row
  const handleOpenTransferFromRow = (row: ARAnalyticsRow) => {
    const allBalances: Array<{ account_id: string; account_name: string; balance: string | number }> = [
      { account_id: row.account_id, account_name: row.account_name, balance: row.current_balance },
      ...(row.other_accounts ?? []).map(o => ({
        account_id: o.account_id,
        account_name: o.account_name,
        balance: o.current_balance,
      })),
    ]

    // Identify source (positive balance) and target (negative balance)
    const positive = allBalances.filter(b => Number(b.balance) > 0.005).sort((a, b) => Number(b.balance) - Number(a.balance))
    const negative = allBalances.filter(b => Number(b.balance) < -0.005).sort((a, b) => Number(a.balance) - Number(b.balance))

    const fromAcc = positive[0]?.account_id
    const toAcc = negative[0]?.account_id
    const posAmt = Number(positive[0]?.balance ?? 0)
    const negAmt = Math.abs(Number(negative[0]?.balance ?? 0))
    const defaultAmount = posAmt > 0 && negAmt > 0 ? Math.min(posAmt, negAmt) : undefined

    setTransferModal({
      childId: row.child_id,
      childName: row.child_name,
      balances: allBalances,
      defaultFromAccountId: fromAcc,
      defaultToAccountId: toAcc,
      defaultAmount,
    })
  }

  // Open transfer modal from child group
  const handleOpenTransferFromGroup = (group: ChildGroupData) => {
    const allBalancesMap = new Map<string, { account_id: string; account_name: string; balance: string | number }>()
    for (const r of group.account_rows) {
      allBalancesMap.set(r.account_id, { account_id: r.account_id, account_name: r.account_name, balance: r.current_balance })
      if (r.other_accounts) {
        for (const o of r.other_accounts) {
          if (!allBalancesMap.has(o.account_id)) {
            allBalancesMap.set(o.account_id, { account_id: o.account_id, account_name: o.account_name, balance: o.current_balance })
          }
        }
      }
    }
    const allBalances = Array.from(allBalancesMap.values())

    const positive = allBalances.filter(b => Number(b.balance) > 0.005).sort((a, b) => Number(b.balance) - Number(a.balance))
    const negative = allBalances.filter(b => Number(b.balance) < -0.005).sort((a, b) => Number(a.balance) - Number(b.balance))

    const fromAcc = positive[0]?.account_id
    const toAcc = negative[0]?.account_id
    const posAmt = Number(positive[0]?.balance ?? 0)
    const negAmt = Math.abs(Number(negative[0]?.balance ?? 0))
    const defaultAmount = posAmt > 0 && negAmt > 0 ? Math.min(posAmt, negAmt) : undefined

    setTransferModal({
      childId: group.child_id,
      childName: group.child_name,
      balances: allBalances,
      defaultFromAccountId: fromAcc,
      defaultToAccountId: toAcc,
      defaultAmount,
    })
  }

  const allExpanded = effectiveViewMode === 'flat'
    ? rows.length > 0 && expandedFlat.size === rows.length
    : childGroups.length > 0 && expandedChildren.size === childGroups.length

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-900 text-lg">Аналітика дебіторської заборгованості</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Нарахування, оплати та баланс по клієнтах з контролем оплат на інші рахунки привязок
          </p>
        </div>

        {/* View Mode Switcher (available when multiple accounts or data loaded) */}
        {data && rows.length > 0 && (
          <div className="flex items-center gap-1.5 self-start sm:self-auto bg-gray-100 p-1 rounded-lg border border-gray-200 text-xs">
            <span className="text-gray-500 px-1 font-medium">Вигляд:</span>
            <button
              type="button"
              onClick={() => setViewModeOverride('grouped')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                effectiveViewMode === 'grouped'
                  ? 'bg-white text-iris-700 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              За дітьми (зведено)
            </button>
            <button
              type="button"
              onClick={() => setViewModeOverride('flat')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                effectiveViewMode === 'flat'
                  ? 'bg-white text-iris-700 shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              За рахунками
            </button>
          </div>
        )}
      </div>

      {/* Filters Form */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">

        {/* Period */}
        <div className="space-y-2 col-span-2">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Період</label>
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={filters.from_month}
              onChange={e => setFilters(f => ({ ...f, from_month: e.target.value }))}
              className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-400"
            />
            <span className="text-gray-400 text-sm">—</span>
            <input
              type="month"
              value={filters.to_month}
              min={filters.from_month}
              onChange={e => setFilters(f => ({ ...f, to_month: e.target.value }))}
              className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-400"
            />
          </div>
        </div>

        {/* Balance mode */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Баланс рахунку</label>
          <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm">
            {([
              { value: 'all',      label: 'Всі'     },
              { value: 'debtors',  label: 'Борг'    },
              { value: 'advances', label: 'Аванс'   },
            ] as const).map(opt => (
              <button
                key={opt.value}
                onClick={() => setFilters(f => ({ ...f, balance_mode: opt.value }))}
                className={`flex-1 py-1.5 transition-colors ${
                  filters.balance_mode === opt.value
                    ? 'bg-iris-500 text-white font-medium'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* is_active */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Статус дитини</label>
          <select
            value={filters.is_active}
            onChange={e => setFilters(f => ({ ...f, is_active: e.target.value as ARAnalyticsFilters['is_active'] }))}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-iris-400"
          >
            <option value="">Всі</option>
            <option value="true">Активні</option>
            <option value="false">Архівні</option>
          </select>
        </div>

        {/* Accounts filter */}
        {accounts.length > 1 && (
          <div className="space-y-2 col-span-2">
            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide">Рахунки</label>
            <div className="flex flex-wrap gap-2">
              {accounts.map(a => (
                <button
                  key={a.id}
                  onClick={() => toggleAccount(a.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                    filters.account_ids.includes(a.id)
                      ? 'bg-iris-500 text-white border-iris-500'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-iris-400'
                  }`}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quick Filter: Only cross-account imbalances */}
        <div className="space-y-2 col-span-2 flex items-end">
          <button
            type="button"
            onClick={() => setFilters(f => ({ ...f, only_imbalances: !f.only_imbalances }))}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              filters.only_imbalances
                ? 'bg-amber-100 text-amber-900 border-amber-300 shadow-xs'
                : 'bg-amber-50/60 text-amber-800 border-amber-200 hover:bg-amber-100/60'
            }`}
          >
            <span className="text-sm">⚠️</span>
            <span>Тільки з перекосом між рахунками</span>
            {imbalanceCount > 0 && committed && (
              <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.2 rounded-full font-bold ml-1">
                {imbalanceCount}
              </span>
            )}
          </button>
        </div>

      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleGenerate}
          disabled={isFetching || !filters.from_month || !filters.to_month}
          className="px-5 py-2 bg-iris-600 text-white text-sm font-medium rounded-lg hover:bg-iris-700 disabled:opacity-50 transition-colors shadow-xs"
        >
          {isFetching ? 'Завантаження…' : 'Згенерувати'}
        </button>
        {committed && (
          <button
            onClick={handleReset}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Скинути
          </button>
        )}
      </div>

      {/* Error */}
      {isError && (
        <p className="text-sm text-red-600">Помилка завантаження. Спробуйте ще раз.</p>
      )}

      {/* Table: Empty State */}
      {data && rows.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-8">Дані відсутні для обраних фільтрів.</p>
      )}

      {/* Table Content */}
      {data && rows.length > 0 && (
        <div className="overflow-x-auto -mx-6">
          <table className="w-full min-w-[1000px] text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-y border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
                <th className="pl-3 pr-1 py-2 w-6">
                  <button
                    onClick={toggleExpandAll}
                    className="text-gray-400 hover:text-gray-600"
                    title={allExpanded ? 'Згорнути всі' : 'Розгорнути всі'}
                  >
                    {allExpanded ? '▼' : '▶'}
                  </button>
                </th>
                <th className="px-3 py-2">Дитина</th>
                <th className="px-3 py-2">Сімʼя</th>
                {effectiveViewMode === 'flat' ? (
                  <>
                    <th className="px-3 py-2">Рахунок</th>
                    <th className="px-3 py-2">Інші рахунки / Аванс</th>
                  </>
                ) : (
                  <th colSpan={2} className="px-3 py-2">Рахунки / Стан перекосу</th>
                )}
                <th className="px-3 py-2 text-right">Баланс на початок</th>
                <th className="px-3 py-2 text-right">Нараховано</th>
                <th className="px-3 py-2 text-right">Сплачено</th>
                <th className="px-3 py-2 text-right">Баланс на кінець</th>
                <th className="px-3 py-2 text-right">Поточний баланс</th>
                <th className="px-3 py-2 text-right">Дії</th>
              </tr>
            </thead>

            <tbody>
              {effectiveViewMode === 'flat' ? (
                // ── Flat View (Variant A) ──
                rows.map(row => {
                  const key = `${row.child_id}:${row.account_id}`
                  return (
                    <FlatAnalyticsRow
                      key={key}
                      row={row}
                      isExpanded={expandedFlat.has(key)}
                      onToggle={() => toggleFlatRow(key)}
                      onOpenTransfer={handleOpenTransferFromRow}
                    />
                  )
                })
              ) : (
                // ── Grouped View (Variant B: Child -> Accounts) ──
                childGroups.map(group => (
                  <GroupedChildRow
                    key={group.child_id}
                    group={group}
                    isExpanded={expandedChildren.has(group.child_id)}
                    onToggle={() => toggleChildGroup(group.child_id)}
                    expandedAccounts={expandedAccounts}
                    onToggleAccount={toggleAccountSub}
                    onOpenTransfer={handleOpenTransferFromGroup}
                  />
                ))
              )}
            </tbody>

            {/* Totals Footer */}
            {totals && (
              <tfoot>
                <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold text-sm">
                  <td />
                  <td colSpan={effectiveViewMode === 'flat' ? 3 : 3} className="px-3 py-2.5 text-gray-700">
                    Разом ({effectiveViewMode === 'flat' ? `${rows.length} записів` : `${childGroups.length} дітей`})
                  </td>
                  <td className="px-3 py-2.5" />
                  <td className={`px-3 py-2.5 text-right tabular-nums ${balanceClass(totals.balance_start)}`}>
                    {fmtMoney(totals.balance_start)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                    {fmtMoney(totals.accrued_in_period)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                    {fmtMoney(totals.paid_in_period)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${balanceClass(totals.balance_end)}`}>
                    {fmtMoney(totals.balance_end)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${balanceClass(totals.current_balance)}`}>
                    {fmtMoney(totals.current_balance)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Placeholder before first generate */}
      {!data && !isFetching && (
        <div className="text-center py-12 text-gray-400 text-sm">
          Оберіть період і натисніть «Згенерувати»
        </div>
      )}

      {/* Transfer Balance Modal */}
      {transferModal && (
        <TransferBalanceModal
          childId={transferModal.childId}
          isOpen={!!transferModal}
          accounts={accounts}
          balances={transferModal.balances}
          defaultFromAccountId={transferModal.defaultFromAccountId}
          defaultToAccountId={transferModal.defaultToAccountId}
          defaultAmount={transferModal.defaultAmount}
          onClose={() => setTransferModal(null)}
        />
      )}

    </div>
  )
}
