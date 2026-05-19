import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'
import { getFamilyDebts, computeWaterfall } from '../services/waterfallService.js'
import { createTransaction } from '../services/balanceService.js'

export async function familiesRoutes(app: FastifyInstance) {
  // GET /api/families?search=&limit=&offset=
  app.get<{ Querystring: { search?: string; limit?: string; offset?: string } }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'manager', 'accountant') },
    async (request) => {
      const limit = Math.min(Number(request.query.limit ?? 500), 500)
      const offset = Number(request.query.offset ?? 0)
      const search = request.query.search?.trim()

      let query = db
        .selectFrom('families as f')
        .innerJoin('parents as p', 'p.id', 'f.primary_parent_id')
        .select([
          'f.id',
          'f.name',
          'f.note',
          'f.created_at',
          'p.id as primary_parent_id',
          'p.full_name as primary_parent_name',
          'p.phone as primary_parent_phone',
        ])

      if (search) {
        query = query.where((eb) =>
          eb.or([
            eb('f.name', 'ilike', `%${search}%`),
            eb('p.full_name', 'ilike', `%${search}%`),
            eb('p.phone', 'ilike', `%${search}%`),
          ])
        )
      }

      const countQuery = db
        .selectFrom('families as f')
        .innerJoin('parents as p', 'p.id', 'f.primary_parent_id')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .$if(!!search, (q) =>
          q.where((eb) =>
            eb.or([
              eb('f.name', 'ilike', `%${search}%`),
              eb('p.full_name', 'ilike', `%${search}%`),
              eb('p.phone', 'ilike', `%${search}%`),
            ])
          )
        )

      const [data, totalRow] = await Promise.all([
        query.orderBy('f.name', 'asc').limit(limit).offset(offset).execute(),
        countQuery.executeTakeFirst(),
      ])

      return { data, total: Number(totalRow?.count ?? 0), limit, offset }
    }
  )

  // GET /api/families/:id (с детьми и участниками)
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin', 'manager', 'accountant') },
    async (request, reply) => {
      const family = await db
        .selectFrom('families as f')
        .innerJoin('parents as p', 'p.id', 'f.primary_parent_id')
        .select([
          'f.id', 'f.name', 'f.note', 'f.created_at',
          'p.id as primary_parent_id',
          'p.full_name as primary_parent_name',
          'p.phone as primary_parent_phone',
        ])
        .where('f.id', '=', request.params.id)
        .executeTakeFirst()

      if (!family) return reply.status(404).send({ error: 'NotFound' })

      const [children, members] = await Promise.all([
        db
          .selectFrom('children as c')
          .leftJoin('groups as g', 'g.id', 'c.group_id')
          .select(['c.id', 'c.full_name', 'c.birth_date', 'c.is_active', 'g.name as group_name'])
          .where('c.family_id', '=', request.params.id)
          .orderBy('c.full_name', 'asc')
          .execute(),
        db
          .selectFrom('family_members as fm')
          .innerJoin('parents as p', 'p.id', 'fm.parent_id')
          .select(['p.id', 'p.full_name', 'p.phone', 'p.email'])
          .where('fm.family_id', '=', request.params.id)
          .execute(),
      ])

      return { ...family, children, members }
    }
  )

  // POST /api/families
  app.post<{
    Body: { name: string; primary_parent_id: string; note?: string }
  }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (request, reply) => {
      const { name, primary_parent_id, note } = request.body

      if (!name?.trim()) {
        return reply.status(400).send({ error: 'BadRequest', message: 'name є обовʼязковим' })
      }
      if (!primary_parent_id?.trim()) {
        return reply.status(400).send({ error: 'BadRequest', message: 'primary_parent_id є обовʼязковим' })
      }

      const family = await db.transaction().execute(async (trx) => {
        const f = await trx
          .insertInto('families')
          .values({ name, primary_parent_id, note })
          .returningAll()
          .executeTakeFirstOrThrow()

        await trx
          .insertInto('family_members')
          .values({ family_id: f.id, parent_id: primary_parent_id })
          .execute()

        return f
      })

      return reply.status(201).send(family)
    }
  )

  // GET /api/families/:id/debts?account_id= — debt breakdown for all children
  app.get<{ Params: { id: string }; Querystring: { account_id: string } }>(
    '/:id/debts',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { account_id } = request.query
      if (!account_id) return reply.status(400).send({ error: 'BadRequest', message: 'account_id є обовʼязковим' })

      const family = await db.selectFrom('families').select('id').where('id', '=', request.params.id).executeTakeFirst()
      if (!family) return reply.status(404).send({ error: 'NotFound' })

      const debts = await getFamilyDebts(request.params.id, account_id)
      const total_debt = debts.reduce((s, c) => s + c.debt, 0)
      return { debts, total_debt: Math.round(total_debt * 100) / 100 }
    }
  )

  // POST /api/families/:id/payment — family waterfall payment (Owner/Admin)
  app.post<{
    Params: { id: string }
    Body: {
      account_id: string
      payment_account_id?: string
      amount: number
      transaction_date?: string
      note?: string
      advance_child_id?: string            // child that receives excess advance
      manual_match?: { child_id: string; amount: number }[]  // override auto-waterfall
    }
  }>(
    '/:id/payment',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { account_id, payment_account_id, amount, transaction_date, note, advance_child_id, manual_match } = request.body

      if (!account_id) return reply.status(400).send({ error: 'BadRequest', message: 'account_id є обовʼязковим' })
      if (!amount || amount <= 0) return reply.status(400).send({ error: 'BadRequest', message: 'Сума повинна бути більше 0' })

      const family = await db.selectFrom('families').select('id').where('id', '=', request.params.id).executeTakeFirst()
      if (!family) return reply.status(404).send({ error: 'NotFound' })

      // Determine allocation: manual or auto-waterfall
      let allocations: { child_id: string; child_name: string; amount: number }[]

      if (manual_match && manual_match.length > 0) {
        // Validate that all children belong to this family
        const childIds = manual_match.map(m => m.child_id)
        const familyChildren = await db
          .selectFrom('children')
          .select(['id', 'full_name'])
          .where('family_id', '=', request.params.id)
          .where('id', 'in', childIds)
          .execute()

        const childMap = new Map(familyChildren.map(c => [c.id, c.full_name]))
        for (const match of manual_match) {
          if (!childMap.has(match.child_id)) {
            return reply.status(400).send({ error: 'BadRequest', message: `Дитина ${match.child_id} не належить цій сім'ї` })
          }
        }

        allocations = manual_match
          .filter(m => m.amount > 0)
          .map(m => ({ child_id: m.child_id, child_name: childMap.get(m.child_id)!, amount: m.amount }))
      } else {
        const debts = await getFamilyDebts(request.params.id, account_id)
        const waterfall = computeWaterfall(debts, amount, advance_child_id)
        allocations = waterfall.allocations
      }

      if (allocations.length === 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Немає розподілу платежу' })
      }

      const dateStr = transaction_date ?? new Date().toISOString().slice(0, 10)
      const payAccountId = payment_account_id ?? account_id
      const isCrossAccount = payAccountId !== account_id
      const createdBy = request.user.sub

      const results: { child_id: string; child_name: string; amount: number; tx_id: string }[] = []

      for (const alloc of allocations) {
        const txId = await createTransaction({
          type: 'PAYMENT',
          child_id: alloc.child_id,
          account_id,
          amount: alloc.amount,
          transaction_date: dateStr,
          note: note ?? null,
          created_by: createdBy,
          metadata_json: isCrossAccount
            ? { payment_account_id: payAccountId, family_payment: true }
            : { family_payment: true },
        })

        if (isCrossAccount) {
          await db.insertInto('inter_account_imbalances').values({
            from_account_id: payAccountId,
            to_account_id: account_id,
            amount: alloc.amount,
            transaction_id: txId,
            note: note ?? null,
          }).execute()
        }

        results.push({ child_id: alloc.child_id, child_name: alloc.child_name, amount: alloc.amount, tx_id: txId })
      }

      return reply.status(201).send({ ok: true, allocations: results, cross_account: isCrossAccount })
    }
  )

  // POST /api/families/:id/members (добавить участника)
  app.post<{ Params: { id: string }; Body: { parent_id: string; role?: string | null } }>(
    '/:id/members',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (request, reply) => {
      await db
        .insertInto('family_members')
        .values({ family_id: request.params.id, parent_id: request.body.parent_id, role: request.body.role ?? null })
        .onConflict((oc) => oc.doNothing())
        .execute()

      return reply.status(201).send({ ok: true })
    }
  )

  // PATCH /api/families/:id/members/:parentId — обновить роль участника (мама/тато/null)
  app.patch<{ Params: { id: string; parentId: string }; Body: { role: string | null } }>(
    '/:id/members/:parentId',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (request, reply) => {
      await db
        .updateTable('family_members')
        .set({ role: request.body.role ?? null })
        .where('family_id', '=', request.params.id)
        .where('parent_id', '=', request.params.parentId)
        .execute()

      return reply.send({ ok: true })
    }
  )
}
