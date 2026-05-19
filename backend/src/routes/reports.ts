import type { FastifyInstance } from 'fastify'
import { sql, type SqlBool } from 'kysely'
import { db } from '../db/index.js'
import { authenticate } from '../plugins/authenticate.js'

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
}
