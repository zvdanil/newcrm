import type { FastifyInstance } from 'fastify'
import { sql, type SqlBool } from 'kysely'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'

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
    { preHandler: requireRole('owner') },
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
            sql<string>`COALESCE(SUM(CASE WHEN is_advance_return THEN -amount ELSE amount - COALESCE(utilized_advance_amount, 0) END), 0)`.as('total'),
            sql<string>`COALESCE(SUM(CASE WHEN NOT is_dividend THEN (CASE WHEN is_advance_return THEN -amount ELSE amount - COALESCE(utilized_advance_amount, 0) END) ELSE 0 END), 0)`.as('total_no_div'),
          ])
          .where('status', '=', 'paid')
          .where('is_deleted', '=', false)
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
          sql<string>`SUM(CASE WHEN t.type IN ('PAYMENT','REFUND','REVERSAL') AND date_trunc('month', t.transaction_date) < ${fromDate} THEN t.amount ELSE 0 END)`.as('credits_before'),
          sql<string>`SUM(CASE WHEN t.type IN ('ACCRUAL','ADJUSTMENT') AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) < ${fromDate} THEN t.amount ELSE 0 END)`.as('debits_before'),
          // Credits / debits WITHIN the period
          sql<string>`SUM(CASE WHEN t.type IN ('PAYMENT','REFUND','REVERSAL') AND date_trunc('month', t.transaction_date) >= ${fromDate} AND date_trunc('month', t.transaction_date) <= ${toDate} THEN t.amount ELSE 0 END)`.as('credits_in_period'),
          sql<string>`SUM(CASE WHEN t.type IN ('ACCRUAL','ADJUSTMENT') AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) >= ${fromDate} AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) <= ${toDate} THEN t.amount ELSE 0 END)`.as('debits_in_period'),
        ])
        .where('t.is_deleted', '=', false)
        .where(sql<SqlBool>`(
          (t.type IN ('PAYMENT','REFUND','REVERSAL') AND date_trunc('month', t.transaction_date) <= ${toDate})
          OR
          (t.type IN ('ACCRUAL','ADJUSTMENT') AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) <= ${toDate})
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
            CASE WHEN t.type IN ('ACCRUAL','ADJUSTMENT')
              THEN COALESCE(t.billing_month, date_trunc('month', t.transaction_date))
              ELSE date_trunc('month', t.transaction_date)
            END,
            'YYYY-MM-01'
          )`.as('month'),
          sql<string>`SUM(CASE WHEN t.type IN ('PAYMENT','REFUND','REVERSAL') THEN t.amount ELSE 0 END)`.as('credits'),
          sql<string>`SUM(CASE WHEN t.type IN ('ACCRUAL','ADJUSTMENT') THEN t.amount ELSE 0 END)`.as('debits'),
        ])
        .where('t.is_deleted', '=', false)
        .where(sql<SqlBool>`(
          (t.type IN ('PAYMENT','REFUND','REVERSAL') AND date_trunc('month', t.transaction_date) >= ${fromDate} AND date_trunc('month', t.transaction_date) <= ${toDate})
          OR
          (t.type IN ('ACCRUAL','ADJUSTMENT') AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) >= ${fromDate} AND COALESCE(t.billing_month, date_trunc('month', t.transaction_date)) <= ${toDate})
        )`)
        .groupBy([
          't.child_id',
          't.account_id',
          sql`CASE WHEN t.type IN ('ACCRUAL','ADJUSTMENT')
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

      // ── 4. Accounts ──
      let accountsQ = db.selectFrom('accounts').select(['id', 'name'])
      if (accountIds.length > 0) accountsQ = accountsQ.where('id', 'in', accountIds)

      // ── 5. Initial balances ──
      let initQ = db.selectFrom('initial_balances').select(['child_id', 'account_id', 'amount'])
      if (accountIds.length > 0) initQ = initQ.where('account_id', 'in', accountIds)

      // ── 6. Current balances ──
      let curQ = db.selectFrom('child_balances').select(['child_id', 'account_id', 'balance'])
      if (accountIds.length > 0) curQ = curQ.where('account_id', 'in', accountIds)

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
}
