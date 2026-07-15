import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'
import { toDbDateStr, castAsDate } from '../services/dateUtils.js'
import { recalcBalance, createTransaction } from '../services/balanceService.js'
import { recalcStaffAccruals, recalcSmartStaffBenefit } from '../services/salaryService.js'
import { recalcActivityAccruals, recalcForIndividualTariff, getChildIndividualTariff, getEffectivePrice } from '../services/billingRunService.js'
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
        const parentRow = await db
          .selectFrom('parents')
          .select('id')
          .where('user_id', '=', userId)
          .executeTakeFirst()

        if (!parentRow) return { data: [], total: 0, limit, offset }

        // Direct child→parent links (new)
        const directLinks = await db
          .selectFrom('child_parents')
          .select('child_id')
          .where('parent_id', '=', parentRow.id)
          .execute()
        const directChildIds = directLinks.map((r) => r.child_id)

        // Fallback: via family_members (backward compat)
        const familyIds = await db
          .selectFrom('family_members')
          .select('family_id')
          .where('parent_id', '=', parentRow.id)
          .execute()
        const fids = familyIds.map((r) => r.family_id)

        if (directChildIds.length === 0 && fids.length === 0) return { data: [], total: 0, limit, offset }

        query = query.where((eb) => {
          const conds = []
          if (directChildIds.length > 0) conds.push(eb('c.id', 'in', directChildIds))
          if (fids.length > 0) conds.push(eb('c.family_id', 'in', fids))
          return eb.or(conds)
        })
      }

      if (search) {
        query = query.where((eb) => eb.or([
          eb('c.full_name', 'ilike', `%${search}%`),
          eb('c.note',      'ilike', `%${search}%`),
          eb('f.name',      'ilike', `%${search}%`),
          eb.exists(
            eb.selectFrom('child_parents as cp')
              .innerJoin('parents as p', 'p.id', 'cp.parent_id')
              .select('p.id')
              .whereRef('cp.child_id', '=', 'c.id')
              .where((eb2) => eb2.or([
                eb2('p.full_name', 'ilike', `%${search}%`),
                eb2('p.phone',     'ilike', `%${search}%`),
                eb2('p.email',     'ilike', `%${search}%`),
              ]))
          )
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

      // Parent: check access via child_parents (new) or family_members (backward compat)
      if (request.user.role === 'parent') {
        const parentRow = await db
          .selectFrom('parents').select('id')
          .where('user_id', '=', request.user.sub)
          .executeTakeFirst()

        if (!parentRow) return reply.status(403).send({ error: 'Forbidden' })

        const directLink = await db.selectFrom('child_parents').select('child_id')
          .where('child_id', '=', request.params.id)
          .where('parent_id', '=', parentRow.id)
          .executeTakeFirst()

        if (!directLink) {
          const familyAccess = await db
            .selectFrom('parents as p')
            .innerJoin('family_members as fm', 'fm.parent_id', 'p.id')
            .where('p.user_id', '=', request.user.sub)
            .where('fm.family_id', '=', child.family_id ?? '')
            .executeTakeFirst()
          if (!familyAccess) return reply.status(403).send({ error: 'Forbidden' })
        }
      }

      const childParents = await db
        .selectFrom('child_parents as cp')
        .innerJoin('parents as p', 'p.id', 'cp.parent_id')
        .select(['cp.role', 'p.id', 'p.full_name', 'p.phone', 'p.email', 'p.edrpou', 'p.iban'])
        .where('cp.child_id', '=', request.params.id)
        .orderBy('p.full_name', 'asc')
        .execute()

      return { ...child, child_parents: childParents }
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
        .where((eb) => eb.or([
          eb('e.status', '!=', 'archived'),
          eb(eb.fn.coalesce(eb.ref('cb.balance'), eb.lit(0)), '!=', eb.lit(0)),
        ]))
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

      const past_debts: Record<string, number> = {}
      if (from) {
        const fromDateStr = toDbDateStr(from)

        // Get all child transactions (non-deleted)
        const allTxs = await db
          .selectFrom('transactions')
          .select(['account_id', 'type', 'amount', 'billing_month', 'transaction_date'])
          .where('child_id', '=', id)
          .where('is_deleted', '=', false)
          .orderBy('transaction_date', 'asc')
          .orderBy('created_at', 'asc')
          .execute()

        // Get all initial balances
        const allInits = await db
          .selectFrom('initial_balances')
          .select(['account_id', 'amount'])
          .where('child_id', '=', id)
          .execute()

        // Group by account
        const txsByAccount: Record<string, typeof allTxs> = {}
        for (const tx of allTxs) {
          txsByAccount[tx.account_id] ??= []
          txsByAccount[tx.account_id].push(tx)
        }

        const initsByAccount: Record<string, number> = {}
        for (const init of allInits) {
          initsByAccount[init.account_id] = parseFloat(init.amount as string)
        }

        // Calculate for each account
        const accountIds = new Set([...Object.keys(txsByAccount), ...Object.keys(initsByAccount)])
        for (const accId of accountIds) {
          const txs = txsByAccount[accId] ?? []
          const initAmt = initsByAccount[accId] ?? 0

          // Total credits: payments, refunds, positive initial balance
          let pool = txs
            .filter((t) => t.type === 'PAYMENT' || t.type === 'REFUND' || t.type === 'REVERSAL')
            .reduce((sum, t) => sum + parseFloat(t.amount as string), 0)

          if (initAmt > 0) pool += initAmt

          // Debits list: negative initial balance + ACCRUAL/ADJUSTMENT txs
          const debits: { amount: number; dateStr: string }[] = []
          if (initAmt < 0) {
            debits.push({ amount: Math.abs(initAmt), dateStr: '1970-01-01' }) // far past
          }

          for (const t of txs) {
            if (t.type === 'ACCRUAL' || t.type === 'ADJUSTMENT') {
              const dateVal = t.billing_month ? t.billing_month : t.transaction_date
              debits.push({ amount: parseFloat(t.amount as string), dateStr: toDbDateStr(dateVal) })
            }
          }

          // Sort debits by date (FIFO order)
          debits.sort((a, b) => a.dateStr.localeCompare(b.dateStr))

          // Allocate pool to debits
          let pastDebt = 0
          for (const deb of debits) {
            const isPast = deb.dateStr < fromDateStr
            if (pool >= deb.amount) {
              pool -= deb.amount
            } else {
              const remaining = deb.amount - pool
              pool = 0
              if (isPast) {
                pastDebt += remaining
              }
            }
          }

          if (pastDebt > 0) {
            past_debts[accId] = pastDebt
          }
        }
      }

      const [data, totalRow] = await Promise.all([
        query.orderBy('t.transaction_date', 'desc').orderBy('t.created_at', 'desc').limit(limit).offset(offset).execute(),
        query
          .clearSelect()
          .clearOrderBy()
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .executeTakeFirst(),
      ])

      return { data, total: Number(totalRow?.count ?? 0), limit, offset, past_debts }
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
        await recalcForIndividualTariff(req.params.id, activity_id, monthStart, curMonthStart, req.user.sub)

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

  // POST /api/children/:id/individual-tariffs/:tariffId/recalc — force-apply existing individual tariff
  app.post<{ Params: { id: string; tariffId: string } }>(
    '/:id/individual-tariffs/:tariffId/recalc',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const tariff = await db.selectFrom('child_individual_tariffs')
        .select(['activity_id', 'tariff_type', 'valid_from'])
        .where('id', '=', req.params.tariffId)
        .where('child_id', '=', req.params.id)
        .executeTakeFirst()

      if (!tariff) return reply.status(404).send({ error: 'NotFound' })

      const validFromDate = new Date(String(tariff.valid_from))
      const now = new Date()
      const monthStart = new Date(validFromDate.getFullYear(), validFromDate.getMonth(), 1)
      const curMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)

      await recalcForIndividualTariff(req.params.id, tariff.activity_id, monthStart, curMonthStart, req.user.sub)

      if (tariff.tariff_type === 'smart') {
        const enrollment = await db.selectFrom('enrollments').select('id')
          .where('child_id', '=', req.params.id).where('activity_id', '=', tariff.activity_id)
          .where('status', 'in', ['active', 'frozen']).executeTakeFirst()
        if (enrollment) {
          const cur2 = new Date(monthStart)
          while (cur2 <= curMonthStart) {
            const mStr = `${cur2.getFullYear()}-${String(cur2.getMonth() + 1).padStart(2, '0')}-01`
            await recalcSmartBenefit(enrollment.id, mStr)
            cur2.setMonth(cur2.getMonth() + 1)
          }
        }
      }

      return reply.send({ ok: true })
    }
  )

  // GET /api/children/:id/open-accruals?account_id=UUID
  // Returns accruals not yet fully covered by payments (FIFO), with remaining amounts.
  app.get<{ Params: { id: string }; Querystring: { account_id?: string } }>(
    '/:id/open-accruals',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params
      const { account_id } = request.query

      if (!account_id) return reply.status(400).send({ error: 'BadRequest', message: 'account_id is required' })

      const child = await db.selectFrom('children').select('id').where('id', '=', id).executeTakeFirst()
      if (!child) return reply.status(404).send({ error: 'NotFound' })

      const [accruals, creditRow] = await Promise.all([
        db.selectFrom('transactions as t')
          .leftJoin('activities as act', 'act.id', 't.activity_id')
          .select(['t.id', 't.amount', 't.transaction_date', 't.billing_month', 'act.name as activity_name'])
          .where('t.child_id', '=', id)
          .where('t.account_id', '=', account_id)
          .where('t.type', '=', 'ACCRUAL')
          .where('t.is_deleted', '=', false)
          .orderBy('t.transaction_date', 'asc')
          .orderBy('t.amount', 'desc')
          .execute(),
        db.selectFrom('transactions')
          .select((eb) => eb.fn.sum<string>('amount').as('total'))
          .where('child_id', '=', id)
          .where('account_id', '=', account_id)
          .where('type', 'in', ['PAYMENT', 'REFUND'])
          .where('is_deleted', '=', false)
          .executeTakeFirst(),
      ])

      const toDateStr = (v: unknown) => {
        if (!v) return null
        if (v instanceof Date) return v.toISOString().slice(0, 10)
        return String(v).slice(0, 10)
      }

      let pool = Number(creditRow?.total ?? 0)
      const result = []
      for (const acc of accruals) {
        const amount = Number(acc.amount)
        if (pool >= amount) { pool -= amount; continue }
        result.push({
          id: acc.id,
          transaction_date: toDateStr(acc.transaction_date)!,
          billing_month: toDateStr(acc.billing_month),
          activity_name: acc.activity_name ?? null,
          amount,
          remaining: amount - pool,
        })
        pool = 0
      }
      return result
    }
  )

  // POST /api/children/:id/parents — link a parent to this child
  app.post<{ Params: { id: string }; Body: { parent_id: string; role?: string | null } }>(
    '/:id/parents',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (req, reply) => {
      const child = await db.selectFrom('children').select('id').where('id', '=', req.params.id).executeTakeFirst()
      if (!child) return reply.status(404).send({ error: 'NotFound' })

      const parent = await db.selectFrom('parents').select('id').where('id', '=', req.body.parent_id).executeTakeFirst()
      if (!parent) return reply.status(404).send({ error: 'ParentNotFound' })

      await db.insertInto('child_parents')
        .values({ child_id: req.params.id, parent_id: req.body.parent_id, role: req.body.role ?? null })
        .onConflict((oc) => oc.columns(['child_id', 'parent_id']).doUpdateSet({ role: req.body.role ?? null }))
        .execute()

      return { ok: true }
    }
  )

  // GET /api/children/:id/parent-access — access status for each linked parent
  app.get<{ Params: { id: string } }>(
    '/:id/parent-access',
    { preHandler: requireRole('owner', 'admin') },
    async (req) => {
      const rows = await db
        .selectFrom('child_parents as cp')
        .innerJoin('parents as p', 'p.id', 'cp.parent_id')
        .leftJoin('users as u', 'u.parent_id', 'p.id')
        .select([
          'p.id as parent_id', 'p.full_name', 'p.email', 'p.phone',
          'u.id as user_id', 'u.is_active as user_is_active',
        ])
        .where('cp.child_id', '=', req.params.id)
        .orderBy('p.full_name', 'asc')
        .execute()

      // For each parent without active user, check for pending invite
      const result = await Promise.all(rows.map(async (r) => {
        let pending_invite_expires_at: string | null = null
        if (!r.user_id || !r.user_is_active) {
          const invite = await db
            .selectFrom('user_invites')
            .select('expires_at')
            .where('parent_id', '=', r.parent_id)
            .where('used_at', 'is', null)
            .orderBy('expires_at', 'desc')
            .executeTakeFirst()
          if (invite && new Date(String(invite.expires_at)) > new Date()) {
            pending_invite_expires_at = new Date(String(invite.expires_at)).toISOString()
          }
        }
        return {
          parent_id: r.parent_id,
          full_name: r.full_name,
          email: r.email,
          phone: r.phone,
          user_id: r.user_id ?? null,
          user_is_active: r.user_is_active ?? null,
          pending_invite_expires_at,
        }
      }))

      return result
    }
  )

  // POST /api/children/:id/parent-invite — create/renew invite for a linked parent
  app.post<{
    Params: { id: string }
    Body: { parent_id: string; email?: string }
  }>(
    '/:id/parent-invite',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { parent_id, email: emailOverride } = req.body

      // Verify parent is linked to this child
      const link = await db.selectFrom('child_parents')
        .select('child_id')
        .where('child_id', '=', req.params.id)
        .where('parent_id', '=', parent_id)
        .executeTakeFirst()
      if (!link) return reply.status(404).send({ error: 'ParentNotLinked' })

      const parent = await db.selectFrom('parents')
        .select(['id', 'email'])
        .where('id', '=', parent_id)
        .executeTakeFirst()
      if (!parent) return reply.status(404).send({ error: 'ParentNotFound' })

      const inviteEmail = emailOverride ?? parent.email ?? null

      // Check if user already active
      if (inviteEmail) {
        const existing = await db.selectFrom('users').select('id')
          .where('email', '=', inviteEmail.toLowerCase())
          .where('is_active', '=', true)
          .executeTakeFirst()
        if (existing) return reply.status(409).send({ error: 'EmailAlreadyExists', message: 'Користувач з таким email вже активний' })
      }

      // Expire old pending invites for this parent
      await db.updateTable('user_invites')
        .set({ used_at: new Date().toISOString() })
        .where('parent_id', '=', parent_id)
        .where('used_at', 'is', null)
        .execute()

      const token = (await import('node:crypto')).randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString()

      await db.insertInto('user_invites').values({
        token,
        email:      inviteEmail,
        role:       'parent',
        parent_id,
        invited_by: req.user.sub,
        type:       'invite',
        expires_at: expiresAt,
      }).execute()

      const frontendUrl = process.env.FRONTEND_URL ?? `${req.protocol}://${req.hostname}`
      return reply.status(201).send({ inviteUrl: `${frontendUrl}/invite/${token}` })
    }
  )

  // DELETE /api/children/:id/parents/:parentId — unlink a parent from this child
  app.delete<{ Params: { id: string; parentId: string } }>(
    '/:id/parents/:parentId',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (req, reply) => {
      await db.deleteFrom('child_parents')
        .where('child_id', '=', req.params.id)
        .where('parent_id', '=', req.params.parentId)
        .execute()
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

  // GET /api/children/:id/billing-forecast?month=YYYY-MM-01
  // Returns projected accruals (monthly/smart tariffs) for the given billing month.
  // balance_start = balance at end of previous month (all txns before monthStart).
  // expected_accruals = what the Billing Run will charge on the 1st.
  app.get<{ Params: { id: string }; Querystring: { month?: string } }>(
    '/:id/billing-forecast',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const childId = request.params.id

      const child = await db.selectFrom('children').select('id').where('id', '=', childId).executeTakeFirst()
      if (!child) return reply.status(404).send({ error: 'NotFound' })

      // Default: next calendar month
      const now = new Date()
      const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      const defaultMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}-01`
      const monthStr = request.query.month ?? defaultMonth

      const billingDate = new Date(monthStr)

      // All active/frozen enrollments with activity + account info
      const enrollments = await db
        .selectFrom('enrollments as e')
        .innerJoin('activities as act', 'act.id', 'e.activity_id')
        .innerJoin('accounts as acc', 'acc.id', 'e.account_id')
        .select([
          'e.id as enrollment_id', 'e.child_id', 'e.account_id', 'e.activity_id',
          'e.start_date', 'e.status',
          'act.name as activity_name', 'act.tariff_type as activity_tariff_type',
          'acc.name as account_name',
        ])
        .where('e.child_id', '=', childId)
        .where('e.status', 'in', ['active', 'frozen'])
        .execute()

      // All accounts relevant to this child (from balances + enrollments)
      const balanceAccounts = await db
        .selectFrom('child_balances as cb')
        .innerJoin('accounts as acc', 'acc.id', 'cb.account_id')
        .select(['cb.account_id', 'acc.name as account_name'])
        .where('cb.child_id', '=', childId)
        .execute()

      const accountMap = new Map<string, string>()
      for (const ba of balanceAccounts) accountMap.set(ba.account_id, ba.account_name)
      for (const e of enrollments) accountMap.set(e.account_id, e.account_name)

      if (accountMap.size === 0) return []

      // Billing run already done for this month? (per account)
      const runDoneRows = await db
        .selectFrom('transactions')
        .select('account_id')
        .where('child_id', '=', childId)
        .where('billing_month', '=', billingDate)
        .where('type', '=', 'ACCRUAL')
        .where('is_deleted', '=', false)
        .execute()
      const billingRunDoneAccounts = new Set(runDoneRows.map((r) => r.account_id))

      // Initial balances
      const initialBalances = await db
        .selectFrom('initial_balances')
        .select(['account_id', 'amount'])
        .where('child_id', '=', childId)
        .execute()
      const initBalMap = new Map<string, number>()
      for (const ib of initialBalances) initBalMap.set(ib.account_id, parseFloat(ib.amount as string))

      // All transactions before billing month start (for balance_start)
      const txBefore = await db
        .selectFrom('transactions')
        .select(['type', 'amount', 'account_id'])
        .where('child_id', '=', childId)
        .where('is_deleted', '=', false)
        .where('transaction_date', '<', castAsDate(monthStr))
        .execute()

      const balanceAtStart = new Map<string, number>()
      for (const tx of txBefore) {
        const cur = balanceAtStart.get(tx.account_id) ?? 0
        const amt = parseFloat(tx.amount as string)
        if (tx.type === 'PAYMENT' || tx.type === 'REFUND' || tx.type === 'REVERSAL') {
          balanceAtStart.set(tx.account_id, cur + amt)
        } else if (tx.type === 'ACCRUAL' || tx.type === 'ADJUSTMENT') {
          balanceAtStart.set(tx.account_id, cur - amt)
        }
      }
      for (const [accId, initAmt] of initBalMap) {
        balanceAtStart.set(accId, (balanceAtStart.get(accId) ?? 0) + initAmt)
      }

      // Build forecast per account
      const result = []

      for (const [accountId, accountName] of accountMap) {
        const balStart = Math.round((balanceAtStart.get(accountId) ?? 0) * 100) / 100

        const lines: Array<{
          enrollment_id: string
          activity_name: string
          expected_amount: number
          tariff_type: string
        }> = []

        const accountEnrollments = enrollments.filter((e) => e.account_id === accountId)

        for (const e of accountEnrollments) {
          // Billing run skips frozen and enrollments starting after the 1st
          if (e.status === 'frozen') continue
          const startDate = new Date(String(e.start_date))
          if (startDate > billingDate) continue

          const ind = await getChildIndividualTariff(e.child_id, e.activity_id, billingDate)
          const effectiveType: string = ind ? ind.tariff_type : e.activity_tariff_type

          if (effectiveType !== 'monthly' && effectiveType !== 'smart') continue

          const price = ind
            ? Math.round(parseFloat(ind.price as string) * 100) / 100
            : await getEffectivePrice(e.child_id, e.activity_id, billingDate)

          if (!price || price <= 0) continue

          lines.push({
            enrollment_id: e.enrollment_id,
            activity_name: e.activity_name,
            expected_amount: price,
            tariff_type: effectiveType,
          })
        }

        const expectedAccruals = Math.round(lines.reduce((s, l) => s + l.expected_amount, 0) * 100) / 100

        result.push({
          account_id: accountId,
          account_name: accountName,
          balance_start: balStart,
          expected_accruals: expectedAccruals,
          balance_after_accruals: Math.round((balStart - expectedAccruals) * 100) / 100,
          billing_run_done: billingRunDoneAccounts.has(accountId),
          lines,
        })
      }

      return result
    }
  )

  // GET /api/children/:id/bank-payers
  app.get<{ Params: { id: string } }>(
    '/:id/bank-payers',
    { preHandler: authenticate },
    async (request) => {
      const { id } = request.params
      return db
        .selectFrom('bank_payer_profiles')
        .select(['id', 'counterparty_name', 'inn', 'iban', 'import_count', 'last_import_date', 'note'])
        .where('child_id', '=', id)
        .orderBy('last_import_date', 'desc')
        .execute()
    }
  )

  // PATCH /api/children/:id/bank-payers/:payerId
  app.patch<{
    Params: { id: string; payerId: string }
    Body: { counterparty_name?: string; inn?: string | null; iban?: string | null; note?: string | null }
  }>(
    '/:id/bank-payers/:payerId',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id, payerId } = request.params
      const existing = await db
        .selectFrom('bank_payer_profiles')
        .select(['id', 'counterparty_name', 'inn', 'iban', 'note'])
        .where('id', '=', payerId)
        .where('child_id', '=', id)
        .executeTakeFirst()

      if (!existing) {
        return reply.status(404).send({ error: 'NotFound', message: 'Платника не знайдено' })
      }

      const body = request.body
      const counterparty_name = body.counterparty_name !== undefined
        ? body.counterparty_name.trim()
        : existing.counterparty_name
      if (!counterparty_name) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Назва платника обовʼязкова' })
      }

      let inn: string | null = existing.inn
      if (body.inn !== undefined) {
        const raw = body.inn?.replace(/\D/g, '') ?? ''
        inn = raw.length >= 8 ? raw : null
      }

      let iban: string | null = existing.iban
      if (body.iban !== undefined) {
        const raw = body.iban?.replace(/\s/g, '').toUpperCase() ?? ''
        iban = raw.startsWith('UA') && raw.length >= 29 ? raw : null
      }

      const note = body.note !== undefined ? (body.note?.trim() || null) : existing.note

      if (!inn && !iban) {
        return reply.status(400).send({
          error: 'BadRequest',
          message: 'Вкажіть ІНН (мін. 8 цифр) або IBAN (UA..., мін. 29 символів)',
        })
      }

      try {
        const row = await db
          .updateTable('bank_payer_profiles')
          .set({
            counterparty_name,
            inn,
            iban,
            note,
            updated_at: new Date(),
          })
          .where('id', '=', payerId)
          .where('child_id', '=', id)
          .returning(['id', 'counterparty_name', 'inn', 'iban', 'import_count', 'last_import_date', 'note'])
          .executeTakeFirstOrThrow()

        return row
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('unique') || msg.includes('duplicate')) {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'Платник з таким ІНН або IBAN вже є у цієї дитини',
          })
        }
        throw err
      }
    }
  )

  // DELETE /api/children/:id/bank-payers/:payerId
  app.delete<{ Params: { id: string; payerId: string } }>(
    '/:id/bank-payers/:payerId',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id, payerId } = request.params
      const deleted = await db
        .deleteFrom('bank_payer_profiles')
        .where('id', '=', payerId)
        .where('child_id', '=', id)
        .returning('id')
        .executeTakeFirst()

      if (!deleted) {
        return reply.status(404).send({ error: 'NotFound', message: 'Платника не знайдено' })
      }

      return { ok: true }
    }
  )

  // GET /api/children/:id/month-stats?month=YYYY-MM
  app.get<{ Params: { id: string }; Querystring: { month?: string } }>(
    '/:id/month-stats',
    { preHandler: authenticate },
    async (request) => {
      const { id } = request.params
      const month = request.query.month ?? new Date().toISOString().slice(0, 7)
      const [y, m] = month.split('-').map(Number)
      const from = `${y}-${String(m).padStart(2, '0')}-01`
      const lastDay = new Date(y, m, 0).getDate()
      const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

      const billingDate = new Date(from)

      const [enrollments, attendanceLogs, indTariffs, baseTariffs] = await Promise.all([
        db.selectFrom('enrollments as e')
          .innerJoin('activities as a', 'a.id', 'e.activity_id')
          .select([
            'e.account_id', 'e.status as enrollment_status',
            'e.start_date', 'e.end_date',
            'a.id as activity_id', 'a.name as activity_name', 'a.is_active as activity_is_active',
            'a.tariff_type',
          ])
          .where('e.child_id', '=', id)
          .execute(),

        db.selectFrom('attendance_logs as al')
          .select(['al.activity_id', 'al.status'])
          .where('al.child_id', '=', id)
          .where('al.date', '>=', new Date(from))
          .where('al.date', '<=', new Date(to))
          .execute(),

        // Individual tariffs active on the first day of the viewed month
        db.selectFrom('child_individual_tariffs')
          .select(['activity_id', 'tariff_type', 'price'])
          .where('child_id', '=', id)
          .where('valid_from', '<=', billingDate)
          .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', billingDate)]))
          .orderBy('valid_from', 'desc')
          .execute(),

        // Base tariffs active on the first day of the viewed month
        db.selectFrom('tariffs')
          .select(['activity_id', 'base_fee'])
          .where('valid_from', '<=', billingDate)
          .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', billingDate)]))
          .orderBy('valid_from', 'desc')
          .execute(),
      ])

      // Maps: activity_id → tariff (first = most recent due to orderBy desc)
      const indTariffMap = new Map<string, typeof indTariffs[0]>()
      for (const t of indTariffs) if (!indTariffMap.has(t.activity_id)) indTariffMap.set(t.activity_id, t)
      const baseTariffMap = new Map<string, typeof baseTariffs[0]>()
      for (const t of baseTariffs) if (!baseTariffMap.has(t.activity_id)) baseTariffMap.set(t.activity_id, t)

      const enrichedEnrollments = enrollments.map((e) => {
        const ind  = indTariffMap.get(e.activity_id)
        const base = baseTariffMap.get(e.activity_id)
        return {
          account_id:             e.account_id,
          enrollment_status:      e.enrollment_status,
          start_date:             e.start_date,
          end_date:               e.end_date,
          activity_id:            e.activity_id,
          activity_name:          e.activity_name,
          activity_is_active:     e.activity_is_active,
          effective_tariff_type:  ind?.tariff_type ?? e.tariff_type ?? null,
          effective_tariff_price: ind
            ? parseFloat(ind.price as string)
            : base ? parseFloat(base.base_fee as string) : null,
          has_individual_tariff:  !!ind,
        }
      })

      const attendanceMap: Record<string, { visit_count: number; excused_count: number; separate_billing_count: number }> = {}
      for (const log of attendanceLogs) {
        const key = log.activity_id ?? 'none'
        attendanceMap[key] ??= { visit_count: 0, excused_count: 0, separate_billing_count: 0 }
        if (log.status === 'present' || log.status === 'special') attendanceMap[key].visit_count++
        else if (log.status === 'absent_excused' || log.status === 'absent_excused_30') attendanceMap[key].excused_count++
        else if (log.status === 'separate_billing') attendanceMap[key].separate_billing_count++
      }

      return {
        enrollments: enrichedEnrollments,
        attendance: Object.entries(attendanceMap).map(([activity_id, data]) => ({ activity_id, ...data })),
      }
    }
  )
}
