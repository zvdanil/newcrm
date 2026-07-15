import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'
import { recalcActivityAccruals, countWorkingDays } from '../services/billingRunService.js'
import { recalcBalance } from '../services/balanceService.js'

export async function enrollmentsRoutes(app: FastifyInstance) {
  // GET /api/children/:childId/enrollments
  app.get<{ Params: { childId: string } }>(
    '/children/:childId/enrollments',
    { preHandler: authenticate },
    async (req) => {
      return db
        .selectFrom('enrollments as e')
        .innerJoin('activities as a', 'a.id', 'e.activity_id')
        .innerJoin('accounts as ac', 'ac.id', 'e.account_id')
        .leftJoin('tariffs as t', (join) =>
          join.onRef('t.activity_id', '=', 'e.activity_id').on('t.valid_to', 'is', null)
        )
        .leftJoin(
          db.selectFrom('tariffs')
            .select(['activity_id', db.fn.min('valid_from').as('first_valid_from')])
            .groupBy('activity_id')
            .as('t_first'),
          (join) => join.onRef('t_first.activity_id', '=', 'e.activity_id')
        )
        .select([
          'e.id', 'e.child_id', 'e.status', 'e.start_date', 'e.end_date',
          'e.frozen_from', 'e.frozen_to', 'e.note', 'e.created_at',
          'a.id as activity_id', 'a.name as activity_name',
          'a.tariff_type', 'a.is_rigid',
          'ac.id as account_id', 'ac.name as account_name',
          't.base_fee', 't.valid_from as current_tariff_valid_from', 't_first.first_valid_from as tariff_valid_from',
        ])
        .where('e.child_id', '=', req.params.childId)
        .orderBy('e.status', 'asc')
        .orderBy('a.name', 'asc')
        .execute()
    }
  )

  // POST /api/enrollments
  app.post<{
    Body: {
      child_id: string
      activity_id: string
      account_id: string
      start_date: string
      end_date?: string
      note?: string
    }
  }>(
    '/enrollments',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (req, reply) => {
      const { child_id, activity_id, account_id, start_date, end_date, note } = req.body
      if (!child_id || !activity_id || !account_id || !start_date) {
        return reply.status(400).send({ error: 'BadRequest', message: 'child_id, activity_id, account_id, start_date є обовʼязковими' })
      }

      const existingEnrollment = await db
        .selectFrom('enrollments')
        .select('id')
        .where('child_id', '=', child_id)
        .where('activity_id', '=', activity_id)
        .where('status', 'in', ['active', 'frozen'])
        .executeTakeFirst()

      if (existingEnrollment) {
        return reply.status(409).send({ error: 'Conflict', message: 'Дитина вже записана на цю активність' })
      }

      const enrollment = await db.insertInto('enrollments')
        .values({ child_id, activity_id, account_id, start_date, end_date: end_date || null, note: note || null })
        .returningAll()
        .executeTakeFirstOrThrow()

      const activity = await db
        .selectFrom('activities')
        .select('tariff_type')
        .where('id', '=', activity_id)
        .executeTakeFirst()

      if (activity?.tariff_type === 'monthly') {
        const d = new Date(start_date)
        const createdBy = (req as { user?: { sub?: string } }).user?.sub ?? null
        const now = new Date()
        const startMonthStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
        const currentMonthStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`

        // recalcActivityAccruals handles both full-month and pro-rata for mid-month starts
        if (startMonthStr <= currentMonthStr) {
          await recalcActivityAccruals(
            activity_id,
            new Date(startMonthStr),
            new Date(currentMonthStr),
            createdBy,
            child_id,
          )
        }
      }

      return reply.status(201).send(enrollment)
    }
  )

  // PUT /api/enrollments/:id
  app.put<{ Params: { id: string }; Body: { account_id?: string; start_date?: string; end_date?: string | null; note?: string | null } }>(
    '/enrollments/:id',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (req, reply) => {
      const updated = await db.updateTable('enrollments')
        .set(req.body)
        .where('id', '=', req.params.id)
        .returningAll()
        .executeTakeFirst()
      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return updated
    }
  )

  // POST /api/enrollments/:id/freeze
  app.post<{ Params: { id: string }; Body: { frozen_from: string; frozen_to: string } }>(
    '/enrollments/:id/freeze',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (req, reply) => {
      const { frozen_from, frozen_to } = req.body
      if (!frozen_from || !frozen_to) return reply.status(400).send({ error: 'BadRequest', message: 'frozen_from та frozen_to є обовʼязковими' })
      if (frozen_to <= frozen_from) return reply.status(400).send({ error: 'BadRequest', message: 'frozen_to має бути після frozen_from' })

      const updated = await db.updateTable('enrollments')
        .set({ status: 'frozen', frozen_from, frozen_to })
        .where('id', '=', req.params.id)
        .where('status', '=', 'active')
        .returningAll()
        .executeTakeFirst()
      if (!updated) return reply.status(409).send({ error: 'Conflict', message: 'Підписка не активна або не знайдена' })
      return updated
    }
  )

  // POST /api/enrollments/:id/unfreeze
  app.post<{ Params: { id: string } }>(
    '/enrollments/:id/unfreeze',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (req, reply) => {
      const updated = await db.updateTable('enrollments')
        .set({ status: 'active', frozen_from: null, frozen_to: null })
        .where('id', '=', req.params.id)
        .where('status', '=', 'frozen')
        .returningAll()
        .executeTakeFirst()
      if (!updated) return reply.status(409).send({ error: 'Conflict', message: 'Підписка не заморожена або не знайдена' })
      return updated
    }
  )

  // POST /api/enrollments/:id/archive
  app.post<{
    Params: { id: string }
    Body: { end_date?: string; cancel_month_accruals?: boolean; recalculate_subscription?: boolean }
  }>(
    '/enrollments/:id/archive',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const endDate = req.body?.end_date ?? new Date().toISOString().slice(0, 10)

      const updated = await db.updateTable('enrollments')
        .set({ status: 'archived', end_date: endDate })
        .where('id', '=', req.params.id)
        .where('status', '!=', 'archived')
        .returningAll()
        .executeTakeFirst()
      if (!updated) return reply.status(409).send({ error: 'Conflict', message: 'Підписка вже в архіві або не знайдена' })

      // Close individual prices from end_date so new subscription starts fresh with base tariff
      await db.updateTable('child_prices')
        .set({ valid_to: endDate })
        .where('child_id', '=', updated.child_id)
        .where('activity_id', '=', updated.activity_id)
        .where('valid_to', 'is', null)
        .execute()

      await db.updateTable('child_individual_tariffs')
        .set({ valid_to: endDate })
        .where('child_id', '=', updated.child_id)
        .where('activity_id', '=', updated.activity_id)
        .where('valid_to', 'is', null)
        .execute()

      const activity = await db
        .selectFrom('activities')
        .select('tariff_type')
        .where('id', '=', updated.activity_id)
        .executeTakeFirst()

      // For per_lesson: reverse ACCRUALs generated after end_date (marks entered beyond unsubscribe date)
      if (activity?.tariff_type === 'per_lesson') {
        await db.updateTable('transactions')
          .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: (req as { user?: { sub?: string } }).user?.sub ?? null })
          .where('enrollment_id', '=', updated.id)
          .where('type', '=', 'ACCRUAL')
          .where('is_deleted', '=', false)
          .where('transaction_date', '>', new Date(endDate))
          .execute()
        await recalcBalance(updated.child_id, updated.account_id)
      }

      // Optional: cancel ACCRUAL+ADJUSTMENT for billing months on/after end_date month
      if (req.body?.cancel_month_accruals) {
        const firstOfEndMonth = endDate.slice(0, 7) + '-01'
        const deletedBy = (req as { user?: { sub?: string } }).user?.sub ?? null
        const softDel = { is_deleted: true as const, deleted_at: new Date().toISOString(), deleted_by: deletedBy }

        if (req.body?.recalculate_subscription && (activity?.tariff_type === 'monthly' || activity?.tariff_type === 'smart')) {
          // Prorate current month subscription:
          // 1. Find existing active accrual for current month
          const currentAccrual = await db
            .selectFrom('transactions')
            .selectAll()
            .where('enrollment_id', '=', updated.id)
            .where('type', '=', 'ACCRUAL')
            .where('billing_month', '=', new Date(firstOfEndMonth))
            .where('is_deleted', '=', false)
            .executeTakeFirst()

          if (currentAccrual) {
            const enrollmentStartDate = new Date(String(updated.start_date))
            const monthStart = new Date(firstOfEndMonth)
            const periodStart = enrollmentStartDate > monthStart ? enrollmentStartDate : monthStart
            const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1)
            const monthLastDay = new Date(nextMonth.getTime() - 1)

            const wdInMonth = countWorkingDays(monthStart, monthLastDay)
            const wdActive = countWorkingDays(periodStart, new Date(endDate))

            const fullPrice = parseFloat(currentAccrual.amount as string)
            let proratedAmount = 0
            if (wdInMonth > 0 && wdActive > 0) {
              proratedAmount = Math.round((fullPrice / wdInMonth) * wdActive)
            }

            if (proratedAmount > 0) {
              const note = `Нарахування за ${firstOfEndMonth.slice(0, 7)} (про-рата ${wdActive}/${wdInMonth} роб. дн. - відписка ${endDate})`
              await db.updateTable('transactions')
                .set({
                  amount: proratedAmount,
                  note,
                  metadata_json: {
                    ...(currentAccrual.metadata_json as Record<string, unknown> || {}),
                    pro_rata: true,
                    working_days_active: wdActive,
                    working_days_in_month: wdInMonth,
                    full_price: fullPrice,
                    unenrollment_date: endDate,
                  }
                })
                .where('id', '=', currentAccrual.id)
                .execute()
            } else {
              // If active days is 0, soft-delete the transaction
              await db.updateTable('transactions')
                .set(softDel)
                .where('id', '=', currentAccrual.id)
                .execute()
            }
          }

          // Soft-delete future ACCRUAL/ADJUSTMENTs (strictly > current month)
          await db.updateTable('transactions')
            .set(softDel)
            .where('enrollment_id', '=', updated.id)
            .where('type', 'in', ['ACCRUAL', 'ADJUSTMENT'])
            .where('is_deleted', '=', false)
            .where('billing_month', '>', new Date(firstOfEndMonth))
            .execute()

        } else {
          // Standard delete all from firstOfEndMonth (>=)
          await db.updateTable('transactions')
            .set(softDel)
            .where('enrollment_id', '=', updated.id)
            .where('type', 'in', ['ACCRUAL', 'ADJUSTMENT'])
            .where('is_deleted', '=', false)
            .where('billing_month', '>=', new Date(firstOfEndMonth))
            .execute()
        }

        // Per_lesson (billing_month IS NULL): cancel by transaction_date > endDate
        await db.updateTable('transactions')
          .set(softDel)
          .where('enrollment_id', '=', updated.id)
          .where('type', '=', 'ACCRUAL')
          .where('is_deleted', '=', false)
          .where('billing_month', 'is', null)
          .where('transaction_date', '>', new Date(endDate))
          .execute()

        // Delete any REFUNDs (absences) for this enrollment after the unenrollment date
        await db.updateTable('transactions')
          .set(softDel)
          .where('enrollment_id', '=', updated.id)
          .where('type', '=', 'REFUND')
          .where('is_deleted', '=', false)
          .where('transaction_date', '>', new Date(endDate))
          .execute()

        await recalcBalance(updated.child_id, updated.account_id)
      }

      return updated
    }
  )

  // POST /api/enrollments/:id/restore
  app.post<{
    Params: { id: string }
  }>(
    '/enrollments/:id/restore',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { id } = req.params

      const enrollment = await db
        .selectFrom('enrollments')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()

      if (!enrollment) return reply.status(404).send({ error: 'NotFound', message: 'Підписку не знайдено' })
      if (enrollment.status !== 'archived') {
        return reply.status(400).send({ error: 'BadRequest', message: 'Підписка не в архіві' })
      }

      // Check if there is already an active/frozen enrollment for this child and activity
      const activeEnrollment = await db
        .selectFrom('enrollments')
        .select('id')
        .where('child_id', '=', enrollment.child_id)
        .where('activity_id', '=', enrollment.activity_id)
        .where('status', 'in', ['active', 'frozen'])
        .executeTakeFirst()

      if (activeEnrollment) {
        return reply.status(409).send({
          error: 'Conflict',
          message: 'У дитини вже є активна або заморожена підписка на цю активність',
        })
      }

      const originalEndDate = enrollment.end_date

      // Update enrollment status to active
      const restored = await db
        .updateTable('enrollments')
        .set({ status: 'active', end_date: null })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst()

      if (!restored) return reply.status(500).send({ error: 'InternalServerError', message: 'Не вдалося оновити підписку' })

      // Re-open individual prices and tariffs closed on the archive date
      if (originalEndDate) {
        const { toDbDateStr, castAsDate } = await import('../services/dateUtils.js')
        const origEndDateStr = toDbDateStr(originalEndDate)

        await db.updateTable('child_prices')
          .set({ valid_to: null })
          .where('child_id', '=', restored.child_id)
          .where('activity_id', '=', restored.activity_id)
          .where('valid_to', '=', castAsDate(origEndDateStr))
          .execute()

        await db.updateTable('child_individual_tariffs')
          .set({ valid_to: null })
          .where('child_id', '=', restored.child_id)
          .where('activity_id', '=', restored.activity_id)
          .where('valid_to', '=', castAsDate(origEndDateStr))
          .execute()
      }

      // Restore transactions soft-deleted during/after archive
      await db.updateTable('transactions')
        .set({ is_deleted: false, deleted_at: null, deleted_by: null })
        .where('enrollment_id', '=', id)
        .where('is_deleted', '=', true)
        .execute()

      // Recalculate balance
      await recalcBalance(restored.child_id, restored.account_id)

      return restored
    }
  )

  // POST /api/enrollments/:id/rebind-account
  app.post<{
    Params: { id: string }
    Body: {
      new_account_id: string
      from_month: string        // YYYY-MM-01
      to_month?: string         // YYYY-MM-01 (defaults to from_month)
      update_future?: boolean
      force?: boolean
    }
  }>(
    '/enrollments/:id/rebind-account',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { new_account_id, update_future = false, force = false } = req.body
      const from_month = req.body.from_month
      const to_month   = req.body.to_month ?? from_month

      if (!new_account_id || !from_month) {
        return reply.status(400).send({ error: 'BadRequest', message: 'new_account_id та from_month є обовʼязковими' })
      }
      if (!/^\d{4}-\d{2}-01$/.test(from_month) || !/^\d{4}-\d{2}-01$/.test(to_month)) {
        return reply.status(400).send({ error: 'BadRequest', message: 'from_month та to_month мають бути у форматі YYYY-MM-01' })
      }
      if (to_month < from_month) {
        return reply.status(400).send({ error: 'BadRequest', message: 'to_month не може бути раніше from_month' })
      }

      const enrollment = await db.selectFrom('enrollments').selectAll().where('id', '=', req.params.id).executeTakeFirst()
      if (!enrollment) return reply.status(404).send({ error: 'NotFound' })

      const old_account_id = enrollment.account_id
      if (old_account_id === new_account_id) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Новий рахунок збігається з поточним' })
      }

      // Build list of billing months in the range
      const months: string[] = []
      const cur = new Date(from_month)
      const end = new Date(to_month)
      while (cur <= end) {
        months.push(`${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, '0')}-01`)
        cur.setUTCMonth(cur.getUTCMonth() + 1)
      }

      // Check for PAYMENT transactions on old account in the period
      if (!force) {
        const lastDay = new Date(to_month)
        lastDay.setUTCMonth(lastDay.getUTCMonth() + 1)
        lastDay.setUTCDate(0)

        const payments = await db.selectFrom('transactions')
          .select(['id', 'transaction_date', 'amount', 'note'])
          .where('child_id', '=', enrollment.child_id)
          .where('account_id', '=', old_account_id)
          .where('type', '=', 'PAYMENT')
          .where('is_deleted', '=', false)
          .where('transaction_date', '>=', new Date(from_month))
          .where('transaction_date', '<=', lastDay)
          .execute()

        if (payments.length > 0) {
          return reply.status(409).send({
            error: 'HasPayments',
            message: `В обраному періоді є ${payments.length} оплат(и). Перенесення нарахувань без переносу оплат призведе до розбіжності балансів.`,
            payments: payments.map((p) => ({
              id: p.id,
              date: new Date(String(p.transaction_date)).toISOString().slice(0, 10),
              amount: Number(p.amount),
              note: p.note,
            })),
          })
        }
      }

      const deletedBy = (req as { user?: { sub?: string } }).user?.sub ?? null
      const now = new Date().toISOString()
      let movedCount = 0

      for (const month of months) {
        const accruals = await db.selectFrom('transactions')
          .selectAll()
          .where('enrollment_id', '=', req.params.id)
          .where('account_id', '=', old_account_id)
          .where('type', 'in', ['ACCRUAL', 'ADJUSTMENT', 'REFUND'])
          .where('is_deleted', '=', false)
          .where('billing_month', '=', new Date(month))
          .execute()

        for (const tx of accruals) {
          await db.updateTable('transactions')
            .set({ is_deleted: true, deleted_at: now, deleted_by: deletedBy })
            .where('id', '=', tx.id)
            .execute()

          await db.insertInto('transactions')
            .values({
              type: tx.type,
              child_id: tx.child_id,
              account_id: new_account_id,
              activity_id: tx.activity_id,
              enrollment_id: tx.enrollment_id,
              amount: tx.amount,
              transaction_date: new Date(String(tx.transaction_date)).toISOString().slice(0, 10),
              billing_month: tx.billing_month ? new Date(String(tx.billing_month)).toISOString().slice(0, 10) : null,
              note: tx.note,
              metadata_json: { ...(tx.metadata_json as Record<string, unknown> ?? {}), rebind_from_account: old_account_id },
              created_by: deletedBy,
            })
            .execute()

          movedCount++
        }
      }

      await recalcBalance(enrollment.child_id, old_account_id)
      await recalcBalance(enrollment.child_id, new_account_id)

      if (update_future) {
        await db.updateTable('enrollments')
          .set({ account_id: new_account_id })
          .where('id', '=', req.params.id)
          .execute()
      }

      return { moved_count: movedCount, updated_enrollment: update_future }
    }
  )

  // GET /api/price-resolve?child_id=&activity_id=&date=
  app.get<{ Querystring: { child_id: string; activity_id: string; date?: string } }>(
    '/price-resolve',
    { preHandler: authenticate },
    async (req, reply) => {
      const { child_id, activity_id, date } = req.query
      if (!child_id || !activity_id) return reply.status(400).send({ error: 'BadRequest', message: 'child_id та activity_id є обовʼязковими' })

      const asOfDate = new Date(date ?? new Date().toISOString().slice(0, 10))

      // Рівень 2: індивідуальна ціна дитини на цю активність
      const childPrice = await db
        .selectFrom('child_prices')
        .selectAll()
        .where('child_id', '=', child_id)
        .where('activity_id', '=', activity_id)
        .where('valid_from', '<=', asOfDate)
        .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>=', asOfDate)]))
        .orderBy('valid_from', 'desc')
        .executeTakeFirst()

      if (childPrice?.price != null) {
        return { price: Number(childPrice.price), rule: 'child_price', detail: childPrice }
      }

      // Базовий тариф активності
      const tariff = await db
        .selectFrom('tariffs')
        .selectAll()
        .where('activity_id', '=', activity_id)
        .where('valid_from', '<=', asOfDate)
        .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>=', asOfDate)]))
        .orderBy('valid_from', 'desc')
        .executeTakeFirst()

      const baseFee = tariff ? Number(tariff.base_fee) : 0

      // Рівень 3: знижка на цю активність
      if (childPrice?.discount_pct != null) {
        const price = baseFee * (1 - Number(childPrice.discount_pct) / 100)
        return { price: Math.round(price * 100) / 100, rule: 'child_discount', detail: childPrice, base_fee: baseFee }
      }

      // Рівень 4: глобальна знижка дитини
      const globalDiscount = await db
        .selectFrom('child_global_discounts')
        .selectAll()
        .where('child_id', '=', child_id)
        .where('valid_from', '<=', asOfDate)
        .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>=', asOfDate)]))
        .orderBy('valid_from', 'desc')
        .executeTakeFirst()

      if (globalDiscount) {
        const price = baseFee * (1 - Number(globalDiscount.discount_pct) / 100)
        return { price: Math.round(price * 100) / 100, rule: 'global_discount', detail: globalDiscount, base_fee: baseFee }
      }

      // Рівень 5: базова ціна
      return { price: baseFee, rule: 'base_fee', detail: tariff ?? null }
    }
  )
}
