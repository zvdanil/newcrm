import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'
import { recalcRetroAccruals } from '../services/salaryService.js'

export async function staffRoutes(app: FastifyInstance) {

  // GET /api/staff
  app.get<{ Querystring: { type?: string; is_active?: string } }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      let q = db
        .selectFrom('staff as s')
        .selectAll('s')

      if (req.query.type)      q = q.where('s.type', '=', req.query.type as 'employee' | 'partner')
      if (req.query.is_active) q = q.where('s.is_active', '=', req.query.is_active === 'true')

      return q.orderBy('s.full_name', 'asc').execute()
    }
  )

  // POST /api/staff
  app.post<{
    Body: {
      full_name: string
      specialization?: string
      type?: 'employee' | 'partner'
      phone?: string
      start_date?: string
      note?: string
    }
  }>(
    '/',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { full_name, specialization, type = 'employee', phone, start_date, note } = req.body
      if (!full_name?.trim()) return reply.status(400).send({ error: 'BadRequest', message: 'full_name є обовʼязковим' })

      const row = await db.insertInto('staff').values({
        full_name: full_name.trim(),
        specialization: specialization ?? null,
        type,
        phone: phone ?? null,
        start_date: start_date ?? null,
        note: note ?? null,
      }).returningAll().executeTakeFirstOrThrow()

      return reply.status(201).send(row)
    }
  )

  // GET /api/staff/:id
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const staff = await db.selectFrom('staff').selectAll().where('id', '=', req.params.id).executeTakeFirst()
      if (!staff) return reply.status(404).send({ error: 'NotFound' })
      return staff
    }
  )

  // PUT /api/staff/:id
  app.put<{
    Params: { id: string }
    Body: {
      full_name?: string
      specialization?: string
      type?: 'employee' | 'partner'
      phone?: string
      start_date?: string | null
      is_active?: boolean
      note?: string | null
    }
  }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const updated = await db.updateTable('staff')
        .set(req.body)
        .where('id', '=', req.params.id)
        .returningAll()
        .executeTakeFirst()
      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return updated
    }
  )

  // ── Rates ──────────────────────────────────────────────────────────────────

  // GET /api/staff/:id/rates — all rates with smart config
  app.get<{ Params: { id: string } }>(
    '/:id/rates',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      const rates = await db
        .selectFrom('staff_rates as r')
        .leftJoin('activities as a', 'a.id', 'r.activity_id')
        .leftJoin('staff_smart_configs as sc', 'sc.rate_id', 'r.id')
        .where('r.staff_id', '=', req.params.id)
        .select([
          'r.id', 'r.staff_id', 'r.activity_id', 'r.rate_category', 'r.rate_type',
          'r.value_mode', 'r.rate_value', 'r.deduction_pct', 'r.valid_from', 'r.valid_to', 'r.note', 'r.created_at',
          'a.name as activity_name',
          'sc.base_lessons', 'sc.absence_threshold', 'sc.threshold_rate',
        ])
        .orderBy('r.valid_from', 'desc')
        .execute()

      return rates
    }
  )

  // POST /api/staff/:id/rates — create rate (closes previous for same activity if auto)
  app.post<{
    Params: { id: string }
    Body: {
      activity_id?: string
      rate_category?: 'auto' | 'manual'
      rate_type: 'per_lesson' | 'per_child' | 'fixed_monthly' | 'hourly' | 'smart' | 'bonus'
      value_mode?: 'fixed' | 'percent_of_revenue'
      rate_value: number
      deduction_pct?: number
      valid_from?: string
      valid_to?: string
      note?: string
      smart_config?: { base_lessons: number; absence_threshold: number; threshold_rate: number }
    }
  }>(
    '/:id/rates',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { activity_id, rate_category = 'auto', rate_type, value_mode = 'fixed', rate_value, deduction_pct = 0, valid_from, valid_to, note, smart_config } = req.body
      if (!rate_type) return reply.status(400).send({ error: 'BadRequest', message: 'rate_type є обовʼязковим' })
      if (rate_value === undefined) return reply.status(400).send({ error: 'BadRequest', message: 'rate_value є обовʼязковим' })

      const today    = new Date().toISOString().slice(0, 10)
      const fromDate = valid_from ?? today

      // Fetch old active rate for same staff+activity+type before closing it (needed for retro recalc)
      let q = db
        .selectFrom('staff_rates')
        .select(['id', 'rate_value'])
        .where('staff_id',    '=', req.params.id)
        .where('rate_type',   '=', rate_type)
        .where('rate_category', '=', rate_category)
        .where('valid_to', 'is', null)

      if (activity_id) {
        q = q.where('activity_id', '=', activity_id)
      } else {
        q = q.where('activity_id', 'is', null)
      }

      const oldRate = await q.executeTakeFirst()

      // Close it (SCD Type 2)
      if (oldRate) {
        await db.updateTable('staff_rates')
          .set({ valid_to: fromDate })
          .where('id', '=', oldRate.id)
          .execute()
      }

      const rate = await db.insertInto('staff_rates').values({
        staff_id:      req.params.id,
        activity_id:   activity_id ?? null,
        rate_category,
        rate_type,
        value_mode,
        rate_value,
        deduction_pct,
        valid_from:    fromDate,
        valid_to:      valid_to ?? null,
        note:          note ?? null,
      }).returningAll().executeTakeFirstOrThrow()

      // Smart config
      if (rate_type === 'smart' && smart_config) {
        await db.insertInto('staff_smart_configs').values({
          rate_id:           rate.id,
          base_lessons:      smart_config.base_lessons,
          absence_threshold: smart_config.absence_threshold,
          threshold_rate:    smart_config.threshold_rate,
        }).execute()
      }

      // Retro recalculation: if valid_from is in the past and we closed an old rate
      const fromDateObj = new Date(fromDate)
      const todayObj    = new Date(today)
      todayObj.setHours(0, 0, 0, 0)

      if (oldRate && fromDateObj < todayObj) {
        await recalcRetroAccruals(
          req.params.id,
          oldRate.id,
          rate.id,
          Number(rate_value),
          fromDateObj,
        )
      }

      return reply.status(201).send(rate)
    }
  )

  // PUT /api/staff/:id/rates/:rateId — update rate (non-SCD fields: note, deduction_pct, valid_to)
  app.put<{
    Params: { id: string; rateId: string }
    Body: {
      deduction_pct?: number
      valid_to?: string | null
      note?: string | null
      smart_config?: { base_lessons: number; absence_threshold: number; threshold_rate: number }
    }
  }>(
    '/:id/rates/:rateId',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { deduction_pct, valid_to, note, smart_config } = req.body

      const updates: Record<string, unknown> = {}
      if (deduction_pct !== undefined) updates.deduction_pct = deduction_pct
      if (valid_to !== undefined)      updates.valid_to = valid_to
      if (note !== undefined)          updates.note = note

      const updated = await db.updateTable('staff_rates')
        .set(updates)
        .where('id', '=', req.params.rateId)
        .where('staff_id', '=', req.params.id)
        .returningAll()
        .executeTakeFirst()

      if (!updated) return reply.status(404).send({ error: 'NotFound' })

      if (smart_config) {
        await db.insertInto('staff_smart_configs')
          .values({ rate_id: req.params.rateId, ...smart_config })
          .onConflict((oc) => oc.column('rate_id').doUpdateSet({
            base_lessons:      smart_config.base_lessons,
            absence_threshold: smart_config.absence_threshold,
            threshold_rate:    smart_config.threshold_rate,
            updated_at:        new Date().toISOString() as unknown as Date,
          }))
          .execute()
      }

      return updated
    }
  )

  // DELETE /api/staff/:id/rates/:rateId — close rate (valid_to = today)
  app.delete<{ Params: { id: string; rateId: string } }>(
    '/:id/rates/:rateId',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const today = new Date().toISOString().slice(0, 10)
      const updated = await db.updateTable('staff_rates')
        .set({ valid_to: today })
        .where('id', '=', req.params.rateId)
        .where('staff_id', '=', req.params.id)
        .where('valid_to', 'is', null)
        .returningAll()
        .executeTakeFirst()

      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return { ok: true }
    }
  )
}
