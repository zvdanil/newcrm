import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'

export async function expensesRoutes(app: FastifyInstance) {

  // ── Categories ─────────────────────────────────────────────────────────────

  // GET /api/expense-categories
  app.get('/categories', { preHandler: authenticate }, async () => {
    return db
      .selectFrom('expense_categories')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')
      .execute()
  })

  // POST /api/expense-categories
  app.post<{ Body: { name: string; parent_id?: string; sort_order?: number } }>(
    '/categories',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { name, parent_id, sort_order } = req.body
      if (!name?.trim()) return reply.status(400).send({ error: 'BadRequest', message: 'name є обовʼязковим' })
      const row = await db.insertInto('expense_categories')
        .values({ name: name.trim(), parent_id: parent_id ?? null, sort_order: sort_order ?? 0 })
        .returningAll()
        .executeTakeFirstOrThrow()
      return reply.status(201).send(row)
    }
  )

  // PUT /api/expense-categories/:id
  app.put<{ Params: { id: string }; Body: { name?: string; parent_id?: string | null; sort_order?: number; is_active?: boolean } }>(
    '/categories/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const updated = await db.updateTable('expense_categories')
        .set(req.body)
        .where('id', '=', req.params.id)
        .returningAll()
        .executeTakeFirst()
      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return updated
    }
  )

  // DELETE /api/expense-categories/:id
  // Blocked if the category has active subcategories.
  // Expenses referencing this category will get category_id = NULL (ON DELETE SET NULL).
  app.delete<{ Params: { id: string } }>(
    '/categories/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const children = await db
        .selectFrom('expense_categories')
        .select('id')
        .where('parent_id', '=', req.params.id)
        .execute()

      if (children.length > 0) {
        return reply.status(409).send({
          error: 'HasChildren',
          message: 'Спочатку видаліть або перенесіть підкатегорії',
        })
      }

      const deleted = await db
        .deleteFrom('expense_categories')
        .where('id', '=', req.params.id)
        .returningAll()
        .executeTakeFirst()

      if (!deleted) return reply.status(404).send({ error: 'NotFound' })
      return { ok: true }
    }
  )

  // ── Expenses ───────────────────────────────────────────────────────────────

  // GET /api/expenses?account_id=&category_id=&status=&from=&to=&is_dividend=&limit=&offset=
  app.get<{
    Querystring: {
      account_id?: string
      category_id?: string
      status?: string
      from?: string
      to?: string
      is_dividend?: string
      limit?: string
      offset?: string
    }
  }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      const limit  = Math.min(Number(req.query.limit  ?? 500), 500)
      const offset = Number(req.query.offset ?? 0)

      let q = db
        .selectFrom('expenses as e')
        .leftJoin('expense_categories as c',  'c.id', 'e.category_id')
        .leftJoin('expense_categories as cp', 'cp.id', 'c.parent_id')
        .leftJoin('accounts as a',            'a.id',  'e.account_id')
        .leftJoin('users as u',               'u.id',  'e.created_by')
        .select([
          'e.id', 'e.amount', 'e.accrual_date', 'e.payment_date',
          'e.status', 'e.is_instant', 'e.is_dividend', 'e.note', 'e.created_at',
          'e.withdrawal_transfer_id',
          'e.account_id', 'a.name as account_name',
          'e.category_id',
          'c.name as category_name',
          'c.parent_id',
          'cp.name as parent_category_name',
          'u.email as created_by_email',
        ])
        .where('e.is_deleted', '=', false)

      if (req.query.account_id)  q = q.where('e.account_id', '=', req.query.account_id)
      if (req.query.category_id) {
        // match category OR its children
        q = q.where((eb) => eb.or([
          eb('e.category_id', '=', req.query.category_id!),
          eb('c.parent_id',   '=', req.query.category_id!),
        ]))
      }
      if (req.query.status)      q = q.where('e.status', '=', req.query.status as 'pending' | 'paid')
      if (req.query.from)        q = q.where('e.accrual_date', '>=', new Date(req.query.from))
      if (req.query.to)          q = q.where('e.accrual_date', '<=', new Date(req.query.to))
      if (req.query.is_dividend === 'true')  q = q.where('e.is_dividend', '=', true)
      if (req.query.is_dividend === 'false') q = q.where('e.is_dividend', '=', false)

      // Total for the filter (without limit/offset)
      const totalQ = db
        .selectFrom('expenses as e')
        .leftJoin('expense_categories as c', 'c.id', 'e.category_id')
        .select((eb) => [
          eb.fn.countAll<number>().as('count'),
          eb.fn.sum<string>('e.amount').as('total_amount'),
        ])
        .where('e.is_deleted', '=', false)
      // apply same filters
      let totalQFiltered = totalQ
      if (req.query.account_id)  totalQFiltered = totalQFiltered.where('e.account_id', '=', req.query.account_id)
      if (req.query.category_id) {
        totalQFiltered = totalQFiltered.where((eb) => eb.or([
          eb('e.category_id', '=', req.query.category_id!),
          eb('c.parent_id',   '=', req.query.category_id!),
        ]))
      }
      if (req.query.status)      totalQFiltered = totalQFiltered.where('e.status', '=', req.query.status as 'pending' | 'paid')
      if (req.query.from)        totalQFiltered = totalQFiltered.where('e.accrual_date', '>=', new Date(req.query.from))
      if (req.query.to)          totalQFiltered = totalQFiltered.where('e.accrual_date', '<=', new Date(req.query.to))
      if (req.query.is_dividend === 'true')  totalQFiltered = totalQFiltered.where('e.is_dividend', '=', true)
      if (req.query.is_dividend === 'false') totalQFiltered = totalQFiltered.where('e.is_dividend', '=', false)

      const [data, totals] = await Promise.all([
        q.orderBy('e.accrual_date', 'desc').orderBy('e.created_at', 'desc').limit(limit).offset(offset).execute(),
        totalQFiltered.executeTakeFirst(),
      ])

      return {
        data,
        total: Number(totals?.count ?? 0),
        total_amount: Number(totals?.total_amount ?? 0),
        limit,
        offset,
      }
    }
  )

  // POST /api/expenses  (pending or instant)
  app.post<{
    Body: {
      account_id: string
      category_id?: string
      amount: number
      accrual_date?: string
      payment_date?: string
      is_instant?: boolean
      is_dividend?: boolean
      note?: string
    }
  }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const { account_id, category_id, amount, accrual_date, payment_date, is_instant = false, is_dividend = false, note } = req.body
      if (!account_id) return reply.status(400).send({ error: 'BadRequest', message: 'account_id є обовʼязковим' })
      if (!amount || amount <= 0) return reply.status(400).send({ error: 'BadRequest', message: 'Сума повинна бути більше 0' })

      const today = new Date().toISOString().slice(0, 10)
      const status = is_instant ? 'paid' : 'pending'
      const paidDate = is_instant ? (payment_date ?? today) : (payment_date ?? null)

      const row = await db.insertInto('expenses')
        .values({
          account_id,
          category_id: category_id ?? null,
          amount,
          accrual_date: accrual_date ?? today,
          payment_date: paidDate,
          status,
          is_instant,
          is_dividend,
          note: note ?? null,
          created_by: req.user.sub,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      return reply.status(201).send(row)
    }
  )

  // PUT /api/expenses/:id
  app.put<{
    Params: { id: string }
    Body: { account_id?: string; category_id?: string | null; amount?: number; accrual_date?: string; note?: string | null }
  }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const expense = await db.selectFrom('expenses').select(['id', 'status', 'is_deleted'])
        .where('id', '=', req.params.id).executeTakeFirst()
      if (!expense || expense.is_deleted) return reply.status(404).send({ error: 'NotFound' })
      if (expense.status === 'paid') return reply.status(409).send({ error: 'Conflict', message: 'Оплачений витрат не можна редагувати' })

      const updated = await db.updateTable('expenses')
        .set(req.body)
        .where('id', '=', req.params.id)
        .returningAll()
        .executeTakeFirst()
      return updated
    }
  )

  // DELETE /api/expenses/:id — soft delete
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const updated = await db.updateTable('expenses')
        .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.sub })
        .where('id', '=', req.params.id)
        .where('is_deleted', '=', false)
        .returningAll()
        .executeTakeFirst()
      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return { ok: true }
    }
  )

  // POST /api/expenses/:id/pay — pending → paid
  app.post<{
    Params: { id: string }
    Body: { payment_date?: string; account_id?: string }
  }>(
    '/:id/pay',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const expense = await db.selectFrom('expenses').select(['id', 'status', 'is_deleted'])
        .where('id', '=', req.params.id).executeTakeFirst()
      if (!expense || expense.is_deleted) return reply.status(404).send({ error: 'NotFound' })
      if (expense.status === 'paid') return reply.status(409).send({ error: 'Conflict', message: 'Вже оплачено' })

      const today = new Date().toISOString().slice(0, 10)
      const updates: Record<string, unknown> = {
        status: 'paid',
        payment_date: req.body.payment_date ?? today,
      }
      if (req.body.account_id) updates.account_id = req.body.account_id

      const updated = await db.updateTable('expenses')
        .set(updates)
        .where('id', '=', req.params.id)
        .returningAll()
        .executeTakeFirst()
      return updated
    }
  )

  // POST /api/expenses/:id/withdraw — cash-out: transfer (amount - commission) back to target account
  app.post<{
    Params: { id: string }
    Body: { target_account_id: string; commission: number; transfer_date?: string }
  }>(
    '/:id/withdraw',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { target_account_id, commission, transfer_date } = req.body

      if (!target_account_id) {
        return reply.status(400).send({ error: 'BadRequest', message: 'target_account_id є обовʼязковим' })
      }
      if (commission < 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Комісія не може бути від\'ємною' })
      }

      const expense = await db.selectFrom('expenses')
        .select(['id', 'account_id', 'amount', 'note', 'is_deleted', 'withdrawal_transfer_id'])
        .where('id', '=', req.params.id)
        .executeTakeFirst()

      if (!expense || expense.is_deleted) return reply.status(404).send({ error: 'NotFound' })
      if (expense.withdrawal_transfer_id) {
        return reply.status(409).send({ error: 'AlreadyWithdrawn', message: 'Обналичування вже було виконано' })
      }

      const amount = parseFloat(expense.amount as string)
      if (commission >= amount) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Комісія не може перевищувати суму транзакції' })
      }

      const dateStr = transfer_date ?? new Date().toISOString().slice(0, 10)
      const returnAmount = Math.round((amount - commission) * 100) / 100

      // 1. Transfer: money comes back (amount - commission) to target account
      const transfer = await db.insertInto('account_transfers')
        .values({
          from_account_id: expense.account_id,
          to_account_id:   target_account_id,
          amount:          returnAmount,
          commission:      0,
          transfer_date:   dateStr,
          note: `Обналичування: ${expense.note ?? expense.id}`,
          created_by: req.user.sub,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      // 2. Commission as a separate expense (if commission > 0)
      let commissionExpense = null
      if (commission > 0) {
        commissionExpense = await db.insertInto('expenses')
          .values({
            account_id:   expense.account_id,
            category_id:  null,
            amount:       commission,
            accrual_date: dateStr,
            payment_date: dateStr,
            status:       'paid',
            is_instant:   true,
            is_dividend:  false,
            note: `Комісія за обналичування "${expense.note ?? expense.id}" на суму ${amount}`,
            created_by:   req.user.sub,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
      }

      // 3. Mark original expense as withdrawn
      await db.updateTable('expenses')
        .set({ withdrawal_transfer_id: transfer.id })
        .where('id', '=', req.params.id)
        .execute()

      return reply.status(201).send({
        ok: true,
        transfer,
        commission_expense: commissionExpense,
      })
    }
  )

  // PUT /api/expenses/:id/dividend — toggle is_dividend (Owner only)
  app.put<{ Params: { id: string }; Body: { is_dividend: boolean } }>(
    '/:id/dividend',
    { preHandler: requireRole('owner') },
    async (req, reply) => {
      const updated = await db.updateTable('expenses')
        .set({ is_dividend: req.body.is_dividend })
        .where('id', '=', req.params.id)
        .where('is_deleted', '=', false)
        .returningAll()
        .executeTakeFirst()
      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return updated
    }
  )

  // ── Account Transfers ──────────────────────────────────────────────────────

  // GET /api/expenses/transfers?account_id=&from=&to=
  app.get<{ Querystring: { account_id?: string; from?: string; to?: string } }>(
    '/transfers',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      let q = db
        .selectFrom('account_transfers as t')
        .innerJoin('accounts as fa', 'fa.id', 't.from_account_id')
        .innerJoin('accounts as ta', 'ta.id', 't.to_account_id')
        .select([
          't.id', 't.amount', 't.commission', 't.transfer_date', 't.note', 't.created_at',
          't.from_account_id', 'fa.name as from_account_name',
          't.to_account_id',   'ta.name as to_account_name',
        ])

      if (req.query.account_id) {
        q = q.where((eb) => eb.or([
          eb('t.from_account_id', '=', req.query.account_id!),
          eb('t.to_account_id',   '=', req.query.account_id!),
        ]))
      }
      if (req.query.from) q = q.where('t.transfer_date', '>=', new Date(req.query.from))
      if (req.query.to)   q = q.where('t.transfer_date', '<=', new Date(req.query.to))

      return q.orderBy('t.transfer_date', 'desc').orderBy('t.created_at', 'desc').limit(500).execute()
    }
  )

  // POST /api/expenses/transfers
  app.post<{
    Body: {
      from_account_id: string
      to_account_id: string
      amount: number
      commission?: number
      transfer_date?: string
      note?: string
    }
  }>(
    '/transfers',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { from_account_id, to_account_id, amount, commission = 0, transfer_date, note } = req.body
      if (!from_account_id || !to_account_id) return reply.status(400).send({ error: 'BadRequest', message: 'from_account_id та to_account_id є обовʼязковими' })
      if (from_account_id === to_account_id) return reply.status(400).send({ error: 'BadRequest', message: 'Рахунки повинні різнитися' })
      if (!amount || amount <= 0) return reply.status(400).send({ error: 'BadRequest', message: 'Сума повинна бути більше 0' })

      const row = await db.insertInto('account_transfers')
        .values({
          from_account_id,
          to_account_id,
          amount,
          commission,
          transfer_date: transfer_date ?? new Date().toISOString().slice(0, 10),
          note: note ?? null,
          created_by: req.user.sub,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      return reply.status(201).send(row)
    }
  )

  // DELETE /api/expenses/transfers/:id (Owner only)
  app.delete<{ Params: { id: string } }>(
    '/transfers/:id',
    { preHandler: requireRole('owner') },
    async (req, reply) => {
      const deleted = await db.deleteFrom('account_transfers')
        .where('id', '=', req.params.id)
        .returningAll()
        .executeTakeFirst()
      if (!deleted) return reply.status(404).send({ error: 'NotFound' })
      return { ok: true }
    }
  )
}
