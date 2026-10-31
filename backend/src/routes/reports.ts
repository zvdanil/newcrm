import type { FastifyInstance } from 'fastify'
import { sql, type SqlBool } from 'kysely'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'
import { getChildIndividualTariff, getEffectivePrice } from '../services/billingRunService.js'

export async function reportsRoutes(app: FastifyInstance) {
  // GET /api/reports/accounts-receivable
  // Returns all children with negative balance (debt), with filters.
  app.get<{
    Querystring: {
      from_month?: string   // YYYY-MM — filter: had ACCRUAL billing_month >= this
      to_month?: string     // YYYY-MM — filter: had ACCRUAL billing_month <= this
      account_ids?: string  // comma-separated UUIDs; empty = all accounts
      is_active?: string    // 'true' | 'false'; empty = all
      min_debt?: string     // minimum debt amount (positive), default 0.01
      sort?: string         // 'desc' = biggest debt first (default), 'asc' = smallest first
    }
  }>(
    '/accounts-receivable',
    { preHandler: authenticate },
    async (request) => {
      const {
        from_month,
        to_month,
        account_ids: accountIdsRaw,
        is_active,
        min_debt,
        sort,
      } = request.query

      const accountIds = accountIdsRaw ? accountIdsRaw.split(',').filter(Boolean) : []
      const minDebt    = Math.max(0, Number(min_debt ?? 0.01))
      // balance is negative; 'desc' debt = balance ASC (most negative first)
      const balanceDir = sort === 'asc' ? 'desc' as const : 'asc' as const

      let query = db
        .selectFrom('child_balances as cb')
        .innerJoin('children as c', 'c.id', 'cb.child_id')
        .innerJoin('accounts as a', 'a.id', 'cb.account_id')
        .leftJoin('families as f', 'f.id', 'c.family_id')
        .leftJoin('parents as p', 'p.id', 'f.primary_parent_id')
        .select([
          'c.id as child_id',
          'c.full_name as child_name',
          'c.is_active',
          'f.id as family_id',
          'f.name as family_name',
          'p.full_name as primary_parent_name',
          'p.phone as primary_parent_phone',
          'a.id as account_id',
          'a.name as account_name',
          sql<number>`(-cb.balance)`.as('debt'),
        ])
        .where(sql<SqlBool>`cb.balance < 0`)
        .where(sql<SqlBool>`-cb.balance >= ${minDebt}`)

      // Account filter
      if (accountIds.length > 0) {
        query = query.where('cb.account_id', 'in', accountIds)
      }

      // Active status filter
      if (is_active === 'true') {
        query = query.where('c.is_active', '=', true)
      } else if (is_active === 'false') {
        query = query.where('c.is_active', '=', false)
      }

      // Period filter: only include child+account pairs that had an ACCRUAL
      // with billing_month in the requested range (per_lesson accruals have billing_month=null,
      // so we also include transaction_date range as fallback).
      if (from_month || to_month) {
        const fromDate = from_month ? new Date(`${from_month}-01`) : null
        const toDate   = to_month   ? new Date(`${to_month}-01`)   : null

        let accrualSub = db
          .selectFrom('transactions as t')
          .select(['t.child_id', 't.account_id'])
          .where('t.type', '=', 'ACCRUAL')
          .where('t.is_deleted', '=', false)
          .distinct()

        if (fromDate && toDate) {
          accrualSub = accrualSub.where((eb) => eb.or([
            // monthly / smart accruals filtered by billing_month
            eb.and([
              eb('t.billing_month', 'is not', null),
              eb('t.billing_month', '>=', fromDate),
              eb('t.billing_month', '<=', toDate),
            ]),
            // per_lesson accruals filtered by transaction_date
            eb.and([
              eb('t.billing_month', 'is', null),
              eb('t.transaction_date', '>=', fromDate),
              eb('t.transaction_date', '<=', toDate),
            ]),
          ]))
        } else if (fromDate) {
          accrualSub = accrualSub.where((eb) => eb.or([
            eb.and([eb('t.billing_month', 'is not', null), eb('t.billing_month', '>=', fromDate)]),
            eb.and([eb('t.billing_month', 'is', null), eb('t.transaction_date', '>=', fromDate)]),
          ]))
        } else if (toDate) {
          accrualSub = accrualSub.where((eb) => eb.or([
            eb.and([eb('t.billing_month', 'is not', null), eb('t.billing_month', '<=', toDate)]),
            eb.and([eb('t.billing_month', 'is', null), eb('t.transaction_date', '<=', toDate)]),
          ]))
        }

        query = query.innerJoin(accrualSub.as('bm'), (join) =>
          join.onRef('bm.child_id', '=', 'c.id').onRef('bm.account_id', '=', 'cb.account_id')
        )
      }

      const rows = await query
        .orderBy('cb.balance', balanceDir)
        .orderBy('c.full_name', 'asc')
        .limit(500)
        .execute()

      const mapped = rows.map((r) => ({ ...r, debt: Number(r.debt) }))
      const totalDebt      = mapped.reduce((s, r) => s + r.debt, 0)
      const childrenCount  = new Set(mapped.map((r) => r.child_id)).size

      return { rows: mapped, total_debt: totalDebt, children_count: childrenCount }
    }
  )

  // ── PnL Report ─────────────────────────────────────────────────────────────
  // GET /api/reports/pnl?from=YYYY-MM&to=YYYY-MM
  // Returns 7 financial metrics for each month in range.
  // Columns: expected_revenue, accrued_expense, real_income,
  //          expense_turnover, expense_turnover_no_div, balance_no_div, account_balance
  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/pnl',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      const { from, to } = req.query

      // Parse range — default: current month
      const now = new Date()
      const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 5, 1)
      const fromDate = from ? new Date(`${from}-01`) : defaultFrom
      const toDate   = to   ? new Date(`${to}-01`)   : new Date(now.getFullYear(), now.getMonth(), 1)

      // Helper: format Date as 'YYYY-MM-01'
      const fmtMonth = (d: Date) => {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        return `${y}-${m}-01`
      }

      // ── 6 parallel queries (ALL time data — needed for cumulative balance) ──
      const [
        clientAccruals,
        clientPayments,
        expenseAccruals,
        expensePayments,
        salaryAccruals,
        salaryPayments,
      ] = await Promise.all([

        // 1. Expected revenue = client ACCRUAL by billing_month (or transaction_date for per_lesson)
        db.selectFrom('transactions')
          .select([
            sql<string>`to_char(COALESCE(billing_month, date_trunc('month', transaction_date)), 'YYYY-MM-01')`.as('month'),
            sql<string>`COALESCE(SUM(amount), 0)`.as('total'),
          ])
          .where('type', '=', 'ACCRUAL')
          .where('is_deleted', '=', false)
          .groupBy(sql`COALESCE(billing_month, date_trunc('month', transaction_date))`)
          .execute(),

        // 2. Real income = client PAYMENT by transaction_date
        db.selectFrom('transactions')
          .select([
            sql<string>`to_char(date_trunc('month', transaction_date), 'YYYY-MM-01')`.as('month'),
            sql<string>`COALESCE(SUM(amount), 0)`.as('total'),
          ])
          .where('type', '=', 'PAYMENT')
          .where('is_deleted', '=', false)
          .groupBy(sql`date_trunc('month', transaction_date)`)
          .execute(),

        // 3. Accrued expense (part A) = ALL expenses by accrual_date (pending + paid)
        db.selectFrom('expenses')
          .select([
            sql<string>`to_char(date_trunc('month', accrual_date), 'YYYY-MM-01')`.as('month'),
            sql<string>`COALESCE(SUM(amount), 0)`.as('total'),
          ])
          .where('is_deleted', '=', false)
          .where('is_advance', '=', false)
          .where('is_advance_return', '=', false)
          .groupBy(sql`date_trunc('month', accrual_date)`)
          .execute(),

        // 4. Expense turnover = PAID expenses by payment_date (with no-div split)
        db.selectFrom('expenses')
          .select([
            sql<string>`to_char(date_trunc('month', payment_date), 'YYYY-MM-01')`.as('month'),
            sql<string>`COALESCE(SUM(amount), 0)`.as('total'),
            sql<string>`COALESCE(SUM(CASE WHEN NOT is_dividend THEN amount WHEN dividend_amount IS NOT NULL THEN (amount - dividend_amount) ELSE 0 END), 0)`.as('total_no_div'),
          ])
          .where('status', '=', 'paid')
          .where('is_deleted', '=', false)
          .where('is_advance', '=', false)
          .where('is_advance_return', '=', false)
          .where('payment_date', 'is not', null)
          .groupBy(sql`date_trunc('month', payment_date)`)
          .execute(),

        // 5. Accrued expense (part B) = salary ACCRUAL by billing_month
        db.selectFrom('salary_transactions')
          .select([
            sql<string>`to_char(COALESCE(billing_month, date_trunc('month', transaction_date)), 'YYYY-MM-01')`.as('month'),
            sql<string>`COALESCE(SUM(gross_amount), 0)`.as('total'),
          ])
          .where('type', '=', 'ACCRUAL')
          .where('is_deleted', '=', false)
          .groupBy(sql`COALESCE(billing_month, date_trunc('month', transaction_date))`)
          .execute(),

        // 6. Salary payments (with no-div split)
        db.selectFrom('salary_transactions')
          .select([
            sql<string>`to_char(date_trunc('month', transaction_date), 'YYYY-MM-01')`.as('month'),
            sql<string>`COALESCE(SUM(gross_amount), 0)`.as('total'),
            sql<string>`COALESCE(SUM(CASE WHEN NOT is_dividend THEN gross_amount ELSE 0 END), 0)`.as('total_no_div'),
          ])
          .where('type', '=', 'PAYMENT')
          .where('is_deleted', '=', false)
          .groupBy(sql`date_trunc('month', transaction_date)`)
          .execute(),
      ])

      // ── Lookup helpers ────────────────────────────────────────────────────
      type MonthRow = { month: string; total: string }
      type MonthRowDiv = MonthRow & { total_no_div: string }

      const get = (data: MonthRow[], month: string) =>
        Number(data.find(r => r.month === month)?.total ?? 0)

      const getNoDiv = (data: MonthRowDiv[], month: string) =>
        Number(data.find(r => r.month === month)?.total_no_div ?? 0)

      // ── Cumulative account balance (running total, ALL time) ──────────────
      // Cash in: client payments. Cash out: paid expenses + salary payments.
      const allMonths = [
        ...clientPayments.map(r => r.month),
        ...expensePayments.map(r => r.month),
        ...salaryPayments.map(r => r.month),
      ]
      const sortedAllMonths = [...new Set(allMonths)].sort()

      let running = 0
      const cumulative: Record<string, number> = {}
      for (const m of sortedAllMonths) {
        running += get(clientPayments, m)
        running -= get(expensePayments, m)
        running -= get(salaryPayments, m)
        cumulative[m] = running
      }

      // Get cumulative balance as of end of targetMonth
      const getCumulative = (targetMonth: string): number => {
        const relevant = sortedAllMonths.filter(m => m <= targetMonth)
        if (relevant.length === 0) return 0
        return cumulative[relevant[relevant.length - 1]] ?? 0
      }

      // ── Generate requested months range ──────────────────────────────────
      const months: string[] = []
      const cursor = new Date(fromDate)
      while (cursor <= toDate) {
        months.push(fmtMonth(cursor))
        cursor.setMonth(cursor.getMonth() + 1)
      }

      // ── Assemble rows ─────────────────────────────────────────────────────
      const rows = months.map(month => {
        const expected_revenue  = get(clientAccruals, month)
        const accrued_expense   = get(expenseAccruals, month) + get(salaryAccruals, month)
        const real_income       = get(clientPayments, month)
        const expense_turnover  = get(expensePayments, month) + get(salaryPayments, month)
        const expense_turnover_no_div = getNoDiv(expensePayments as MonthRowDiv[], month)
                                      + getNoDiv(salaryPayments as MonthRowDiv[], month)
        const balance_no_div    = real_income - expense_turnover_no_div
        const account_balance   = getCumulative(month)

        return {
          month,
          expected_revenue,
          accrued_expense,
          real_income,
          expense_turnover,
          expense_turnover_no_div,
          balance_no_div,
          account_balance,
        }
      })

      return { rows }
    }
  )

  // ── AR Analytics Report ────────────────────────────────────────────────────
  // GET /api/reports/ar-analytics
  // Historical AR report: balance at start/end of period, accruals, payments —
  // per child with expandable monthly breakdown.
  app.get<{
    Querystring: {
      from_month?: string   // YYYY-MM, required
      to_month?: string     // YYYY-MM, required
      account_ids?: string  // comma-separated UUIDs
      balance_mode?: string // 'all' | 'debtors' | 'advances'
      is_active?: string    // 'true' | 'false' | ''
      only_imbalances?: string // 'true' | 'false' | ''
    }
  }>(
    '/ar-analytics',
    { preHandler: authenticate },
    async (request) => {
      const {
        from_month,
        to_month,
        account_ids: accountIdsRaw,
        balance_mode = 'all',
        is_active,
        only_imbalances,
      } = request.query

      if (!from_month || !to_month) {
        return {
          rows: [],
          totals: { balance_start: 0, accrued_in_period: 0, paid_in_period: 0, balance_end: 0, current_balance: 0 },
          period_months: [],
        }
      }

      const fromDate   = new Date(`${from_month}-01`)
      const toDate     = new Date(`${to_month}-01`)
      const accountIds = accountIdsRaw ? accountIdsRaw.split(',').filter(Boolean) : []

      // ── 1. Summary: per child+account — credit/debit sums before and within period ──
      let summaryQ = db
        .selectFrom('transactions as t')
        .select([
          't.child_id',
          't.account_id',
          // Credits / debits that occurred BEFORE the period (needed to compute balance_start)
          sql<string>`SUM(CASE WHEN t.type IN ('PAYMENT','REFUND','REVERSAL','TRANSFER_IN') AND date_trunc('month', t.transaction_date) < ${fromDate} THEN t.amount ELSE 0 END)`.as('credits_before'),
          sql<string>`SUM(CASE WHEN t.type IN ('ACCRUAL','ADJUSTMENT','TRANSFER_OUT') AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) < ${fromDate} THEN t.amount ELSE 0 END)`.as('debits_before'),
          // Credits / debits WITHIN the period
          sql<string>`SUM(CASE WHEN t.type IN ('PAYMENT','REFUND','REVERSAL','TRANSFER_IN') AND date_trunc('month', t.transaction_date) >= ${fromDate} AND date_trunc('month', t.transaction_date) <= ${toDate} THEN t.amount ELSE 0 END)`.as('credits_in_period'),
          sql<string>`SUM(CASE WHEN t.type IN ('ACCRUAL','ADJUSTMENT','TRANSFER_OUT') AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) >= ${fromDate} AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) <= ${toDate} THEN t.amount ELSE 0 END)`.as('debits_in_period'),
        ])
        .where('t.is_deleted', '=', false)
        .where(sql<SqlBool>`(
          (t.type IN ('PAYMENT','REFUND','REVERSAL','TRANSFER_IN') AND date_trunc('month', t.transaction_date) <= ${toDate})
          OR
          (t.type IN ('ACCRUAL','ADJUSTMENT','TRANSFER_OUT') AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) <= ${toDate})
        )`)
        .groupBy(['t.child_id', 't.account_id'])

      if (accountIds.length > 0) summaryQ = summaryQ.where('t.account_id', 'in', accountIds)

      // ── 2. Monthly detail: per child+account+month, within the period only ──
      let monthlyQ = db
        .selectFrom('transactions as t')
        .select([
          't.child_id',
          't.account_id',
          sql<string>`to_char(
            CASE WHEN t.type IN ('ACCRUAL','ADJUSTMENT','TRANSFER_OUT')
              THEN COALESCE(t.billing_month, date_trunc('month', t.transaction_date))
              ELSE date_trunc('month', t.transaction_date)
            END,
            'YYYY-MM-01'
          )`.as('month'),
          sql<string>`SUM(CASE WHEN t.type IN ('PAYMENT','REFUND','REVERSAL','TRANSFER_IN') THEN t.amount ELSE 0 END)`.as('credits'),
          sql<string>`SUM(CASE WHEN t.type IN ('ACCRUAL','ADJUSTMENT','TRANSFER_OUT') THEN t.amount ELSE 0 END)`.as('debits'),
        ])
        .where('t.is_deleted', '=', false)
        .where(sql<SqlBool>`(
          (t.type IN ('PAYMENT','REFUND','REVERSAL','TRANSFER_IN') AND date_trunc('month', t.transaction_date) >= ${fromDate} AND date_trunc('month', t.transaction_date) <= ${toDate})
          OR
          (t.type IN ('ACCRUAL','ADJUSTMENT','TRANSFER_OUT') AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) >= ${fromDate} AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) <= ${toDate})
        )`)
        .groupBy([
          't.child_id',
          't.account_id',
          sql`CASE WHEN t.type IN ('ACCRUAL','ADJUSTMENT','TRANSFER_OUT')
            THEN COALESCE(t.billing_month, date_trunc('month', t.transaction_date))
            ELSE date_trunc('month', t.transaction_date)
          END`,
        ])

      if (accountIds.length > 0) monthlyQ = monthlyQ.where('t.account_id', 'in', accountIds)

      // ── 3. Child metadata (all — is_active filter applied in JS) ──
      const childMetaQ = db
        .selectFrom('children as c')
        .leftJoin('families as f', 'f.id', 'c.family_id')
        .leftJoin('parents as p', 'p.id', 'f.primary_parent_id')
        .select([
          'c.id as child_id',
          'c.full_name as child_name',
          'c.is_active',
          'f.id as family_id',
          'f.name as family_name',
          'p.phone as primary_parent_phone',
        ])

      // ── 4. Accounts (all accounts loaded so we have names for other accounts too) ──
      const accountsQ = db.selectFrom('accounts').select(['id', 'name'])

      // ── 5. Initial balances ──
      let initQ = db.selectFrom('initial_balances').select(['child_id', 'account_id', 'amount'])
      if (accountIds.length > 0) initQ = initQ.where('account_id', 'in', accountIds)

      // ── 6. Current balances (all accounts loaded to detect cross-account balances) ──
      const curQ = db.selectFrom('child_balances').select(['child_id', 'account_id', 'balance'])

      const [summaryRows, monthlyRows, childMeta, accountMeta, initBals, curBals] = await Promise.all([
        summaryQ.execute(),
        monthlyQ.execute(),
        childMetaQ.execute(),
        accountsQ.execute(),
        initQ.execute(),
        curQ.execute(),
      ])

      // ── Build lookup maps ──
      const childMetaMap   = new Map(childMeta.map(r => [r.child_id, r]))
      const accountMetaMap = new Map(accountMeta.map(r => [r.id, r]))
      const initBalMap     = new Map(initBals.map(r => [`${r.child_id}:${r.account_id}`, Number(r.amount)]))
      const curBalMap      = new Map(curBals.map(r => [`${r.child_id}:${r.account_id}`, Number(r.balance)]))

      // Build map of all active/non-zero balances per child across all accounts
      const childAllBalancesMap = new Map<string, Array<{ account_id: string; account_name: string; current_balance: number }>>()
      for (const cb of curBals) {
        const bal = Number(cb.balance)
        if (Math.abs(bal) < 0.005) continue
        const acc = accountMetaMap.get(cb.account_id)
        if (!childAllBalancesMap.has(cb.child_id)) {
          childAllBalancesMap.set(cb.child_id, [])
        }
        childAllBalancesMap.get(cb.child_id)!.push({
          account_id: cb.account_id,
          account_name: acc?.name ?? '—',
          current_balance: bal,
        })
      }

      // Monthly lookup: `child_id:account_id` → Map<month_YYYY-MM-01, {credits, debits}>
      const monthlyMap = new Map<string, Map<string, { credits: number; debits: number }>>()
      for (const r of monthlyRows) {
        const k = `${r.child_id}:${r.account_id}`
        if (!monthlyMap.has(k)) monthlyMap.set(k, new Map())
        monthlyMap.get(k)!.set(r.month, { credits: Number(r.credits), debits: Number(r.debits) })
      }

      // ── Generate period months list ──
      const periodMonths: string[] = []
      const cur = new Date(fromDate)
      while (cur <= toDate) {
        const y = cur.getFullYear()
        const m = String(cur.getMonth() + 1).padStart(2, '0')
        periodMonths.push(`${y}-${m}-01`)
        cur.setMonth(cur.getMonth() + 1)
      }

      // ── Assemble rows ──
      const rows = summaryRows
        .map(sr => {
          const pairKey = `${sr.child_id}:${sr.account_id}`
          const initBal = initBalMap.get(pairKey) ?? 0
          const curBal  = curBalMap.get(pairKey)  ?? 0
          const child   = childMetaMap.get(sr.child_id)
          const account = accountMetaMap.get(sr.account_id)

          const credBefore   = Number(sr.credits_before)
          const debBefore    = Number(sr.debits_before)
          const credInPeriod = Number(sr.credits_in_period)
          const debInPeriod  = Number(sr.debits_in_period)

          const balance_start     = initBal + credBefore - debBefore
          const accrued_in_period = debInPeriod
          const paid_in_period    = credInPeriod
          const balance_end       = balance_start + credInPeriod - debInPeriod

          // Monthly breakdown with running balance from balance_start
          const mMap = monthlyMap.get(pairKey) ?? new Map()
          let running = balance_start
          const months = periodMonths.map(month => {
            const md = mMap.get(month) ?? { credits: 0, debits: 0 }
            const balance_start_month = running
            running += md.credits - md.debits
            return {
              month,
              accrued_in_month:  md.debits,
              paid_in_month:     md.credits,
              balance_start_month,
              balance_end_month: running,
            }
          })

          const isMultiAccountFilter = accountIds.length > 1
          const allChildBals = childAllBalancesMap.get(sr.child_id) ?? []

          // When multiple specific accounts are chosen (accountIds.length > 1), evaluate cross-account
          // imbalance strictly WITHIN the selected accounts.
          // When 1 account is chosen (or all accounts), evaluate across all accounts.
          const scopedChildBals = isMultiAccountFilter
            ? allChildBals.filter(b => accountIds.includes(b.account_id))
            : allChildBals

          const net_balance = scopedChildBals.reduce((sum, b) => sum + b.current_balance, 0)
          const hasDebt = scopedChildBals.some(b => b.current_balance < -0.005)
          const hasAdvance = scopedChildBals.some(b => b.current_balance > 0.005)
          const has_cross_imbalance = hasDebt && hasAdvance
          const other_accounts = scopedChildBals.filter(b => b.account_id !== sr.account_id)
          const cross_prepayment_total = other_accounts.filter(b => b.current_balance > 0.005).reduce((s, b) => s + b.current_balance, 0)

          return {
            child_id:             sr.child_id,
            child_name:           child?.child_name ?? '—',
            is_active:            child?.is_active ?? false,
            family_id:            child?.family_id ?? null,
            family_name:          child?.family_name ?? null,
            primary_parent_phone: child?.primary_parent_phone ?? null,
            account_id:           sr.account_id,
            account_name:         account?.name ?? '—',
            balance_start,
            accrued_in_period,
            paid_in_period,
            balance_end,
            current_balance: curBal,
            months,
            other_accounts,
            net_balance,
            has_cross_imbalance,
            cross_prepayment_total,
          }
        })
        // is_active filter
        .filter(r => {
          if (is_active === 'true'  && !r.is_active) return false
          if (is_active === 'false' &&  r.is_active) return false
          return true
        })
        // balance_mode filter (based on current_balance)
        .filter(r => {
          if (balance_mode === 'debtors')  return r.current_balance < -0.005
          if (balance_mode === 'advances') return r.current_balance >  0.005
          return true
        })
        // only_imbalances filter
        .filter(r => {
          if (only_imbalances === 'true' && !r.has_cross_imbalance) return false
          return true
        })
        // Sort: biggest debt (most negative) first, then by name
        .sort((a, b) => a.current_balance - b.current_balance || a.child_name.localeCompare(b.child_name))
        .slice(0, 500)

      const totals = {
        balance_start:     rows.reduce((s, r) => s + r.balance_start, 0),
        accrued_in_period: rows.reduce((s, r) => s + r.accrued_in_period, 0),
        paid_in_period:    rows.reduce((s, r) => s + r.paid_in_period, 0),
        balance_end:       rows.reduce((s, r) => s + r.balance_end, 0),
        current_balance:   rows.reduce((s, r) => s + r.current_balance, 0),
      }

      return { rows, totals, period_months: periodMonths }
    }
  )

  // ── PnL 2 Report ─────────────────────────────────────────────────────────────
  // GET /api/reports/pnl2?from=YYYY-MM&to=YYYY-MM&account_ids=...
  // Returns parallel Accrual and Cash metrics for each account and category, with detailed drilldown.
  app.get<{ Querystring: { from?: string; to?: string; account_ids?: string } }>(
    '/pnl2',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      const { from, to, account_ids: accountIdsRaw } = req.query
      const accountIds = accountIdsRaw ? accountIdsRaw.split(',').filter(Boolean) : []

      // Parse range — default: last 6 months
      const now = new Date()
      const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 5, 1)
      const fromDate = from ? new Date(`${from}-01`) : defaultFrom
      const toDate   = to   ? new Date(`${to}-01`)   : new Date(now.getFullYear(), now.getMonth(), 1)

      // Helper: format Date as 'YYYY-MM-01'
      const fmtMonth = (d: Date) => {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        return `${y}-${m}-01`
      }

      // Generate requested months list
      const months: string[] = []
      const cursor = new Date(fromDate)
      while (cursor <= toDate) {
        months.push(fmtMonth(cursor))
        cursor.setMonth(cursor.getMonth() + 1)
      }

      // 1. Fetch active accounts
      let accountsQ = db.selectFrom('accounts')
        .select(['id', 'name'])
        .where('is_active', '=', true)
      
      if (accountIds.length > 0) {
        accountsQ = accountsQ.where('id', 'in', accountIds)
      }
      
      const accounts = await accountsQ
        .orderBy('name', 'asc')
        .execute()

      // 2. Fetch withdrawal category
      const withdrawalCat = await db.selectFrom('expense_categories')
        .select('id')
        .where('name', '=', 'Вивід коштів')
        .executeTakeFirst()
      const withdrawalCatId = withdrawalCat?.id ?? null

      // 3. Parallel DB queries
      const [
        clientTxDetails,
        salaryTxDetails,
        expenseTxDetails,
        dividendPayouts,
        cashoutTransfers,
      ] = await Promise.all([
        // 1. Client transactions with activity and child info
        (() => {
          let q = db.selectFrom('transactions as t')
            .leftJoin('children as c', 'c.id', 't.child_id')
            .leftJoin('activities as act', 'act.id', 't.activity_id')
            .select([
              't.account_id',
              't.activity_id',
              'act.name as activity_name',
              't.child_id',
              'c.full_name as child_name',
              't.type',
              sql<string>`to_char(COALESCE(t.billing_month, date_trunc('month', t.transaction_date)), 'YYYY-MM-01')`.as('month_accrual'),
              sql<string>`to_char(date_trunc('month', t.transaction_date), 'YYYY-MM-01')`.as('month_payment'),
              sql<string>`COALESCE(SUM(t.amount), 0)`.as('total')
            ])
            .where('t.is_deleted', '=', false)
            .groupBy([
              't.account_id',
              't.activity_id',
              'act.name',
              't.child_id',
              'c.full_name',
              't.type',
              sql`COALESCE(t.billing_month, date_trunc('month', t.transaction_date))`,
              sql`date_trunc('month', t.transaction_date)`
            ])
          if (accountIds.length > 0) q = q.where('t.account_id', 'in', accountIds)
          return q.execute()
        })(),

        // 2. Salary transactions with staff info
        (() => {
          let q = db.selectFrom('salary_transactions as st')
            .innerJoin('staff as s', 's.id', 'st.staff_id')
            .select([
              'st.staff_id',
              's.full_name as staff_name',
              'st.type',
              'st.is_dividend',
              'st.note',
              'st.transaction_date',
              sql<string>`to_char(COALESCE(st.billing_month, date_trunc('month', st.transaction_date)), 'YYYY-MM-01')`.as('month_accrual'),
              sql<string>`to_char(date_trunc('month', st.transaction_date), 'YYYY-MM-01')`.as('month_payment'),
              sql<string>`COALESCE(SUM(st.gross_amount), 0)`.as('total')
            ])
            .where('st.is_deleted', '=', false)
            .groupBy([
              'st.staff_id',
              's.full_name',
              'st.type',
              'st.is_dividend',
              'st.note',
              'st.transaction_date',
              sql`COALESCE(st.billing_month, date_trunc('month', st.transaction_date))`,
              sql`date_trunc('month', st.transaction_date)`
            ])
          if (accountIds.length > 0) q = q.where('st.account_id', 'in', accountIds)
          return q.execute()
        })(),

        // 3. Expense transactions with category info
        (() => {
          let q = db.selectFrom('expenses as e')
            .leftJoin('expense_categories as c', 'c.id', 'e.category_id')
            .select([
              'e.id',
              'e.category_id',
              'c.name as category_name',
              'e.amount',
              'e.accrual_date',
              'e.payment_date',
              'e.status',
              'e.note',
              'e.is_dividend',
              'e.dividend_amount',
              'e.is_advance',
              'e.is_advance_return',
              'e.utilized_advance_amount',
              'e.dividend_payout_id',
            ])
            .where('e.is_deleted', '=', false)
          if (accountIds.length > 0) q = q.where('e.account_id', 'in', accountIds)
          return q.execute()
        })(),

        // 4. Dividend payouts to map participants
        db.selectFrom('dividend_payouts as dp')
          .innerJoin('equity_participants as ep', 'ep.id', 'dp.participant_id')
          .select(['dp.id', 'ep.name as participant_name'])
          .execute(),

        // 5. Cash-out transfers (linked to active expenses or salary payments)
        (() => {
          let q = db.selectFrom('account_transfers as t')
            .innerJoin('accounts as fa', 'fa.id', 't.from_account_id')
            .innerJoin('accounts as ta', 'ta.id', 't.to_account_id')
            .select([
              't.id',
              't.amount',
              't.transfer_date',
              't.note',
              't.from_account_id',
              'fa.name as from_account_name',
              't.to_account_id',
              'ta.name as to_account_name',
              sql<string>`to_char(date_trunc('month', t.transfer_date), 'YYYY-MM-01')`.as('month')
            ])
            .where((eb) => eb.or([
              eb.exists(
                db.selectFrom('expenses as e')
                  .select('e.id')
                  .where(sql<boolean>`e.withdrawal_transfer_id = t.id`)
                  .where('e.is_deleted', '=', false)
              ),
              eb.exists(
                db.selectFrom('salary_transactions as st')
                  .select('st.id')
                  .where(sql<boolean>`st.withdrawal_transfer_id = t.id`)
                  .where('st.is_deleted', '=', false)
              )
            ]))
          if (accountIds.length > 0) {
            q = q.where((eb) => eb.or([
              eb('t.from_account_id', 'in', accountIds),
              eb('t.to_account_id', 'in', accountIds)
            ]))
          }
          return q.execute()
        })(),
      ])

      // 4. Post-process Revenue Details
      const revDetailsMap: Record<string, Record<string, Record<string, { activity_name: string; accrued: number; paid: number; children: Record<string, { child_name: string; accrued: number; paid: number }> }>>> = {}
      const refundDetailsMap: Record<string, Record<string, Record<string, { activity_name: string; accrued: number; paid: number; children: Record<string, { child_name: string; accrued: number; paid: number }> }>>> = {}

      for (const tx of clientTxDetails) {
        const actId = tx.activity_id ?? 'manual'
        const actName = tx.activity_name ?? 'Без активності'
        const chId = tx.child_id ?? 'unknown'
        const chName = tx.child_name ?? 'Невідомий клієнт'
        const total = Number(tx.total)

        if (tx.type === 'ACCRUAL') {
          const m = tx.month_accrual
          if (!revDetailsMap[m]) revDetailsMap[m] = {}
          if (!revDetailsMap[m][tx.account_id]) revDetailsMap[m][tx.account_id] = {}
          if (!revDetailsMap[m][tx.account_id][actId]) {
            revDetailsMap[m][tx.account_id][actId] = { activity_name: actName, accrued: 0, paid: 0, children: {} }
          }
          const actObj = revDetailsMap[m][tx.account_id][actId]
          actObj.accrued += total
          if (!actObj.children[chId]) actObj.children[chId] = { child_name: chName, accrued: 0, paid: 0 }
          actObj.children[chId].accrued += total
        } else if (tx.type === 'PAYMENT') {
          const m = tx.month_payment
          if (!revDetailsMap[m]) revDetailsMap[m] = {}
          if (!revDetailsMap[m][tx.account_id]) revDetailsMap[m][tx.account_id] = {}
          if (!revDetailsMap[m][tx.account_id][actId]) {
            revDetailsMap[m][tx.account_id][actId] = { activity_name: actName, accrued: 0, paid: 0, children: {} }
          }
          const actObj = revDetailsMap[m][tx.account_id][actId]
          actObj.paid += total
          if (!actObj.children[chId]) actObj.children[chId] = { child_name: chName, accrued: 0, paid: 0 }
          actObj.children[chId].paid += total
        } else if (tx.type === 'REFUND') {
          const m = tx.month_accrual
          if (!refundDetailsMap[m]) refundDetailsMap[m] = {}
          if (!refundDetailsMap[m][tx.account_id]) refundDetailsMap[m][tx.account_id] = {}
          if (!refundDetailsMap[m][tx.account_id][actId]) {
            refundDetailsMap[m][tx.account_id][actId] = { activity_name: actName, accrued: 0, paid: 0, children: {} }
          }
          const actObj = refundDetailsMap[m][tx.account_id][actId]
          actObj.accrued += total
          if (!actObj.children[chId]) actObj.children[chId] = { child_name: chName, accrued: 0, paid: 0 }
          actObj.children[chId].accrued += total
        }
      }

      // Fold in cash-out transfers as revenue on the target account
      for (const w of cashoutTransfers) {
        const m = w.month
        const accId = w.to_account_id
        const actId = 'withdrawal'
        const actName = 'Обналичування'
        const chId = w.id
        const chName = `[Переказ з ${w.from_account_name}] ${w.note || 'Обналичування'}`
        const total = Number(w.amount)

        if (!revDetailsMap[m]) revDetailsMap[m] = {}
        if (!revDetailsMap[m][accId]) revDetailsMap[m][accId] = {}
        if (!revDetailsMap[m][accId][actId]) {
          revDetailsMap[m][accId][actId] = { activity_name: actName, accrued: 0, paid: 0, children: {} }
        }
        const actObj = revDetailsMap[m][accId][actId]
        actObj.paid += total
        if (!actObj.children[chId]) actObj.children[chId] = { child_name: chName, accrued: 0, paid: 0 }
        actObj.children[chId].paid += total
      }

      // 5. Post-process Salary Details
      const salaryDetailsMap: Record<string, Record<string, { staff_name: string; accrued: number; paid: number }>> = {}
      const salaryDividendPayments: Array<{ month: string; date: string; name: string; note: string; amount: number }> = []

      for (const tx of salaryTxDetails) {
        const total = Number(tx.total)
        const dateStr = tx.transaction_date ? new Date(tx.transaction_date).toISOString().slice(0, 10) : ''

        if (tx.is_dividend) {
          if (tx.type === 'PAYMENT') {
            salaryDividendPayments.push({
              month: tx.month_payment,
              date: dateStr,
              name: tx.staff_name,
              note: tx.note || 'Виплата дивідендів (ЗП)',
              amount: total,
            })
          }
          continue
        }

        if (tx.type === 'ACCRUAL') {
          const m = tx.month_accrual
          if (!salaryDetailsMap[m]) salaryDetailsMap[m] = {}
          if (!salaryDetailsMap[m][tx.staff_id]) {
            salaryDetailsMap[m][tx.staff_id] = { staff_name: tx.staff_name, accrued: 0, paid: 0 }
          }
          salaryDetailsMap[m][tx.staff_id].accrued += total
        } else if (tx.type === 'PAYMENT') {
          const m = tx.month_payment
          if (!salaryDetailsMap[m]) salaryDetailsMap[m] = {}
          if (!salaryDetailsMap[m][tx.staff_id]) {
            salaryDetailsMap[m][tx.staff_id] = { staff_name: tx.staff_name, accrued: 0, paid: 0 }
          }
          salaryDetailsMap[m][tx.staff_id].paid += total
        }
      }

      // 6. Post-process Expense Details
      const expDetailsMap: Record<string, Record<string, { category_name: string; accrued: number; paid: number; transactions: Array<{ id: string; date: string; amount: number; note: string; type: 'accrued' | 'paid' }> }>> = {}
      const withdrawalsTxList: Array<{ month: string; id: string; date: string; note: string; amount: number }> = []
      const dividendExpensesList: Array<{ month: string; id: string; date: string; note: string; amount: number; dividend_payout_id: string | null }> = []

      for (const e of expenseTxDetails) {
        const catId = e.category_id ?? 'uncategorized'
        const catName = e.category_name ?? 'Без категорії'
        const totalAmount = Number(e.amount)
        const divAmount = e.is_dividend
          ? (e.dividend_amount != null ? Number(e.dividend_amount) : totalAmount)
          : 0
        const opAmount = totalAmount - divAmount

        if (opAmount > 0 && !e.is_advance && !e.is_advance_return && (catId !== withdrawalCatId)) {
          const m = fmtMonth(new Date(e.accrual_date))
          if (!expDetailsMap[m]) expDetailsMap[m] = {}
          if (!expDetailsMap[m][catId]) {
            expDetailsMap[m][catId] = { category_name: catName, accrued: 0, paid: 0, transactions: [] }
          }
          const catObj = expDetailsMap[m][catId]
          catObj.accrued += opAmount
          catObj.transactions.push({
            id: e.id,
            date: new Date(e.accrual_date).toISOString().slice(0, 10),
            amount: opAmount,
            note: e.note || '',
            type: 'accrued',
          })
        }

        if (e.status === 'paid' && e.payment_date && !e.is_advance && !e.is_advance_return) {
          const m = fmtMonth(new Date(e.payment_date))
          const paidDateStr = new Date(e.payment_date).toISOString().slice(0, 10)

          if (e.is_dividend && divAmount > 0) {
            dividendExpensesList.push({
              month: m,
              id: e.id,
              date: paidDateStr,
              note: e.note || '',
              amount: divAmount,
              dividend_payout_id: e.dividend_payout_id,
            })
          }

          if (catId === withdrawalCatId) {
            withdrawalsTxList.push({
              month: m,
              id: e.id,
              date: paidDateStr,
              note: e.note || '',
              amount: totalAmount,
            })
          } else if (opAmount > 0) {
            if (!expDetailsMap[m]) expDetailsMap[m] = {}
            if (!expDetailsMap[m][catId]) {
              expDetailsMap[m][catId] = { category_name: catName, accrued: 0, paid: 0, transactions: [] }
            }
            const catObj = expDetailsMap[m][catId]
            catObj.paid += opAmount
            catObj.transactions.push({
              id: e.id,
              date: paidDateStr,
              amount: opAmount,
              note: e.note || '',
              type: 'paid',
            })
          }
        }
      }

      // 7. Assemble Results by Month
      const rows = months.map(month => {
        // Accounts list
        const monthAccounts = accounts.map(a => {
          let accrued = 0
          let paid = 0

          const monthMap = revDetailsMap[month]
          const accMap = monthMap?.[a.id]

          const detailsList = []
          if (accMap) {
            for (const [actId, actObj] of Object.entries(accMap)) {
              accrued += actObj.accrued
              paid += actObj.paid

              const childrenList = Object.entries(actObj.children).map(([childId, chObj]) => ({
                child_id: childId,
                child_name: chObj.child_name,
                accrued: chObj.accrued,
                paid: chObj.paid,
              })).sort((x, y) => y.paid - x.paid || y.accrued - x.accrued)

              detailsList.push({
                activity_id: actId,
                activity_name: actObj.activity_name,
                accrued: actObj.accrued,
                paid: actObj.paid,
                children: childrenList,
              })
            }
          }

          detailsList.sort((x, y) => y.paid - x.paid || y.accrued - x.accrued)

          return {
            account_id: a.id,
            name: a.name,
            accrued,
            paid,
            details: detailsList,
          }
        })

        // Refunds list
        const monthRefunds = accounts.map(a => {
          let accrued = 0
          let paid = 0

          const monthMap = refundDetailsMap[month]
          const accMap = monthMap?.[a.id]

          const detailsList = []
          if (accMap) {
            for (const [actId, actObj] of Object.entries(accMap)) {
              accrued += actObj.accrued
              paid += actObj.paid

              const childrenList = Object.entries(actObj.children).map(([childId, chObj]) => ({
                child_id: childId,
                child_name: chObj.child_name,
                accrued: chObj.accrued,
                paid: chObj.paid,
              })).sort((x, y) => y.accrued - x.accrued)

              detailsList.push({
                activity_id: actId,
                activity_name: actObj.activity_name,
                accrued: actObj.accrued,
                paid: actObj.paid,
                children: childrenList,
              })
            }
          }

          detailsList.sort((x, y) => y.accrued - x.accrued)

          return {
            account_id: a.id,
            name: a.name,
            accrued,
            paid,
            details: detailsList,
          }
        })

        // Salary
        const monthSalaryDetails = []
        const salMap = salaryDetailsMap[month]
        let salary_accrued = 0
        let salary_paid = 0
        if (salMap) {
          for (const [staffId, obj] of Object.entries(salMap)) {
            salary_accrued += obj.accrued
            salary_paid += obj.paid
            monthSalaryDetails.push({
              staff_id: staffId,
              staff_name: obj.staff_name,
              accrued: obj.accrued,
              paid: obj.paid,
            })
          }
        }
        monthSalaryDetails.sort((x, y) => y.paid - x.paid || y.accrued - x.accrued)

        // General Expenses
        const monthExpDetails = []
        const expMap = expDetailsMap[month]
        let expenses_accrued = 0
        let expenses_paid = 0
        if (expMap) {
          for (const [catId, obj] of Object.entries(expMap)) {
            expenses_accrued += obj.accrued
            expenses_paid += obj.paid
            obj.transactions.sort((x, y) => x.date.localeCompare(y.date))
            monthExpDetails.push({
              category_id: catId,
              category_name: obj.category_name,
              accrued: obj.accrued,
              paid: obj.paid,
              transactions: obj.transactions,
            })
          }
        }
        monthExpDetails.sort((x, y) => y.paid - x.paid || y.accrued - x.accrued)

        // Withdrawals
        const monthWithdrawals = withdrawalsTxList
          .filter(t => t.month === month)
          .map(t => ({ id: t.id, date: t.date, note: t.note, amount: t.amount }))
          .sort((x, y) => x.date.localeCompare(y.date))
        const withdrawal_paid = monthWithdrawals.reduce((s, t) => s + t.amount, 0)

        // Dividends
        const monthDividends = []
        const divExps = dividendExpensesList.filter(t => t.month === month)
        for (const de of divExps) {
          const recipient = de.dividend_payout_id
            ? (dividendPayouts.find(p => p.id === de.dividend_payout_id)?.participant_name ?? '')
            : ''
          monthDividends.push({
            id: de.id,
            date: de.date,
            recipient,
            note: de.note,
            amount: de.amount,
          })
        }
        const divSals = salaryDividendPayments.filter(t => t.month === month)
        for (const ds of divSals) {
          monthDividends.push({
            id: ds.date + '::' + ds.name,
            date: ds.date,
            recipient: ds.name,
            note: ds.note,
            amount: ds.amount,
          })
        }
        monthDividends.sort((x, y) => x.date.localeCompare(y.date))
        const dividend_paid = monthDividends.reduce((s, t) => s + t.amount, 0)

        return {
          month,
          accounts: monthAccounts,
          refunds: {
            accrued: monthRefunds.reduce((s, r) => s + r.accrued, 0),
            paid: 0,
            details: monthRefunds,
          },
          salary: { accrued: salary_accrued, paid: salary_paid, details: monthSalaryDetails },
          expenses: { accrued: expenses_accrued, paid: expenses_paid, details: monthExpDetails },
          withdrawals: { paid: withdrawal_paid, transactions: monthWithdrawals },
          dividends: { paid: dividend_paid, transactions: monthDividends },
        }
      })

      return {
        months,
        accounts,
        rows,
      }
    }
  )

  // ── PnL 3 Report Core ────────────────────────────────────────────────────────
  // Mixed-base PnL: Income by accrual minus refunds, expenses by actual payment,
  // internal transfers & obnal isolated, non-operating expenses separate, obnal commissions in OPEX.
  // salaryBasis: 'payment' (standard PnL3) or 'accrual' (PnL3 по нарахуванню ЗП).
  async function buildPnL3Report(
    from?: string,
    to?: string,
    accountIdsRaw?: string,
    salaryBasis: 'payment' | 'accrual' = 'payment',
    staffType?: 'all' | 'employee' | 'partner'
  ) {
    const accountIds = accountIdsRaw ? accountIdsRaw.split(',').filter(Boolean) : []

      const now = new Date()
      const defaultFrom = new Date(now.getFullYear(), now.getMonth() - 5, 1)
      const fromDate = from ? new Date(`${from}-01`) : defaultFrom
      const toDate   = to   ? new Date(`${to}-01`)   : new Date(now.getFullYear(), now.getMonth(), 1)

      const fmtMonth = (d: Date) => {
        const y = d.getFullYear()
        const m = String(d.getMonth() + 1).padStart(2, '0')
        return `${y}-${m}-01`
      }

      const months: string[] = []
      const cursor = new Date(fromDate)
      while (cursor <= toDate) {
        months.push(fmtMonth(cursor))
        cursor.setMonth(cursor.getMonth() + 1)
      }

      let accountsQ = db.selectFrom('accounts')
        .select(['id', 'name'])
        .where('is_active', '=', true)

      if (accountIds.length > 0) {
        accountsQ = accountsQ.where('id', 'in', accountIds)
      }

      const accounts = await accountsQ
        .orderBy('name', 'asc')
        .execute()

      const withdrawalCat = await db.selectFrom('expense_categories')
        .select('id')
        .where('name', '=', 'Вивід коштів')
        .executeTakeFirst()
      const withdrawalCatId = withdrawalCat?.id ?? null

      const [
        clientTxDetails,
        salaryTxDetails,
        expenseTxDetails,
        dividendPayouts,
        allTransfers,
      ] = await Promise.all([
        // 1. Client transactions (accruals & refunds)
        (() => {
          let q = db.selectFrom('transactions as t')
            .leftJoin('children as c', 'c.id', 't.child_id')
            .leftJoin('activities as act', 'act.id', 't.activity_id')
            .select([
              't.account_id',
              't.activity_id',
              'act.name as activity_name',
              't.child_id',
              'c.full_name as child_name',
              't.type',
              sql<string>`to_char(COALESCE(t.billing_month, date_trunc('month', t.transaction_date)), 'YYYY-MM-01')`.as('month_accrual'),
              sql<string>`COALESCE(SUM(t.amount), 0)`.as('total')
            ])
            .where('t.is_deleted', '=', false)
            .where('t.type', 'in', ['ACCRUAL', 'REFUND'])
            .groupBy([
              't.account_id',
              't.activity_id',
              'act.name',
              't.child_id',
              'c.full_name',
              't.type',
              sql`COALESCE(t.billing_month, date_trunc('month', t.transaction_date))`
            ])
          if (accountIds.length > 0) q = q.where('t.account_id', 'in', accountIds)
          return q.execute()
        })(),

        // 2. Salary transactions (accrual or payment based)
        (() => {
          let q = db.selectFrom('salary_transactions as st')
            .innerJoin('staff as s', 's.id', 'st.staff_id')
            .select([
              'st.staff_id',
              's.full_name as staff_name',
              's.type as staff_type',
              'st.type',
              'st.is_dividend',
              'st.note',
              'st.transaction_date',
              sql<string>`to_char(COALESCE(st.billing_month, date_trunc('month', st.transaction_date)), 'YYYY-MM-01')`.as('month_accrual'),
              sql<string>`to_char(date_trunc('month', st.transaction_date), 'YYYY-MM-01')`.as('month_payment'),
              sql<string>`COALESCE(SUM(st.gross_amount), 0)`.as('total')
            ])
            .where('st.is_deleted', '=', false)

          if (staffType === 'employee' || staffType === 'partner') {
            q = q.where('s.type', '=', staffType)
          }

          if (salaryBasis === 'accrual') {
            q = q.where((eb) => eb.or([
              eb('st.type', 'in', ['ACCRUAL', 'CORRECTION']),
              eb.and([
                eb('st.type', '=', 'PAYMENT'),
                eb('st.is_dividend', '=', true)
              ])
            ]))
            if (accountIds.length > 0) {
              q = q.where((eb) => eb.or([
                eb('st.account_id', 'in', accountIds),
                eb('st.account_id', 'is', null)
              ]))
            }
          } else {
            q = q.where('st.type', '=', 'PAYMENT')
            if (accountIds.length > 0) q = q.where('st.account_id', 'in', accountIds)
          }

          q = q.groupBy([
            'st.staff_id',
            's.full_name',
            's.type',
            'st.type',
            'st.is_dividend',
            'st.note',
            'st.transaction_date',
            sql`COALESCE(st.billing_month, date_trunc('month', st.transaction_date))`,
            sql`date_trunc('month', st.transaction_date)`
          ])
          return q.execute()
        })(),

        // 3. Paid expenses with category and transfer info
        (() => {
          let q = db.selectFrom('expenses as e')
            .leftJoin('expense_categories as c', 'c.id', 'e.category_id')
            .leftJoin('accounts as a', 'a.id', 'e.account_id')
            .select([
              'e.id',
              'e.account_id',
              'a.name as account_name',
              'e.category_id',
              'c.name as category_name',
              'e.amount',
              'e.accrual_date',
              'e.payment_date',
              'e.status',
              'e.note',
              'e.is_dividend',
              'e.dividend_amount',
              'e.dividend_payout_id',
              'e.is_non_operating',
              'e.withdrawal_transfer_id',
              'e.withdrawal_amount',
              'e.is_advance',
              'e.is_advance_return',
            ])
            .where('e.is_deleted', '=', false)
            .where('e.status', '=', 'paid')
            .where('e.payment_date', 'is not', null)
          if (accountIds.length > 0) q = q.where('e.account_id', 'in', accountIds)
          return q.execute()
        })(),

        // 4. Dividend payouts
        db.selectFrom('dividend_payouts as dp')
          .innerJoin('equity_participants as ep', 'ep.id', 'dp.participant_id')
          .select(['dp.id', 'ep.name as participant_name', 'dp.gross_amount', 'dp.expense_id'])
          .where('dp.is_deleted', '=', false)
          .execute(),

        // 5. Account transfers (all internal transfers / obnal)
        (() => {
          let q = db.selectFrom('account_transfers as t')
            .innerJoin('accounts as fa', 'fa.id', 't.from_account_id')
            .innerJoin('accounts as ta', 'ta.id', 't.to_account_id')
            .select([
              't.id',
              't.amount',
              't.transfer_date',
              't.note',
              't.from_account_id',
              'fa.name as from_account_name',
              't.to_account_id',
              'ta.name as to_account_name',
              sql<string>`to_char(date_trunc('month', t.transfer_date), 'YYYY-MM-01')`.as('month')
            ])
          if (accountIds.length > 0) {
            q = q.where((eb) => eb.or([
              eb('t.from_account_id', 'in', accountIds),
              eb('t.to_account_id', 'in', accountIds)
            ]))
          }
          return q.execute()
        })(),
      ])

      // 4. Process Client Revenue & Refunds (by accrual month)
      const revDetailsMap: Record<string, Record<string, Record<string, { activity_name: string; accrued: number; paid: number; children: Record<string, { child_name: string; accrued: number; paid: number }> }>>> = {}
      const refundDetailsMap: Record<string, Record<string, Record<string, { activity_name: string; accrued: number; paid: number; children: Record<string, { child_name: string; accrued: number; paid: number }> }>>> = {}

      for (const tx of clientTxDetails) {
        const actId = tx.activity_id ?? 'manual'
        const actName = tx.activity_name ?? 'Без активності'
        const chId = tx.child_id ?? 'unknown'
        const chName = tx.child_name ?? 'Невідомий клієнт'
        const total = Number(tx.total)
        const m = tx.month_accrual

        if (tx.type === 'ACCRUAL') {
          if (!revDetailsMap[m]) revDetailsMap[m] = {}
          if (!revDetailsMap[m][tx.account_id]) revDetailsMap[m][tx.account_id] = {}
          if (!revDetailsMap[m][tx.account_id][actId]) {
            revDetailsMap[m][tx.account_id][actId] = { activity_name: actName, accrued: 0, paid: 0, children: {} }
          }
          const actObj = revDetailsMap[m][tx.account_id][actId]
          actObj.accrued += total
          if (!actObj.children[chId]) actObj.children[chId] = { child_name: chName, accrued: 0, paid: 0 }
          actObj.children[chId].accrued += total
        } else if (tx.type === 'REFUND') {
          if (!refundDetailsMap[m]) refundDetailsMap[m] = {}
          if (!refundDetailsMap[m][tx.account_id]) refundDetailsMap[m][tx.account_id] = {}
          if (!refundDetailsMap[m][tx.account_id][actId]) {
            refundDetailsMap[m][tx.account_id][actId] = { activity_name: actName, accrued: 0, paid: 0, children: {} }
          }
          const actObj = refundDetailsMap[m][tx.account_id][actId]
          actObj.accrued += total
          if (!actObj.children[chId]) actObj.children[chId] = { child_name: chName, accrued: 0, paid: 0 }
          actObj.children[chId].accrued += total
        }
      }

      // 5. Process Salaries (by payment or accrual month)
      const salaryDetailsMap: Record<string, Record<string, { staff_name: string; staff_type: 'employee' | 'partner'; accrued: number; paid: number }>> = {}
      const salaryDividendPayments: Array<{ month: string; date: string; name: string; note: string; amount: number }> = []

      for (const tx of salaryTxDetails) {
        const total = Number(tx.total)
        const dateStr = tx.transaction_date ? new Date(tx.transaction_date).toISOString().slice(0, 10) : ''

        if (tx.is_dividend) {
          if (tx.type === 'PAYMENT') {
            salaryDividendPayments.push({
              month: tx.month_payment,
              date: dateStr,
              name: tx.staff_name,
              note: tx.note || 'Виплата дивідендів (ЗП)',
              amount: total,
            })
          }
          continue
        }

        const m = salaryBasis === 'accrual' ? tx.month_accrual : tx.month_payment

        if (!salaryDetailsMap[m]) salaryDetailsMap[m] = {}
        if (!salaryDetailsMap[m][tx.staff_id]) {
          salaryDetailsMap[m][tx.staff_id] = {
            staff_name: tx.staff_name,
            staff_type: (tx.staff_type as 'employee' | 'partner') || 'employee',
            accrued: 0,
            paid: 0,
          }
        }
        if (salaryBasis === 'accrual') {
          salaryDetailsMap[m][tx.staff_id].accrued += total
          salaryDetailsMap[m][tx.staff_id].paid += total
        } else {
          salaryDetailsMap[m][tx.staff_id].paid += total
        }
      }

      // 6. Process Expenses (by payment month)
      const operatingExpMap: Record<string, Record<string, { category_name: string; accrued: number; paid: number; transactions: Array<{ id: string; date: string; amount: number; note: string; type: 'paid' }> }>> = {}
      const nonOperatingExpMap: Record<string, Record<string, { category_name: string; accrued: number; paid: number; transactions: Array<{ id: string; date: string; amount: number; note: string; type: 'paid' }> }>> = {}
      const obnalCommissionsMap: Record<string, { paid: number; transactions: Array<{ id: string; date: string; amount: number; note: string }> }> = {}
      const withdrawalsTxList: Array<{ month: string; id: string; date: string; note: string; amount: number }> = []
      const dividendExpensesList: Array<{ month: string; id: string; date: string; note: string; amount: number; dividend_payout_id: string | null }> = []

      for (const e of expenseTxDetails) {
        if (e.is_advance || e.is_advance_return) continue
        if (!e.payment_date) continue

        const m = fmtMonth(new Date(e.payment_date))
        const paidDateStr = new Date(e.payment_date).toISOString().slice(0, 10)
        const catId = e.category_id ?? 'uncategorized'
        const catName = e.category_name ?? 'Без категорії'
        let totalAmount = Number(e.amount)

        // A. Dividends
        if (e.is_dividend || e.dividend_payout_id) {
          const divAmount = e.dividend_amount != null ? Number(e.dividend_amount) : totalAmount
          dividendExpensesList.push({
            month: m,
            id: e.id,
            date: paidDateStr,
            note: e.note || '',
            amount: divAmount,
            dividend_payout_id: e.dividend_payout_id,
          })
          totalAmount -= divAmount
          if (totalAmount <= 0) continue
        }

        // B. Obnal commission ("% за вывод" or cash withdrawal fee)
        const noteLower = (e.note || '').toLowerCase()
        const isObnalComm = (
          (catId === withdrawalCatId && (
            noteLower.includes('% за вывод') ||
            noteLower.includes('% за вивід') ||
            noteLower.includes('зняття') ||
            noteLower.includes('снятие') ||
            noteLower.includes('комісі') ||
            noteLower.includes('комисси') ||
            noteLower.includes('обнал') ||
            e.account_name === 'Готівка'
          )) ||
          noteLower.includes('% за вывод') ||
          noteLower.includes('% за вивід')
        )
        if (isObnalComm) {
          if (!obnalCommissionsMap[m]) obnalCommissionsMap[m] = { paid: 0, transactions: [] }
          obnalCommissionsMap[m].paid += totalAmount
          obnalCommissionsMap[m].transactions.push({
            id: e.id,
            date: paidDateStr,
            amount: totalAmount,
            note: e.note || 'Комісія за обнал',
          })
          continue
        }

        // C. Linked Account Transfer (Obnal or inter-account transfer)
        if (e.withdrawal_transfer_id != null) {
          const withdrawalAmount = e.withdrawal_amount != null ? Number(e.withdrawal_amount) : totalAmount
          const remainingExpense = Math.max(0, totalAmount - withdrawalAmount)

          // If there is a remaining real expense beyond the transfer (e.g. 77 330 - 60 000 = 17 330)
          if (remainingExpense > 0) {
            const targetMap = e.is_non_operating ? nonOperatingExpMap : operatingExpMap

            if (!targetMap[m]) targetMap[m] = {}
            if (!targetMap[m][catId]) {
              targetMap[m][catId] = { category_name: catName, accrued: 0, paid: 0, transactions: [] }
            }
            targetMap[m][catId].paid += remainingExpense
            targetMap[m][catId].transactions.push({
              id: e.id,
              date: paidDateStr,
              amount: remainingExpense,
              note: e.note || '',
              type: 'paid',
            })
          }
          // The transfer amount itself is excluded from company expenses!
          continue
        }

        // D. Withdrawal category without transfer and without dividend (owner cash drawings)
        if (catId === withdrawalCatId) {
          withdrawalsTxList.push({
            month: m,
            id: e.id,
            date: paidDateStr,
            note: e.note || '',
            amount: totalAmount,
          })
          continue
        }

        // E. Non-operating expense
        if (e.is_non_operating) {
          if (!nonOperatingExpMap[m]) nonOperatingExpMap[m] = {}
          if (!nonOperatingExpMap[m][catId]) {
            nonOperatingExpMap[m][catId] = { category_name: catName, accrued: 0, paid: 0, transactions: [] }
          }
          nonOperatingExpMap[m][catId].paid += totalAmount
          nonOperatingExpMap[m][catId].transactions.push({
            id: e.id,
            date: paidDateStr,
            amount: totalAmount,
            note: e.note || '',
            type: 'paid',
          })
          continue
        }

        // F. Regular Operating Expense
        if (!operatingExpMap[m]) operatingExpMap[m] = {}
        if (!operatingExpMap[m][catId]) {
          operatingExpMap[m][catId] = { category_name: catName, accrued: 0, paid: 0, transactions: [] }
        }
        operatingExpMap[m][catId].paid += totalAmount
        operatingExpMap[m][catId].transactions.push({
          id: e.id,
          date: paidDateStr,
          amount: totalAmount,
          note: e.note || '',
          type: 'paid',
        })
      }

      // 7. Assemble Results by Month
      const rows = months.map(month => {
        // Accounts revenue list (accrued)
        let totalIncomeAccrued = 0
        const monthAccounts = accounts.map(a => {
          let accrued = 0
          const monthMap = revDetailsMap[month]
          const accMap = monthMap?.[a.id]

          const detailsList = []
          if (accMap) {
            for (const [actId, actObj] of Object.entries(accMap)) {
              accrued += actObj.accrued

              const childrenList = Object.entries(actObj.children).map(([childId, chObj]) => ({
                child_id: childId,
                child_name: chObj.child_name,
                accrued: chObj.accrued,
                paid: chObj.paid,
              })).sort((x, y) => y.accrued - x.accrued)

              detailsList.push({
                activity_id: actId,
                activity_name: actObj.activity_name,
                accrued: actObj.accrued,
                paid: actObj.paid,
                children: childrenList,
              })
            }
          }

          detailsList.sort((x, y) => y.accrued - x.accrued)
          totalIncomeAccrued += accrued

          const accTransfersIn = allTransfers
            .filter(t => t.month === month && t.to_account_id === a.id)
            .map(t => ({
              id: t.id,
              date: t.transfer_date ? new Date(t.transfer_date).toISOString().slice(0, 10) : '',
              from_account_name: t.from_account_name,
              to_account_name: t.to_account_name,
              amount: Number(t.amount),
              note: t.note || '',
            }))
          const accTransfersOut = allTransfers
            .filter(t => t.month === month && t.from_account_id === a.id)
            .map(t => ({
              id: t.id,
              date: t.transfer_date ? new Date(t.transfer_date).toISOString().slice(0, 10) : '',
              from_account_name: t.from_account_name,
              to_account_name: t.to_account_name,
              amount: Number(t.amount),
              note: t.note || '',
            }))

          return {
            account_id: a.id,
            name: a.name,
            accrued,
            paid: accrued, // for UI display
            transfers_in: accTransfersIn.reduce((s, t) => s + t.amount, 0),
            transfers_out: accTransfersOut.reduce((s, t) => s + t.amount, 0),
            transfers_in_items: accTransfersIn,
            transfers_out_items: accTransfersOut,
            details: detailsList,
          }
        })

        // Refunds list (accrued)
        let totalRefundsAccrued = 0
        const monthRefunds = accounts.map(a => {
          let accrued = 0
          const monthMap = refundDetailsMap[month]
          const accMap = monthMap?.[a.id]

          const detailsList = []
          if (accMap) {
            for (const [actId, actObj] of Object.entries(accMap)) {
              accrued += actObj.accrued

              const childrenList = Object.entries(actObj.children).map(([childId, chObj]) => ({
                child_id: childId,
                child_name: chObj.child_name,
                accrued: chObj.accrued,
                paid: chObj.paid,
              })).sort((x, y) => y.accrued - x.accrued)

              detailsList.push({
                activity_id: actId,
                activity_name: actObj.activity_name,
                accrued: actObj.accrued,
                paid: actObj.paid,
                children: childrenList,
              })
            }
          }

          detailsList.sort((x, y) => y.accrued - x.accrued)
          totalRefundsAccrued += accrued

          return {
            account_id: a.id,
            name: a.name,
            accrued,
            paid: accrued,
            details: detailsList,
          }
        })

        // Salary list
        const monthSalaryDetails = []
        const salMap = salaryDetailsMap[month]
        let salary_paid = 0
        let employee_paid = 0
        let partner_paid = 0
        if (salMap) {
          for (const [staffId, obj] of Object.entries(salMap)) {
            salary_paid += obj.paid
            if (obj.staff_type === 'partner') {
              partner_paid += obj.paid
            } else {
              employee_paid += obj.paid
            }
            monthSalaryDetails.push({
              staff_id: staffId,
              staff_name: obj.staff_name,
              staff_type: obj.staff_type,
              accrued: obj.accrued || obj.paid,
              paid: obj.paid,
            })
          }
        }
        monthSalaryDetails.sort((x, y) => y.paid - x.paid)

        // Operating Expenses (paid)
        const monthOperatingExpDetails = []
        const opExpMap = operatingExpMap[month]
        let operating_expenses_paid = 0
        if (opExpMap) {
          for (const [catId, obj] of Object.entries(opExpMap)) {
            operating_expenses_paid += obj.paid
            obj.transactions.sort((x, y) => x.date.localeCompare(y.date))
            monthOperatingExpDetails.push({
              category_id: catId,
              category_name: obj.category_name,
              accrued: obj.paid,
              paid: obj.paid,
              transactions: obj.transactions,
            })
          }
        }
        // Obnal Commissions
        const obnalCommObj = obnalCommissionsMap[month] ?? { paid: 0, transactions: [] }
        const obnal_commissions_paid = obnalCommObj.paid
        obnalCommObj.transactions.sort((x, y) => x.date.localeCompare(y.date))

        if (obnal_commissions_paid > 0) {
          monthOperatingExpDetails.push({
            category_id: 'obnal_commissions',
            category_name: 'Комісії за обнал',
            accrued: obnal_commissions_paid,
            paid: obnal_commissions_paid,
            transactions: obnalCommObj.transactions.map(t => ({ ...t, type: 'paid' as const })),
          })
        }
        monthOperatingExpDetails.sort((x, y) => y.paid - x.paid)

        // Non-operating Expenses (paid)
        const monthNonOperatingExpDetails = []
        const nonOpExpMap = nonOperatingExpMap[month]
        let non_operating_expenses_paid = 0
        if (nonOpExpMap) {
          for (const [catId, obj] of Object.entries(nonOpExpMap)) {
            non_operating_expenses_paid += obj.paid
            obj.transactions.sort((x, y) => x.date.localeCompare(y.date))
            monthNonOperatingExpDetails.push({
              category_id: catId,
              category_name: obj.category_name,
              accrued: obj.paid,
              paid: obj.paid,
              transactions: obj.transactions,
            })
          }
        }
        monthNonOperatingExpDetails.sort((x, y) => y.paid - x.paid)

        // Combined expenses list for backward compatibility in table view
        const combinedExpenseDetails = [...monthOperatingExpDetails]
        if (obnal_commissions_paid > 0) {
          combinedExpenseDetails.push({
            category_id: 'obnal_commissions',
            category_name: 'Комісії за обнал',
            accrued: obnal_commissions_paid,
            paid: obnal_commissions_paid,
            transactions: obnalCommObj.transactions.map(t => ({ ...t, type: 'paid' as const })),
          })
        }
        combinedExpenseDetails.sort((x, y) => y.paid - x.paid)

        // Withdrawals (drawings by owners)
        const monthWithdrawals = withdrawalsTxList
          .filter(t => t.month === month)
          .map(t => ({ id: t.id, date: t.date, note: t.note, amount: t.amount }))
          .sort((x, y) => x.date.localeCompare(y.date))
        const withdrawal_paid = monthWithdrawals.reduce((s, t) => s + t.amount, 0)

        // Dividends
        const monthDividends = []
        const divExps = dividendExpensesList.filter(t => t.month === month)
        for (const de of divExps) {
          const linkedPayouts = dividendPayouts.filter(p => (p.expense_id && p.expense_id === de.id) || p.id === de.dividend_payout_id)
          if (linkedPayouts.length > 0) {
            for (const lp of linkedPayouts) {
              monthDividends.push({
                id: `${de.id}-${lp.id}`,
                date: de.date,
                recipient: lp.participant_name,
                note: de.note,
                amount: Number(lp.gross_amount),
              })
            }
          } else {
            monthDividends.push({
              id: de.id,
              date: de.date,
              recipient: '',
              note: de.note,
              amount: de.amount,
            })
          }
        }
        const divSals = salaryDividendPayments.filter(t => t.month === month)
        for (const ds of divSals) {
          monthDividends.push({
            id: ds.date + '::' + ds.name,
            date: ds.date,
            recipient: ds.name,
            note: ds.note,
            amount: ds.amount,
          })
        }
        monthDividends.sort((x, y) => x.date.localeCompare(y.date))
        const dividend_paid = monthDividends.reduce((s, t) => s + t.amount, 0)

        // Transfers (informational movement)
        const monthTransfers = allTransfers.filter(t => t.month === month)
        const transfers_in = monthTransfers.map(t => ({
          id: t.id,
          date: t.transfer_date ? new Date(t.transfer_date).toISOString().slice(0, 10) : '',
          from_account_id: t.from_account_id,
          from_account_name: t.from_account_name,
          to_account_id: t.to_account_id,
          to_account_name: t.to_account_name,
          amount: Number(t.amount),
          note: t.note || '',
        }))
        const transfers_in_total = transfers_in.reduce((s, t) => s + t.amount, 0)

        // Totals calculations
        const net_income = totalIncomeAccrued - totalRefundsAccrued
        const total_operating_expenses = salary_paid + operating_expenses_paid + obnal_commissions_paid
        const operating_profit = net_income - total_operating_expenses
        const profit_before_distribution = operating_profit - non_operating_expenses_paid
        const retained_profit = profit_before_distribution - dividend_paid - withdrawal_paid

        return {
          month,
          accounts: monthAccounts,
          refunds: {
            accrued: totalRefundsAccrued,
            paid: totalRefundsAccrued,
            details: monthRefunds,
          },
          salary: {
            accrued: salary_paid,
            paid: salary_paid,
            employee_paid,
            partner_paid,
            details: monthSalaryDetails,
          },
          operating_expenses: {
            paid: operating_expenses_paid + obnal_commissions_paid,
            details: monthOperatingExpDetails,
          },
          obnal_commissions: {
            paid: obnal_commissions_paid,
            transactions: obnalCommObj.transactions,
          },
          non_operating_expenses: {
            paid: non_operating_expenses_paid,
            details: monthNonOperatingExpDetails,
          },
          expenses: {
            accrued: operating_expenses_paid + obnal_commissions_paid,
            paid: operating_expenses_paid + obnal_commissions_paid,
            details: combinedExpenseDetails,
          },
          withdrawals: {
            paid: withdrawal_paid,
            transactions: monthWithdrawals,
          },
          dividends: {
            paid: dividend_paid,
            transactions: monthDividends,
          },
          transfers: {
            total_amount: transfers_in_total,
            items: transfers_in,
          },
          totals: {
            income_accrued: totalIncomeAccrued,
            refunds_accrued: totalRefundsAccrued,
            net_income,
            salary_paid,
            employee_salary_paid: employee_paid,
            partner_salary_paid: partner_paid,
            operating_expenses_paid: operating_expenses_paid + obnal_commissions_paid,
            total_operating_expenses,
            operating_profit,
            non_operating_expenses_paid,
            profit_before_distribution,
            dividends_paid: dividend_paid,
            withdrawals_paid: withdrawal_paid,
            retained_profit,
          },
        }
      })

      return {
        months,
        accounts,
        rows,
      }
    }

  // ── PnL 3 Report (Cash Salaries) ─────────────────────────────────────────────
  // GET /api/reports/pnl3?from=YYYY-MM&to=YYYY-MM&account_ids=...&salary_basis=payment|accrual&staff_type=all|employee|partner
  app.get<{ Querystring: { from?: string; to?: string; account_ids?: string; salary_basis?: 'payment' | 'accrual'; staff_type?: 'all' | 'employee' | 'partner' } }>(
    '/pnl3',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      const salaryBasis = req.query.salary_basis === 'accrual' ? 'accrual' : 'payment'
      return buildPnL3Report(req.query.from, req.query.to, req.query.account_ids, salaryBasis, req.query.staff_type)
    }
  )

  // ── PnL 3 Report (Accrued Salaries) ──────────────────────────────────────────
  // GET /api/reports/pnl3-accrual?from=YYYY-MM&to=YYYY-MM&account_ids=...&staff_type=all|employee|partner
  app.get<{ Querystring: { from?: string; to?: string; account_ids?: string; staff_type?: 'all' | 'employee' | 'partner' } }>(
    '/pnl3-accrual',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      return buildPnL3Report(req.query.from, req.query.to, req.query.account_ids, 'accrual', req.query.staff_type)
    }
  )

  // GET /api/reports/osv/child/:childId
  app.get<{
    Params: { childId: string }
    Querystring: {
      start_date?: string
      end_date?: string
      account_id?: string
    }
  }>(
    '/osv/child/:childId',
    { preHandler: authenticate },
    async (request, reply) => {
      const { childId } = request.params
      const { start_date, end_date, account_id } = request.query

      const child = await db
        .selectFrom('children as c')
        .leftJoin('groups as g', 'g.id', 'c.group_id')
        .select(['c.id', 'c.full_name', 'g.name as group_name'])
        .where('c.id', '=', childId)
        .executeTakeFirst()

      if (!child) return reply.status(404).send({ error: 'ChildNotFound' })

      const currentYear = new Date().getFullYear()
      const startDateStr = start_date || `${currentYear}-01-01`
      const endDateStr = end_date || `${currentYear}-12-31`

      const accounts = await db
        .selectFrom('accounts')
        .select(['id', 'name'])
        .execute()
      const accountMap = new Map(accounts.map((a) => [a.id, a.name]))

      let priorTxQuery = db
        .selectFrom('transactions')
        .select(['type', 'amount'])
        .where('child_id', '=', childId)
        .where('is_deleted', '=', false)
        .where(sql<SqlBool>`COALESCE(billing_month, transaction_date) < ${startDateStr}`)

      if (account_id) {
        priorTxQuery = priorTxQuery.where('account_id', '=', account_id)
      }
      const priorTxs = await priorTxQuery.execute()

      let openingBalance = 0
      for (const tx of priorTxs) {
        const amt = Number(tx.amount)
        if (tx.type === 'PAYMENT' || tx.type === 'REFUND' || tx.type === 'REVERSAL' || tx.type === 'TRANSFER_IN') {
          openingBalance += amt
        } else if (tx.type === 'ACCRUAL' || tx.type === 'ADJUSTMENT' || tx.type === 'TRANSFER_OUT') {
          openingBalance -= amt
        }
      }

      let initBalQuery = db
        .selectFrom('initial_balances')
        .select(['amount', 'balance_date', 'created_at'])
        .where('child_id', '=', childId)
      if (account_id) {
        initBalQuery = initBalQuery.where('account_id', '=', account_id)
      }
      const initBals = await initBalQuery.execute()
      for (const ib of initBals) {
        const rawDate = ib.balance_date ?? ib.created_at
        const ibDateStr = rawDate
          ? (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString().slice(0, 10))
          : '1970-01-01'
        if (ibDateStr < startDateStr) {
          openingBalance += Number(ib.amount)
        }
      }

      let periodTxQuery = db
        .selectFrom('transactions as t')
        .leftJoin('accounts as a', 'a.id', 't.account_id')
        .leftJoin('activities as act', 'act.id', 't.activity_id')
        .select([
          't.id',
          't.type',
          't.child_id',
          't.account_id',
          't.activity_id',
          't.enrollment_id',
          't.amount',
          't.transaction_date',
          't.billing_month',
          't.created_at',
          't.note',
          't.metadata_json',
          'a.name as account_name',
          'act.name as activity_name',
        ])
        .where('t.child_id', '=', childId)
        .where('t.is_deleted', '=', false)
        .where(sql<SqlBool>`COALESCE(t.billing_month, t.transaction_date) >= ${startDateStr}`)
        .where(sql<SqlBool>`COALESCE(t.billing_month, t.transaction_date) <= ${endDateStr}`)

      if (account_id) {
        periodTxQuery = periodTxQuery.where('t.account_id', '=', account_id)
      }

      const periodTxs = await periodTxQuery
        .orderBy('t.transaction_date', 'asc')
        .orderBy('t.created_at', 'asc')
        .execute()

      const startYM = startDateStr.slice(0, 7)
      const endYM = endDateStr.slice(0, 7)
      const monthsList: string[] = []

      let [curY, curM] = startYM.split('-').map(Number)
      const [endY, endM] = endYM.split('-').map(Number)

      while (curY < endY || (curY === endY && curM <= endM)) {
        monthsList.push(`${curY}-${String(curM).padStart(2, '0')}`)
        curM++
        if (curM > 12) {
          curM = 1
          curY++
        }
      }

      const txByMonth = new Map<string, typeof periodTxs>()
      for (const ym of monthsList) {
        txByMonth.set(ym, [])
      }
      for (const tx of periodTxs) {
        const effDate = (tx.type === 'ACCRUAL' || tx.type === 'ADJUSTMENT') && tx.billing_month
          ? tx.billing_month
          : tx.transaction_date
        const txDateStr = typeof effDate === 'string'
          ? effDate
          : new Date(effDate).toISOString().slice(0, 10)
        const ym = txDateStr.slice(0, 7)
        if (txByMonth.has(ym)) {
          txByMonth.get(ym)!.push(tx)
        }
      }

      const ukMonthNames = [
        'Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
        'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'
      ]

      let runningBalance = openingBalance
      let periodTotalAccrual = 0
      let periodTotalPayment = 0
      let periodTotalRefund = 0

      const monthsResult = monthsList.map((ym) => {
        const [y, m] = ym.split('-').map(Number)
        const monthLabel = `${ukMonthNames[m - 1]} ${y}`

        // Add initial_balances created within this month
        let monthInitAmount = 0
        for (const ib of initBals) {
          const rawDate = ib.balance_date ?? ib.created_at
          const ibDateStr = rawDate
            ? (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString().slice(0, 10))
            : '1970-01-01'
          if (ibDateStr.startsWith(ym)) {
            monthInitAmount += Number(ib.amount)
          }
        }

        const monthStartBalance = runningBalance + monthInitAmount

        const txs = txByMonth.get(ym) || []

        const accrualItemsMap = new Map<string, {
          id: string
          activity_name: string
          gross_amount: number
          refund_amount: number
          amount: number
          count: number
          account_id: string
          account_name: string
          transaction_date: string
          note: string | null
        }>()

        const paymentItems: Array<{
          id: string
          transaction_date: string
          created_at: string
          amount: number
          payment_method: string
          account_id: string
          account_name: string
          note: string | null
          receipt_url: string | null
        }> = []

        const refundItemsByAccount = new Map<string, { account_id: string; account_name: string; amount: number }>()

        let monthGrossAccrualSum = 0
        let monthPaymentSum = 0
        let monthRefundSum = 0

        for (const tx of txs) {
          const amt = Number(tx.amount)
          const txDateStr = typeof tx.transaction_date === 'string'
            ? tx.transaction_date
            : new Date(tx.transaction_date).toISOString().slice(0, 10)
          const accName = tx.account_name || accountMap.get(tx.account_id) || 'Невідомий рахунок'

          if (tx.type === 'ACCRUAL' || tx.type === 'ADJUSTMENT') {
            monthGrossAccrualSum += amt
            const actName = tx.activity_name || tx.note || 'Нарахування'
            const key = `${tx.account_id}::${actName}`
            const existing = accrualItemsMap.get(key)
            if (existing) {
              existing.gross_amount += (-amt)
              existing.amount += (-amt)
              existing.count += 1
            } else {
              accrualItemsMap.set(key, {
                id: tx.id,
                activity_name: actName,
                gross_amount: -amt,
                refund_amount: 0,
                amount: -amt,
                count: 1,
                account_id: tx.account_id,
                account_name: accName,
                transaction_date: txDateStr,
                note: tx.note,
              })
            }
          } else if (tx.type === 'PAYMENT' || tx.type === 'TRANSFER_IN' || tx.type === 'TRANSFER_OUT') {
            const isTransfer = tx.type !== 'PAYMENT'
            const signedAmt = tx.type === 'TRANSFER_OUT' ? -amt : amt
            monthPaymentSum += signedAmt
            const meta = (tx.metadata_json as Record<string, any>) || {}
            paymentItems.push({
              id: tx.id,
              transaction_date: txDateStr,
              created_at: tx.created_at ? new Date(tx.created_at).toISOString() : txDateStr,
              amount: signedAmt,
              payment_method: isTransfer ? 'Переброс балансу' : (meta.payment_method || meta.method || 'Каса/Безготівковий'),
              account_id: tx.account_id,
              account_name: accName,
              note: tx.note,
              receipt_url: isTransfer ? null : (meta.receipt_url || null),
            })
          } else if (tx.type === 'REFUND' || tx.type === 'REVERSAL') {
            monthRefundSum += amt
            const actName = tx.activity_name || 'Перерасчет / повернення'
            const key = `${tx.account_id}::${actName}`
            const existing = accrualItemsMap.get(key)
            if (existing) {
              existing.refund_amount += amt
              existing.amount += amt
            } else {
              accrualItemsMap.set(key, {
                id: tx.id,
                activity_name: actName,
                gross_amount: 0,
                refund_amount: amt,
                amount: amt,
                count: 0,
                account_id: tx.account_id,
                account_name: accName,
                transaction_date: txDateStr,
                note: tx.note,
              })
            }

            const cur = refundItemsByAccount.get(tx.account_id) || {
              account_id: tx.account_id,
              account_name: accName,
              amount: 0,
            }
            cur.amount += amt
            refundItemsByAccount.set(tx.account_id, cur)
          }
        }

        const monthNetAccrual = -monthGrossAccrualSum + monthRefundSum
        const monthEndBalance = monthStartBalance + monthPaymentSum + monthNetAccrual
        runningBalance = monthEndBalance

        periodTotalAccrual += monthNetAccrual
        periodTotalPayment += monthPaymentSum
        periodTotalRefund += monthRefundSum

        return {
          month: ym,
          month_label: monthLabel,
          balance_start: monthStartBalance,
          balance_end: monthEndBalance,
          accruals: {
            total: monthNetAccrual,
            items: Array.from(accrualItemsMap.values()),
          },
          payments: {
            total: monthPaymentSum,
            items: paymentItems,
          },
          refunds: {
            total: monthRefundSum,
            items: Array.from(refundItemsByAccount.values()),
          },
        }
      })

      return {
        child: {
          id: child.id,
          full_name: child.full_name,
          group_name: child.group_name,
        },
        period: {
          start_date: startDateStr,
          end_date: endDateStr,
        },
        account_id: account_id || null,
        opening_balance: openingBalance,
        closing_balance: runningBalance,
        totals: {
          accruals: periodTotalAccrual,
          payments: periodTotalPayment,
          refunds: periodTotalRefund,
        },
        months: monthsResult,
      }
    }
  )

  // ── Invoices and Payments Report (Рахунки та оплати) ─────────────────────────
  // GET /api/reports/invoices-and-payments
  app.get<{
    Querystring: {
      from_month?: string
      to_month?: string
      account_ids?: string
      is_active?: string
      debt_filter?: string
    }
  }>(
    '/invoices-and-payments',
    { preHandler: authenticate },
    async (request) => {
      function getPrevMonth(ym: string): string {
        const [y, m] = ym.split('-').map(Number)
        const d = new Date(Date.UTC(y, m - 2, 1))
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      }

      const curYM = new Date().toISOString().slice(0, 7)
      const from_month = request.query.from_month || curYM
      const to_month = request.query.to_month || curYM
      const accountIdsRaw = request.query.account_ids
      const isActiveFilter = request.query.is_active ?? 'true'
      const debtFilter = request.query.debt_filter || 'all'

      const accountIds = accountIdsRaw ? accountIdsRaw.split(',').filter(Boolean) : []

      const fromDate = new Date(`${from_month}-01T00:00:00.000Z`)
      const [toY, toM] = to_month.split('-').map(Number)
      const lastDayTo = new Date(toY, toM, 0).getDate()
      const toDate = new Date(`${to_month}-${String(lastDayTo).padStart(2, '0')}T23:59:59.999Z`)

      // Period months list
      const periodMonths: string[] = []
      let mCur = new Date(`${from_month}-01T00:00:00.000Z`)
      const mEnd = new Date(`${to_month}-01T00:00:00.000Z`)
      while (mCur <= mEnd) {
        const y = mCur.getFullYear()
        const m = String(mCur.getMonth() + 1).padStart(2, '0')
        periodMonths.push(`${y}-${m}`)
        mCur.setMonth(mCur.getMonth() + 1)
      }

      // Previous months corresponding to each period month (for consumed services in invoices)
      const prevMonths = periodMonths.map(getPrevMonth)
      const prevFromDate = new Date(`${prevMonths[0]}-01T00:00:00.000Z`)
      const [ptY, ptM] = prevMonths[prevMonths.length - 1].split('-').map(Number)
      const prevLastDay = new Date(Date.UTC(ptY, ptM, 0)).getUTCDate()
      const prevToDate = new Date(`${prevMonths[prevMonths.length - 1]}-${String(prevLastDay).padStart(2, '0')}T23:59:59.999Z`)

      // 1. Transaction summary per child + account
      let summaryQ = db
        .selectFrom('transactions as t')
        .select([
          't.child_id',
          't.account_id',
          sql<string>`SUM(CASE WHEN t.type IN ('PAYMENT','REFUND','REVERSAL','TRANSFER_IN') AND date_trunc('month', t.transaction_date) < ${fromDate} THEN t.amount ELSE 0 END)`.as('credits_before'),
          sql<string>`SUM(CASE WHEN t.type IN ('ACCRUAL','ADJUSTMENT','TRANSFER_OUT') AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) < ${fromDate} THEN t.amount ELSE 0 END)`.as('debits_before'),
          sql<string>`SUM(CASE WHEN t.type = 'PAYMENT' AND date_trunc('month', t.transaction_date) >= ${fromDate} AND date_trunc('month', t.transaction_date) <= ${toDate} THEN t.amount ELSE 0 END)`.as('payments_in_period'),
          sql<string>`SUM(CASE WHEN t.type = 'TRANSFER_IN' AND date_trunc('month', t.transaction_date) >= ${fromDate} AND date_trunc('month', t.transaction_date) <= ${toDate} THEN t.amount ELSE 0 END)`.as('transfers_in_period'),
          sql<string>`SUM(CASE WHEN t.type = 'TRANSFER_OUT' AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) >= ${fromDate} AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) <= ${toDate} THEN t.amount ELSE 0 END)`.as('transfers_out_period'),
          sql<string>`SUM(CASE WHEN t.type IN ('PAYMENT','REFUND','REVERSAL','TRANSFER_IN') AND date_trunc('month', t.transaction_date) >= ${fromDate} AND date_trunc('month', t.transaction_date) <= ${toDate} THEN t.amount ELSE 0 END)`.as('credits_in_period'),
          sql<string>`SUM(CASE WHEN t.type IN ('ACCRUAL','ADJUSTMENT','TRANSFER_OUT') AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) >= ${fromDate} AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) <= ${toDate} THEN t.amount ELSE 0 END)`.as('debits_in_period'),
          sql<string>`SUM(CASE WHEN t.type IN ('PAYMENT','REFUND','REVERSAL','TRANSFER_IN') AND date_trunc('month', t.transaction_date) > ${toDate} THEN t.amount ELSE 0 END)`.as('credits_after_period'),
        ])
        .where('t.is_deleted', '=', false)
        .groupBy(['t.child_id', 't.account_id'])

      if (accountIds.length > 0) {
        summaryQ = summaryQ.where('t.account_id', 'in', accountIds)
      }

      // 2. Child metadata
      let childMetaQ = db
        .selectFrom('children as c')
        .leftJoin('families as f', 'f.id', 'c.family_id')
        .leftJoin('parents as p', 'p.id', 'f.primary_parent_id')
        .select([
          'c.id as child_id',
          'c.full_name as child_name',
          'c.is_active',
          'f.name as family_name',
          'p.phone as primary_parent_phone',
        ])

      if (isActiveFilter === 'true') {
        childMetaQ = childMetaQ.where('c.is_active', '=', true)
      } else if (isActiveFilter === 'false') {
        childMetaQ = childMetaQ.where('c.is_active', '=', false)
      }

      // 3. Accounts
      let accountsQ = db.selectFrom('accounts').select(['id', 'name', 'type'])
      if (accountIds.length > 0) {
        accountsQ = accountsQ.where('id', 'in', accountIds)
      }

      // 4. Initial balances
      let initQ = db.selectFrom('initial_balances').select(['child_id', 'account_id', 'amount'])
      if (accountIds.length > 0) {
        initQ = initQ.where('account_id', 'in', accountIds)
      }

      // 5. Current balances
      let curQ = db.selectFrom('child_balances').select(['child_id', 'account_id', 'balance'])
      if (accountIds.length > 0) {
        curQ = curQ.where('account_id', 'in', accountIds)
      }

      // 5b. Transfers in period with notes
      let transfersQ = db
        .selectFrom('transactions as t')
        .select([
          't.child_id',
          't.account_id',
          't.type',
          't.amount',
          't.note',
          't.transaction_date',
        ])
        .where('t.type', 'in', ['TRANSFER_IN', 'TRANSFER_OUT'])
        .where('t.is_deleted', '=', false)
        .where(sql<SqlBool>`(
          (t.type = 'TRANSFER_IN' AND date_trunc('month', t.transaction_date) >= ${fromDate} AND date_trunc('month', t.transaction_date) <= ${toDate})
          OR
          (t.type = 'TRANSFER_OUT' AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) >= ${fromDate} AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) <= ${toDate})
        )`)
      if (accountIds.length > 0) {
        transfersQ = transfersQ.where('t.account_id', 'in', accountIds)
      }

      // 6. Active/frozen enrollments (for current subscriptions)
      let enrollmentsQ = db
        .selectFrom('enrollments as e')
        .innerJoin('activities as a', 'a.id', 'e.activity_id')
        .innerJoin('accounts as ac', 'ac.id', 'e.account_id')
        .select([
          'e.id as enrollment_id',
          'e.child_id',
          'e.account_id',
          'e.activity_id',
          'e.status as enrollment_status',
          'e.start_date',
          'e.end_date',
          'a.name as activity_name',
          'a.tariff_type as activity_tariff_type',
          'ac.name as account_name',
        ])
        .where('e.status', 'in', ['active', 'frozen'])

      if (accountIds.length > 0) {
        enrollmentsQ = enrollmentsQ.where('e.account_id', 'in', accountIds)
      }

      // 7. Accrual transactions for PREVIOUS month(s) — consumed services in the invoice!
      let accrualTxsQ = db
        .selectFrom('transactions as t')
        .leftJoin('activities as a', 'a.id', 't.activity_id')
        .select([
          't.child_id',
          't.account_id',
          't.activity_id',
          't.amount',
          't.type',
          't.note',
          'a.name as activity_name',
          'a.tariff_type as activity_tariff_type',
          sql<string>`to_char(COALESCE(t.billing_month, date_trunc('month', t.transaction_date)), 'YYYY-MM')`.as('month'),
        ])
        .where('t.is_deleted', '=', false)
        .where('t.type', 'in', ['ACCRUAL', 'REFUND'])
        .where(sql<SqlBool>`COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) >= ${prevFromDate}`)
        .where(sql<SqlBool>`COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) <= ${prevToDate}`)

      if (accountIds.length > 0) {
        accrualTxsQ = accrualTxsQ.where('t.account_id', 'in', accountIds)
      }

      // 8. Attendance logs for PREVIOUS month(s) — to count visits per activity
      const attendanceQ = db
        .selectFrom('attendance_logs as al')
        .select([
          'al.child_id',
          'al.activity_id',
          sql<string>`to_char(date_trunc('month', al.date), 'YYYY-MM')`.as('month'),
          sql<string>`COUNT(al.id)`.as('visit_count'),
        ])
        .where('al.date', '>=', prevFromDate)
        .where('al.date', '<=', prevToDate)
        .where('al.status', 'in', ['present', 'special'])
        .groupBy(['al.child_id', 'al.activity_id', sql`date_trunc('month', al.date)`])

      const [summaryRows, childMeta, accountMeta, initBals, curBals, enrollments, accrualTxs, attendanceRows, transferRows] =
        await Promise.all([
          summaryQ.execute(),
          childMetaQ.execute(),
          accountsQ.execute(),
          initQ.execute(),
          curQ.execute(),
          enrollmentsQ.execute(),
          accrualTxsQ.execute(),
          attendanceQ.execute(),
          transfersQ.execute(),
        ])

      const childMetaMap = new Map(childMeta.map(r => [r.child_id, r]))
      const accountMetaMap = new Map(accountMeta.map(r => [r.id, r]))
      const initBalMap = new Map(initBals.map(r => [`${r.child_id}:${r.account_id}`, Number(r.amount)]))
      const curBalMap = new Map(curBals.map(r => [`${r.child_id}:${r.account_id}`, Number(r.balance)]))

      // Transfers map: `${childId}:${accountId}` -> Array of transfer items
      const transfersMap = new Map<string, Array<{ type: 'TRANSFER_IN' | 'TRANSFER_OUT'; amount: number; note: string | null }>>()
      for (const tr of transferRows) {
        const pairKey = `${tr.child_id}:${tr.account_id}`
        if (!transfersMap.has(pairKey)) transfersMap.set(pairKey, [])
        transfersMap.get(pairKey)!.push({
          type: tr.type as 'TRANSFER_IN' | 'TRANSFER_OUT',
          amount: Number(tr.amount),
          note: tr.note ?? null,
        })
      }

      // Attendance map: `${childId}:${activityId}:${month}` -> count
      const attendanceMap = new Map<string, number>()
      for (const att of attendanceRows) {
        if (att.child_id && att.activity_id && att.month) {
          attendanceMap.set(`${att.child_id}:${att.activity_id}:${att.month}`, Number(att.visit_count))
        }
      }

      // ── Aggregate Consumed Services for PREVIOUS month(s) by activity ──
      // Map: `${child_id}:${account_id}` -> Map<activityKey, Item>
      const consumedServicesMap = new Map<string, Map<string, {
        activity_id?: string
        activity_name: string
        tariff_type?: string
        month: string
        visit_count: number
        amount: number
      }>>()

      for (const tx of accrualTxs) {
        const pairKey = `${tx.child_id}:${tx.account_id}`
        if (!consumedServicesMap.has(pairKey)) {
          consumedServicesMap.set(pairKey, new Map())
        }
        const childAccMap = consumedServicesMap.get(pairKey)!
        const actKey = tx.activity_id ? `${tx.activity_id}:${tx.month}` : `manual:${tx.month}:${tx.note ?? 'other'}`

        const amt = Number(tx.amount) * (tx.type === 'REFUND' ? -1 : 1)

        if (!childAccMap.has(actKey)) {
          const vCount = tx.activity_id
            ? attendanceMap.get(`${tx.child_id}:${tx.activity_id}:${tx.month}`) ?? 0
            : 0
          childAccMap.set(actKey, {
            activity_id: tx.activity_id ?? undefined,
            activity_name: tx.activity_name ?? tx.note ?? 'Спожита послуга',
            tariff_type: tx.activity_tariff_type ?? 'per_lesson',
            month: tx.month,
            visit_count: vCount,
            amount: amt,
          })
        } else {
          childAccMap.get(actKey)!.amount += amt
        }
      }

      // ── Subscriptions for CURRENT month(s) in periodMonths ──
      // Map: `${child_id}:${account_id}` -> Map<activityKey, Item>
      const monthSubscriptionsMap = new Map<string, Map<string, {
        activity_id: string
        activity_name: string
        tariff_type: string
        month: string
        amount: number
      }>>()

      for (const ym of periodMonths) {
        const [y, m] = ym.split('-').map(Number)
        const monthStart = new Date(Date.UTC(y, m - 1, 1))
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
        const monthEnd = new Date(Date.UTC(y, m - 1, lastDay, 23, 59, 59, 999))

        const applicableEnrollments = enrollments.filter(e => {
          const s = new Date(String(e.start_date))
          const eEnd = e.end_date ? new Date(String(e.end_date)) : null
          return s <= monthEnd && (!eEnd || eEnd >= monthStart)
        })

        const prices = await Promise.all(
          applicableEnrollments.map(async (e) => {
            if (e.enrollment_status === 'frozen') return 0
            const ind = await getChildIndividualTariff(e.child_id, e.activity_id, monthStart)
            const effectiveType = ind ? ind.tariff_type : e.activity_tariff_type
            if (effectiveType === 'monthly' || effectiveType === 'smart') {
              if (ind) {
                return Math.round(parseFloat(ind.price as string) * 100) / 100
              }
              const p = await getEffectivePrice(e.child_id, e.activity_id, monthStart)
              return p && p > 0 ? p : 0
            }
            return 0
          })
        )

        for (let i = 0; i < applicableEnrollments.length; i++) {
          const e = applicableEnrollments[i]
          const price = prices[i]
          if (price > 0) {
            const pairKey = `${e.child_id}:${e.account_id}`
            if (!monthSubscriptionsMap.has(pairKey)) {
              monthSubscriptionsMap.set(pairKey, new Map())
            }
            const actKey = `${e.activity_id}:${ym}`
            monthSubscriptionsMap.get(pairKey)!.set(actKey, {
              activity_id: e.activity_id,
              activity_name: e.activity_name,
              tariff_type: e.activity_tariff_type,
              month: ym,
              amount: price,
            })
          }
        }
      }

      // Group summaries: child_id -> array of account summaries
      const summaryByChild = new Map<string, typeof summaryRows>()
      for (const sr of summaryRows) {
        if (!summaryByChild.has(sr.child_id)) summaryByChild.set(sr.child_id, [])
        summaryByChild.get(sr.child_id)!.push(sr)
      }

      // Collect all distinct child IDs
      const allChildIds = new Set<string>()
      for (const c of childMeta) allChildIds.add(c.child_id)
      for (const sr of summaryRows) allChildIds.add(sr.child_id)
      for (const e of enrollments) allChildIds.add(e.child_id)

      const rows: any[] = []

      for (const childId of allChildIds) {
        const meta = childMetaMap.get(childId)
        if (!meta) continue // filtered out by isActive or not found

        const childAccIds = new Set<string>()
        const childSummaries = summaryByChild.get(childId) ?? []
        for (const cs of childSummaries) childAccIds.add(cs.account_id)
        for (const e of enrollments) {
          if (e.child_id === childId) childAccIds.add(e.account_id)
        }
        for (const cb of curBals) {
          if (cb.child_id === childId && (accountIds.length === 0 || accountIds.includes(cb.account_id))) {
            childAccIds.add(cb.account_id)
          }
        }

        if (childAccIds.size === 0) continue

        const accountDetails: any[] = []
        let child_balance_start = 0
        let child_consumed_services_total = 0
        let child_subscriptions_total = 0
        let child_invoice_total = 0
        let child_paid_in_period = 0
        let child_transfers_in_period = 0
        let child_transfers_out_period = 0
        let child_paid_after_period = 0
        let child_balance_end = 0
        let child_current_balance = 0

        for (const accId of childAccIds) {
          const acc = accountMetaMap.get(accId)
          if (!acc) continue

          const pairKey = `${childId}:${accId}`
          const sr = childSummaries.find(s => s.account_id === accId)
          const initBal = initBalMap.get(pairKey) ?? 0
          const curBal = curBalMap.get(pairKey) ?? 0

          const credBefore = Number(sr?.credits_before ?? 0)
          const debBefore = Number(sr?.debits_before ?? 0)
          const paymentsInPeriod = Number((sr as any)?.payments_in_period ?? 0)
          const transfersInPeriod = Number((sr as any)?.transfers_in_period ?? 0)
          const transfersOutPeriod = Number((sr as any)?.transfers_out_period ?? 0)
          const credInPeriod = Number(sr?.credits_in_period ?? 0)
          const debInPeriod = Number(sr?.debits_in_period ?? 0)
          const credAfter = Number(sr?.credits_after_period ?? 0)

          const balance_start = initBal + credBefore - debBefore
          // Direct payments from parents (excludes internal balance transfers)
          const paid_in_period = paymentsInPeriod
          const paid_after_period = credAfter
          const balance_end = balance_start + credInPeriod - debInPeriod
          const current_balance = curBal

          // Consumed services (from previous month(s))
          const consumed_services = Array.from(consumedServicesMap.get(pairKey)?.values() ?? []).filter(
            s => s.amount > 0
          )
          const consumed_services_total = consumed_services.reduce((sum, item) => sum + item.amount, 0)

          // Subscriptions (for current month(s))
          const subscriptions = Array.from(monthSubscriptionsMap.get(pairKey)?.values() ?? []).filter(
            s => s.amount > 0
          )
          const subscriptions_total = subscriptions.reduce((sum, item) => sum + item.amount, 0)

          // Invoiced amount (Variant B):
          // In invoice logic: subscriptions + debt on start (which already incorporates previous month accruals)
          // or minus advance on start.
          const invoice_total = Math.max(0, subscriptions_total - balance_start)

          child_balance_start += balance_start
          child_consumed_services_total += consumed_services_total
          child_subscriptions_total += subscriptions_total
          child_invoice_total += invoice_total
          child_paid_in_period += paid_in_period
          child_transfers_in_period += transfersInPeriod
          child_transfers_out_period += transfersOutPeriod
          child_paid_after_period += paid_after_period
          child_balance_end += balance_end
          child_current_balance += current_balance

          accountDetails.push({
            account_id: accId,
            account_name: acc.name,
            account_type: acc.type,
            balance_start,
            consumed_services,
            consumed_services_total,
            subscriptions,
            subscriptions_total,
            invoice_total,
            paid_in_period,
            paid_after_period,
            transfers_in_period: transfersInPeriod,
            transfers_out_period: transfersOutPeriod,
            transfers: transfersMap.get(pairKey) ?? [],
            balance_end,
            current_balance,
          })
        }

        // Sort accounts by name
        accountDetails.sort((a, b) => a.account_name.localeCompare(b.account_name, 'uk'))

        // Skip completely empty records (no balance, no invoices, no payments)
        const isCompletelyEmpty =
          Math.abs(child_balance_start) < 0.005 &&
          Math.abs(child_consumed_services_total) < 0.005 &&
          Math.abs(child_subscriptions_total) < 0.005 &&
          Math.abs(child_invoice_total) < 0.005 &&
          Math.abs(child_paid_in_period) < 0.005 &&
          Math.abs(child_transfers_in_period) < 0.005 &&
          Math.abs(child_transfers_out_period) < 0.005 &&
          Math.abs(child_paid_after_period) < 0.005 &&
          Math.abs(child_balance_end) < 0.005 &&
          Math.abs(child_current_balance) < 0.005

        if (isCompletelyEmpty) continue

        // Debt filtering
        if (debtFilter === 'debt_period_end' && child_balance_end >= -0.005) {
          continue
        }
        if (debtFilter === 'debt_today' && child_current_balance >= -0.005) {
          continue
        }

        rows.push({
          child_id: meta.child_id,
          child_name: meta.child_name,
          is_active: meta.is_active,
          family_name: meta.family_name,
          primary_parent_phone: meta.primary_parent_phone,
          balance_start: child_balance_start,
          consumed_services_total: child_consumed_services_total,
          subscriptions_total: child_subscriptions_total,
          invoice_total: child_invoice_total,
          paid_in_period: child_paid_in_period,
          transfers_in_period: child_transfers_in_period,
          transfers_out_period: child_transfers_out_period,
          paid_after_period: child_paid_after_period,
          balance_end: child_balance_end,
          current_balance: child_current_balance,
          accounts: accountDetails,
        })
      }

      // Sort children alphabetically
      rows.sort((a, b) => a.child_name.localeCompare(b.child_name, 'uk'))

      const totals = {
        invoice_total: rows.reduce((s, r) => s + r.invoice_total, 0),
        consumed_services_total: rows.reduce((s, r) => s + r.consumed_services_total, 0),
        subscriptions_total: rows.reduce((s, r) => s + r.subscriptions_total, 0),
        paid_in_period: rows.reduce((s, r) => s + r.paid_in_period, 0),
        transfers_in_total: rows.reduce((s, r) => s + (r.transfers_in_period ?? 0), 0),
        transfers_out_total: rows.reduce((s, r) => s + (r.transfers_out_period ?? 0), 0),
        paid_after_period: rows.reduce((s, r) => s + r.paid_after_period, 0),
        balance_end: rows.reduce((s, r) => s + r.balance_end, 0),
        current_balance: rows.reduce((s, r) => s + r.current_balance, 0),
        children_count: rows.length,
      }

      return {
        rows,
        totals,
        period_months: periodMonths,
      }
    }
  )
}


