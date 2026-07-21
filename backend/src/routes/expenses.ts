import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
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

  // GET /api/expenses?account_id=&category_id=&status=&from=&to=&is_dividend=&include_salary=&limit=&offset=
  app.get<{
    Querystring: {
      account_id?: string
      category_id?: string
      status?: string
      from?: string
      to?: string
      is_dividend?: string
      include_salary?: string
      limit?: string
      offset?: string
    }
  }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      const limit = Math.min(Number(req.query.limit ?? 500), 500)
      const offset = Number(req.query.offset ?? 0)
      const includeSalary = req.query.include_salary === 'true'

      let q = db
        .selectFrom('expenses as e')
        .leftJoin('expense_categories as c', 'c.id', 'e.category_id')
        .leftJoin('expense_categories as cp', 'cp.id', 'c.parent_id')
        .leftJoin('accounts as a', 'a.id', 'e.account_id')
        .leftJoin('users as u', 'u.id', 'e.created_by')
        .leftJoin('staff as s', 's.id', 'e.staff_id')
        .select([
          'e.id', 'e.amount', 'e.accrual_date', 'e.payment_date',
          'e.status', 'e.is_instant', 'e.is_dividend', 'e.note', 'e.created_at',
          'e.withdrawal_transfer_id', 'e.withdrawal_amount', 'e.dividend_payout_id', 'e.dividend_amount',
          'e.account_id', 'a.name as account_name',
          'e.category_id',
          'c.name as category_name',
          'c.parent_id',
          'cp.name as parent_category_name',
          'u.email as created_by_email',
          'e.is_advance', 'e.is_advance_return', 'e.staff_id', 's.full_name as staff_name',
          'e.utilized_advance_id', 'e.utilized_advance_amount', 'e.advance_staff_id',
        ])
        .select(
          sql<string>`COALESCE((SELECT SUM(u.amount) FROM expense_advance_usages u WHERE u.expense_id = e.id), 0)`.as('pool_advance_amount')
        )
        .select(
          sql<string | null>`CASE WHEN EXISTS (
            SELECT 1 WHERE e.utilized_advance_id IS NOT NULL
            UNION
            SELECT 1 FROM expense_advance_usages WHERE expense_id = e.id
          ) THEN (
            SELECT 
              COALESCE(SUM(pool_adv.amount), 0)
              - COALESCE((
                  SELECT SUM(spent.utilized_advance_amount) 
                  FROM expenses spent 
                  WHERE spent.is_advance_return = false 
                    AND spent.is_deleted = false
                    AND (
                      spent.accrual_date < e.accrual_date 
                      OR (spent.accrual_date = e.accrual_date AND spent.created_at <= e.created_at)
                    )
                    AND spent.utilized_advance_id IN (
                      SELECT id FROM expenses WHERE is_advance = true AND is_deleted = false
                      AND (
                        (staff_id IS NOT NULL AND staff_id = COALESCE(
                          e.advance_staff_id, 
                          (SELECT staff_id FROM expenses WHERE id = e.utilized_advance_id),
                          (SELECT staff_id FROM expenses WHERE id = (SELECT u.advance_id FROM expense_advance_usages u WHERE u.expense_id = e.id LIMIT 1))
                        ))
                        OR
                        (staff_id IS NULL AND category_id = e.category_id)
                      )
                    )
                ), 0)
              - COALESCE((
                  SELECT SUM(u.amount) 
                  FROM expense_advance_usages u 
                  INNER JOIN expenses ex ON ex.id = u.expense_id 
                  WHERE ex.is_deleted = false
                    AND (
                      ex.accrual_date < e.accrual_date 
                      OR (ex.accrual_date = e.accrual_date AND ex.created_at <= e.created_at)
                    )
                    AND u.advance_id IN (
                      SELECT id FROM expenses WHERE is_advance = true AND is_deleted = false
                      AND (
                        (staff_id IS NOT NULL AND staff_id = COALESCE(
                          e.advance_staff_id, 
                          (SELECT staff_id FROM expenses WHERE id = e.utilized_advance_id),
                          (SELECT staff_id FROM expenses WHERE id = (SELECT u.advance_id FROM expense_advance_usages u WHERE u.expense_id = e.id LIMIT 1))
                        ))
                        OR
                        (staff_id IS NULL AND category_id = e.category_id)
                      )
                    )
                ), 0)
              - COALESCE((
                  SELECT SUM(ret.amount) 
                  FROM expenses ret 
                  WHERE ret.is_advance_return = true 
                    AND ret.is_deleted = false
                    AND (
                      ret.accrual_date < e.accrual_date 
                      OR (ret.accrual_date = e.accrual_date AND ret.created_at <= e.created_at)
                    )
                    AND ret.utilized_advance_id IN (
                      SELECT id FROM expenses WHERE is_advance = true AND is_deleted = false
                      AND (
                        (staff_id IS NOT NULL AND staff_id = COALESCE(
                          e.advance_staff_id, 
                          (SELECT staff_id FROM expenses WHERE id = e.utilized_advance_id),
                          (SELECT staff_id FROM expenses WHERE id = (SELECT u.advance_id FROM expense_advance_usages u WHERE u.expense_id = e.id LIMIT 1))
                        ))
                        OR
                        (staff_id IS NULL AND category_id = e.category_id)
                      )
                    )
                ), 0)
            FROM expenses pool_adv
            WHERE pool_adv.is_advance = true AND pool_adv.is_deleted = false
              AND (
                (pool_adv.staff_id IS NOT NULL AND pool_adv.staff_id = COALESCE(
                  e.advance_staff_id, 
                  (SELECT staff_id FROM expenses WHERE id = e.utilized_advance_id),
                  (SELECT staff_id FROM expenses WHERE id = (SELECT u.advance_id FROM expense_advance_usages u WHERE u.expense_id = e.id LIMIT 1))
                ))
                OR
                (pool_adv.staff_id IS NULL AND pool_adv.category_id = e.category_id)
              )
              AND (
                pool_adv.accrual_date < e.accrual_date 
                OR (pool_adv.accrual_date = e.accrual_date AND pool_adv.created_at <= e.created_at)
              )
          ) ELSE NULL END`.as('utilized_advance_remaining_balance')
        )
        .where('e.is_deleted', '=', false)

      if (req.query.account_id) q = q.where('e.account_id', '=', req.query.account_id)
      if (req.query.category_id) {
        // match category OR its children
        q = q.where((eb) => eb.or([
          eb('e.category_id', '=', req.query.category_id!),
          eb('c.parent_id', '=', req.query.category_id!),
        ]))
      }
      if (req.query.status) q = q.where('e.status', '=', req.query.status as 'pending' | 'paid')
      if (req.query.from && req.query.to) {
        const fromDate = new Date(req.query.from)
        const toDate = new Date(req.query.to)
        q = q.where((eb) => eb.or([
          eb.and([eb('e.accrual_date', '>=', fromDate), eb('e.accrual_date', '<=', toDate)]),
          eb.and([eb('e.payment_date', '>=', fromDate), eb('e.payment_date', '<=', toDate)])
        ]))
      } else {
        if (req.query.from) q = q.where((eb) => eb.or([eb('e.accrual_date', '>=', new Date(req.query.from!)), eb('e.payment_date', '>=', new Date(req.query.from!))]))
        if (req.query.to) q = q.where((eb) => eb.or([eb('e.accrual_date', '<=', new Date(req.query.to!)), eb('e.payment_date', '<=', new Date(req.query.to!))]))
      }
      if (req.query.is_dividend === 'true') q = q.where('e.is_dividend', '=', true)
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
      if (req.query.account_id) totalQFiltered = totalQFiltered.where('e.account_id', '=', req.query.account_id)
      if (req.query.category_id) {
        totalQFiltered = totalQFiltered.where((eb) => eb.or([
          eb('e.category_id', '=', req.query.category_id!),
          eb('c.parent_id', '=', req.query.category_id!),
        ]))
      }
      if (req.query.status) totalQFiltered = totalQFiltered.where('e.status', '=', req.query.status as 'pending' | 'paid')
      if (req.query.from && req.query.to) {
        const fromDate = new Date(req.query.from)
        const toDate = new Date(req.query.to)
        totalQFiltered = totalQFiltered.where((eb) => eb.or([
          eb.and([eb('e.accrual_date', '>=', fromDate), eb('e.accrual_date', '<=', toDate)]),
          eb.and([eb('e.payment_date', '>=', fromDate), eb('e.payment_date', '<=', toDate)])
        ]))
      } else {
        if (req.query.from) totalQFiltered = totalQFiltered.where((eb) => eb.or([eb('e.accrual_date', '>=', new Date(req.query.from!)), eb('e.payment_date', '>=', new Date(req.query.from!))]))
        if (req.query.to) totalQFiltered = totalQFiltered.where((eb) => eb.or([eb('e.accrual_date', '<=', new Date(req.query.to!)), eb('e.payment_date', '<=', new Date(req.query.to!))]))
      }
      if (req.query.is_dividend === 'true') totalQFiltered = totalQFiltered.where('e.is_dividend', '=', true)
      if (req.query.is_dividend === 'false') totalQFiltered = totalQFiltered.where('e.is_dividend', '=', false)

      const [data, totals] = await Promise.all([
        q.orderBy('e.accrual_date', 'desc').orderBy('e.created_at', 'desc').limit(limit).offset(offset).execute(),
        totalQFiltered.executeTakeFirst(),
      ])

      // ── Merge salary_transactions when include_salary=true ──────────────
      let mergedData = data as any[]
      let salaryCount = 0
      let salaryAmount = 0

      if (includeSalary) {
        // Check if filtering by a specific category
        const filterCatId = req.query.category_id
        let shouldIncludeSalary = true

        if (filterCatId) {
          // Only include salary records when filtering by the "Зарплата" category
          const salaryCat = await db.selectFrom('expense_categories')
            .select(['id', 'parent_id'])
            .where('name', '=', 'Зарплата')
            .executeTakeFirst()
          // Include if filterCatId matches the salary category or its parent
          shouldIncludeSalary = !!(salaryCat && (
            salaryCat.id === filterCatId ||
            salaryCat.parent_id === filterCatId
          ))
        }

        // Don't include salary when filtering for status=pending (salary is always paid)
        if (req.query.status === 'pending') shouldIncludeSalary = false

        if (shouldIncludeSalary) {
          // Look up the "Зарплата" category
          const salaryCat = await db.selectFrom('expense_categories')
            .select('id')
            .where('name', '=', 'Зарплата')
            .executeTakeFirst()

          let sq = db
            .selectFrom('salary_transactions as st')
            .innerJoin('staff as s', 's.id', 'st.staff_id')
            .leftJoin('accounts as ac', 'ac.id', 'st.account_id')
            .where('st.type', '=', 'PAYMENT')
            .where('st.is_deleted', '=', false)
            .select([
              'st.id', 'st.staff_id', 's.full_name as staff_name',
              'st.account_id', 'ac.name as account_name',
              'st.gross_amount', 'st.transaction_date',
              'st.note', 'st.is_dividend', 'st.created_at',
            ])

          if (req.query.account_id) sq = sq.where('st.account_id', '=', req.query.account_id)
          if (req.query.from) sq = sq.where('st.transaction_date', '>=', new Date(req.query.from))
          if (req.query.to) sq = sq.where('st.transaction_date', '<=', new Date(req.query.to))
          if (req.query.is_dividend === 'true') sq = sq.where('st.is_dividend', '=', true)
          if (req.query.is_dividend === 'false') sq = sq.where('st.is_dividend', '=', false)

          const salaryRows = await sq.orderBy('st.transaction_date', 'desc').execute()

          // Map salary rows to Expense-like shape
          const mappedSalary = salaryRows.map(sr => ({
            id:                      `salary:${sr.id}`,
            account_id:              sr.account_id,
            account_name:            sr.account_name ?? '—',
            category_id:             salaryCat?.id ?? null,
            category_name:           'Зарплата',
            parent_id:               null,
            parent_category_name:    null,
            amount:                  sr.gross_amount,
            accrual_date:            sr.transaction_date,
            payment_date:            sr.transaction_date,
            status:                  'paid' as const,
            is_instant:              true,
            is_dividend:             sr.is_dividend,
            note:                    sr.note ?? `Зарплата: ${sr.staff_name}`,
            created_at:              sr.created_at,
            withdrawal_transfer_id:  null,
            withdrawal_amount:       null,
            dividend_payout_id:      null,
            dividend_amount:         null,
            created_by_email:        null,
            is_advance:              false,
            is_advance_return:       false,
            staff_id:                sr.staff_id,
            staff_name:              sr.staff_name,
            utilized_advance_id:     null,
            utilized_advance_amount: null,
            advance_staff_id:        null,
            pool_advance_amount:     '0',
            utilized_advance_remaining_balance: null,
            _is_salary:              true,
          }))

          salaryCount = mappedSalary.length
          salaryAmount = mappedSalary.reduce((s, r) => s + Number(r.amount), 0)

          // Merge and sort by date desc
          mergedData = [...data, ...mappedSalary].sort((a: any, b: any) => {
            const dateA = new Date(a.accrual_date).getTime()
            const dateB = new Date(b.accrual_date).getTime()
            if (dateA !== dateB) return dateB - dateA
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          })
        }
      }

      return {
        data: mergedData,
        total: Number(totals?.count ?? 0) + salaryCount,
        total_amount: Number(totals?.total_amount ?? 0) + salaryAmount,
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
      is_advance?: boolean
      staff_id?: string
      utilized_advance_id?: string
      utilized_advance_amount?: number
      advance_staff_id?: string | null
    }
  }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const {
        account_id, category_id, amount, accrual_date, payment_date,
        is_instant = false, is_dividend = false, note,
        is_advance = false, staff_id,
        utilized_advance_id, utilized_advance_amount,
        advance_staff_id,
      } = req.body
      if (!account_id) return reply.status(400).send({ error: 'BadRequest', message: 'account_id є обовʼязковим' })
      if (!amount || amount <= 0) return reply.status(400).send({ error: 'BadRequest', message: 'Сума повинна бути більше 0' })

      const today = new Date().toISOString().slice(0, 10)
      const status = is_instant ? 'paid' : 'pending'
      const paidDate = is_instant ? (payment_date ?? accrual_date ?? today) : (payment_date ?? null)

      const row = await db.transaction().execute(async (trx) => {
        const expense = await trx.insertInto('expenses')
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
            is_advance,
            staff_id: staff_id ?? null,
            // Legacy single-advance link (backward compat)
            utilized_advance_id: (!advance_staff_id && utilized_advance_id) ? utilized_advance_id : null,
            utilized_advance_amount: (!advance_staff_id && utilized_advance_id) ? (utilized_advance_amount ?? null) : null,
            advance_staff_id: advance_staff_id ?? null,
          })
          .returningAll()
          .executeTakeFirstOrThrow()

        // FIFO pool deduction: find advances for this staff / category ordered by date, deduct in order
        // advance_staff_id === null  → "no-staff" pool (staff_id IS NULL), bound to category_id
        // advance_staff_id === uuid  → named-staff pool, can be used for any category
        // advance_staff_id === undefined → no pool selected, skip
        if (advance_staff_id !== undefined) {
          if (advance_staff_id === null && !category_id) {
            // Can't use category-bound advance without a category, skip
          } else {
            let poolQ = trx
              .selectFrom('expenses as e')
              .select(['e.id', 'e.amount'])
              .where('e.is_advance', '=', true)
              .where('e.is_deleted', '=', false)
              .orderBy('e.accrual_date', 'asc')

            if (advance_staff_id === null) {
              poolQ = poolQ
                .where('e.category_id', '=', category_id!)
                .where('e.staff_id', 'is', null)
            } else {
              poolQ = poolQ.where('e.staff_id', '=', advance_staff_id)
            }

            const poolAdvances = await poolQ.execute()

            let remaining = amount
            for (const adv of poolAdvances) {
              if (remaining <= 0) break

              const [oldSpentRes, newSpentRes, retRes] = await Promise.all([
                trx.selectFrom('expenses')
                  .select((eb) => eb.fn.sum<string>('utilized_advance_amount').as('spent'))
                  .where('utilized_advance_id', '=', adv.id)
                  .where('is_advance_return', '=', false)
                  .where('is_deleted', '=', false)
                  .executeTakeFirst(),
                trx.selectFrom('expense_advance_usages as u')
                  .innerJoin('expenses as e', 'e.id', 'u.expense_id')
                  .select((eb) => eb.fn.sum<string>('u.amount').as('spent'))
                  .where('u.advance_id', '=', adv.id)
                  .where('e.is_deleted', '=', false)
                  .executeTakeFirst(),
                trx.selectFrom('expenses')
                  .select((eb) => eb.fn.sum<string>('amount').as('returned'))
                  .where('utilized_advance_id', '=', adv.id)
                  .where('is_advance_return', '=', true)
                  .where('is_deleted', '=', false)
                  .executeTakeFirst(),
              ])

              const advRemaining = Number(adv.amount)
                - Number(oldSpentRes?.spent ?? 0)
                - Number(newSpentRes?.spent ?? 0)
                - Number(retRes?.returned ?? 0)

              if (advRemaining <= 0) continue

              const deduct = Math.min(remaining, advRemaining)
              await trx.insertInto('expense_advance_usages')
                .values({ expense_id: expense.id, advance_id: adv.id, amount: deduct })
                .execute()

              remaining = Math.round((remaining - deduct) * 100) / 100
            }
          }
        }

        return expense
      })

      return reply.status(201).send(row)
    }
  )

  // PUT /api/expenses/:id  — edit any expense (including paid), record audit diff
  app.put<{
    Params: { id: string }
    Body: { account_id?: string; category_id?: string | null; amount?: number; accrual_date?: string; payment_date?: string | null; note?: string | null; edit_note?: string }
  }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const expense = await db.selectFrom('expenses')
        .selectAll()
        .where('id', '=', req.params.id)
        .where('is_deleted', '=', false)
        .executeTakeFirst()
      if (!expense) return reply.status(404).send({ error: 'NotFound' })

      const { edit_note, ...fields } = req.body
      const editedBy = (req.user as { sub: string }).sub

      // Build only changed fields
      const tracked: Array<{ field_name: string; old_value: string | null; new_value: string | null }> = []
      for (const [key, newVal] of Object.entries(fields)) {
        const oldVal = (expense as Record<string, unknown>)[key]
        const oldStr = oldVal != null ? String(oldVal) : null
        const newStr = newVal != null ? String(newVal) : null
        if (oldStr !== newStr) {
          tracked.push({ field_name: key, old_value: oldStr, new_value: newStr })
        }
      }

      if (tracked.length === 0) {
        return expense  // nothing changed
      }

      const updated = await db.updateTable('expenses')
        .set(fields)
        .where('id', '=', req.params.id)
        .returningAll()
        .executeTakeFirstOrThrow()

      // Write audit records
      if (tracked.length > 0) {
        await db.insertInto('expense_edits')
          .values(tracked.map(t => ({
            expense_id: req.params.id,
            edited_by: editedBy,
            field_name: t.field_name,
            old_value: t.old_value,
            new_value: t.new_value,
            edit_note: edit_note ?? null,
          })))
          .execute()
      }

      return updated
    }
  )

  // GET /api/expenses/:id/edits  — audit history for an expense
  app.get<{ Params: { id: string } }>(
    '/:id/edits',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const edits = await db
        .selectFrom('expense_edits as ee')
        .leftJoin('users as u', 'u.id', 'ee.edited_by')
        .select([
          'ee.id', 'ee.field_name', 'ee.old_value', 'ee.new_value',
          'ee.edit_note', 'ee.edited_at',
          'u.email as editor_email',
        ])
        .where('ee.expense_id', '=', req.params.id)
        .orderBy('ee.edited_at', 'desc')
        .execute()
      return edits
    }
  )

  // GET /api/expenses/advances?category_id=UUID
  // Returns advance pools grouped by staff_id, with FIFO-ordered individual advances inside.
  // category_id is optional; when omitted, returns all active pools across all categories.
  app.get<{ Querystring: { category_id?: string } }>(
    '/advances',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const { category_id } = req.query

      let q = db
        .selectFrom('expenses as e')
        .leftJoin('staff as s', 's.id', 'e.staff_id')
        .leftJoin('expense_categories as c', 'c.id', 'e.category_id')
        .select(['e.id', 'e.amount', 'e.staff_id', 's.full_name as staff_name', 'e.accrual_date', 'c.name as category_name'])
        .where('e.is_advance', '=', true)
        .where('e.is_deleted', '=', false)
        .orderBy('e.accrual_date', 'asc')

      if (category_id !== undefined) {
        if (category_id && category_id.trim() !== '') {
          q = q.where((eb) =>
            eb.or([
              eb('e.category_id', '=', category_id),
              eb('e.staff_id', 'is not', null)
            ])
          )
        } else {
          // If category_id is present but empty, only fetch staff-bound advances
          q = q.where('e.staff_id', 'is not', null)
        }
      }

      const advances = await q.execute()

      // Calculate remaining balance per individual advance (backward-compatible: checks both
      // old utilized_advance_id link and new expense_advance_usages table)
      const advancesWithBalance = []
      for (const adv of advances) {
        const [oldSpentRes, newSpentRes, retRes] = await Promise.all([
          db.selectFrom('expenses')
            .select((eb) => eb.fn.sum<string>('utilized_advance_amount').as('spent'))
            .where('utilized_advance_id', '=', adv.id)
            .where('is_advance_return', '=', false)
            .where('is_deleted', '=', false)
            .executeTakeFirst(),
          db.selectFrom('expense_advance_usages as u')
            .innerJoin('expenses as e', 'e.id', 'u.expense_id')
            .select((eb) => eb.fn.sum<string>('u.amount').as('spent'))
            .where('u.advance_id', '=', adv.id)
            .where('e.is_deleted', '=', false)
            .executeTakeFirst(),
          db.selectFrom('expenses')
            .select((eb) => eb.fn.sum<string>('amount').as('returned'))
            .where('utilized_advance_id', '=', adv.id)
            .where('is_advance_return', '=', true)
            .where('is_deleted', '=', false)
            .executeTakeFirst(),
        ])

        const remaining = Number(adv.amount)
          - Number(oldSpentRes?.spent ?? 0)
          - Number(newSpentRes?.spent ?? 0)
          - Number(retRes?.returned ?? 0)

        advancesWithBalance.push({ ...adv, remaining_balance: Math.round(remaining * 100) / 100 })
      }

      // Group by staff_id if staff_id is set (all their advances in one pool),
      // otherwise by category_name if staff_id is null.
      const poolMap = new Map<string, {
        staff_id: string | null
        staff_name: string | null
        category_name: string | null
        remaining_balance: number
        advances: typeof advancesWithBalance
      }>()

      for (const adv of advancesWithBalance) {
        const key = adv.staff_id
          ? `staff::${adv.staff_id}`
          : `cat::${adv.category_name ?? '__no_cat__'}`
        if (!poolMap.has(key)) {
          poolMap.set(key, {
            staff_id: adv.staff_id,
            staff_name: adv.staff_id ? adv.staff_name : null,
            category_name: adv.staff_id ? null : (adv.category_name ?? null),
            remaining_balance: 0,
            advances: []
          })
        }
        const pool = poolMap.get(key)!
        pool.advances.push(adv)
        pool.remaining_balance = Math.round((pool.remaining_balance + adv.remaining_balance) * 100) / 100
      }

      // Only return pools with positive total balance
      return Array.from(poolMap.values()).filter(p => p.remaining_balance > 0)
    }
  )

  // POST /api/expenses/:id/return-advance
  app.post<{ Params: { id: string }; Body: { amount: number; account_id: string; date?: string; note?: string } }>(
    '/:id/return-advance',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const { id } = req.params
      const { amount, account_id, date, note } = req.body
      if (!account_id || !amount || amount <= 0) return reply.status(400).send({ error: 'BadRequest', message: 'Неправильні дані' })

      const advance = await db.selectFrom('expenses').select('category_id').where('id', '=', id).executeTakeFirst()
      if (!advance) return reply.status(404).send({ error: 'NotFound' })

      const returnDate = date ?? new Date().toISOString().slice(0, 10)
      const row = await db.insertInto('expenses').values({
        account_id, category_id: advance.category_id, amount, accrual_date: returnDate, payment_date: returnDate,
        status: 'paid', is_instant: true, is_advance_return: true, utilized_advance_id: id,
        note: note || 'Повернення невикористаного залишку авансу', created_by: req.user.sub
      }).returningAll().executeTakeFirstOrThrow()

      return reply.status(201).send(row)
    }
  )

  // DELETE /api/expenses/:id — soft delete
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const expense = await db.selectFrom('expenses').select(['id', 'dividend_payout_id', 'withdrawal_transfer_id', 'note']).where('id', '=', req.params.id).where('is_deleted', '=', false).executeTakeFirst()
      if (!expense) return reply.status(404).send({ error: 'NotFound' })

      await db.transaction().execute(async (trx) => {
        // Soft delete the linked dividend payout if exists
        if (expense.dividend_payout_id) {
          await trx.updateTable('dividend_payouts')
            .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.sub })
            .where('id', '=', expense.dividend_payout_id)
            .execute()
        }

        // Cleanup withdrawal side effects
        if (expense.withdrawal_transfer_id) {
          const transfer = await trx.selectFrom('account_transfers')
            .select(['to_account_id'])
            .where('id', '=', expense.withdrawal_transfer_id)
            .executeTakeFirst()

          if (transfer) {
            const expectedNotePrefix = `% за вывод ${expense.note ?? expense.id}`
            await trx.updateTable('expenses')
              .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.sub })
              .where('account_id', '=', transfer.to_account_id)
              .where('note', 'like', `${expectedNotePrefix}%`)
              .where('is_deleted', '=', false)
              .execute()
          }

          await trx.deleteFrom('account_transfers')
            .where('id', '=', expense.withdrawal_transfer_id)
            .execute()
        }

        // Soft delete the expense itself
        await trx.updateTable('expenses')
          .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.sub })
          .where('id', '=', req.params.id)
          .execute()
      })

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

  // POST /api/expenses/:id/withdraw — cash-out (full or partial) to target account
  app.post<{
    Params: { id: string }
    Body: { target_account_id: string; withdrawal_amount?: number; commission: number; transfer_date?: string }
  }>(
    '/:id/withdraw',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { target_account_id, transfer_date } = req.body
      const commissionPct = Number(req.body.commission)
      const expenseTotal = await db.selectFrom('expenses')
        .select(['id', 'account_id', 'amount', 'note', 'is_deleted', 'withdrawal_transfer_id'])
        .where('id', '=', req.params.id)
        .executeTakeFirst()

      if (!expenseTotal || expenseTotal.is_deleted) return reply.status(404).send({ error: 'NotFound' })
      const expense = expenseTotal

      if (!target_account_id) {
        return reply.status(400).send({ error: 'BadRequest', message: 'target_account_id є обовʼязковим' })
      }
      if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Комісія має бути від 0 до 100 %' })
      }

      if (expense.withdrawal_transfer_id) {
        return reply.status(409).send({ error: 'AlreadyWithdrawn', message: 'Обналичування вже було виконано' })
      }

      const maxAmount = parseFloat(expense.amount as string)
      const withdrawalAmount = req.body.withdrawal_amount != null
        ? Number(req.body.withdrawal_amount)
        : maxAmount

      if (!Number.isFinite(withdrawalAmount) || withdrawalAmount <= 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Сума виводу має бути більше 0' })
      }
      if (withdrawalAmount > maxAmount + 0.001) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Сума виводу не може перевищувати суму витрати' })
      }

      const roundedCommission = Math.round(withdrawalAmount * commissionPct * 100) / 10000
      if (roundedCommission >= withdrawalAmount) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Комісія не може перевищувати суму виводу' })
      }

      const dateStr = transfer_date ?? new Date().toISOString().slice(0, 10)

      const withdrawalCategory = await db.selectFrom('expense_categories')
        .select('id')
        .where('name', '=', 'Вивід коштів')
        .executeTakeFirst()
      const categoryId = withdrawalCategory ? withdrawalCategory.id : null

      const transfer = await db.insertInto('account_transfers')
        .values({
          from_account_id: expense.account_id,
          to_account_id: target_account_id,
          amount: withdrawalAmount,
          commission: 0,
          transfer_date: dateStr,
          note: `Обналичування: ${expense.note ?? expense.id}`,
          created_by: req.user.sub,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      let commissionExpense = null
      if (roundedCommission > 0) {
        commissionExpense = await db.insertInto('expenses')
          .values({
            account_id: target_account_id,
            category_id: categoryId,
            amount: roundedCommission,
            accrual_date: dateStr,
            payment_date: dateStr,
            status: 'paid',
            is_instant: true,
            is_dividend: false,
            note: `% за вывод ${expense.note ?? expense.id}`,
            created_by: req.user.sub,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
      }

      await db.updateTable('expenses')
        .set({
          withdrawal_transfer_id: transfer.id,
          withdrawal_amount: withdrawalAmount,
        })
        .where('id', '=', req.params.id)
        .execute()

      return reply.status(201).send({
        ok: true,
        transfer,
        withdrawal_amount: withdrawalAmount,
        commission_amount: roundedCommission,
        commission_expense: commissionExpense,
      })
    }
  )

  // GET /api/expenses/:id/withdrawal — fetch current withdrawal info
  app.get<{ Params: { id: string } }>(
    '/:id/withdrawal',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const expense = await db.selectFrom('expenses')
        .select(['id', 'account_id', 'amount', 'note', 'withdrawal_transfer_id', 'withdrawal_amount'])
        .where('id', '=', req.params.id)
        .where('is_deleted', '=', false)
        .executeTakeFirst()

      if (!expense || !expense.withdrawal_transfer_id) {
        return reply.status(404).send({ error: 'NotFound', message: 'Обналичування не знайдено' })
      }

      const transfer = await db.selectFrom('account_transfers')
        .select(['id', 'from_account_id', 'to_account_id', 'amount', 'transfer_date'])
        .where('id', '=', expense.withdrawal_transfer_id)
        .executeTakeFirst()

      if (!transfer) {
        return reply.status(404).send({ error: 'NotFound', message: 'Переказ не знайдено' })
      }

      const withdrawalCategory = await db.selectFrom('expense_categories')
        .select('id')
        .where('name', '=', 'Вивід коштів')
        .executeTakeFirst()

      let commissionExpense = null
      if (withdrawalCategory) {
        commissionExpense = await db.selectFrom('expenses')
          .select(['id', 'amount'])
          .where('account_id', '=', transfer.to_account_id)
          .where('category_id', '=', withdrawalCategory.id)
          .where('accrual_date', '=', transfer.transfer_date)
          .where('note', 'like', `% за вывод %`)
          .where('is_deleted', '=', false)
          .executeTakeFirst()
      }

      const withdrawalAmount = Number(transfer.amount)
      const commissionAmount = commissionExpense ? Number(commissionExpense.amount) : 0
      const commissionPct = withdrawalAmount > 0 ? Math.round((commissionAmount / withdrawalAmount) * 10000) / 100 : 0

      return reply.send({
        target_account_id: transfer.to_account_id,
        withdrawal_amount: withdrawalAmount,
        commission: commissionPct,
        commission_amount: commissionAmount,
        transfer_date: String(transfer.transfer_date).slice(0, 10),
      })
    }
  )

  // PUT /api/expenses/:id/withdraw — edit an existing cash-out (withdrawal)
  app.put<{
    Params: { id: string }
    Body: { target_account_id: string; withdrawal_amount?: number; commission: number; transfer_date?: string }
  }>(
    '/:id/withdraw',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { target_account_id, transfer_date } = req.body
      const commissionPct = Number(req.body.commission)

      const expense = await db.selectFrom('expenses')
        .select(['id', 'account_id', 'amount', 'note', 'is_deleted', 'withdrawal_transfer_id'])
        .where('id', '=', req.params.id)
        .where('is_deleted', '=', false)
        .executeTakeFirst()

      if (!expense) return reply.status(404).send({ error: 'NotFound' })
      if (!expense.withdrawal_transfer_id) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Обналичування ще не створено' })
      }

      if (!target_account_id) {
        return reply.status(400).send({ error: 'BadRequest', message: 'target_account_id є обовʼязковим' })
      }
      if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Комісія має бути від 0 до 100 %' })
      }

      const maxAmount = parseFloat(expense.amount as string)
      const withdrawalAmount = req.body.withdrawal_amount != null
        ? Number(req.body.withdrawal_amount)
        : maxAmount

      if (!Number.isFinite(withdrawalAmount) || withdrawalAmount <= 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Сума виводу має бути більше 0' })
      }
      if (withdrawalAmount > maxAmount + 0.001) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Сума виводу не може перевищувати суму витрати' })
      }

      const roundedCommission = Math.round(withdrawalAmount * commissionPct * 100) / 10000
      if (roundedCommission >= withdrawalAmount) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Комісія не може перевищувати суму виводу' })
      }

      const dateStr = transfer_date ?? new Date().toISOString().slice(0, 10)

      const withdrawalCategory = await db.selectFrom('expense_categories')
        .select('id')
        .where('name', '=', 'Вивід коштів')
        .executeTakeFirst()
      const categoryId = withdrawalCategory ? withdrawalCategory.id : null

      await db.transaction().execute(async (trx) => {
        const transfer = await trx.selectFrom('account_transfers')
          .select(['id', 'to_account_id', 'transfer_date'])
          .where('id', '=', expense.withdrawal_transfer_id!)
          .executeTakeFirst()

        if (transfer) {
          await trx.updateTable('account_transfers')
            .set({
              from_account_id: expense.account_id,
              to_account_id: target_account_id,
              amount: withdrawalAmount,
              transfer_date: dateStr,
              note: `Обналичування: ${expense.note ?? expense.id}`,
            })
            .where('id', '=', transfer.id)
            .execute()

          let existingCommission = null
          if (categoryId) {
            existingCommission = await trx.selectFrom('expenses')
              .select(['id'])
              .where('account_id', '=', transfer.to_account_id)
              .where('category_id', '=', categoryId)
              .where('accrual_date', '=', transfer.transfer_date)
              .where('note', 'like', `% за вывод %`)
              .where('is_deleted', '=', false)
              .executeTakeFirst()
          }

          const label = expense.note ?? expense.id
          if (roundedCommission > 0) {
            if (existingCommission) {
              await trx.updateTable('expenses')
                .set({
                  account_id: target_account_id,
                  amount: roundedCommission,
                  accrual_date: dateStr,
                  payment_date: dateStr,
                  note: `% за вывод ${label}`,
                })
                .where('id', '=', existingCommission.id)
                .execute()
            } else {
              await trx.insertInto('expenses')
                .values({
                  account_id: target_account_id,
                  category_id: categoryId,
                  amount: roundedCommission,
                  accrual_date: dateStr,
                  payment_date: dateStr,
                  status: 'paid',
                  is_instant: true,
                  is_dividend: false,
                  note: `% за вывод ${label}`,
                  created_by: req.user.sub,
                })
                .execute()
            }
          } else if (existingCommission) {
            await trx.updateTable('expenses')
              .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.sub })
              .where('id', '=', existingCommission.id)
              .execute()
          }
        }

        await trx.updateTable('expenses')
          .set({ withdrawal_amount: withdrawalAmount })
          .where('id', '=', expense.id)
          .execute()
      })

      return reply.send({ ok: true })
    }
  )

  // DELETE /api/expenses/:id/withdraw — cancel/delete an existing cash-out (withdrawal)
  app.delete<{ Params: { id: string } }>(
    '/:id/withdraw',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const expense = await db.selectFrom('expenses')
        .select(['id', 'withdrawal_transfer_id'])
        .where('id', '=', req.params.id)
        .where('is_deleted', '=', false)
        .executeTakeFirst()

      if (!expense || !expense.withdrawal_transfer_id) {
        return reply.status(404).send({ error: 'NotFound', message: 'Обналичування не знайдено' })
      }

      await db.transaction().execute(async (trx) => {
        const transfer = await trx.selectFrom('account_transfers')
          .select(['id', 'to_account_id', 'transfer_date'])
          .where('id', '=', expense.withdrawal_transfer_id!)
          .executeTakeFirst()

        if (transfer) {
          await trx.updateTable('expenses')
            .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.sub })
            .where('account_id', '=', transfer.to_account_id)
            .where('accrual_date', '=', transfer.transfer_date)
            .where('note', 'like', `% за вывод %`)
            .where('is_deleted', '=', false)
            .execute()

          await trx.deleteFrom('account_transfers')
            .where('id', '=', transfer.id)
            .execute()
        }

        await trx.updateTable('expenses')
          .set({ withdrawal_transfer_id: null, withdrawal_amount: null })
          .where('id', '=', expense.id)
          .execute()
      })

      return reply.send({ ok: true })
    }
  )

  // PUT /api/expenses/:id/dividend — set/clear is_dividend with optional partial amount (Owner only)
  app.put<{ Params: { id: string }; Body: { is_dividend: boolean; dividend_amount?: number | null } }>(
    '/:id/dividend',
    { preHandler: requireRole('owner') },
    async (req, reply) => {
      const { is_dividend, dividend_amount } = req.body

      const expense = await db.selectFrom('expenses')
        .select(['id', 'amount'])
        .where('id', '=', req.params.id)
        .where('is_deleted', '=', false)
        .executeTakeFirst()
      if (!expense) return reply.status(404).send({ error: 'NotFound' })

      if (is_dividend && dividend_amount != null) {
        const maxAmount = parseFloat(expense.amount as string)
        if (!Number.isFinite(dividend_amount) || dividend_amount <= 0) {
          return reply.status(400).send({ error: 'BadRequest', message: 'Сума дивіденду має бути більше 0' })
        }
        if (dividend_amount > maxAmount + 0.001) {
          return reply.status(400).send({ error: 'BadRequest', message: 'Сума дивіденду не може перевищувати суму витрати' })
        }
      }

      const updates: Record<string, unknown> = { is_dividend }
      if (!is_dividend) {
        updates.dividend_amount = null
      } else {
        updates.dividend_amount = dividend_amount != null ? dividend_amount : null
      }

      const updated = await db.updateTable('expenses')
        .set(updates)
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
          't.to_account_id', 'ta.name as to_account_name',
        ])

      if (req.query.account_id) {
        q = q.where((eb) => eb.or([
          eb('t.from_account_id', '=', req.query.account_id!),
          eb('t.to_account_id', '=', req.query.account_id!),
        ]))
      }
      if (req.query.from) q = q.where('t.transfer_date', '>=', new Date(req.query.from))
      if (req.query.to) q = q.where('t.transfer_date', '<=', new Date(req.query.to))

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
