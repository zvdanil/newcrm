import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'
import { createTransaction, recalcBalance } from '../services/balanceService.js'
import { recalcSmartBenefit } from '../services/smartTariffService.js'
import { recalcStaffAccruals, recalcSmartStaffBenefit } from '../services/salaryService.js'
import { getChildIndividualTariff } from '../services/billingRunService.js'

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/**
 * Creates a REFUND transaction for an absent_excused mark if refund config allows it.
 * Returns the transaction id, or null if no refund applies.
 */
async function triggerRefund(
  enrollmentId: string,
  childId: string,
  accountId: string,
  activityId: string,
  date: string,
  createdBy: string | null,
): Promise<string | null> {
  const [activity, refundConfig, tariff] = await Promise.all([
    db.selectFrom('activities').select(['is_rigid']).where('id', '=', activityId).executeTakeFirst(),
    db.selectFrom('refund_configs').selectAll().where('activity_id', '=', activityId).executeTakeFirst(),
    db.selectFrom('tariffs')
      .select('base_fee')
      .where('activity_id', '=', activityId)
      .where('valid_from', '<=', new Date(date))
      .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', new Date(date))]))
      .orderBy('valid_from', 'desc')
      .executeTakeFirst(),
  ])

  if (!refundConfig?.refund_on_excused) return null
  if (activity?.is_rigid) return null  // жёсткий абонемент блокирует возврат основной услуги

  let amount = 0
  if (refundConfig.refund_amount !== null) {
    amount = parseFloat(refundConfig.refund_amount as string)
  } else if (refundConfig.refund_pct !== null && tariff) {
    const pct = parseFloat(refundConfig.refund_pct as string)
    const base = parseFloat(tariff.base_fee as string)
    amount = Math.round(base * pct) / 100
  }

  if (amount <= 0) return null

  return createTransaction({
    type: 'REFUND',
    child_id: childId,
    account_id: accountId,
    activity_id: activityId,
    enrollment_id: enrollmentId,
    amount,
    transaction_date: date,
    note: `Повернення за пропуск ${date}`,
    metadata_json: { refund_config: { amount: refundConfig.refund_amount, pct: refundConfig.refund_pct } },
    created_by: createdBy,
  })
}

/**
 * Soft-deletes an existing REFUND for a given enrollment+date (undo absent_excused).
 */
async function reverseRefund(enrollmentId: string, accountId: string, childId: string, date: string, deletedBy: string | null): Promise<void> {
  const existing = await db
    .selectFrom('transactions')
    .select('id')
    .where('enrollment_id', '=', enrollmentId)
    .where('type', '=', 'REFUND')
    .where('transaction_date', '=', new Date(date))
    .where('is_deleted', '=', false)
    .execute()

  if (existing.length === 0) return

  for (const tx of existing) {
    await db.updateTable('transactions')
      .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: deletedBy })
      .where('id', '=', tx.id)
      .execute()
  }

  await recalcBalance(childId, accountId)
}

/**
 * Создаёт ACCRUAL для одного занятия (per_lesson активность).
 * Вызывается при отметке present / special.
 * custom_amount — сумма из ячейки журнала (спецтариф), иначе берётся текущий тариф.
 */
async function triggerPerLessonAccrual(
  enrollmentId: string,
  childId: string,
  accountId: string,
  activityId: string,
  date: string,
  customAmount: number | null,
  overridePrice: number | null,  // from child_individual_tariff
  createdBy: string | null,
): Promise<string | null> {
  let amount: number

  if (customAmount !== null && customAmount > 0) {
    amount = customAmount
  } else if (overridePrice !== null && overridePrice > 0) {
    amount = overridePrice
  } else {
    const tariff = await db
      .selectFrom('tariffs')
      .select('base_fee')
      .where('activity_id', '=', activityId)
      .where('valid_from', '<=', new Date(date))
      .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', new Date(date))]))
      .orderBy('valid_from', 'desc')
      .executeTakeFirst()

    if (!tariff) return null
    amount = parseFloat(tariff.base_fee as string)

    const childPrice = await db
      .selectFrom('child_prices')
      .select(['price', 'discount_pct'])
      .where('child_id', '=', childId)
      .where('activity_id', '=', activityId)
      .where('valid_from', '<=', new Date(date))
      .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', new Date(date))]))
      .orderBy('valid_from', 'desc')
      .executeTakeFirst()

    if (childPrice?.price !== null && childPrice?.price !== undefined) {
      amount = parseFloat(childPrice.price as string)
    } else if (childPrice?.discount_pct !== null && childPrice?.discount_pct !== undefined) {
      amount = amount * (1 - parseFloat(childPrice.discount_pct as string) / 100)
    }

    amount = Math.round(amount * 100) / 100
  }

  if (amount <= 0) return null

  return createTransaction({
    type: 'ACCRUAL',
    child_id: childId,
    account_id: accountId,
    activity_id: activityId,
    enrollment_id: enrollmentId,
    amount,
    transaction_date: date,
    note: `Заняття ${date}`,
    metadata_json: { per_lesson: true, custom_amount: customAmount },
    created_by: createdBy,
  })
}

/**
 * Soft-delete ACCRUAL за конкретное занятие (при отмене/смене отметки).
 */
async function reversePerLessonAccrual(
  enrollmentId: string,
  accountId: string,
  childId: string,
  date: string,
  deletedBy: string | null,
): Promise<void> {
  const existing = await db
    .selectFrom('transactions')
    .select('id')
    .where('enrollment_id', '=', enrollmentId)
    .where('type', '=', 'ACCRUAL')
    .where('transaction_date', '=', new Date(date))
    .where('billing_month', 'is', null)   // только per_lesson (billing_month не задан)
    .where('is_deleted', '=', false)
    .executeTakeFirst()

  if (!existing) return

  await db
    .updateTable('transactions')
    .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: deletedBy })
    .where('id', '=', existing.id)
    .execute()

  await recalcBalance(childId, accountId)
}

function generateDates(from: string, to: string): string[] {
  const dates: string[] = []
  const current = new Date(from)
  const end = new Date(to)
  while (current <= end) {
    dates.push(toDateStr(current))
    current.setDate(current.getDate() + 1)
  }
  return dates
}

export async function journalsRoutes(app: FastifyInstance) {
  // GET /api/journals?activity_id=&from=&to=
  // Возвращает данные журнала: активность + строки (дети + логи по датам)
  app.get<{ Querystring: { activity_id: string; from: string; to: string } }>(
    '/',
    { preHandler: authenticate },
    async (req, reply) => {
      const { activity_id, from, to } = req.query
      if (!activity_id || !from || !to) {
        return reply.status(400).send({ error: 'BadRequest', message: 'activity_id, from, to є обовʼязковими' })
      }

      const [activity, refundConfig, enrollments, logs, groupLogs] = await Promise.all([
        db.selectFrom('activities as a')
          .leftJoin('accounts as ac', 'ac.id', 'a.account_id')
          .select(['a.id', 'a.name', 'a.account_id', 'a.tariff_type', 'a.is_rigid', 'a.has_group_classes', 'a.auto_group_classes', 'ac.name as account_name'])
          .where('a.id', '=', activity_id)
          .executeTakeFirst(),

        db.selectFrom('refund_configs')
          .selectAll()
          .where('activity_id', '=', activity_id)
          .executeTakeFirst(),

        db.selectFrom('enrollments as e')
          .innerJoin('children as c', 'c.id', 'e.child_id')
          .leftJoin('groups as g', 'g.id', 'c.group_id')
          .select([
            'e.id as enrollment_id', 'e.status', 'e.frozen_from', 'e.frozen_to', 'e.note as enrollment_note',
            'c.id as child_id', 'c.full_name as child_name',
            'g.name as group_name'
          ])
          .where('e.activity_id', '=', activity_id)
          .where('e.status', '!=', 'archived')
          .orderBy('c.full_name', 'asc')
          .execute(),

        db.selectFrom('attendance_logs')
          .selectAll()
          .where('activity_id', '=', activity_id)
          .where('date', '>=', new Date(from))
          .where('date', '<=', new Date(to))
          .execute(),

        db.selectFrom('group_lesson_logs')
          .selectAll()
          .where('activity_id', '=', activity_id)
          .where('date', '>=', new Date(from))
          .where('date', '<=', new Date(to))
          .execute(),
      ])

      if (!activity) return reply.status(404).send({ error: 'NotFound' })

      // Индекс логов: enrollment_id → date → log
      const logsIndex: Record<string, Record<string, typeof logs[0]>> = {}
      for (const log of logs) {
        if (!logsIndex[log.enrollment_id]) logsIndex[log.enrollment_id] = {}
        logsIndex[log.enrollment_id][toDateStr(log.date)] = log
      }

      // Индекс group logs: date → log
      const groupLogsIndex: Record<string, typeof groupLogs[0]> = {}
      for (const log of groupLogs) {
        groupLogsIndex[toDateStr(log.date)] = log
      }

      return {
        activity: { ...activity, refund_config: refundConfig ?? null },
        dates: generateDates(from, to),
        rows: enrollments.map((e) => ({
          enrollment_id: e.enrollment_id,
          child_id: e.child_id,
          child_name: e.child_name,
          group_name: e.group_name,
          status: e.status,
          frozen_from: e.frozen_from ? toDateStr(e.frozen_from as unknown as Date) : null,
          frozen_to:   e.frozen_to   ? toDateStr(e.frozen_to   as unknown as Date) : null,
          logs: logsIndex[e.enrollment_id] ?? {},
        })),
        group_logs: groupLogsIndex,
      }
    }
  )

  // POST /api/attendance — поставить отметку (с каскадом на связанные активности)
  app.post<{
    Body: {
      enrollment_id: string
      date: string
      status: 'present' | 'absent_excused' | 'absent_unexcused' | 'special'
      custom_amount?: number | null
      note?: string | null
    }
  }>(
    '/attendance',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher') },
    async (req, reply) => {
      const { enrollment_id, date, status, custom_amount, note } = req.body
      if (!enrollment_id || !date || !status) {
        return reply.status(400).send({ error: 'BadRequest', message: 'enrollment_id, date, status є обовʼязковими' })
      }

      const enrollment = await db.selectFrom('enrollments')
        .selectAll()
        .where('id', '=', enrollment_id)
        .executeTakeFirst()

      if (!enrollment) return reply.status(404).send({ error: 'NotFound', message: 'Підписку не знайдено' })
      if (enrollment.status === 'archived') return reply.status(409).send({ error: 'Conflict', message: 'Підписка в архіві' })

      // Перевірка заморозки
      if (enrollment.status === 'frozen' && enrollment.frozen_from && enrollment.frozen_to) {
        const logDate = new Date(date)
        const fFrom = new Date(enrollment.frozen_from as unknown as string)
        const fTo   = new Date(enrollment.frozen_to   as unknown as string)
        if (logDate >= fFrom && logDate <= fTo) {
          return reply.status(409).send({ error: 'Frozen', message: 'Підписка заморожена на цю дату' })
        }
      }

      const createdBy = (req.user as { sub: string }).sub

      const log = await db.transaction().execute(async (trx) => {
        // Основна відмітка (upsert)
        const main = await trx.insertInto('attendance_logs')
          .values({
            enrollment_id,
            child_id: enrollment.child_id,
            activity_id: enrollment.activity_id,
            date,
            status,
            custom_amount: custom_amount ?? null,
            note: note ?? null,
            created_by: createdBy,
          })
          .onConflict((oc) =>
            oc.columns(['enrollment_id', 'date']).doUpdateSet({
              status,
              custom_amount: custom_amount ?? null,
              note: note ?? null,
              updated_at: new Date().toISOString() as unknown as Date,
            })
          )
          .returningAll()
          .executeTakeFirstOrThrow()

        // Каскад: знаходимо пов'язані активності (де поточна — батьківська)
        const linked = await trx
          .selectFrom('linked_activities')
          .select('child_activity_id')
          .where('parent_activity_id', '=', enrollment.activity_id)
          .execute()

        const linkedEnrollments: Array<{ id: string; activity_id: string; account_id: string }> = []

        for (const { child_activity_id } of linked) {
          const linkedEnrollment = await trx
            .selectFrom('enrollments')
            .select(['id', 'activity_id', 'account_id', 'status', 'frozen_from', 'frozen_to'])
            .where('child_id', '=', enrollment.child_id)
            .where('activity_id', '=', child_activity_id)
            .where('status', '!=', 'archived')
            .executeTakeFirst()

          if (!linkedEnrollment) continue

          // Пропускаємо якщо дата в заморозці пов'язаної підписки
          if (linkedEnrollment.status === 'frozen' && linkedEnrollment.frozen_from && linkedEnrollment.frozen_to) {
            const logDate = new Date(date)
            const fFrom = new Date(linkedEnrollment.frozen_from as unknown as string)
            const fTo   = new Date(linkedEnrollment.frozen_to   as unknown as string)
            if (logDate >= fFrom && logDate <= fTo) continue
          }

          await trx.insertInto('attendance_logs')
            .values({
              enrollment_id: linkedEnrollment.id,
              child_id: enrollment.child_id,
              activity_id: child_activity_id,
              date,
              status,
              custom_amount: null,
              note: null,
              created_by: createdBy,
            })
            .onConflict((oc) =>
              oc.columns(['enrollment_id', 'date']).doUpdateSet({
                status,
                updated_at: new Date().toISOString() as unknown as Date,
              })
            )
            .execute()

          linkedEnrollments.push({ id: linkedEnrollment.id, activity_id: linkedEnrollment.activity_id, account_id: linkedEnrollment.account_id })
        }

        return { main, linkedEnrollments }
      })

      // Финансовые триггеры (вне DB-транзакции, после записи лога)
      const activity = await db.selectFrom('activities').select('tariff_type').where('id', '=', enrollment.activity_id).executeTakeFirst()
      const ind = await getChildIndividualTariff(enrollment.child_id, enrollment.activity_id, new Date(date))
      const effectiveTariffType = ind?.tariff_type ?? activity?.tariff_type
      const indPrice = ind ? Math.round(parseFloat(ind.price as string) * 100) / 100 : null

      if (effectiveTariffType === 'per_lesson' && (status === 'present' || status === 'special')) {
        await triggerPerLessonAccrual(enrollment_id, enrollment.child_id, enrollment.account_id, enrollment.activity_id, date, custom_amount ?? null, indPrice, createdBy)
      } else if (effectiveTariffType === 'monthly' && status === 'absent_excused') {
        const existingRefund = await db.selectFrom('transactions').select('id')
          .where('enrollment_id', '=', enrollment_id)
          .where('type', '=', 'REFUND')
          .where('transaction_date', '=', new Date(date))
          .where('is_deleted', '=', false)
          .executeTakeFirst()
        if (!existingRefund) {
          await triggerRefund(enrollment_id, enrollment.child_id, enrollment.account_id, enrollment.activity_id, date, createdBy)
          for (const le of log.linkedEnrollments) {
            const leExistingRefund = await db.selectFrom('transactions').select('id')
              .where('enrollment_id', '=', le.id)
              .where('type', '=', 'REFUND')
              .where('transaction_date', '=', new Date(date))
              .where('is_deleted', '=', false)
              .executeTakeFirst()
            if (!leExistingRefund) {
              await triggerRefund(le.id, enrollment.child_id, le.account_id, le.activity_id, date, createdBy)
            }
          }
        }
      } else if (effectiveTariffType === 'smart') {
        const billingMonth = date.slice(0, 7) + '-01'
        await recalcSmartBenefit(enrollment_id, billingMonth)
      }

      // Staff salary auto-accruals
      await recalcStaffAccruals(enrollment.activity_id, date)
      // Smart staff rates: recalc for all smart rates on this activity
      const smartStaffRates = await db.selectFrom('staff_rates')
        .select('id')
        .where('activity_id', '=', enrollment.activity_id)
        .where('rate_type', '=', 'smart')
        .where('rate_category', '=', 'auto')
        .execute()
      for (const r of smartStaffRates) {
        await recalcSmartStaffBenefit(r.id, date.slice(0, 7) + '-01')
      }

      return reply.status(201).send(log.main)
    }
  )

  // PUT /api/attendance/:id — оновити відмітку
  app.put<{
    Params: { id: string }
    Body: {
      status: 'present' | 'absent_excused' | 'absent_unexcused' | 'special'
      custom_amount?: number | null
      note?: string | null
    }
  }>(
    '/attendance/:id',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher') },
    async (req, reply) => {
      const { status, custom_amount, note } = req.body
      const createdBy = (req.user as { sub: string }).sub

      const existing = await db.selectFrom('attendance_logs').selectAll().where('id', '=', req.params.id).executeTakeFirst()
      if (!existing) return reply.status(404).send({ error: 'NotFound' })

      const enrollment = await db.selectFrom('enrollments').selectAll().where('id', '=', existing.enrollment_id).executeTakeFirst()
      if (!enrollment) return reply.status(404).send({ error: 'NotFound' })

      const oldStatus = existing.status
      const dateStr = toDateStr(existing.date as unknown as Date)

      const updated = await db.transaction().execute(async (trx) => {
        const main = await trx.updateTable('attendance_logs')
          .set({ status, custom_amount: custom_amount ?? null, note: note ?? null })
          .where('id', '=', req.params.id)
          .returningAll()
          .executeTakeFirstOrThrow()

        // Каскад оновлення
        const linked = await trx
          .selectFrom('linked_activities')
          .select('child_activity_id')
          .where('parent_activity_id', '=', existing.activity_id)
          .execute()

        for (const { child_activity_id } of linked) {
          await trx.updateTable('attendance_logs')
            .set({ status })
            .where('child_id', '=', existing.child_id)
            .where('activity_id', '=', child_activity_id)
            .where('date', '=', existing.date)
            .execute()
        }

        return main
      })

      // Финансовые триггеры вне DB-транзакции
      const activityRow = await db.selectFrom('activities').select('tariff_type').where('id', '=', existing.activity_id).executeTakeFirst()
      const putInd = await getChildIndividualTariff(existing.child_id, existing.activity_id, new Date(dateStr))
      const putEffectiveType = putInd?.tariff_type ?? activityRow?.tariff_type
      const putIndPrice = putInd ? Math.round(parseFloat(putInd.price as string) * 100) / 100 : null

      const wasChargeable = oldStatus === 'present' || oldStatus === 'special'
      const isChargeable  = status === 'present' || status === 'special'

      if (putEffectiveType === 'per_lesson') {
        if (!wasChargeable && isChargeable) {
          await triggerPerLessonAccrual(existing.enrollment_id, existing.child_id, enrollment.account_id, existing.activity_id, dateStr, custom_amount ?? null, putIndPrice, createdBy)
        } else if (wasChargeable && !isChargeable) {
          await reversePerLessonAccrual(existing.enrollment_id, enrollment.account_id, existing.child_id, dateStr, createdBy)
        } else if (wasChargeable && isChargeable && oldStatus !== status) {
          await reversePerLessonAccrual(existing.enrollment_id, enrollment.account_id, existing.child_id, dateStr, createdBy)
          await triggerPerLessonAccrual(existing.enrollment_id, existing.child_id, enrollment.account_id, existing.activity_id, dateStr, custom_amount ?? null, putIndPrice, createdBy)
        }
      } else if (putEffectiveType === 'smart') {
        if (oldStatus !== status) {
          const billingMonth = dateStr.slice(0, 7) + '-01'
          await recalcSmartBenefit(existing.enrollment_id, billingMonth)
        }
      } else {
        // monthly: логика возврата за absent_excused
        const linked = await db.selectFrom('linked_activities').select('child_activity_id').where('parent_activity_id', '=', existing.activity_id).execute()

        if (oldStatus !== 'absent_excused' && status === 'absent_excused') {
          await triggerRefund(existing.enrollment_id, existing.child_id, enrollment.account_id, existing.activity_id, dateStr, createdBy)
          for (const { child_activity_id } of linked) {
            const le = await db.selectFrom('enrollments').select(['id', 'account_id']).where('child_id', '=', existing.child_id).where('activity_id', '=', child_activity_id).where('status', '!=', 'archived').executeTakeFirst()
            if (le) await triggerRefund(le.id, existing.child_id, le.account_id, child_activity_id, dateStr, createdBy)
          }
        } else if (oldStatus === 'absent_excused' && status !== 'absent_excused') {
          await reverseRefund(existing.enrollment_id, enrollment.account_id, existing.child_id, dateStr, createdBy)
          for (const { child_activity_id } of linked) {
            const le = await db.selectFrom('enrollments').select(['id', 'account_id']).where('child_id', '=', existing.child_id).where('activity_id', '=', child_activity_id).where('status', '!=', 'archived').executeTakeFirst()
            if (le) await reverseRefund(le.id, le.account_id, existing.child_id, dateStr, createdBy)
          }
        }
      }

      // Staff salary auto-accruals after PUT
      await recalcStaffAccruals(existing.activity_id, dateStr)
      const smartStaffRatesPut = await db.selectFrom('staff_rates')
        .select('id')
        .where('activity_id', '=', existing.activity_id)
        .where('rate_type', '=', 'smart')
        .where('rate_category', '=', 'auto')
        .execute()
      for (const r of smartStaffRatesPut) {
        await recalcSmartStaffBenefit(r.id, dateStr.slice(0, 7) + '-01')
      }

      return updated
    }
  )

  // DELETE /api/attendance/:id — зняти відмітку
  app.delete<{ Params: { id: string } }>(
    '/attendance/:id',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher') },
    async (req, reply) => {
      const deletedBy = (req.user as { sub: string }).sub

      const log = await db.selectFrom('attendance_logs').selectAll().where('id', '=', req.params.id).executeTakeFirst()
      if (!log) return reply.status(404).send({ error: 'NotFound' })

      const enrollment = await db.selectFrom('enrollments').selectAll().where('id', '=', log.enrollment_id).executeTakeFirst()

      await db.deleteFrom('attendance_logs').where('id', '=', req.params.id).execute()

      if (enrollment) {
        const dateStr = toDateStr(log.date as unknown as Date)
        const actRow = await db.selectFrom('activities').select('tariff_type').where('id', '=', log.activity_id).executeTakeFirst()
        const delInd = await getChildIndividualTariff(log.child_id, log.activity_id, new Date(dateStr))
        const delEffectiveType = delInd?.tariff_type ?? actRow?.tariff_type

        if (delEffectiveType === 'per_lesson') {
          if (log.status === 'present' || log.status === 'special') {
            await reversePerLessonAccrual(log.enrollment_id, enrollment.account_id, log.child_id, dateStr, deletedBy)
          }
        } else if (delEffectiveType === 'smart') {
          if (log.status === 'absent_excused') {
            const billingMonth = dateStr.slice(0, 7) + '-01'
            await recalcSmartBenefit(log.enrollment_id, billingMonth)
          }
        } else if (log.status === 'absent_excused') {
          await reverseRefund(log.enrollment_id, enrollment.account_id, log.child_id, dateStr, deletedBy)
          const linked = await db.selectFrom('linked_activities').select('child_activity_id').where('parent_activity_id', '=', log.activity_id).execute()
          for (const { child_activity_id } of linked) {
            const le = await db.selectFrom('enrollments').select(['id', 'account_id']).where('child_id', '=', log.child_id).where('activity_id', '=', child_activity_id).where('status', '!=', 'archived').executeTakeFirst()
            if (le) await reverseRefund(le.id, le.account_id, log.child_id, dateStr, deletedBy)
          }
        }
      }

      // Staff salary auto-accruals after DELETE
      if (log.activity_id) {
        const dateStrDel = toDateStr(log.date as unknown as Date)
        await recalcStaffAccruals(log.activity_id, dateStrDel)
        const smartStaffRatesDel = await db.selectFrom('staff_rates')
          .select('id')
          .where('activity_id', '=', log.activity_id)
          .where('rate_type', '=', 'smart')
          .where('rate_category', '=', 'auto')
          .execute()
        for (const r of smartStaffRatesDel) {
          await recalcSmartStaffBenefit(r.id, dateStrDel.slice(0, 7) + '-01')
        }
      }

      return { ok: true }
    }
  )

  // POST /api/journals/group-attendance
  app.post<{
    Body: {
      activity_id: string
      date: string
      status: 'conducted' | 'cancelled'
      lessons_count?: number
    }
  }>(
    '/group-attendance',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher') },
    async (req, reply) => {
      const { activity_id, date, status, lessons_count } = req.body
      if (!activity_id || !date || !status) {
        return reply.status(400).send({ error: 'BadRequest', message: 'activity_id, date, status є обовʼязковими' })
      }

      const createdBy = (req.user as { sub: string }).sub

      const log = await db.insertInto('group_lesson_logs')
        .values({
          activity_id,
          date,
          status,
          lessons_count: lessons_count ?? 1,
          created_by: createdBy,
        })
        .onConflict((oc) =>
          oc.columns(['activity_id', 'date']).doUpdateSet({
            status,
            lessons_count: lessons_count ?? 1,
            updated_at: new Date().toISOString() as unknown as Date,
          })
        )
        .returningAll()
        .executeTakeFirstOrThrow()

      // Staff salary auto-accruals
      await recalcStaffAccruals(activity_id, date)
      
      return reply.status(201).send(log)
    }
  )

  // DELETE /api/journals/group-attendance/:id
  app.delete<{ Params: { id: string } }>(
    '/group-attendance/:id',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher') },
    async (req, reply) => {
      const log = await db.selectFrom('group_lesson_logs').selectAll().where('id', '=', req.params.id).executeTakeFirst()
      if (!log) return reply.status(404).send({ error: 'NotFound' })

      await db.deleteFrom('group_lesson_logs').where('id', '=', req.params.id).execute()

      // Staff salary auto-accruals after DELETE
      const dateStrDel = toDateStr(log.date as unknown as Date)
      await recalcStaffAccruals(log.activity_id, dateStrDel)

      return { ok: true }
    }
  )
}
