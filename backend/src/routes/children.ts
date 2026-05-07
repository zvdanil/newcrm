import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'
import { recalcBalance, createTransaction } from '../services/balanceService.js'

export async function childrenRoutes(app: FastifyInstance) {
  // GET /api/children?search=&group_id=&is_active=&limit=&offset=
  app.get<{
    Querystring: {
      search?: string
      group_id?: string
      is_active?: string
      limit?: string
      offset?: string
    }
  }>(
    '/',
    { preHandler: authenticate },
    async (request) => {
      const limit = Math.min(Number(request.query.limit ?? 500), 500)
      const offset = Number(request.query.offset ?? 0)
      const search = request.query.search?.trim()
      const { group_id, is_active } = request.query

      // Parent видит только своих детей
      const role = request.user.role
      const userId = request.user.sub

      let query = db
        .selectFrom('children as c')
        .leftJoin('groups as g', 'g.id', 'c.group_id')
        .leftJoin('families as f', 'f.id', 'c.family_id')
        .select([
          'c.id', 'c.full_name', 'c.birth_date', 'c.is_active',
          'c.note', 'c.created_at',
          'g.id as group_id', 'g.name as group_name',
          'f.id as family_id', 'f.name as family_name',
        ])

      if (role === 'parent') {
        // Ограничиваем видимость: только дети семей, в которых состоит родитель
        const parentRow = await db
          .selectFrom('parents')
          .select('id')
          .where('user_id', '=', userId)
          .executeTakeFirst()

        if (!parentRow) return { data: [], total: 0, limit, offset }

        const familyIds = await db
          .selectFrom('family_members')
          .select('family_id')
          .where('parent_id', '=', parentRow.id)
          .execute()

        const ids = familyIds.map((r) => r.family_id)
        if (ids.length === 0) return { data: [], total: 0, limit, offset }

        query = query.where('c.family_id', 'in', ids)
      }

      if (search) {
        query = query.where('c.full_name', 'ilike', `%${search}%`)
      }

      if (group_id) {
        query = query.where('c.group_id', '=', group_id)
      }

      if (is_active !== undefined) {
        query = query.where('c.is_active', '=', is_active === 'true')
      }

      const [data, totalRow] = await Promise.all([
        query.orderBy('c.full_name', 'asc').limit(limit).offset(offset).execute(),
        query
          .clearSelect()
          .clearOrderBy()
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .executeTakeFirst(),
      ])

      return { data, total: Number(totalRow?.count ?? 0), limit, offset }
    }
  )

  // GET /api/children/:id
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const child = await db
        .selectFrom('children as c')
        .leftJoin('groups as g', 'g.id', 'c.group_id')
        .leftJoin('families as f', 'f.id', 'c.family_id')
        .leftJoin('parents as p', 'p.id', 'f.primary_parent_id')
        .select([
          'c.id', 'c.full_name', 'c.birth_date', 'c.is_active', 'c.note',
          'c.created_at', 'c.updated_at',
          'g.id as group_id', 'g.name as group_name',
          'f.id as family_id', 'f.name as family_name',
          'p.id as primary_parent_id', 'p.full_name as primary_parent_name',
          'p.phone as primary_parent_phone',
        ])
        .where('c.id', '=', request.params.id)
        .executeTakeFirst()

      if (!child) return reply.status(404).send({ error: 'NotFound' })

      // Parent: проверяем, что ребёнок принадлежит его семье
      if (request.user.role === 'parent') {
        const access = await db
          .selectFrom('parents as p')
          .innerJoin('family_members as fm', 'fm.parent_id', 'p.id')
          .where('p.user_id', '=', request.user.sub)
          .where('fm.family_id', '=', child.family_id ?? '')
          .executeTakeFirst()

        if (!access) return reply.status(403).send({ error: 'Forbidden' })
      }

      return child
    }
  )

  // POST /api/children
  app.post<{
    Body: {
      full_name: string
      birth_date?: string
      family_id?: string
      group_id?: string
      note?: string
    }
  }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (request, reply) => {
      const child = await db
        .insertInto('children')
        .values(request.body)
        .returningAll()
        .executeTakeFirstOrThrow()

      return reply.status(201).send(child)
    }
  )

  // PUT /api/children/:id
  app.put<{
    Params: { id: string }
    Body: {
      full_name?: string
      birth_date?: string
      family_id?: string
      group_id?: string
      is_active?: boolean
      note?: string
    }
  }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (request, reply) => {
      const updated = await db
        .updateTable('children')
        .set(request.body)
        .where('id', '=', request.params.id)
        .returningAll()
        .executeTakeFirst()

      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return updated
    }
  )

  // GET /api/children/:id/balance — balances per account
  app.get<{ Params: { id: string } }>(
    '/:id/balance',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params

      const child = await db
        .selectFrom('children')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst()
      if (!child) return reply.status(404).send({ error: 'NotFound' })

      // Показываем все счета из активных подписок ребёнка (даже если транзакций ещё нет → balance = 0)
      const balances = await db
        .selectFrom('enrollments as e')
        .innerJoin('accounts as a', 'a.id', 'e.account_id')
        .leftJoin('child_balances as cb', (join) =>
          join.onRef('cb.child_id', '=', 'e.child_id').onRef('cb.account_id', '=', 'e.account_id')
        )
        .select([
          'e.account_id',
          'a.name as account_name',
          (eb) => eb.fn.coalesce('cb.balance', eb.lit(0)).as('balance'),
          'cb.updated_at',
        ])
        .where('e.child_id', '=', id)
        .where('e.status', '!=', 'archived')
        .distinctOn(['e.account_id'])
        .orderBy('e.account_id')
        .orderBy('a.name')
        .execute()

      return balances
    }
  )

  // GET /api/children/:id/ledger?account_id=&from=&to=&limit=&offset=&include_deleted=
  app.get<{
    Params: { id: string }
    Querystring: { account_id?: string; from?: string; to?: string; limit?: string; offset?: string; include_deleted?: string }
  }>(
    '/:id/ledger',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params
      const limit = Math.min(Number(request.query.limit ?? 100), 500)
      const offset = Number(request.query.offset ?? 0)
      const { account_id, from, to, include_deleted } = request.query
      const showDeleted = include_deleted === 'true'

      const child = await db
        .selectFrom('children')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst()
      if (!child) return reply.status(404).send({ error: 'NotFound' })

      let query = db
        .selectFrom('transactions as t')
        .leftJoin('accounts as a',    'a.id',   't.account_id')
        .leftJoin('activities as act', 'act.id', 't.activity_id')
        .leftJoin('users as cu',       'cu.id',  't.created_by')
        .leftJoin('users as du',       'du.id',  't.deleted_by')
        .select([
          't.id', 't.type', 't.amount', 't.transaction_date', 't.billing_month',
          't.note', 't.is_deleted', 't.deleted_at', 't.created_at',
          't.account_id', 'a.name as account_name',
          't.activity_id', 'act.name as activity_name',
          't.enrollment_id', 't.metadata_json',
          'cu.email as created_by_email',
          'du.email as deleted_by_email',
        ])
        .where('t.child_id', '=', id)

      if (!showDeleted) {
        query = query.where('t.is_deleted', '=', false)
      }

      if (account_id) query = query.where('t.account_id', '=', account_id)
      if (from) query = query.where('t.transaction_date', '>=', new Date(from))
      if (to)   query = query.where('t.transaction_date', '<=', new Date(to))

      const [data, totalRow] = await Promise.all([
        query.orderBy('t.transaction_date', 'desc').orderBy('t.created_at', 'desc').limit(limit).offset(offset).execute(),
        query
          .clearSelect()
          .clearOrderBy()
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .executeTakeFirst(),
      ])

      return { data, total: Number(totalRow?.count ?? 0), limit, offset }
    }
  )

  // GET /api/children/:id/prices — individual prices & discounts per activity
  app.get<{ Params: { id: string } }>(
    '/:id/prices',
    { preHandler: authenticate },
    async (request, reply) => {
      const child = await db.selectFrom('children').select('id').where('id', '=', request.params.id).executeTakeFirst()
      if (!child) return reply.status(404).send({ error: 'NotFound' })

      return db
        .selectFrom('child_prices as cp')
        .innerJoin('activities as a', 'a.id', 'cp.activity_id')
        .select([
          'cp.id', 'cp.activity_id', 'a.name as activity_name',
          'cp.price', 'cp.discount_pct', 'cp.valid_from', 'cp.valid_to', 'cp.created_at',
        ])
        .where('cp.child_id', '=', request.params.id)
        .orderBy('a.name', 'asc')
        .orderBy('cp.valid_from', 'desc')
        .execute()
    }
  )

  // POST /api/children/:id/prices — set individual price or discount (SCD Type 2)
  app.post<{
    Params: { id: string }
    Body: { activity_id: string; price?: number | null; discount_pct?: number | null; valid_from?: string }
  }>(
    '/:id/prices',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params
      const { activity_id, price, discount_pct, valid_from } = request.body

      const hasPrice = price != null
      const hasDiscount = discount_pct != null
      if (hasPrice === hasDiscount) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Вкажіть або price, або discount_pct — не обидва і не порожньо' })
      }

      const from = valid_from ?? new Date().toISOString().slice(0, 10)

      await db.updateTable('child_prices').set({ valid_to: from })
        .where('child_id', '=', id).where('activity_id', '=', activity_id).where('valid_to', 'is', null).execute()

      const row = await db.insertInto('child_prices')
        .values({ child_id: id, activity_id, price: price ?? null, discount_pct: discount_pct ?? null, valid_from: from, valid_to: null })
        .returningAll().executeTakeFirstOrThrow()

      return reply.status(201).send(row)
    }
  )

  // DELETE /api/children/:id/prices/:priceId?valid_to=YYYY-MM-DD — close an individual price record
  app.delete<{ Params: { id: string; priceId: string }; Querystring: { valid_to?: string } }>(
    '/:id/prices/:priceId',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const validTo = request.query.valid_to ?? new Date().toISOString().slice(0, 10)
      await db.updateTable('child_prices').set({ valid_to: validTo })
        .where('id', '=', request.params.priceId).where('child_id', '=', request.params.id).where('valid_to', 'is', null).execute()
      return { ok: true }
    }
  )

  // GET /api/children/:id/global-discount — active global discount
  app.get<{ Params: { id: string } }>(
    '/:id/global-discount',
    { preHandler: authenticate },
    async (request) => {
      const today = new Date()
      const row = await db.selectFrom('child_global_discounts').selectAll()
        .where('child_id', '=', request.params.id)
        .where('valid_from', '<=', today)
        .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>=', today)]))
        .orderBy('valid_from', 'desc').executeTakeFirst()
      return row ?? null
    }
  )

  // POST /api/children/:id/global-discount — set global discount (SCD Type 2)
  app.post<{
    Params: { id: string }
    Body: { discount_pct: number; valid_from?: string }
  }>(
    '/:id/global-discount',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params
      const { discount_pct, valid_from } = request.body
      if (!discount_pct || discount_pct <= 0 || discount_pct > 100)
        return reply.status(400).send({ error: 'BadRequest', message: 'discount_pct має бути від 1 до 100' })

      const from = valid_from ?? new Date().toISOString().slice(0, 10)
      await db.updateTable('child_global_discounts').set({ valid_to: from })
        .where('child_id', '=', id).where('valid_to', 'is', null).execute()

      const row = await db.insertInto('child_global_discounts')
        .values({ child_id: id, discount_pct, valid_from: from, valid_to: null })
        .returningAll().executeTakeFirstOrThrow()
      return reply.status(201).send(row)
    }
  )

  // DELETE /api/children/:id/global-discount — remove active global discount
  app.delete<{ Params: { id: string } }>(
    '/:id/global-discount',
    { preHandler: requireRole('owner', 'admin') },
    async (_request, reply) => {
      await db.updateTable('child_global_discounts').set({ valid_to: new Date().toISOString().slice(0, 10) })
        .where('child_id', '=', _request.params.id).where('valid_to', 'is', null).execute()
      return { ok: true }
    }
  )

  // POST /api/children/:id/payment — зарегистрировать оплату
  // account_id        — счёт услуги (где числится долг ребёнка, закрывается PAYMENT)
  // payment_account_id — счёт зачисления (куда физически пришли деньги; если ≠ account_id → кросс-счётная оплата)
  app.post<{
    Params: { id: string }
    Body: { account_id: string; payment_account_id?: string; amount: number; transaction_date?: string; note?: string }
  }>(
    '/:id/payment',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params
      const { account_id, payment_account_id, amount, transaction_date, note } = request.body

      if (!amount || amount <= 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Сума повинна бути більше 0' })
      }

      const child = await db.selectFrom('children').select('id').where('id', '=', id).executeTakeFirst()
      if (!child) return reply.status(404).send({ error: 'NotFound' })

      const dateStr = transaction_date ?? new Date().toISOString().slice(0, 10)
      const payAccountId = payment_account_id ?? account_id
      const isCrossAccount = payAccountId !== account_id

      // PAYMENT closes debt on the service account
      const txId = await createTransaction({
        type: 'PAYMENT',
        child_id: id,
        account_id,
        amount,
        transaction_date: dateStr,
        note: note ?? null,
        created_by: request.user.sub,
        metadata_json: isCrossAccount ? { payment_account_id: payAccountId } : null,
      })

      // Cross-account: money physically landed on a different account → record imbalance
      if (isCrossAccount) {
        await db.insertInto('inter_account_imbalances').values({
          from_account_id: payAccountId,   // where money arrived
          to_account_id:   account_id,     // which account should receive from payAccount
          amount,
          transaction_id:  txId,
          note: note ?? null,
        }).execute()
      }

      return reply.status(201).send({ id: txId, cross_account: isCrossAccount })
    }
  )

  // GET /api/children/:id/imbalances — межсчётные дисбалансы по данному ребёнку (Owner/Admin)
  app.get<{ Params: { id: string } }>(
    '/:id/imbalances',
    { preHandler: requireRole('owner', 'admin') },
    async (request) => {
      return db
        .selectFrom('inter_account_imbalances as i')
        .innerJoin('accounts as fa', 'fa.id', 'i.from_account_id')
        .innerJoin('accounts as ta', 'ta.id', 'i.to_account_id')
        .select([
          'i.id', 'i.amount', 'i.note', 'i.created_at', 'i.resolved_at',
          'i.transaction_id',
          'fa.id as from_account_id', 'fa.name as from_account_name',
          'ta.id as to_account_id', 'ta.name as to_account_name',
        ])
        .where('i.transaction_id', 'in',
          db.selectFrom('transactions').select('id').where('child_id', '=', request.params.id)
        )
        .where('i.resolved_at', 'is', null)
        .orderBy('i.created_at', 'desc')
        .execute()
    }
  )

  // POST /api/children/:id/initial-balance — set opening balance (Owner only)
  app.post<{
    Params: { id: string }
    Body: { account_id: string; amount: number; note?: string }
  }>(
    '/:id/initial-balance',
    { preHandler: requireRole('owner') },
    async (request, reply) => {
      const { id } = request.params
      const { account_id, amount, note } = request.body

      const child = await db
        .selectFrom('children')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst()
      if (!child) return reply.status(404).send({ error: 'NotFound' })

      const row = await db
        .insertInto('initial_balances')
        .values({
          child_id: id,
          account_id,
          amount,
          note: note ?? null,
          created_by: request.user.sub,
        })
        .onConflict((oc) =>
          oc.columns(['child_id', 'account_id']).doUpdateSet({ amount, note: note ?? null })
        )
        .returningAll()
        .executeTakeFirstOrThrow()

      await recalcBalance(id, account_id)

      return reply.status(201).send(row)
    }
  )
}
