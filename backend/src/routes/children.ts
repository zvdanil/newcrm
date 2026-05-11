import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'
import { recalcBalance, createTransaction } from '../services/balanceService.js'
import { recalcStaffAccruals, recalcSmartStaffBenefit } from '../services/salaryService.js'
import { recalcActivityAccruals } from '../services/billingRunService.js'
import { recalcSmartBenefit } from '../services/smartTariffService.js'

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
        query = query.where((eb) => eb.or([
          eb('c.full_name', 'ilike', `%${search}%`),
          eb('c.note',      'ilike', `%${search}%`),
          eb('f.name',      'ilike', `%${search}%`),
        ]))
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

      const balances = await db
        .selectFrom('enrollments as e')
        .innerJoin('accounts as a', 'a.id', 'e.account_id')
        .leftJoin('child_balances as cb', (join) =>
          join.onRef('cb.child_id', '=', 'e.child_id').onRef('cb.account_id', '=', 'e.account_id')
        )
        .leftJoin('initial_balances as ib', (join) =>
          join.onRef('ib.child_id', '=', 'e.child_id').onRef('ib.account_id', '=', 'e.account_id')
        )
        .select([
          'e.account_id',
          'a.name as account_name',
          (eb) => eb.fn.coalesce('cb.balance', eb.lit(0)).as('balance'),
          (eb) => eb.fn.coalesce('ib.amount', eb.lit(0)).as('initial_balance'),
          'ib.note as initial_balance_note',
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

      // Immediately recalculate accruals for this child+activity from valid_from to current month
      const validFromDate = new Date(from)
      const now = new Date()
      if (validFromDate <= now) {
        const monthStart = new Date(validFromDate.getFullYear(), validFromDate.getMonth(), 1)
        const curMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        await recalcActivityAccruals(activity_id, monthStart, curMonthStart, request.user.sub, id)
      }

      return reply.status(201).send(row)
    }
  )

  // DELETE /api/children/:id/prices/:priceId?valid_to=YYYY-MM-DD — close an individual price record
  app.delete<{ Params: { id: string; priceId: string }; Querystring: { valid_to?: string } }>(
    '/:id/prices/:priceId',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const now = new Date()
      const validTo = request.query.valid_to
        ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

      const price = await db.selectFrom('child_prices').select('activity_id')
        .where('id', '=', request.params.priceId).where('child_id', '=', request.params.id).executeTakeFirst()

      await db.updateTable('child_prices').set({ valid_to: validTo })
        .where('id', '=', request.params.priceId).where('child_id', '=', request.params.id).where('valid_to', 'is', null).execute()

      if (price) {
        const validToDate = new Date(validTo)
        const curMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        const fromDate = new Date(validToDate.getFullYear(), validToDate.getMonth(), 1)
        if (fromDate <= curMonthStart) {
          await recalcActivityAccruals(price.activity_id, fromDate, curMonthStart, request.user.sub, request.params.id)
        }
      }

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

  // ─── Individual tariffs ────────────────────────────────────────────────────

  // GET /api/children/:id/individual-tariffs
  app.get<{ Params: { id: string } }>(
    '/:id/individual-tariffs',
    { preHandler: requireRole('owner', 'admin') },
    async (req) => {
      return db
        .selectFrom('child_individual_tariffs as cit')
        .leftJoin('child_smart_tariff_configs as csc', 'csc.individual_tariff_id', 'cit.id')
        .select([
          'cit.id', 'cit.activity_id', 'cit.tariff_type', 'cit.price',
          'cit.valid_from', 'cit.valid_to', 'cit.created_at',
          'csc.base_lessons', 'csc.l1_threshold_absences', 'csc.l1_threshold_fee',
          'csc.l2_max_refunds', 'csc.l2_refund_per_absence',
        ])
        .where('cit.child_id', '=', req.params.id)
        .orderBy('cit.valid_from', 'desc')
        .execute()
    }
  )

  // POST /api/children/:id/individual-tariffs
  app.post<{
    Params: { id: string }
    Body: {
      activity_id:           string
      tariff_type:           'monthly' | 'per_lesson' | 'smart'
      price:                 number
      valid_from:            string
      base_lessons?:         number
      l1_threshold_absences?: number | null
      l1_threshold_fee?:     number | null
      l2_max_refunds?:       number | null
      l2_refund_per_absence?: number | null
    }
  }>(
    '/:id/individual-tariffs',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { activity_id, tariff_type, price, valid_from, base_lessons, l1_threshold_absences, l1_threshold_fee, l2_max_refunds, l2_refund_per_absence } = req.body

      if (!activity_id || !tariff_type || price == null || !valid_from) {
        return reply.status(400).send({ error: 'BadRequest', message: 'activity_id, tariff_type, price, valid_from є обовʼязковими' })
      }

      // Close any existing active tariff for this child+activity
      await db.updateTable('child_individual_tariffs')
        .set({ valid_to: valid_from })
        .where('child_id', '=', req.params.id)
        .where('activity_id', '=', activity_id)
        .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', new Date(valid_from))]))
        .execute()

      const row = await db.insertInto('child_individual_tariffs')
        .values({ child_id: req.params.id, activity_id, tariff_type, price, valid_from, created_by: req.user.sub })
        .returningAll()
        .executeTakeFirstOrThrow()

      if (tariff_type === 'smart') {
        await db.insertInto('child_smart_tariff_configs')
          .values({
            individual_tariff_id:  row.id,
            base_lessons:          base_lessons ?? 0,
            l1_threshold_absences: l1_threshold_absences ?? null,
            l1_threshold_fee:      l1_threshold_fee ?? null,
            l2_max_refunds:        l2_max_refunds ?? null,
            l2_refund_per_absence: l2_refund_per_absence ?? null,
          })
          .execute()
      }

      // Immediately recalculate accruals for this child+activity from valid_from to current month
      const validFromDate = new Date(valid_from)
      const now = new Date()
      if (validFromDate <= now) {
        const monthStart = new Date(validFromDate.getFullYear(), validFromDate.getMonth(), 1)
        const curMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        await recalcActivityAccruals(activity_id, monthStart, curMonthStart, req.user.sub, req.params.id)

        // For smart individual tariffs, also recalculate the smart benefit REFUND for each affected month
        if (tariff_type === 'smart') {
          const enrollment = await db.selectFrom('enrollments').select('id')
            .where('child_id', '=', req.params.id).where('activity_id', '=', activity_id)
            .where('status', 'in', ['active', 'frozen']).executeTakeFirst()
          if (enrollment) {
            const cur = new Date(monthStart)
            while (cur <= curMonthStart) {
              const mStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-01`
              await recalcSmartBenefit(enrollment.id, mStr)
              cur.setMonth(cur.getMonth() + 1)
            }
          }
        }
      }

      return reply.status(201).send(row)
    }
  )

  // PUT /api/children/:id/individual-tariffs/:tariffId/smart-config
  app.put<{
    Params: { id: string; tariffId: string }
    Body: { base_lessons?: number; l1_threshold_absences?: number | null; l1_threshold_fee?: number | null; l2_max_refunds?: number | null; l2_refund_per_absence?: number | null }
  }>(
    '/:id/individual-tariffs/:tariffId/smart-config',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { base_lessons, l1_threshold_absences, l1_threshold_fee, l2_max_refunds, l2_refund_per_absence } = req.body

      await db.insertInto('child_smart_tariff_configs')
        .values({
          individual_tariff_id:  req.params.tariffId,
          base_lessons:          base_lessons ?? 0,
          l1_threshold_absences: l1_threshold_absences ?? null,
          l1_threshold_fee:      l1_threshold_fee ?? null,
          l2_max_refunds:        l2_max_refunds ?? null,
          l2_refund_per_absence: l2_refund_per_absence ?? null,
        })
        .onConflict((oc) => oc.column('individual_tariff_id').doUpdateSet({
          base_lessons:          base_lessons ?? 0,
          l1_threshold_absences: l1_threshold_absences ?? null,
          l1_threshold_fee:      l1_threshold_fee ?? null,
          l2_max_refunds:        l2_max_refunds ?? null,
          l2_refund_per_absence: l2_refund_per_absence ?? null,
          updated_at:            new Date().toISOString() as unknown as Date,
        }))
        .execute()

      return reply.send({ ok: true })
    }
  )

  // DELETE /api/children/:id/individual-tariffs/:tariffId — close tariff
  app.delete<{ Params: { id: string; tariffId: string }; Querystring: { valid_to?: string } }>(
    '/:id/individual-tariffs/:tariffId',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const now = new Date()
      // Default: first of current month — tariff stops from this billing period onwards
      const validTo = req.query.valid_to
        ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

      const tariff = await db.selectFrom('child_individual_tariffs')
        .select(['activity_id', 'tariff_type'])
        .where('id', '=', req.params.tariffId)
        .where('child_id', '=', req.params.id)
        .executeTakeFirst()

      await db.updateTable('child_individual_tariffs')
        .set({ valid_to: validTo })
        .where('id', '=', req.params.tariffId)
        .where('child_id', '=', req.params.id)
        .execute()

      if (tariff) {
        const validToDate = new Date(validTo)
        const curMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        const fromDate = new Date(validToDate.getFullYear(), validToDate.getMonth(), 1)
        if (fromDate <= curMonthStart) {
          await recalcActivityAccruals(tariff.activity_id, fromDate, curMonthStart, req.user.sub, req.params.id)

          if (tariff.tariff_type === 'smart') {
            const enrollment = await db.selectFrom('enrollments').select('id')
              .where('child_id', '=', req.params.id).where('activity_id', '=', tariff.activity_id)
              .where('status', 'in', ['active', 'frozen']).executeTakeFirst()
            if (enrollment) {
              const cur = new Date(fromDate)
              while (cur <= curMonthStart) {
                const mStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-01`
                await recalcSmartBenefit(enrollment.id, mStr)
                cur.setMonth(cur.getMonth() + 1)
              }
            }
          }
        }
      }

      return reply.status(204).send()
    }
  )

  // POST /api/children/:id/clear-month-accruals
  // Owner only. Cancels all accruals + refunds for a child+activity in a given month.
  // For per_lesson: also hard-deletes ALL attendance marks so recalc won't recreate them.
  app.post<{
    Params: { id: string }
    Body: { activity_id: string; billing_month: string; is_per_lesson: boolean; reason?: string }
  }>(
    '/:id/clear-month-accruals',
    { preHandler: requireRole('owner') },
    async (req, reply) => {
      const childId = req.params.id
      const { activity_id: activityId, billing_month, is_per_lesson: isPerLesson, reason } = req.body

      // Normalize billing_month: "2026-05-01" or "2026-05-01T00:00:00.000Z" → "2026-05-01"
      const parts = billing_month.split('-')
      const y = Number(parts[0])
      const m = Number(parts[1])
      const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
      const lastDay    = new Date(y, m, 0).getDate()
      const monthEnd   = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

      // Include archived enrollments — child may have been unenrolled but accruals still exist
      const enrollment = await db
        .selectFrom('enrollments')
        .select(['id', 'account_id'])
        .where('child_id', '=', childId)
        .where('activity_id', '=', activityId)
        .orderBy(sql`CASE status WHEN 'active' THEN 0 WHEN 'frozen' THEN 1 ELSE 2 END`, 'asc')
        .executeTakeFirst()

      if (!enrollment) return reply.status(404).send({ error: 'EnrollmentNotFound' })

      const softDeleteSet = {
        is_deleted: true as const,
        deleted_at: new Date().toISOString(),
        deleted_by: (req.user as { sub: string }).sub,
      } as const

      const startDate = new Date(monthStart)
      const endDate   = new Date(monthEnd)

      if (isPerLesson) {
        // Hard-delete ALL attendance marks for this enrollment in the month (any status)
        const logs = await db
          .selectFrom('attendance_logs')
          .select(['id', 'date'])
          .where('enrollment_id', '=', enrollment.id)
          .where('date', '>=', startDate)
          .where('date', '<=', endDate)
          .execute()

        const dates = new Set<string>()
        for (const log of logs) {
          const d = log.date as Date
          dates.add(d.toISOString().slice(0, 10))
          await db.deleteFrom('attendance_logs').where('id', '=', log.id).execute()
        }

        // Soft-delete all per_lesson ACCRUALs in the month
        await db.updateTable('transactions').set(softDeleteSet)
          .where('enrollment_id', '=', enrollment.id)
          .where('type', '=', 'ACCRUAL')
          .where('is_deleted', '=', false)
          .where('billing_month', 'is', null)
          .where('transaction_date', '>=', startDate)
          .where('transaction_date', '<=', endDate)
          .execute()

        // Soft-delete REFUNDs in the month (except smart_benefit)
        await db.updateTable('transactions').set(softDeleteSet)
          .where('enrollment_id', '=', enrollment.id)
          .where('type', '=', 'REFUND')
          .where('is_deleted', '=', false)
          .where('transaction_date', '>=', startDate)
          .where('transaction_date', '<=', endDate)
          .where(sql`metadata_json->>'source'`, 'is', null)
          .execute()
        await db.updateTable('transactions').set(softDeleteSet)
          .where('enrollment_id', '=', enrollment.id)
          .where('type', '=', 'REFUND')
          .where('is_deleted', '=', false)
          .where('transaction_date', '>=', startDate)
          .where('transaction_date', '<=', endDate)
          .where(sql`metadata_json->>'source'`, '!=', 'smart_benefit')
          .execute()

        // Recalculate staff salary for each deleted lesson date
        const smartRates = await db
          .selectFrom('staff_rates')
          .select('id')
          .where('activity_id', '=', activityId)
          .where('rate_type', '=', 'smart')
          .where('rate_category', '=', 'auto')
          .execute()

        for (const dateStr of dates) {
          await recalcStaffAccruals(activityId, dateStr)
          for (const r of smartRates) {
            await recalcSmartStaffBenefit(r.id, monthStart)
          }
        }

      } else {
        // monthly / smart: soft-delete ACCRUAL + REFUNDs for this billing_month
        const noteAppend = reason ? ` [Скасовано: ${reason}]` : ''

        const existing = await db
          .selectFrom('transactions')
          .select(['id', 'note'])
          .where('enrollment_id', '=', enrollment.id)
          .where('type', '=', 'ACCRUAL')
          .where('is_deleted', '=', false)
          .where('billing_month', '=', startDate)
          .executeTakeFirst()

        if (existing) {
          await db.updateTable('transactions')
            .set({ ...softDeleteSet, note: ((existing.note ?? '') + noteAppend).trim() || null })
            .where('id', '=', existing.id)
            .execute()
        }

        // Soft-delete REFUNDs for this billing_month (except smart_benefit)
        await db.updateTable('transactions').set(softDeleteSet)
          .where('enrollment_id', '=', enrollment.id)
          .where('type', '=', 'REFUND')
          .where('is_deleted', '=', false)
          .where('transaction_date', '>=', startDate)
          .where('transaction_date', '<=', endDate)
          .where(sql`metadata_json->>'source'`, 'is', null)
          .execute()
        await db.updateTable('transactions').set(softDeleteSet)
          .where('enrollment_id', '=', enrollment.id)
          .where('type', '=', 'REFUND')
          .where('is_deleted', '=', false)
          .where('transaction_date', '>=', startDate)
          .where('transaction_date', '<=', endDate)
          .where(sql`metadata_json->>'source'`, '!=', 'smart_benefit')
          .execute()
      }

      await recalcBalance(childId, enrollment.account_id)
      return { ok: true }
    }
  )
}
