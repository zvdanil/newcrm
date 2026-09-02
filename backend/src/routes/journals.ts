import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'
import { createTransaction, recalcBalance } from '../services/balanceService.js'
import { recalcSmartBenefit } from '../services/smartTariffService.js'
import { recalcStaffAccruals, recalcSmartStaffBenefit, recalcSmartPerChildBenefit } from '../services/salaryService.js'
import { getChildIndividualTariff, getEffectivePrice, countWorkingDays } from '../services/billingRunService.js'
import { castAsDate, toDbDateStr } from '../services/dateUtils.js'

function toDateStr(d: Date): string {
  return toDbDateStr(d)
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
  status: string,
  createdBy: string | null,
): Promise<string | null> {
  const [activity, refundConfig, tariff] = await Promise.all([
    db.selectFrom('activities').select(['tariff_type', 'is_rigid']).where('id', '=', activityId).executeTakeFirst(),
    db.selectFrom('refund_configs').selectAll().where('activity_id', '=', activityId).executeTakeFirst(),
    db.selectFrom('tariffs')
      .select('base_fee')
      .where('activity_id', '=', activityId)
      .where('valid_from', '<=', castAsDate(date))
      .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>=', castAsDate(date))]))
      .orderBy('valid_from', 'desc')
      .executeTakeFirst(),
  ])

  if (!refundConfig?.refund_on_excused && status !== 'absent_excused_30') return null
  if (activity?.is_rigid) return null  // жёсткий абонемент блокирует возврат основной услуги

  const ind = await getChildIndividualTariff(childId, activityId, date)
  const effectiveTariffType = ind?.tariff_type ?? activity?.tariff_type

  let R = 0
  if (effectiveTariffType === 'smart') {
    const l2Refund = ind?.l2_refund_per_absence ?? (
      await db.selectFrom('smart_tariff_configs')
        .select('l2_refund_per_absence')
        .where('activity_id', '=', activityId)
        .executeTakeFirst()
    )?.l2_refund_per_absence
    if (l2Refund != null) {
      R = parseFloat(l2Refund as string)
    }
  } else if (refundConfig?.refund_on_excused) {
    if (refundConfig.refund_amount !== null) {
      R = parseFloat(refundConfig.refund_amount as string)
    } else if (refundConfig.refund_pct !== null && tariff) {
      const pct = parseFloat(refundConfig.refund_pct as string)
      const base = parseFloat(tariff.base_fee as string)
      R = Math.round(base * pct) / 100
    }
  }

  let amount = R
  if (status === 'absent_excused_30') {
    const billingDate = new Date(date)
    const ind = await getChildIndividualTariff(childId, activityId, date)
    const P = ind
      ? Math.round(parseFloat(ind.price as string) * 100) / 100
      : await getEffectivePrice(childId, activityId, date)
    if (P !== null && P > 0) {
      const year = billingDate.getUTCFullYear()
      const month = billingDate.getUTCMonth()
      const firstDay = new Date(Date.UTC(year, month, 1))
      const lastDay = new Date(Date.UTC(year, month + 1, 0))
      const W = countWorkingDays(firstDay, lastDay)
      if (W > 0) {
        const D = Math.round(P / W)
        const diff = D - R
        if (diff > 0) {
          amount = R + 0.3 * diff
        }
      }
    }
  }

  amount = Math.round(amount * 100) / 100
  if (amount <= 0) return null

  const billingMonth = date.slice(0, 7) + '-01'
  return createTransaction({
    type: 'REFUND',
    child_id: childId,
    account_id: accountId,
    activity_id: activityId,
    enrollment_id: enrollmentId,
    amount,
    transaction_date: date,
    billing_month: billingMonth,
    note: `Повернення за пропуск ${date}`,
    metadata_json: { refund_config: { amount: refundConfig?.refund_amount ?? null, pct: refundConfig?.refund_pct ?? null } },
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
    .where('transaction_date', '=', castAsDate(date))
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
  } else if (overridePrice !== null) {
    // Individual tariff applies even when price = 0 (free lesson)
    amount = overridePrice
  } else {
    const tariff = await db
      .selectFrom('tariffs')
      .select('base_fee')
      .where('activity_id', '=', activityId)
      .where('valid_from', '<=', castAsDate(date))
      .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>=', castAsDate(date))]))
      .orderBy('valid_from', 'desc')
      .executeTakeFirst()

    if (!tariff) return null
    amount = parseFloat(tariff.base_fee as string)

    const childPrice = await db
      .selectFrom('child_prices')
      .select(['price', 'discount_pct'])
      .where('child_id', '=', childId)
      .where('activity_id', '=', activityId)
      .where('valid_from', '<=', castAsDate(date))
      .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>=', castAsDate(date))]))
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

  // Check if an un-deleted per-lesson ACCRUAL transaction already exists for this enrollment & date
  const existingTxs = await db
    .selectFrom('transactions')
    .select(['id', 'amount'])
    .where('enrollment_id', '=', enrollmentId)
    .where('type', '=', 'ACCRUAL')
    .where('transaction_date', '=', castAsDate(date))
    .where('billing_month', 'is', null)
    .where('is_deleted', '=', false)
    .execute()

  if (existingTxs.length > 0) {
    const matching = existingTxs.find(tx => Math.abs(parseFloat(tx.amount as string) - amount) < 0.01)
    if (matching) {
      // If there are duplicate matching transactions, soft-delete extra duplicates
      const duplicates = existingTxs.filter(tx => tx.id !== matching.id)
      for (const dup of duplicates) {
        await db.updateTable('transactions')
          .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: createdBy })
          .where('id', '=', dup.id)
          .execute()
      }
      if (duplicates.length > 0) {
        await recalcBalance(childId, accountId)
      }
      return matching.id
    }
    // Amount changed — soft delete all previous transactions for this date
    for (const tx of existingTxs) {
      await db.updateTable('transactions')
        .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: createdBy })
        .where('id', '=', tx.id)
        .execute()
    }
  }

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
    .where('transaction_date', '=', castAsDate(date))
    .where('billing_month', 'is', null)   // только per_lesson (billing_month не задан)
    .where('is_deleted', '=', false)
    .execute()

  if (existing.length === 0) return

  for (const tx of existing) {
    await db
      .updateTable('transactions')
      .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: deletedBy })
      .where('id', '=', tx.id)
      .execute()
  }

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

interface AttributedNote { role: string; name: string; text: string }

function transformLogNotes(
  log: any,
  userId: string,
  role: string
): { note: string | null; attributed_notes: AttributedNote[]; has_note: boolean } {
  const entries: Array<{ user_id: string; role: string; name: string; text: string }> =
    Array.isArray(log.notes_json) ? log.notes_json : []

  if (role === 'duty_admin') {
    const mine = entries.find(n => n.user_id === userId)
    return { note: mine?.text ?? null, attributed_notes: [], has_note: !!mine?.text }
  }

  const mine   = entries.find(n => n.user_id === userId)
  const others = entries.filter(n => n.user_id !== userId)

  // For owner: fall back to legacy `note` field in textarea if no notes_json entry yet
  let myNote = mine?.text ?? null
  if (!myNote && role === 'owner') myNote = (log.note as string | null) ?? null

  return {
    note:             myNote,
    attributed_notes: others.map(n => ({ role: n.role, name: n.name, text: n.text })),
    has_note:         !!myNote || others.length > 0,
  }
}

async function fetchUserName(userId: string): Promise<string> {
  const u = await db.selectFrom('users').select(['name', 'email']).where('id', '=', userId).executeTakeFirst()
  return u?.name || u?.email || 'Невідомо'
}

function buildNotesJsonUpsert(userId: string, userRole: string, userName: string, noteText: string | null) {
  const entry = noteText?.trim()
    ? JSON.stringify([{ user_id: userId, role: userRole, name: userName, text: noteText.trim() }])
    : '[]'
  return sql<unknown>`
    COALESCE(
      (SELECT jsonb_agg(e) FROM jsonb_array_elements(attendance_logs.notes_json) e
       WHERE (e->>'user_id') != ${userId}),
      '[]'::jsonb
    ) || ${entry}::jsonb
  `
}

/**
 * Synchronizes financial transactions (accruals, refunds, smart benefits) when an attendance log
 * is created, updated, or deleted. Unified across POST, PUT, and DELETE routes.
 */
export async function syncAttendanceFinancials(params: {
  enrollmentId: string
  childId: string
  accountId: string
  activityId: string
  date: string
  oldStatus: string | null
  newStatus: string | null
  oldCustomAmount?: number | null
  newCustomAmount?: number | null
  userId: string | null
}): Promise<void> {
  const {
    enrollmentId,
    childId,
    accountId,
    activityId,
    date,
    oldStatus,
    newStatus,
    oldCustomAmount,
    newCustomAmount,
    userId,
  } = params

  const activityRow = await db.selectFrom('activities').select('tariff_type').where('id', '=', activityId).executeTakeFirst()
  const ind = await getChildIndividualTariff(childId, activityId, date)
  const effectiveTariffType = ind?.tariff_type ?? activityRow?.tariff_type
  const indPrice = ind ? Math.round(parseFloat(ind.price as string) * 100) / 100 : null

  const isChargeable = (s: string | null) => s === 'present' || s === 'special' || s === 'separate_billing'
  const isExcused = (s: string | null) => s === 'absent_excused' || s === 'absent_excused_30'

  const wasChargeable = isChargeable(oldStatus)
  const isNowChargeable = isChargeable(newStatus)
  const wasExcused = isExcused(oldStatus)
  const isNowExcused = isExcused(newStatus)

  const oldAmt = oldCustomAmount != null ? Number(oldCustomAmount) : null
  const newAmt = newCustomAmount != null ? Number(newCustomAmount) : null
  const amountChanged = oldAmt !== newAmt

  const linked = await db.selectFrom('linked_activities').select('child_activity_id').where('parent_activity_id', '=', activityId).execute()

  if (effectiveTariffType === 'per_lesson') {
    if (wasChargeable && !isNowChargeable) {
      await reversePerLessonAccrual(enrollmentId, accountId, childId, date, userId)
      for (const { child_activity_id } of linked) {
        const le = await db.selectFrom('enrollments').select(['id', 'account_id']).where('child_id', '=', childId).where('activity_id', '=', child_activity_id).where('status', '!=', 'archived').executeTakeFirst()
        if (le) await reversePerLessonAccrual(le.id, le.account_id, childId, date, userId)
      }
    } else if (!wasChargeable && isNowChargeable) {
      await triggerPerLessonAccrual(enrollmentId, childId, accountId, activityId, date, newCustomAmount ?? null, indPrice, userId)
      for (const { child_activity_id } of linked) {
        const le = await db.selectFrom('enrollments').select(['id', 'account_id']).where('child_id', '=', childId).where('activity_id', '=', child_activity_id).where('status', '!=', 'archived').executeTakeFirst()
        if (le) {
          const leInd = await getChildIndividualTariff(childId, child_activity_id, date)
          const leIndPrice = leInd ? Math.round(parseFloat(leInd.price as string) * 100) / 100 : null
          await triggerPerLessonAccrual(le.id, childId, le.account_id, child_activity_id, date, null, leIndPrice, userId)
        }
      }
    } else if (wasChargeable && isNowChargeable && (oldStatus !== newStatus || amountChanged)) {
      await reversePerLessonAccrual(enrollmentId, accountId, childId, date, userId)
      await triggerPerLessonAccrual(enrollmentId, childId, accountId, activityId, date, newCustomAmount ?? null, indPrice, userId)
      for (const { child_activity_id } of linked) {
        const le = await db.selectFrom('enrollments').select(['id', 'account_id']).where('child_id', '=', childId).where('activity_id', '=', child_activity_id).where('status', '!=', 'archived').executeTakeFirst()
        if (le) {
          const leInd = await getChildIndividualTariff(childId, child_activity_id, date)
          const leIndPrice = leInd ? Math.round(parseFloat(leInd.price as string) * 100) / 100 : null
          await reversePerLessonAccrual(le.id, le.account_id, childId, date, userId)
          await triggerPerLessonAccrual(le.id, childId, le.account_id, child_activity_id, date, null, leIndPrice, userId)
        }
      }
    }
  } else if (effectiveTariffType === 'smart') {
    const was30 = oldStatus === 'absent_excused_30'
    const isNow30 = newStatus === 'absent_excused_30'
    if (was30 && (!isNow30 || oldStatus !== newStatus)) {
      await reverseRefund(enrollmentId, accountId, childId, date, userId)
      for (const { child_activity_id } of linked) {
        const le = await db.selectFrom('enrollments').select(['id', 'account_id']).where('child_id', '=', childId).where('activity_id', '=', child_activity_id).where('status', '!=', 'archived').executeTakeFirst()
        if (le) await reverseRefund(le.id, le.account_id, childId, date, userId)
      }
    }
    if (isNow30 && (!was30 || oldStatus !== newStatus)) {
      await triggerRefund(enrollmentId, childId, accountId, activityId, date, newStatus!, userId)
      for (const { child_activity_id } of linked) {
        const le = await db.selectFrom('enrollments').select(['id', 'account_id']).where('child_id', '=', childId).where('activity_id', '=', child_activity_id).where('status', '!=', 'archived').executeTakeFirst()
        if (le) await triggerRefund(le.id, childId, le.account_id, child_activity_id, date, newStatus!, userId)
      }
    }

    if (oldStatus !== newStatus || amountChanged || (wasExcused !== isNowExcused)) {
      const billingMonth = date.slice(0, 7) + '-01'
      await recalcSmartBenefit(enrollmentId, billingMonth)
    }
  } else {
    // monthly: refund handling for absent_excused / absent_excused_30
    if (wasExcused && (!isNowExcused || oldStatus !== newStatus)) {
      await reverseRefund(enrollmentId, accountId, childId, date, userId)
      for (const { child_activity_id } of linked) {
        const le = await db.selectFrom('enrollments').select(['id', 'account_id']).where('child_id', '=', childId).where('activity_id', '=', child_activity_id).where('status', '!=', 'archived').executeTakeFirst()
        if (le) await reverseRefund(le.id, le.account_id, childId, date, userId)
      }
    }
    if (isNowExcused && (!wasExcused || oldStatus !== newStatus)) {
      await triggerRefund(enrollmentId, childId, accountId, activityId, date, newStatus!, userId)
      for (const { child_activity_id } of linked) {
        const le = await db.selectFrom('enrollments').select(['id', 'account_id']).where('child_id', '=', childId).where('activity_id', '=', child_activity_id).where('status', '!=', 'archived').executeTakeFirst()
        if (le) await triggerRefund(le.id, childId, le.account_id, child_activity_id, date, newStatus!, userId)
      }
    }
  }

  // Staff salary auto-accruals
  await recalcStaffAccruals(activityId, date)
  const smartStaffRates = await db.selectFrom('staff_rates')
    .select(['id', 'rate_type'])
    .where('activity_id', '=', activityId)
    .where('rate_type', 'in', ['smart', 'smart_per_child'])
    .where('rate_category', '=', 'auto')
    .execute()
  for (const r of smartStaffRates) {
    if (r.rate_type === 'smart') {
      await recalcSmartStaffBenefit(r.id, date.slice(0, 7) + '-01')
    } else {
      await recalcSmartPerChildBenefit(r.id, date.slice(0, 7) + '-01')
    }
  }
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

      const [activity, refundConfig, enrollments, logs, groupLogs, rawStaffRates] = await Promise.all([
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
            'c.id as child_id', 'c.full_name as child_name', 'c.group_id',
            'g.name as group_name'
          ])
          .where('e.activity_id', '=', activity_id)
          .where(eb => eb.or([
            eb('e.status', '!=', 'archived'),
            eb('e.id', 'in',
              db.selectFrom('attendance_logs')
                .select('enrollment_id')
                .where('activity_id', '=', activity_id)
                .where('date', '>=', sql<Date>`CAST(${from} AS DATE)`)
                .where('date', '<=', sql<Date>`CAST(${to} AS DATE)`)
            )
          ]))
          .orderBy('c.full_name', 'asc')
          .execute(),

        db.selectFrom('attendance_logs')
          .selectAll()
          .where('activity_id', '=', activity_id)
          .where('date', '>=', castAsDate(from))
          .where('date', '<=', castAsDate(to))
          .execute(),

        db.selectFrom('group_lesson_logs')
          .selectAll()
          .where('activity_id', '=', activity_id)
          .where('date', '>=', castAsDate(from))
          .where('date', '<=', castAsDate(to))
          .execute(),

        db.selectFrom('staff_rates as sr')
          .innerJoin('staff as s', 's.id', 'sr.staff_id')
          .select(['s.id as staff_id', 's.full_name', 'sr.rate_type', 'sr.valid_from', 'sr.valid_to', 'sr.created_at'])
          .where('sr.activity_id', '=', activity_id)
          .where('sr.rate_category', '=', 'auto')
          .where('sr.rate_type', 'in', ['group_lesson', 'per_lesson', 'per_child', 'individual_per_child', 'smart', 'smart_per_child'])
          .where('sr.valid_from', '<=', castAsDate(to))
          .where('sr.valid_to', 'is', null)
          .orderBy('sr.created_at', 'desc')
          .execute(),
      ])

      if (!activity) return reply.status(404).send({ error: 'NotFound' })

      const childIds = Array.from(new Set(enrollments.map(e => e.child_id)))
      const historyRows = childIds.length > 0
        ? await db.selectFrom('child_group_history as cgh')
            .leftJoin('groups as g', 'g.id', 'cgh.group_id')
            .select([
              'cgh.id as history_id',
              'cgh.child_id',
              'cgh.group_id',
              'cgh.start_date',
              'cgh.end_date',
              'g.name as group_name',
            ])
            .where('cgh.child_id', 'in', childIds)
            .where('cgh.start_date', '<=', castAsDate(to))
            .where(eb => eb.or([
              eb('cgh.end_date', 'is', null),
              eb('cgh.end_date', '>=', castAsDate(from))
            ]))
            .orderBy('cgh.start_date', 'asc')
            .execute()
        : []

      const historyMap = new Map<string, typeof historyRows>()
      for (const h of historyRows) {
        if (!historyMap.has(h.child_id)) historyMap.set(h.child_id, [])
        historyMap.get(h.child_id)!.push(h)
      }

      const requestUserId = req.user.sub
      const requestRole   = req.user.role
      const isDutyAdmin   = requestRole === 'duty_admin'

      // Deduplicate assigned staff by staff_id to prevent multiple rows per teacher
      const staffMap = new Map<string, { staff_id: string; full_name: string; rate_type: string }>()
      for (const r of rawStaffRates) {
        if (!staffMap.has(r.staff_id)) {
          staffMap.set(r.staff_id, { staff_id: r.staff_id, full_name: r.full_name, rate_type: r.rate_type })
        }
      }
      const assignedStaff = Array.from(staffMap.values()).sort((a, b) => a.full_name.localeCompare(b.full_name))

      // Индекс логов: enrollment_id → date → log
      const logsIndex: Record<string, Record<string, typeof logs[0]>> = {}
      for (const log of logs) {
        if (!logsIndex[log.enrollment_id]) logsIndex[log.enrollment_id] = {}
        logsIndex[log.enrollment_id][toDateStr(log.date)] = log
      }

      // Индекс group logs:
      // Если у лога есть staff_id — индексируем по key `${d}::${staff_id}`.
      // Если staff_id IS NULL (для старых записей) — индексируем по `d`.
      const groupLogsIndex: Record<string, typeof groupLogs[0]> = {}
      for (const log of groupLogs) {
        const d = toDateStr(log.date)
        if (log.staff_id) {
          groupLogsIndex[`${d}::${log.staff_id}`] = log
        } else {
          groupLogsIndex[d] = log
        }
      }

      const groupTeachers = assignedStaff
        .filter(s => s.rate_type === 'group_lesson')
        .map(s => ({ id: s.staff_id, full_name: s.full_name }))

      const groupTeacherIds = new Set(groupTeachers.map(g => g.id))
      const additionalTeachers = assignedStaff
        .filter(s => !groupTeacherIds.has(s.staff_id))
        .map(s => ({ id: s.staff_id, full_name: s.full_name }))

      return {
        activity: { ...activity, refund_config: refundConfig ?? null },
        dates: generateDates(from, to),
        rows: enrollments.flatMap((e) => {
          const childHistories = historyMap.get(e.child_id) ?? []
          const rowLogs = logsIndex[e.enrollment_id] ?? {}
          const maskedLogs = Object.fromEntries(
            Object.entries(rowLogs).map(([d, l]) => {
              const notesInfo = transformLogNotes(l, requestUserId, requestRole)
              return [d, {
                ...l,
                custom_amount:    isDutyAdmin && l.status === 'special' ? null : l.custom_amount,
                note:             notesInfo.note,
                attributed_notes: notesInfo.attributed_notes,
                has_note:         notesInfo.has_note,
                notes_json:       undefined, // never expose raw array to client
              }]
            })
          )

          if (childHistories.length > 0) {
            return childHistories.map(h => {
              const hStart = toDateStr(h.start_date as unknown as Date)
              const hEnd = h.end_date ? toDateStr(h.end_date as unknown as Date) : null

              const effective_start = hStart > from ? hStart : from
              const effective_end = (hEnd && hEnd < to) ? hEnd : to

              return {
                enrollment_id: e.enrollment_id,
                history_id: h.history_id,
                child_id: e.child_id,
                child_name: e.child_name,
                group_id: h.group_id,
                group_name: h.group_name ?? e.group_name ?? null,
                effective_start,
                effective_end,
                status: e.status,
                frozen_from: e.frozen_from ? toDateStr(e.frozen_from as unknown as Date) : null,
                frozen_to:   e.frozen_to   ? toDateStr(e.frozen_to   as unknown as Date) : null,
                logs: maskedLogs,
              }
            })
          } else {
            return [{
              enrollment_id: e.enrollment_id,
              history_id: `default_${e.child_id}`,
              child_id: e.child_id,
              child_name: e.child_name,
              group_id: e.group_id ?? null,
              group_name: e.group_name ?? null,
              effective_start: from,
              effective_end: to,
              status: e.status,
              frozen_from: e.frozen_from ? toDateStr(e.frozen_from as unknown as Date) : null,
              frozen_to:   e.frozen_to   ? toDateStr(e.frozen_to   as unknown as Date) : null,
              logs: maskedLogs,
            }]
          }
        }),
        group_logs: groupLogsIndex,
        assigned_staff: { group_teachers: groupTeachers, additional_teachers: additionalTeachers },
      }
    }
  )

  // POST /api/attendance — поставить отметку (с каскадом на связанные активности)
  app.post<{
    Body: {
      enrollment_id: string
      date: string
      status: 'present' | 'absent_excused' | 'absent_excused_30' | 'absent_unexcused' | 'special' | 'separate_billing'
      custom_amount?: number | null
      note?: string | null
      is_individual_class?: boolean
    }
  }>(
    '/attendance',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher', 'duty_admin') },
    async (req, reply) => {
      const { enrollment_id, date, status, custom_amount, note, is_individual_class } = req.body
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

      // Check for existing log before insertion to capture oldStatus & oldCustomAmount
      const existingBefore = await db
        .selectFrom('attendance_logs')
        .select(['status', 'custom_amount'])
        .where('enrollment_id', '=', enrollment_id)
        .where('date', '=', castAsDate(date))
        .executeTakeFirst()

      const createdBy = req.user.sub
      const createdByRole = req.user.role
      const createdByName = await fetchUserName(createdBy)
      const initialNotesJson = JSON.stringify(
        note?.trim() ? [{ user_id: createdBy, role: createdByRole, name: createdByName, text: note.trim() }] : []
      )

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
            note: note?.trim() || null,
            notes_json: initialNotesJson,
            created_by: createdBy,
            is_individual_class: is_individual_class ?? false,
          })
          .onConflict((oc) =>
            oc.columns(['enrollment_id', 'date']).doUpdateSet({
              status,
              custom_amount: custom_amount ?? null,
              note: note?.trim() || null,
              notes_json: initialNotesJson,
              is_individual_class: is_individual_class ?? false,
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
              notes_json: '[]',
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

      // Единая финансовая синхронизация (после записи лога)
      await syncAttendanceFinancials({
        enrollmentId: enrollment_id,
        childId: enrollment.child_id,
        accountId: enrollment.account_id,
        activityId: enrollment.activity_id,
        date,
        oldStatus: existingBefore?.status ?? null,
        newStatus: status,
        oldCustomAmount: existingBefore?.custom_amount != null ? Number(existingBefore.custom_amount) : null,
        newCustomAmount: custom_amount ?? null,
        userId: createdBy,
      })

      return reply.status(201).send(log.main)
    }
  )

  // PUT /api/attendance/:id — оновити відмітку
  app.put<{
    Params: { id: string }
    Body: {
      status: 'present' | 'absent_excused' | 'absent_excused_30' | 'absent_unexcused' | 'special' | 'separate_billing'
      custom_amount?: number | null
      note?: string | null
      is_individual_class?: boolean
    }
  }>(
    '/attendance/:id',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher', 'duty_admin') },
    async (req, reply) => {
      const { status, custom_amount, note, is_individual_class } = req.body
      const createdBy = (req.user as { sub: string }).sub

      const existing = await db.selectFrom('attendance_logs').selectAll().where('id', '=', req.params.id).executeTakeFirst()
      if (!existing) return reply.status(404).send({ error: 'NotFound' })

      const enrollment = await db.selectFrom('enrollments').selectAll().where('id', '=', existing.enrollment_id).executeTakeFirst()
      if (!enrollment) return reply.status(404).send({ error: 'NotFound' })

      const oldStatus = existing.status
      const oldCustomAmount = existing.custom_amount != null ? Number(existing.custom_amount) : null
      const dateStr = toDateStr(existing.date as unknown as Date)

      // duty_admin не может изменить custom_amount у special-отметки
      const safeCustomAmount = (req.user.role === 'duty_admin' && existing.status === 'special' && status === 'special')
        ? (existing.custom_amount != null ? Number(existing.custom_amount) : null)
        : (custom_amount ?? null)

      const putUserId   = req.user.sub
      const putUserRole = req.user.role
      const putUserName = await fetchUserName(putUserId)

      const updated = await db.transaction().execute(async (trx) => {
        const main = await trx.updateTable('attendance_logs')
          .set({
            status,
            custom_amount: safeCustomAmount,
            notes_json: buildNotesJsonUpsert(putUserId, putUserRole, putUserName, note ?? null),
            is_individual_class: is_individual_class ?? false,
          })
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

      // Единая финансовая синхронизация
      await syncAttendanceFinancials({
        enrollmentId: existing.enrollment_id,
        childId: existing.child_id,
        accountId: enrollment.account_id,
        activityId: existing.activity_id,
        date: dateStr,
        oldStatus,
        newStatus: status,
        oldCustomAmount,
        newCustomAmount: safeCustomAmount,
        userId: putUserId,
      })

      return updated
    }
  )

  // DELETE /api/attendance/:id — зняти відмітку
  app.delete<{ Params: { id: string } }>(
    '/attendance/:id',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher', 'duty_admin') },
    async (req, reply) => {
      const deletedBy = (req.user as { sub: string }).sub

      const log = await db.selectFrom('attendance_logs').selectAll().where('id', '=', req.params.id).executeTakeFirst()
      if (!log) return reply.status(404).send({ error: 'NotFound' })

      if (req.user.role === 'duty_admin' && log.status === 'special') {
        return reply.status(403).send({ error: 'Forbidden', message: 'Адмін зміни не може видаляти записи з встановленим тарифом' })
      }

      const enrollment = await db.selectFrom('enrollments').selectAll().where('id', '=', log.enrollment_id).executeTakeFirst()

      await db.deleteFrom('attendance_logs').where('id', '=', req.params.id).execute()

      if (enrollment) {
        const dateStr = toDateStr(log.date as unknown as Date)

        // Единая финансовая синхронизация при удалении
        await syncAttendanceFinancials({
          enrollmentId: log.enrollment_id,
          childId: log.child_id,
          accountId: enrollment.account_id,
          activityId: log.activity_id,
          date: dateStr,
          oldStatus: log.status,
          newStatus: null,
          oldCustomAmount: log.custom_amount != null ? Number(log.custom_amount) : null,
          newCustomAmount: null,
          userId: deletedBy,
        })
      }

      return { ok: true }
    }
  )

  // POST /api/journals/group-attendance
  app.post<{
    Body: {
      activity_id: string
      staff_id?: string | null
      date: string
      status: 'conducted' | 'cancelled'
      lessons_count?: number
    }
  }>(
    '/group-attendance',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher', 'duty_admin') },
    async (req, reply) => {
      const { activity_id, staff_id, date, status, lessons_count } = req.body
      if (!activity_id || !date || !status) {
        return reply.status(400).send({ error: 'BadRequest', message: 'activity_id, date, status є обовʼязковими' })
      }

      const createdBy = (req.user as { sub: string }).sub
      const targetStaffId = staff_id ?? null

      let existingQuery = db.selectFrom('group_lesson_logs')
        .select('id')
        .where('activity_id', '=', activity_id)
        .where('date', '=', castAsDate(date))

      if (targetStaffId) {
        existingQuery = existingQuery.where('staff_id', '=', targetStaffId)
      } else {
        existingQuery = existingQuery.where('staff_id', 'is', null)
      }

      const existing = await existingQuery.executeTakeFirst()

      let log
      if (existing) {
        log = await db.updateTable('group_lesson_logs')
          .set({
            status,
            lessons_count: lessons_count ?? 1,
            updated_at: new Date().toISOString() as unknown as Date,
          })
          .where('id', '=', existing.id)
          .returningAll()
          .executeTakeFirstOrThrow()
      } else {
        log = await db.insertInto('group_lesson_logs')
          .values({
            activity_id,
            staff_id: targetStaffId,
            date,
            status,
            lessons_count: lessons_count ?? 1,
            created_by: createdBy,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
      }

      // Staff salary auto-accruals
      await recalcStaffAccruals(activity_id, date)

      return reply.status(201).send(log)
    }
  )

  // DELETE /api/journals/group-attendance/:id
  app.delete<{ Params: { id: string } }>(
    '/group-attendance/:id',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher', 'duty_admin') },
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
