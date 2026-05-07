import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'

export async function activitiesRoutes(app: FastifyInstance) {
  // GET /api/activities?include_archived=true
  app.get<{ Querystring: { include_archived?: string } }>(
    '/',
    { preHandler: authenticate },
    async (req) => {
      const includeArchived = req.query.include_archived === 'true'
      let query = db
        .selectFrom('activities as a')
        .leftJoin('accounts as ac', 'ac.id', 'a.account_id')
        .select([
          'a.id', 'a.name', 'a.tariff_type', 'a.is_rigid', 'a.is_active', 'a.note', 'a.created_at',
          'ac.id as account_id', 'ac.name as account_name',
        ])
        .orderBy('a.name', 'asc')
      if (!includeArchived) query = query.where('a.is_active', '=', true)
      return query.execute()
    }
  )

  // GET /api/activities/:id
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: authenticate },
    async (req, reply) => {
      const activity = await db
        .selectFrom('activities as a')
        .leftJoin('accounts as ac', 'ac.id', 'a.account_id')
        .select([
          'a.id', 'a.name', 'a.tariff_type', 'a.is_rigid', 'a.is_active', 'a.note', 'a.created_at',
          'ac.id as account_id', 'ac.name as account_name',
        ])
        .where('a.id', '=', req.params.id)
        .executeTakeFirst()
      if (!activity) return reply.status(404).send({ error: 'NotFound' })

      // Текущий тариф
      const currentTariff = await db
        .selectFrom('tariffs')
        .selectAll()
        .where('activity_id', '=', req.params.id)
        .where('valid_to', 'is', null)
        .executeTakeFirst()

      // Связанные активности
      const linked = await db
        .selectFrom('linked_activities as la')
        .innerJoin('activities as a2', 'a2.id', 'la.child_activity_id')
        .select(['a2.id', 'a2.name'])
        .where('la.parent_activity_id', '=', req.params.id)
        .execute()

      return { ...activity, current_tariff: currentTariff ?? null, linked_activities: linked }
    }
  )

  // POST /api/activities
  app.post<{ Body: { name: string; account_id?: string; tariff_type?: 'monthly' | 'per_lesson'; is_rigid?: boolean; note?: string; base_fee?: number } }>(
    '/',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { name, account_id, tariff_type = 'monthly', is_rigid = false, note, base_fee } = req.body
      if (!name?.trim()) return reply.status(400).send({ error: 'BadRequest', message: 'name є обовʼязковим' })

      const activity = await db.transaction().execute(async (trx) => {
        const a = await trx.insertInto('activities')
          .values({ name: name.trim(), account_id: account_id || null, tariff_type, is_rigid, note: note || null })
          .returningAll()
          .executeTakeFirstOrThrow()

        if (base_fee !== undefined && base_fee >= 0) {
          await trx.insertInto('tariffs')
            .values({ activity_id: a.id, base_fee, valid_from: new Date().toISOString().slice(0, 10), valid_to: null })
            .execute()
        }
        return a
      })
      return reply.status(201).send(activity)
    }
  )

  // PUT /api/activities/:id
  app.put<{ Params: { id: string }; Body: { name?: string; account_id?: string | null; tariff_type?: 'monthly' | 'per_lesson'; is_rigid?: boolean; is_active?: boolean; note?: string } }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const updated = await db.updateTable('activities').set(req.body).where('id', '=', req.params.id).returningAll().executeTakeFirst()
      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return updated
    }
  )

  // GET /api/activities/:id/tariff-history
  app.get<{ Params: { id: string } }>(
    '/:id/tariff-history',
    { preHandler: authenticate },
    async (req) => {
      return db.selectFrom('tariffs')
        .selectAll()
        .where('activity_id', '=', req.params.id)
        .orderBy('valid_from', 'desc')
        .execute()
    }
  )

  // POST /api/activities/:id/tariff — новая ставка, закрывает предыдущую
  app.post<{ Params: { id: string }; Body: { base_fee: number; valid_from?: string } }>(
    '/:id/tariff',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { base_fee, valid_from } = req.body
      if (base_fee === undefined || base_fee < 0) return reply.status(400).send({ error: 'BadRequest', message: 'base_fee є обовʼязковим і >= 0' })

      const from = valid_from ?? new Date().toISOString().slice(0, 10)

      const tariff = await db.transaction().execute(async (trx) => {
        // Закрываем текущий актуальный тариф
        await trx.updateTable('tariffs')
          .set({ valid_to: from })
          .where('activity_id', '=', req.params.id)
          .where('valid_to', 'is', null)
          .execute()

        return trx.insertInto('tariffs')
          .values({ activity_id: req.params.id, base_fee, valid_from: from, valid_to: null })
          .returningAll()
          .executeTakeFirstOrThrow()
      })
      return reply.status(201).send(tariff)
    }
  )

  // GET /api/activities/:id/refund-config
  app.get<{ Params: { id: string } }>(
    '/:id/refund-config',
    { preHandler: authenticate },
    async (req) => {
      const config = await db
        .selectFrom('refund_configs')
        .selectAll()
        .where('activity_id', '=', req.params.id)
        .executeTakeFirst()
      return config ?? null
    }
  )

  // PUT /api/activities/:id/refund-config — upsert
  app.put<{
    Params: { id: string }
    Body: { refund_on_excused: boolean; refund_amount?: number | null; refund_pct?: number | null; note?: string | null }
  }>(
    '/:id/refund-config',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { refund_on_excused, refund_amount, refund_pct, note } = req.body

      if (refund_amount != null && refund_pct != null) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Вкажіть або refund_amount, або refund_pct — не обидва одночасно' })
      }

      const config = await db
        .insertInto('refund_configs')
        .values({
          activity_id: req.params.id,
          refund_on_excused,
          refund_amount: refund_amount ?? null,
          refund_pct: refund_pct ?? null,
          note: note ?? null,
        })
        .onConflict((oc) =>
          oc.column('activity_id').doUpdateSet({
            refund_on_excused,
            refund_amount: refund_amount ?? null,
            refund_pct: refund_pct ?? null,
            note: note ?? null,
            updated_at: new Date().toISOString() as unknown as Date,
          })
        )
        .returningAll()
        .executeTakeFirstOrThrow()

      return config
    }
  )

  // POST /api/activities/:id/link — добавить связанную активность
  app.post<{ Params: { id: string }; Body: { child_activity_id: string } }>(
    '/:id/link',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      if (req.params.id === req.body.child_activity_id) return reply.status(400).send({ error: 'BadRequest', message: 'Не можна звʼязати активність з собою' })
      await db.insertInto('linked_activities')
        .values({ parent_activity_id: req.params.id, child_activity_id: req.body.child_activity_id })
        .onConflict((oc) => oc.doNothing())
        .execute()
      return { ok: true }
    }
  )

  // DELETE /api/activities/:id/link/:childId
  app.delete<{ Params: { id: string; childId: string } }>(
    '/:id/link/:childId',
    { preHandler: requireRole('owner', 'admin') },
    async (_req, reply) => {
      await db.deleteFrom('linked_activities')
        .where('parent_activity_id', '=', _req.params.id)
        .where('child_activity_id', '=', _req.params.childId)
        .execute()
      return { ok: true }
    }
  )
}
