import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'

// Physical cash balance:
//   + PAYMENT transactions — excluding cross-account ones where money went to a different account
//     (those are identified by having an imbalance record with to_account_id = this account)
//   + cross-account receipts: client paid HERE but debt was on another account (always, regardless of resolution)
//   - paid expenses
//   - salary payments (salary_transactions.type = 'PAYMENT' with account_id set)
//   ± account transfers
//
// After resolution via account_transfer:
//   cross_in still +300, transfer_out -300 → net 0 for the physical receiver ✓
//   debt account: PAYMENT filtered + transfer_in +300 → net +300 ✓
const balanceSql = sql<string>`(
  COALESCE((
    SELECT SUM(t.amount) FROM transactions t
    WHERE t.account_id = a.id AND t.type = 'PAYMENT' AND t.is_deleted = false
      AND NOT EXISTS (
        SELECT 1 FROM inter_account_imbalances i
        WHERE i.to_account_id = a.id AND i.transaction_id = t.id
      )
  ), 0)
  + COALESCE((
      SELECT SUM(i.amount) FROM inter_account_imbalances i
      WHERE i.from_account_id = a.id
        AND i.transaction_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM transactions t WHERE t.id = i.transaction_id AND t.is_deleted = false)
    ), 0)
  - COALESCE((SELECT SUM(amount - COALESCE(utilized_advance_amount, 0)) FROM expenses WHERE account_id = a.id AND status = 'paid' AND is_deleted = false AND is_advance_return = false), 0)
  + COALESCE((SELECT SUM(amount) FROM expenses WHERE account_id = a.id AND status = 'paid' AND is_deleted = false AND is_advance_return = true), 0)
  - COALESCE((SELECT SUM(gross_amount) FROM salary_transactions WHERE account_id = a.id AND type = 'PAYMENT' AND is_deleted = false), 0)
  + COALESCE((SELECT SUM(amount) FROM account_transfers WHERE to_account_id   = a.id), 0)
  - COALESCE((
      SELECT SUM(amount) FROM account_transfers WHERE from_account_id = a.id
      AND NOT EXISTS (SELECT 1 FROM expenses WHERE withdrawal_transfer_id = account_transfers.id AND is_deleted = false)
      AND NOT EXISTS (SELECT 1 FROM salary_transactions WHERE withdrawal_transfer_id = account_transfers.id AND is_deleted = false)
    ), 0)
  + COALESCE((SELECT SUM(amount) FROM account_income      WHERE account_id = a.id AND is_deleted = false), 0)
  + COALESCE((SELECT SUM(amount) FROM account_corrections WHERE account_id = a.id AND is_deleted = false), 0)
)`

export async function accountsRoutes(app: FastifyInstance) {

  // ── GET /api/accounts ─────────────────────────────────────────────────────
  app.get('/', { preHandler: authenticate }, async () => {
    return db.selectFrom('accounts as a')
      .selectAll('a')
      .select(balanceSql.as('balance'))
      .orderBy('a.name', 'asc')
      .execute()
  })

  // ── GET /api/accounts/:id ─────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', { preHandler: authenticate }, async (req, reply) => {
    const [account, imb] = await Promise.all([
      db.selectFrom('accounts as a')
        .selectAll('a')
        .select(balanceSql.as('balance'))
        .where('a.id', '=', req.params.id)
        .executeTakeFirst(),
      db.selectFrom('inter_account_imbalances')
        .select((eb) => eb.fn.count<string>('id').as('count'))
        .where((eb) => eb.or([
          eb('from_account_id', '=', req.params.id),
          eb('to_account_id',   '=', req.params.id),
        ]))
        .where('resolved_at', 'is', null)
        .executeTakeFirstOrThrow(),
    ])
    if (!account) return reply.status(404).send({ error: 'NotFound' })
    return { ...account, open_imbalances: Number(imb.count) }
  })

  // ── GET /api/accounts/:id/ledger?from=&to=&limit=&offset= ─────────────────
  app.get<{
    Params: { id: string }
    Querystring: { from?: string; to?: string; limit?: string; offset?: string }
  }>(
    '/:id/ledger',
    { preHandler: authenticate },
    async (req, reply) => {
      const { id } = req.params
      const limit  = Math.min(Number(req.query.limit  ?? 100), 500)
      const offset = Number(req.query.offset ?? 0)
      const f = req.query.from ?? null
      const t = req.query.to   ?? null

      // Unified ledger: PAYMENT + paid expenses + salary payments + transfers + cross-account flows
      const rows = await sql<{
        id: string
        date: string
        kind: 'payment' | 'expense' | 'salary_payment' | 'transfer_in' | 'transfer_out' | 'cross_in' | 'cross_out' | 'income' | 'correction_in' | 'correction_out'
        amount: string
        note: string | null
        detail: string | null
        is_advance: boolean | null
        utilized_advance_amount: string | null
      }>`
        SELECT
          id,
          transaction_date::date AS date,
          'payment'              AS kind,
          amount::numeric        AS amount,
          note,
          (SELECT full_name FROM children WHERE id = child_id) AS detail,
          false                  AS is_advance,
          NULL::numeric          AS utilized_advance_amount
        FROM transactions
        WHERE account_id = ${id}
          AND type       = 'PAYMENT'
          AND is_deleted = false
          AND (${f}::date IS NULL OR transaction_date::date >= ${f}::date)
          AND (${t}::date IS NULL OR transaction_date::date <= ${t}::date)
          AND NOT EXISTS (
            SELECT 1 FROM inter_account_imbalances i
            WHERE i.to_account_id = ${id} AND i.transaction_id = transactions.id
          )

        UNION ALL

        SELECT
          id,
          accrual_date::date AS date,
          'expense'          AS kind,
          (amount - COALESCE(utilized_advance_amount, 0))::numeric AS amount,
          note,
          (SELECT name FROM expense_categories WHERE id = category_id) AS detail,
          is_advance,
          utilized_advance_amount
        FROM expenses
        WHERE account_id = ${id}
          AND status     = 'paid'
          AND is_deleted = false
          AND is_advance_return = false
          AND (amount - COALESCE(utilized_advance_amount, 0)) > 0
          AND (${f}::date IS NULL OR accrual_date::date >= ${f}::date)
          AND (${t}::date IS NULL OR accrual_date::date <= ${t}::date)

        UNION ALL

        SELECT
          id,
          accrual_date::date AS date,
          'transfer_in'      AS kind,
          amount::numeric    AS amount,
          note,
          (SELECT name FROM expense_categories WHERE id = category_id) AS detail,
          false              AS is_advance,
          NULL::numeric      AS utilized_advance_amount
        FROM expenses
        WHERE account_id = ${id}
          AND status     = 'paid'
          AND is_deleted = false
          AND is_advance_return = true
          AND (${f}::date IS NULL OR accrual_date::date >= ${f}::date)
          AND (${t}::date IS NULL OR accrual_date::date <= ${t}::date)

        UNION ALL

        SELECT
          at.id,
          at.transfer_date::date AS date,
          'transfer_in'          AS kind,
          at.amount::numeric     AS amount,
          at.note,
          a_from.name            AS detail,
          false                  AS is_advance,
          NULL::numeric          AS utilized_advance_amount
        FROM account_transfers at
        LEFT JOIN accounts a_from ON a_from.id = at.from_account_id
        WHERE at.to_account_id = ${id}
          AND (${f}::date IS NULL OR at.transfer_date::date >= ${f}::date)
          AND (${t}::date IS NULL OR at.transfer_date::date <= ${t}::date)

        UNION ALL

        SELECT
          at.id,
          at.transfer_date::date AS date,
          'transfer_out'         AS kind,
          at.amount::numeric     AS amount,
          at.note,
          a_to.name              AS detail,
          false                  AS is_advance,
          NULL::numeric          AS utilized_advance_amount
        FROM account_transfers at
        LEFT JOIN accounts a_to ON a_to.id = at.to_account_id
        WHERE at.from_account_id = ${id}
          AND (${f}::date IS NULL OR at.transfer_date::date >= ${f}::date)
          AND (${t}::date IS NULL OR at.transfer_date::date <= ${t}::date)
          AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.withdrawal_transfer_id = at.id AND e.is_deleted = false)
          AND NOT EXISTS (SELECT 1 FROM salary_transactions st WHERE st.withdrawal_transfer_id = at.id AND st.is_deleted = false)

        UNION ALL

        SELECT
          st.id,
          st.transaction_date::date AS date,
          'salary_payment'          AS kind,
          st.gross_amount::numeric  AS amount,
          st.note,
          (SELECT full_name FROM staff WHERE id = st.staff_id) AS detail,
          false                     AS is_advance,
          NULL::numeric             AS utilized_advance_amount
        FROM salary_transactions st
        WHERE st.account_id = ${id}
          AND st.type       = 'PAYMENT'
          AND st.is_deleted = false
          AND (${f}::date IS NULL OR st.transaction_date::date >= ${f}::date)
          AND (${t}::date IS NULL OR st.transaction_date::date <= ${t}::date)

        UNION ALL

        -- Cross-account: client paid here but debt was on another account
        -- detail = "Іваненко Марія (рахунок: Готівка)"
        SELECT
          iai.id,
          iai.created_at::date AS date,
          'cross_in'           AS kind,
          iai.amount::numeric  AS amount,
          iai.note,
          (
            SELECT ch.full_name || ' (рахунок: ' || a_debt.name || ')'
            FROM transactions tx
            JOIN children ch    ON ch.id     = tx.child_id
            JOIN accounts a_debt ON a_debt.id = tx.account_id
            WHERE tx.id = iai.transaction_id
          ) AS detail,
          false                AS is_advance,
          NULL::numeric        AS utilized_advance_amount
        FROM inter_account_imbalances iai
        WHERE iai.from_account_id = ${id}
          AND iai.transaction_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM transactions tx
            WHERE tx.id = iai.transaction_id AND tx.is_deleted = false
          )
          AND (${f}::date IS NULL OR iai.created_at::date >= ${f}::date)
          AND (${t}::date IS NULL OR iai.created_at::date <= ${t}::date)

        UNION ALL

        SELECT
          ai.id,
          ai.income_date::date AS date,
          'income'             AS kind,
          ai.amount::numeric   AS amount,
          ai.note,
          ai.payer_name        AS detail,
          false                AS is_advance,
          NULL::numeric        AS utilized_advance_amount
        FROM account_income ai
        WHERE ai.account_id = ${id}
          AND ai.is_deleted = false
          AND (${f}::date IS NULL OR ai.income_date::date >= ${f}::date)
          AND (${t}::date IS NULL OR ai.income_date::date <= ${t}::date)

        UNION ALL

        SELECT
          ac.id,
          ac.correction_date::date AS date,
          CASE WHEN ac.amount >= 0 THEN 'correction_in' ELSE 'correction_out' END AS kind,
          ABS(ac.amount)::numeric  AS amount,
          ac.note,
          NULL                     AS detail,
          false                    AS is_advance,
          NULL::numeric            AS utilized_advance_amount
        FROM account_corrections ac
        WHERE ac.account_id = ${id}
          AND ac.is_deleted = false
          AND (${f}::date IS NULL OR ac.correction_date::date >= ${f}::date)
          AND (${t}::date IS NULL OR ac.correction_date::date <= ${t}::date)

        ORDER BY date DESC, kind
        LIMIT ${limit} OFFSET ${offset}
      `.execute(db)

      return reply.send({ data: rows.rows, limit, offset })
    }
  )

  // ── GET /api/accounts/:id/imbalances ──────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/:id/imbalances',
    { preHandler: requireRole('owner', 'admin') },
    async (req) => {
      const rows = await db.selectFrom('inter_account_imbalances as iai')
        .selectAll('iai')
        .leftJoin('accounts as af',  'af.id',  'iai.from_account_id')
        .leftJoin('accounts as at',  'at.id',  'iai.to_account_id')
        .leftJoin('transactions as tx', 'tx.id', 'iai.transaction_id')
        .leftJoin('children as ch',  'ch.id',  'tx.child_id')
        .select([
          'af.name as from_account_name',
          'at.name as to_account_name',
          'tx.transaction_date as tx_date',
          'tx.amount as tx_amount',
          'tx.note as tx_note',
          'ch.full_name as child_name',
        ])
        .where((eb) => eb.or([
          eb('iai.from_account_id', '=', req.params.id),
          eb('iai.to_account_id',   '=', req.params.id),
        ]))
        .where('iai.resolved_at', 'is', null)
        .orderBy('iai.created_at', 'desc')
        .execute()
      return rows
    }
  )

  // ── POST /api/accounts ────────────────────────────────────────────────────
  app.post<{ Body: { name: string; type: 'fop' | 'cash' | 'bank'; currency?: string; note?: string } }>(
    '/',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { name, type, currency = 'UAH', note } = req.body
      if (!name?.trim()) return reply.status(400).send({ error: 'BadRequest', message: 'name є обовʼязковим' })
      if (!['fop', 'cash', 'bank'].includes(type)) return reply.status(400).send({ error: 'BadRequest', message: 'type має бути fop, cash або bank' })

      const account = await db.insertInto('accounts')
        .values({ name: name.trim(), type, currency, note: note || null })
        .returningAll()
        .executeTakeFirstOrThrow()
      return reply.status(201).send(account)
    }
  )

  // ── PUT /api/accounts/:id ─────────────────────────────────────────────────
  app.put<{ Params: { id: string }; Body: { name?: string; type?: 'fop' | 'cash' | 'bank'; currency?: string; note?: string; is_active?: boolean } }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const updated = await db.updateTable('accounts').set(req.body).where('id', '=', req.params.id).returningAll().executeTakeFirst()
      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return updated
    }
  )

  // ── GET /api/accounts/payer-search?q= ────────────────────────────────────
  // Search children by child name OR parent full_name
  app.get<{ Querystring: { q?: string } }>(
    '/payer-search',
    { preHandler: authenticate },
    async (req) => {
      const q = (req.query.q ?? '').trim()
      if (q.length < 2) return []

      const pattern = `%${q}%`

      // Children matching by own name
      const byChildName = await db.selectFrom('children as c')
        .select(['c.id', 'c.full_name'])
        .where('c.is_active', '=', true)
        .where('c.full_name', 'ilike', pattern)
        .limit(10)
        .execute()

      // Children matching via parent name
      const byParentName = await db.selectFrom('child_parents as cp')
        .innerJoin('children as c', 'c.id', 'cp.child_id')
        .innerJoin('parents as p', 'p.id', 'cp.parent_id')
        .select(['c.id', 'c.full_name', 'p.full_name as parent_name'])
        .where('c.is_active', '=', true)
        .where('p.full_name', 'ilike', pattern)
        .limit(10)
        .execute()

      // Merge and deduplicate by child id
      const seen = new Set<string>()
      const results: { id: string; full_name: string; parent_name?: string | null }[] = []

      for (const r of byChildName) {
        if (!seen.has(r.id)) { seen.add(r.id); results.push(r) }
      }
      for (const r of byParentName) {
        if (!seen.has(r.id)) { seen.add(r.id); results.push({ id: r.id, full_name: r.full_name, parent_name: r.parent_name }) }
      }

      return results.slice(0, 15)
    }
  )

  // ── POST /api/accounts/:id/payments — manual payment from child ───────────
  app.post<{
    Params: { id: string }
    Body: {
      child_id: string
      amount: number
      transaction_date?: string
      note?: string
      debt_account_id?: string   // if set → cross-account: money arrived here, debt on debt_account_id
    }
  }>(
    '/:id/payments',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { child_id, amount, note, debt_account_id } = req.body
      const physicalAccountId = req.params.id   // account where money physically arrived
      const dateStr = req.body.transaction_date ?? new Date().toISOString().slice(0, 10)

      if (!child_id || !amount || amount <= 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'child_id та amount є обовʼязковими' })
      }

      const isCrossAccount = !!debt_account_id && debt_account_id !== physicalAccountId
      const serviceAccountId = isCrossAccount ? debt_account_id! : physicalAccountId

      const { createTransaction, recalcBalance } = await import('../services/balanceService.js')

      const txId = await createTransaction({
        type: 'PAYMENT',
        child_id,
        account_id: serviceAccountId,
        amount,
        transaction_date: dateStr,
        note: note ?? null,
        created_by: (req as { user?: { sub?: string } }).user?.sub ?? null,
        metadata_json: isCrossAccount ? { payment_account_id: physicalAccountId } : null,
      })

      if (isCrossAccount) {
        await db.insertInto('inter_account_imbalances').values({
          from_account_id: physicalAccountId,
          to_account_id:   serviceAccountId,
          amount,
          transaction_id:  txId,
          note: note ?? null,
        }).execute()
      }

      await recalcBalance(child_id, serviceAccountId)

      return reply.status(201).send({ id: txId, cross_account: isCrossAccount })
    }
  )

  // ── POST /api/accounts/:id/income — arbitrary income (no child) ───────────
  app.post<{
    Params: { id: string }
    Body: { amount: number; income_date?: string; payer_name?: string; note?: string }
  }>(
    '/:id/income',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { amount, payer_name, note } = req.body
      const income_date = req.body.income_date ?? new Date().toISOString().slice(0, 10)

      if (!amount || amount <= 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'amount має бути більше 0' })
      }

      const row = await db.insertInto('account_income')
        .values({
          account_id: req.params.id,
          income_date,
          amount,
          payer_name: payer_name || null,
          note: note || null,
          created_by: (req as { user?: { sub?: string } }).user?.sub ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      return reply.status(201).send(row)
    }
  )

  // ── POST /api/accounts/:id/corrections — balance correction ──────────────
  app.post<{
    Params: { id: string }
    Body: { amount: number; correction_date?: string; note?: string }
  }>(
    '/:id/corrections',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { amount, note } = req.body
      const correction_date = req.body.correction_date ?? new Date().toISOString().slice(0, 10)

      if (amount === undefined || amount === null) {
        return reply.status(400).send({ error: 'BadRequest', message: 'amount є обовʼязковим' })
      }

      const row = await db.insertInto('account_corrections')
        .values({
          account_id: req.params.id,
          correction_date,
          amount,
          note: note || null,
          created_by: (req as { user?: { sub?: string } }).user?.sub ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      return reply.status(201).send(row)
    }
  )

  // ── PUT /api/accounts/:id/corrections/:corrId ─────────────────────────────
  app.put<{
    Params: { id: string; corrId: string }
    Body: { amount?: number; correction_date?: string; note?: string }
  }>(
    '/:id/corrections/:corrId',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { amount, note, correction_date } = req.body
      const updates: Record<string, unknown> = {}
      if (amount !== undefined) updates.amount = amount
      if (note    !== undefined) updates.note = note || null
      if (correction_date)       updates.correction_date = correction_date

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Немає полів для оновлення' })
      }

      const row = await db.updateTable('account_corrections')
        .set(updates)
        .where('id', '=', req.params.corrId)
        .where('account_id', '=', req.params.id)
        .where('is_deleted', '=', false)
        .returningAll()
        .executeTakeFirst()

      if (!row) return reply.status(404).send({ error: 'NotFound' })
      return row
    }
  )

  // ── DELETE /api/accounts/:id/corrections/:corrId ──────────────────────────
  app.delete<{ Params: { id: string; corrId: string } }>(
    '/:id/corrections/:corrId',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const row = await db.updateTable('account_corrections')
        .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: (req as { user?: { sub?: string } }).user?.sub ?? null })
        .where('id', '=', req.params.corrId)
        .where('account_id', '=', req.params.id)
        .where('is_deleted', '=', false)
        .returningAll()
        .executeTakeFirst()

      if (!row) return reply.status(404).send({ error: 'NotFound' })
      return reply.status(204).send()
    }
  )

  // ── PUT /api/accounts/:id/income/:incomeId ────────────────────────────────
  app.put<{
    Params: { id: string; incomeId: string }
    Body: { amount?: number; income_date?: string; payer_name?: string; note?: string }
  }>(
    '/:id/income/:incomeId',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { amount, income_date, payer_name, note } = req.body
      const updates: Record<string, unknown> = {}
      if (amount      !== undefined) updates.amount = amount
      if (income_date !== undefined) updates.income_date = income_date
      if (payer_name  !== undefined) updates.payer_name = payer_name || null
      if (note        !== undefined) updates.note = note || null

      if (Object.keys(updates).length === 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Немає полів для оновлення' })
      }

      const row = await db.updateTable('account_income')
        .set(updates)
        .where('id', '=', req.params.incomeId)
        .where('account_id', '=', req.params.id)
        .where('is_deleted', '=', false)
        .returningAll()
        .executeTakeFirst()

      if (!row) return reply.status(404).send({ error: 'NotFound' })
      return row
    }
  )

  // ── DELETE /api/accounts/:id/income/:incomeId ─────────────────────────────
  app.delete<{ Params: { id: string; incomeId: string } }>(
    '/:id/income/:incomeId',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const row = await db.updateTable('account_income')
        .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: (req as { user?: { sub?: string } }).user?.sub ?? null })
        .where('id', '=', req.params.incomeId)
        .where('account_id', '=', req.params.id)
        .where('is_deleted', '=', false)
        .returningAll()
        .executeTakeFirst()

      if (!row) return reply.status(404).send({ error: 'NotFound' })
      return reply.status(204).send()
    }
  )
}
