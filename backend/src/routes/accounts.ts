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
  - COALESCE((SELECT SUM(amount) FROM expenses             WHERE account_id = a.id AND status = 'paid' AND is_deleted = false), 0)
  - COALESCE((SELECT SUM(gross_amount) FROM salary_transactions WHERE account_id = a.id AND type = 'PAYMENT' AND is_deleted = false), 0)
  + COALESCE((SELECT SUM(amount) FROM account_transfers WHERE to_account_id   = a.id), 0)
  - COALESCE((SELECT SUM(amount) FROM account_transfers WHERE from_account_id = a.id), 0)
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
        kind: 'payment' | 'expense' | 'salary_payment' | 'transfer_in' | 'transfer_out' | 'cross_in' | 'cross_out'
        amount: string
        note: string | null
        detail: string | null
      }>`
        SELECT
          id,
          transaction_date::date AS date,
          'payment'              AS kind,
          amount::numeric        AS amount,
          note,
          (SELECT full_name FROM children WHERE id = child_id) AS detail
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
          payment_date::date AS date,
          'expense'          AS kind,
          amount::numeric    AS amount,
          note,
          (SELECT name FROM expense_categories WHERE id = category_id) AS detail
        FROM expenses
        WHERE account_id = ${id}
          AND status     = 'paid'
          AND is_deleted = false
          AND (${f}::date IS NULL OR payment_date::date >= ${f}::date)
          AND (${t}::date IS NULL OR payment_date::date <= ${t}::date)

        UNION ALL

        SELECT
          at.id,
          at.transfer_date::date AS date,
          'transfer_in'          AS kind,
          at.amount::numeric     AS amount,
          at.note,
          a_from.name            AS detail
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
          a_to.name              AS detail
        FROM account_transfers at
        LEFT JOIN accounts a_to ON a_to.id = at.to_account_id
        WHERE at.from_account_id = ${id}
          AND (${f}::date IS NULL OR at.transfer_date::date >= ${f}::date)
          AND (${t}::date IS NULL OR at.transfer_date::date <= ${t}::date)

        UNION ALL

        SELECT
          st.id,
          st.transaction_date::date AS date,
          'salary_payment'          AS kind,
          st.gross_amount::numeric  AS amount,
          st.note,
          (SELECT full_name FROM staff WHERE id = st.staff_id) AS detail
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
          ) AS detail
        FROM inter_account_imbalances iai
        WHERE iai.from_account_id = ${id}
          AND iai.transaction_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM transactions tx
            WHERE tx.id = iai.transaction_id AND tx.is_deleted = false
          )
          AND (${f}::date IS NULL OR iai.created_at::date >= ${f}::date)
          AND (${t}::date IS NULL OR iai.created_at::date <= ${t}::date)

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
    async (req, reply) => {
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
}
