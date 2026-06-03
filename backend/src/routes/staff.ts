import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'
import { recalcRetroAccruals, triggerRetroAccruals, recalcSmartStaffBenefit, recalcSmartPerChildBenefit } from '../services/salaryService.js'

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
          'sc.attendance_threshold', 'sc.starter_rate', 'sc.extra_lesson_price',
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
      rate_type: 'per_lesson' | 'per_child' | 'group_lesson' | 'fixed_monthly' | 'hourly' | 'smart' | 'smart_per_child' | 'bonus' | 'monthly_by_day'
      value_mode?: 'fixed' | 'percent_of_revenue'
      rate_value: number
      deduction_pct?: number
      valid_from?: string
      valid_to?: string
      note?: string
      smart_config?: {
        base_lessons: number
        absence_threshold: number
        threshold_rate: number
        // smart_per_child fields
        attendance_threshold?: number
        starter_rate?: number
        extra_lesson_price?: number
        trial_lesson_price?: number
      }
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

      // Fetch ALL overlapping rates for same staff+activity+type+category that end AFTER fromDate (or never end)
      const fromDateObj = new Date(fromDate)
      let q = db
        .selectFrom('staff_rates')
        .select(['id', 'rate_value', 'valid_from', 'valid_to'])
        .where('staff_id', '=', req.params.id)
        .where('rate_category', '=', rate_category)
        .where((eb) => eb.or([
          eb('valid_to', 'is', null),
          eb('valid_to', '>', fromDateObj)
        ]))

      if (activity_id) {
        q = q.where('activity_id', '=', activity_id)
             .where('rate_type', '=', rate_type)
      } else {
        q = q.where('activity_id', 'is', null)
             .where('rate_type', '=', rate_type)
      }

      const overlappingRates = await q.execute()

      // Process overlapping rates (SCD Type 2 conflict resolution)
      for (const oldRate of overlappingRates) {
        const oldValidFromStr = oldRate.valid_from instanceof Date 
          ? oldRate.valid_from.toISOString().slice(0, 10) 
          : String(oldRate.valid_from).slice(0, 10)

        const newValidTo = new Date(oldRate.valid_from) < fromDateObj ? fromDate : oldValidFromStr
        await db.updateTable('staff_rates')
          .set({ valid_to: newValidTo })
          .where('id', '=', oldRate.id)
          .execute()

        // Delete any CORRECTION transactions attached to this rate that are now superseded
        await db.updateTable('salary_transactions')
          .set({ is_deleted: true, deleted_at: new Date().toISOString() })
          .where('staff_id', '=', req.params.id)
          .where('rate_id', '=', oldRate.id)
          .where('type', '=', 'CORRECTION')
          .where('transaction_date', '>=', fromDateObj)
          .execute()
      }

      const rate = await db.insertInto('staff_rates').values({
        staff_id:      req.params.id,
        activity_id:   activity_id ?? null,
        rate_category,
        rate_type,
        value_mode,
        rate_value:    String(rate_value),
        deduction_pct: String(deduction_pct),
        valid_from:    fromDate,
        note:          note ?? null,
      }).returningAll().executeTakeFirstOrThrow()

      if (smart_config && (rate_type === 'smart' || rate_type === 'smart_per_child')) {
        await db.insertInto('staff_smart_configs').values({
          rate_id:              rate.id,
          base_lessons:         smart_config.base_lessons,
          absence_threshold:    smart_config.absence_threshold,
          threshold_rate:       String(smart_config.threshold_rate),
          attendance_threshold: smart_config.attendance_threshold ?? 5,
          starter_rate:         String(smart_config.starter_rate ?? 0),
          extra_lesson_price:   String(smart_config.extra_lesson_price ?? 0),
          trial_lesson_price:   String(smart_config.trial_lesson_price ?? 0),
        }).execute()
      }

      // Retro recalculation: if valid_from is in the past, run for all affected old rates
      const todayObj    = new Date(today)
      todayObj.setHours(0, 0, 0, 0)

      if (overlappingRates.length > 0 && fromDateObj < todayObj) {
        for (const oldRate of overlappingRates) {
          await recalcRetroAccruals(
            req.params.id,
            oldRate.id,
            rate.id,
            Number(rate_value),
            fromDateObj,
          )
        }
      }

      // Recalc all marks from valid_from through today (inclusive — string comparison avoids tz skew)
      if (fromDate <= today) {
        await triggerRetroAccruals(req.params.id, activity_id ?? null, fromDateObj, new Date(today))
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
      smart_config?: {
        base_lessons: number
        absence_threshold: number
        threshold_rate: number
        attendance_threshold?: number
        starter_rate?: number
        extra_lesson_price?: number
        trial_lesson_price?: number
      }
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
          .values({
            rate_id:              req.params.rateId,
            base_lessons:         smart_config.base_lessons,
            absence_threshold:    smart_config.absence_threshold,
            threshold_rate:       String(smart_config.threshold_rate),
            attendance_threshold: smart_config.attendance_threshold ?? 5,
            starter_rate:         String(smart_config.starter_rate ?? 0),
            extra_lesson_price:   String(smart_config.extra_lesson_price ?? 0),
            trial_lesson_price:   String(smart_config.trial_lesson_price ?? 0),
          })
          .onConflict((oc) => oc.column('rate_id').doUpdateSet({
            base_lessons:         smart_config.base_lessons,
            absence_threshold:    smart_config.absence_threshold,
            threshold_rate:       String(smart_config.threshold_rate),
            attendance_threshold: smart_config.attendance_threshold ?? 5,
            starter_rate:         String(smart_config.starter_rate ?? 0),
            extra_lesson_price:   String(smart_config.extra_lesson_price ?? 0),
            trial_lesson_price:   String(smart_config.trial_lesson_price ?? 0),
            updated_at:           new Date().toISOString() as unknown as Date,
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

  // POST /api/staff/:id/recalc — принудительный пересчёт начислений за месяц
  app.post<{
    Params: { id: string }
    Body: { month?: string }
  }>(
    '/:id/recalc',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const staffId = req.params.id
      const month   = req.body?.month ?? new Date().toISOString().slice(0, 7)

      const fromDate = new Date(month + '-01')
      const toDate   = new Date(fromDate)
      toDate.setMonth(toDate.getMonth() + 1)

      // Все уникальные активности с авто-ставками типа per_lesson / per_child / group_lesson
      const activityRows = await db
        .selectFrom('staff_rates')
        .select('activity_id')
        .distinct()
        .where('staff_id',      '=', staffId)
        .where('rate_category', '=', 'auto')
        .where('activity_id',   'is not', null)
        .where((eb) => eb.or([
          eb('rate_type', '=', 'per_lesson'),
          eb('rate_type', '=', 'per_child'),
          eb('rate_type', '=', 'group_lesson'),
        ]))
        .execute()

      for (const { activity_id } of activityRows) {
        if (activity_id) {
          await triggerRetroAccruals(staffId, activity_id, fromDate, toDate)
        }
      }

      // Пересчёт смарт-ставок за месяц
      const billingMonth = month + '-01'
      const smartRates = await db
        .selectFrom('staff_rates')
        .select(['id', 'rate_type'])
        .where('staff_id',      '=', staffId)
        .where('rate_category', '=', 'auto')
        .where('rate_type', 'in', ['smart', 'smart_per_child'])
        .execute()

      for (const r of smartRates) {
        if (r.rate_type === 'smart') {
          await recalcSmartStaffBenefit(r.id, billingMonth)
        } else {
          await recalcSmartPerChildBenefit(r.id, billingMonth)
        }
      }

      return reply.send({ ok: true })
    }
  )
}
