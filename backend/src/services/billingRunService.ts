import { sql } from 'kysely'
import { db } from '../db/index.js'
import { createTransaction, recalcBalance } from './balanceService.js'

// Підрахунок робочих днів (пн–пт) у діапазоні [from, to] включно
export function countWorkingDays(from: Date, to: Date): number {
  let count = 0
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()))
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()))
  while (cur <= end) {
    const dow = cur.getUTCDay()
    if (dow >= 1 && dow <= 5) count++
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return count
}

interface RunResult {
  billing_month: string
  created_count: number
  adjusted_count: number
  skipped_count: number
  error?: string
}

/**
 * Returns the active individual tariff (with smart config if any) for a child+activity on a date.
 * When present, its tariff_type overrides the activity's tariff_type, and its price is used directly.
 */
export async function getChildIndividualTariff(childId: string, activityId: string, date: Date) {
  return db
    .selectFrom('child_individual_tariffs as cit')
    .leftJoin('child_smart_tariff_configs as csc', 'csc.individual_tariff_id', 'cit.id')
    .select([
      'cit.id', 'cit.tariff_type', 'cit.price',
      'csc.base_lessons', 'csc.l1_threshold_absences', 'csc.l1_threshold_fee',
      'csc.l2_max_refunds', 'csc.l2_refund_per_absence',
    ])
    .where('cit.child_id', '=', childId)
    .where('cit.activity_id', '=', activityId)
    .where('cit.valid_from', '<=', date)
    .where((eb) => eb.or([eb('cit.valid_to', 'is', null), eb('cit.valid_to', '>', date)]))
    .orderBy('cit.valid_from', 'desc')
    .executeTakeFirst()
}

/**
 * Returns the effective price for an enrollment on a given date using the legacy hierarchy:
 *   1. Individual child price (child_prices)
 *   2. Base tariff + global discount
 * Used when no child_individual_tariff overrides the tariff type.
 */
export async function getEffectivePrice(childId: string, activityId: string, billingDate: Date): Promise<number | null> {
  const childPrice = await db
    .selectFrom('child_prices')
    .select(['price', 'discount_pct'])
    .where('child_id', '=', childId)
    .where('activity_id', '=', activityId)
    .where('valid_from', '<=', billingDate)
    .where((eb) => eb.or([
      eb('valid_to', 'is', null),
      eb('valid_to', '>', billingDate),
    ]))
    .orderBy('valid_from', 'desc')
    .executeTakeFirst()

  const tariff = await db
    .selectFrom('tariffs')
    .select('base_fee')
    .where('activity_id', '=', activityId)
    .where('valid_from', '<=', billingDate)
    .where((eb) => eb.or([
      eb('valid_to', 'is', null),
      eb('valid_to', '>', billingDate),
    ]))
    .orderBy('valid_from', 'desc')
    .executeTakeFirst()

  if (!tariff) return null

  let price = parseFloat(tariff.base_fee as string)

  if (childPrice) {
    if (childPrice.price !== null) {
      price = parseFloat(childPrice.price as string)
    } else if (childPrice.discount_pct !== null) {
      price = price * (1 - parseFloat(childPrice.discount_pct as string) / 100)
    }
  }

  const globalDiscount = await db
    .selectFrom('child_global_discounts')
    .select('discount_pct')
    .where('child_id', '=', childId)
    .where('valid_from', '<=', billingDate)
    .where((eb) => eb.or([
      eb('valid_to', 'is', null),
      eb('valid_to', '>', billingDate),
    ]))
    .orderBy('valid_from', 'desc')
    .executeTakeFirst()

  if (globalDiscount && !childPrice?.price) {
    price = price * (1 - parseFloat(globalDiscount.discount_pct as string) / 100)
  }

  return Math.round(price * 100) / 100
}

// ─── Shared billing helper ────────────────────────────────────────────────────

async function billMonthlyEnrollment(
  enrollmentId: string,
  childId: string,
  accountId: string,
  activityId: string,
  price: number,
  billingMonthStr: string,
  billingDate: Date,
  triggeredBy: string | null,
  result: RunResult,
) {
  const existing = await db
    .selectFrom('transactions')
    .select(['id', 'amount'])
    .where('enrollment_id', '=', enrollmentId)
    .where('billing_month', '=', billingDate)
    .where('type', '=', 'ACCRUAL')
    .where('is_deleted', '=', false)
    .executeTakeFirst()

  if (!existing) {
    await createTransaction({
      type: 'ACCRUAL',
      child_id: childId,
      account_id: accountId,
      activity_id: activityId,
      enrollment_id: enrollmentId,
      amount: price,
      transaction_date: billingMonthStr,
      billing_month: billingMonthStr,
      note: `Нарахування за ${billingMonthStr.slice(0, 7)}`,
      metadata_json: { tariff_snapshot: { price, billing_month: billingMonthStr } },
      created_by: triggeredBy,
    })
    result.created_count++
  } else {
    const existingAmount = parseFloat(existing.amount as string)
    if (Math.abs(existingAmount - price) < 0.01) {
      result.skipped_count++
    } else {
      const delta = Math.abs(price - existingAmount)
      const isIncrease = price > existingAmount
      // Idempotency: remove previous tariff-change adjustment for this enrollment+month
      await db.updateTable('transactions')
        .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: triggeredBy })
        .where('type', '=', 'ADJUSTMENT')
        .where('enrollment_id', '=', enrollmentId)
        .where('billing_month', '=', billingDate)
        .where('is_deleted', '=', false)
        .where(sql`metadata_json->>'adjustment_reason'`, '=', 'tariff_changed')
        .execute()
      await createTransaction({
        type: 'ADJUSTMENT',
        child_id: childId,
        account_id: accountId,
        activity_id: activityId,
        enrollment_id: enrollmentId,
        amount: delta,
        transaction_date: new Date().toISOString().slice(0, 10),
        billing_month: billingMonthStr,
        note: isIncrease
          ? `Доначислення за ${billingMonthStr.slice(0, 7)} (тариф змінено)`
          : `Зменшення нарахування за ${billingMonthStr.slice(0, 7)} (тариф змінено)`,
        metadata_json: {
          tariff_snapshot: { price, billing_month: billingMonthStr },
          adjustment_reason: 'tariff_changed',
          original_amount: existingAmount,
          new_amount: price,
        },
        created_by: triggeredBy,
      })
      result.adjusted_count++
    }
  }
}

// ─── Billing Run ──────────────────────────────────────────────────────────────

/**
 * Runs the monthly billing for all enrollments whose EFFECTIVE tariff type is 'monthly'.
 * Effective tariff type = child_individual_tariff.tariff_type ?? activity.tariff_type
 *
 * Pass 1: monthly-activity enrollments where child has no individual override (or override is also monthly)
 * Pass 2: non-monthly-activity enrollments where child has individual monthly tariff
 */
export async function runBilling(billingMonthStr: string, triggeredBy: string | null = null): Promise<RunResult> {
  const result: RunResult = {
    billing_month: billingMonthStr,
    created_count: 0,
    adjusted_count: 0,
    skipped_count: 0,
  }

  const runLog = await db
    .insertInto('billing_run_log')
    .values({ billing_month: billingMonthStr, triggered_by: triggeredBy })
    .returning('id')
    .executeTakeFirstOrThrow()

  const billingDate = new Date(billingMonthStr)

  try {
    // ── Pass 1: monthly activity enrollments ──────────────────────────────────
    const monthlyEnrollments = await db
      .selectFrom('enrollments as e')
      .innerJoin('activities as act', 'act.id', 'e.activity_id')
      .select(['e.id as enrollment_id', 'e.child_id', 'e.account_id', 'e.activity_id', 'e.start_date', 'e.status'])
      .where('act.tariff_type', '=', 'monthly')
      .where('e.status', 'in', ['active', 'frozen'])
      .execute()

    for (const e of monthlyEnrollments) {
      if (new Date(e.start_date as Date) > billingDate || e.status === 'frozen') {
        result.skipped_count++
        continue
      }

      // Check for individual tariff override
      const ind = await getChildIndividualTariff(e.child_id, e.activity_id, billingDate)
      if (ind && ind.tariff_type !== 'monthly') {
        // Overridden to per_lesson or smart — skip from monthly run
        result.skipped_count++
        continue
      }

      // Price: individual tariff price OR legacy effective price
      const price = ind
        ? Math.round(parseFloat(ind.price as string) * 100) / 100
        : await getEffectivePrice(e.child_id, e.activity_id, billingDate)

      if (!price || price <= 0) { result.skipped_count++; continue }

      await billMonthlyEnrollment(e.enrollment_id, e.child_id, e.account_id, e.activity_id, price, billingMonthStr, billingDate, triggeredBy, result)
    }

    // ── Pass 2: non-monthly enrollments with individual monthly tariff ────────
    const individualMonthly = await db
      .selectFrom('child_individual_tariffs as cit')
      .innerJoin('enrollments as e', (join) =>
        join.onRef('e.child_id', '=', 'cit.child_id').onRef('e.activity_id', '=', 'cit.activity_id')
      )
      .innerJoin('activities as act', 'act.id', 'e.activity_id')
      .select([
        'e.id as enrollment_id', 'e.child_id', 'e.account_id', 'e.activity_id',
        'e.start_date', 'e.status', 'cit.price as ind_price',
      ])
      .where('cit.tariff_type', '=', 'monthly')
      .where('act.tariff_type', '!=', 'monthly')
      .where('e.status', 'in', ['active', 'frozen'])
      .where('cit.valid_from', '<=', billingDate)
      .where((eb) => eb.or([eb('cit.valid_to', 'is', null), eb('cit.valid_to', '>=', billingDate)]))
      .execute()

    for (const e of individualMonthly) {
      if (new Date(e.start_date as Date) > billingDate || e.status === 'frozen') {
        result.skipped_count++
        continue
      }
      const price = Math.round(parseFloat(e.ind_price as string) * 100) / 100
      if (price < 0) { result.skipped_count++; continue }
      if (price === 0) { result.skipped_count++; continue }  // free subscription, no accrual
      await billMonthlyEnrollment(e.enrollment_id, e.child_id, e.account_id, e.activity_id, price, billingMonthStr, billingDate, triggeredBy, result)
    }

    await db.updateTable('billing_run_log').set({
      finished_at: new Date().toISOString(),
      created_count: result.created_count,
      adjusted_count: result.adjusted_count,
      skipped_count: result.skipped_count,
    }).where('id', '=', runLog.id).execute()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    result.error = message
    await db.updateTable('billing_run_log')
      .set({ finished_at: new Date().toISOString(), error: message })
      .where('id', '=', runLog.id).execute()
  }

  return result
}

export function currentBillingMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}

// ─── Retroactive recalculation for a single activity ─────────────────────────

export async function recalcActivityAccruals(
  activityId: string,
  fromDate: Date,
  toDate: Date,
  triggeredBy: string | null,
  childId?: string,
): Promise<{ replaced: number; refunded: number }> {
  const activity = await db
    .selectFrom('activities')
    .select(['tariff_type', 'is_rigid'])
    .where('id', '=', activityId)
    .executeTakeFirst()

  if (!activity) return { replaced: 0, refunded: 0 }

  let replaced = 0
  let refunded = 0

  if (activity.tariff_type === 'monthly' || activity.tariff_type === 'smart') {
    const refundConfig = await db
      .selectFrom('refund_configs')
      .select(['refund_on_excused', 'refund_amount', 'refund_pct'])
      .where('activity_id', '=', activityId)
      .executeTakeFirst()

    const shouldRefund = !!(refundConfig?.refund_on_excused && !activity.is_rigid)

    const months: string[] = []
    const cur = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1)
    const end = new Date(toDate.getFullYear(), toDate.getMonth(), 1)
    while (cur <= end) {
      months.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-01`)
      cur.setMonth(cur.getMonth() + 1)
    }

    let enrollmentsQ = db
      .selectFrom('enrollments as e')
      .select(['e.id as enrollment_id', 'e.child_id', 'e.account_id', 'e.start_date'])
      .where('e.activity_id', '=', activityId)
      .where('e.status', 'in', ['active', 'frozen'])
    if (childId) enrollmentsQ = enrollmentsQ.where('e.child_id', '=', childId)
    const enrollments = await enrollmentsQ.execute()

    for (const monthStr of months) {
      const billingDate = new Date(monthStr)
      const nextMonth = new Date(billingDate.getFullYear(), billingDate.getMonth() + 1, 1)
      const monthLastDay = new Date(nextMonth.getTime() - 1).toISOString().slice(0, 10)

      for (const e of enrollments) {
        const softDeleteSet = { is_deleted: true as const, deleted_at: new Date().toISOString(), deleted_by: triggeredBy }

        // Soft-delete existing ACCRUAL for this enrollment+billing_month
        await db.updateTable('transactions')
          .set(softDeleteSet)
          .where('enrollment_id', '=', e.enrollment_id)
          .where('billing_month', '=', billingDate)
          .where('type', '=', 'ACCRUAL')
          .where('is_deleted', '=', false)
          .execute()

        // Soft-delete existing ADJUSTMENTs for this enrollment+billing_month (cleanup old data)
        await db.updateTable('transactions')
          .set(softDeleteSet)
          .where('enrollment_id', '=', e.enrollment_id)
          .where('billing_month', '=', billingDate)
          .where('type', '=', 'ADJUSTMENT')
          .where('is_deleted', '=', false)
          .execute()

        // Soft-delete existing REFUNDs this month where metadata_json source is null
        // REFUNDs from normal journal ops have billing_month=null, so match by transaction_date range
        await db.updateTable('transactions')
          .set(softDeleteSet)
          .where('enrollment_id', '=', e.enrollment_id)
          .where('type', '=', 'REFUND')
          .where('is_deleted', '=', false)
          .where('transaction_date', '>=', billingDate)
          .where('transaction_date', '<=', new Date(monthLastDay))
          .where(sql`metadata_json->>'source'`, 'is', null)
          .execute()

        // Soft-delete existing REFUNDs this month where source is not smart_benefit
        await db.updateTable('transactions')
          .set(softDeleteSet)
          .where('enrollment_id', '=', e.enrollment_id)
          .where('type', '=', 'REFUND')
          .where('is_deleted', '=', false)
          .where('transaction_date', '>=', billingDate)
          .where('transaction_date', '<=', new Date(monthLastDay))
          .where(sql`metadata_json->>'source'`, '!=', 'smart_benefit')
          .execute()

        const startDate = new Date(String(e.start_date))
        const startMonthKey = `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}-01`
        const isMidMonthStart = startDate.getTime() > billingDate.getTime()

        // Запис ще не почався у цьому місяці (починається в майбутньому місяці) — пропускаємо
        if (isMidMonthStart && startMonthKey !== monthStr) {
          await recalcBalance(e.child_id, e.account_id)
          continue
        }

        const ind = await getChildIndividualTariff(e.child_id, activityId, billingDate)
        const effectiveIndType: string = ind ? ind.tariff_type : activity.tariff_type

        // per_lesson handled by journal trigger, not by recalc
        if (effectiveIndType === 'per_lesson') {
          await recalcBalance(e.child_id, e.account_id)
          continue
        }
        // If effective type differs from activity type, the correct billing run handles it
        // (e.g. monthly activity + individual smart → runSmartAccruals owns it)
        if (effectiveIndType !== activity.tariff_type) {
          await recalcBalance(e.child_id, e.account_id)
          continue
        }

        const price = ind
          ? Math.round(parseFloat(ind.price as string) * 100) / 100
          : await getEffectivePrice(e.child_id, activityId, billingDate)

        if (!price || price <= 0) {
          await recalcBalance(e.child_id, e.account_id)
          continue
        }

        // Розрахунок суми: про-рата для запису не з 1-го числа, повна ціна — інакше
        let accrualAmount = price
        let accrualNote = `Нарахування за ${monthStr.slice(0, 7)}`
        let proRataMeta: Record<string, unknown> = {}

        if (isMidMonthStart) {
          const firstDay = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1))
          const lastDay  = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0))
          const wdInMonth   = countWorkingDays(firstDay, lastDay)
          const wdRemaining = countWorkingDays(startDate, lastDay)
          if (wdInMonth === 0 || wdRemaining === 0) {
            await recalcBalance(e.child_id, e.account_id)
            continue
          }
          accrualAmount = Math.round((price / wdInMonth) * wdRemaining)
          accrualNote = `Нарахування за ${monthStr.slice(0, 7)} (про-рата ${wdRemaining}/${wdInMonth} роб. дн.)`
          proRataMeta = { pro_rata: true, working_days_remaining: wdRemaining, working_days_in_month: wdInMonth, full_price: price }
        }

        await createTransaction({
          type: 'ACCRUAL',
          child_id: e.child_id,
          account_id: e.account_id,
          activity_id: activityId,
          enrollment_id: e.enrollment_id,
          amount: accrualAmount,
          transaction_date: monthStr,
          billing_month: monthStr,
          note: accrualNote,
          metadata_json: { tariff_snapshot: { price, billing_month: monthStr }, source: 'retro_recalc', ...proRataMeta },
          created_by: triggeredBy,
        })
        replaced++

        // Smart tariffs use recalcSmartBenefit for REFUND — don't create per-absence REFUNDs here
        const effectiveType = ind?.tariff_type ?? activity.tariff_type
        if (shouldRefund && effectiveType !== 'smart') {
          const absences = await db
            .selectFrom('attendance_logs')
            .select(['id', 'date'])
            .where('enrollment_id', '=', e.enrollment_id)
            .where('status', '=', 'absent_excused')
            .where('date', '>=', new Date(monthStr))
            .where('date', '<=', new Date(monthLastDay))
            .execute()

          for (const abs of absences) {
            let refundAmount = 0
            if (refundConfig!.refund_amount != null) {
              refundAmount = parseFloat(refundConfig!.refund_amount as string)
            } else if (refundConfig!.refund_pct != null) {
              refundAmount = Math.round(price * parseFloat(refundConfig!.refund_pct as string) / 100 * 100) / 100
            }
            if (refundAmount <= 0) continue

            await createTransaction({
              type: 'REFUND',
              child_id: e.child_id,
              account_id: e.account_id,
              activity_id: activityId,
              enrollment_id: e.enrollment_id,
              amount: refundAmount,
              transaction_date: new Date(abs.date as Date).toISOString().slice(0, 10),
              billing_month: monthStr,
              note: `Повернення за відсутність ${new Date(abs.date as Date).toISOString().slice(0, 10)}`,
              metadata_json: { source: 'retro_recalc', attendance_log_id: abs.id },
              created_by: triggeredBy,
            })
            refunded++
          }
        }
      }
    }

  } else {
    // per_lesson: soft-delete old ACCRUALs (skip custom_amount) → recreate from attendance_logs
    let enrollmentsQ2 = db
      .selectFrom('enrollments as e')
      .select(['e.id as enrollment_id', 'e.child_id', 'e.account_id'])
      .where('e.activity_id', '=', activityId)
      .where('e.status', 'in', ['active', 'frozen'])
    if (childId) enrollmentsQ2 = enrollmentsQ2.where('e.child_id', '=', childId)
    const enrollments = await enrollmentsQ2.execute()

    if (enrollments.length === 0) return { replaced: 0, refunded: 0 }
    const enrollmentIds = enrollments.map((e) => e.enrollment_id)

    const existing = await db
      .selectFrom('transactions')
      .select(['id', 'child_id', 'account_id', 'metadata_json'])
      .where('enrollment_id', 'in', enrollmentIds)
      .where('type', '=', 'ACCRUAL')
      .where('is_deleted', '=', false)
      .where('transaction_date', '>=', fromDate)
      .where('transaction_date', '<=', toDate)
      .execute()

    const needsRecalc = new Set<string>()
    for (const tx of existing) {
      const meta = tx.metadata_json as Record<string, unknown> | null
      if (meta?.custom_amount != null && meta.custom_amount !== 'null') continue
      await db.updateTable('transactions')
        .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: triggeredBy })
        .where('id', '=', tx.id)
        .execute()
      needsRecalc.add(`${tx.child_id}:${tx.account_id}`)
    }

    const marks = await db
      .selectFrom('attendance_logs as al')
      .innerJoin('enrollments as e', 'e.id', 'al.enrollment_id')
      .select(['al.id as log_id', 'al.enrollment_id', 'al.child_id', 'al.date', 'e.account_id'])
      .where('al.activity_id', '=', activityId)
      .where('al.status', 'in', ['present', 'special'])
      .where('al.date', '>=', fromDate)
      .where('al.date', '<=', toDate)
      .where('al.custom_amount', 'is', null)
      .execute()

    for (const mark of marks) {
      const lessonDate = new Date(mark.date as Date)

      // Individual tariff overrides price (and possibly tariff type)
      const ind = await getChildIndividualTariff(mark.child_id, activityId, lessonDate)
      if (ind && ind.tariff_type !== 'per_lesson') continue  // switched to monthly/smart — skip

      const price = ind
        ? Math.round(parseFloat(ind.price as string) * 100) / 100
        : await getEffectivePrice(mark.child_id, activityId, lessonDate)

      if (price === null || price <= 0) continue  // no tariff or free lesson

      const lessonDateStr = lessonDate.toISOString().slice(0, 10)
      await createTransaction({
        type: 'ACCRUAL',
        child_id: mark.child_id,
        account_id: mark.account_id,
        activity_id: activityId,
        enrollment_id: mark.enrollment_id,
        amount: price,
        transaction_date: lessonDateStr,
        billing_month: null,
        note: `Нарахування за заняття ${lessonDateStr}`,
        metadata_json: { tariff_snapshot: { price }, source: 'retro_recalc', attendance_log_id: mark.log_id },
        created_by: triggeredBy,
      })
      replaced++
      needsRecalc.delete(`${mark.child_id}:${mark.account_id}`)
    }

    for (const key of needsRecalc) {
      const [childId, accountId] = key.split(':')
      await recalcBalance(childId, accountId)
    }
  }

  return { replaced, refunded }
}

/**
 * Unconditional recalculation of accruals for a child's individual tariff.
 * Does NOT depend on activity.tariff_type — uses the individual tariff as the sole source of truth.
 * For each billing month:
 *   - Wipes all non-custom ACCRUALs and ADJUSTMENTs (both per-lesson and monthly variants)
 *   - Creates the correct ACCRUAL based on the individual tariff type for that month
 * Safe to call multiple times (idempotent result).
 */
export async function recalcForIndividualTariff(
  childId: string,
  activityId: string,
  fromDate: Date,
  toDate: Date,
  triggeredBy: string | null,
): Promise<void> {
  const enrollment = await db
    .selectFrom('enrollments')
    .select(['id as enrollment_id', 'account_id', 'start_date'])
    .where('child_id', '=', childId)
    .where('activity_id', '=', activityId)
    .where('status', 'in', ['active', 'frozen', 'archived'])
    .executeTakeFirst()

  if (!enrollment) return

  const softDeleteSet = { is_deleted: true as const, deleted_at: new Date().toISOString(), deleted_by: triggeredBy }
  const cur = new Date(fromDate.getFullYear(), fromDate.getMonth(), 1)
  const end = new Date(toDate.getFullYear(), toDate.getMonth(), 1)

  while (cur <= end) {
    const monthStr = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-01`
    const billingDate = new Date(monthStr)
    const nextMonth = new Date(billingDate.getFullYear(), billingDate.getMonth() + 1, 1)
    const monthLastDay = new Date(nextMonth.getTime() - 1).toISOString().slice(0, 10)

    const ind = await getChildIndividualTariff(childId, activityId, billingDate)

    // No individual tariff active this month — leave existing accruals untouched
    if (!ind) {
      cur.setMonth(cur.getMonth() + 1)
      continue
    }

    // ── Wipe existing non-custom ACCRUALs for this month (both per-lesson and monthly) ──
    const existingPerLesson = await db
      .selectFrom('transactions')
      .select(['id', 'metadata_json'])
      .where('enrollment_id', '=', enrollment.enrollment_id)
      .where('type', '=', 'ACCRUAL')
      .where('is_deleted', '=', false)
      .where('billing_month', 'is', null)
      .where('transaction_date', '>=', billingDate)
      .where('transaction_date', '<=', new Date(monthLastDay))
      .execute()

    for (const tx of existingPerLesson) {
      const meta = tx.metadata_json as Record<string, unknown> | null
      if (meta?.custom_amount != null && meta.custom_amount !== 'null') continue
      await db.updateTable('transactions').set(softDeleteSet).where('id', '=', tx.id).execute()
    }

    await db.updateTable('transactions')
      .set(softDeleteSet)
      .where('enrollment_id', '=', enrollment.enrollment_id)
      .where('type', 'in', ['ACCRUAL', 'ADJUSTMENT'])
      .where('is_deleted', '=', false)
      .where('billing_month', '=', billingDate)
      .execute()

    const price = Math.round(parseFloat(ind.price as string) * 100) / 100

    // ── Create new ACCRUAL based on individual tariff type ──
    if (ind.tariff_type === 'monthly' || ind.tariff_type === 'smart') {
      const startDate = new Date(String(enrollment.start_date))
      const isMidMonthStart = startDate.getTime() > billingDate.getTime()
      const startMonthKey = `${startDate.getUTCFullYear()}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}-01`

      if (isMidMonthStart && startMonthKey !== monthStr) {
        await recalcBalance(childId, enrollment.account_id as string)
        cur.setMonth(cur.getMonth() + 1)
        continue
      }

      let accrualAmount = price
      let accrualNote = `Нарахування за ${monthStr.slice(0, 7)}`
      let proRataMeta: Record<string, unknown> = {}

      if (isMidMonthStart) {
        const firstDay = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1))
        const lastDay  = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0))
        const wdInMonth   = countWorkingDays(firstDay, lastDay)
        const wdRemaining = countWorkingDays(startDate, lastDay)
        if (wdInMonth > 0 && wdRemaining > 0) {
          accrualAmount = Math.round((price / wdInMonth) * wdRemaining)
          accrualNote = `Нарахування за ${monthStr.slice(0, 7)} (про-рата ${wdRemaining}/${wdInMonth} роб. дн.)`
          proRataMeta = { pro_rata: true, working_days_remaining: wdRemaining, working_days_in_month: wdInMonth, full_price: price }
        }
      }

      if (accrualAmount > 0) {
        await createTransaction({
          type: 'ACCRUAL',
          child_id: childId,
          account_id: enrollment.account_id as string,
          activity_id: activityId,
          enrollment_id: enrollment.enrollment_id,
          amount: accrualAmount,
          transaction_date: monthStr,
          billing_month: monthStr,
          note: accrualNote,
          metadata_json: { tariff_snapshot: { price, billing_month: monthStr }, source: 'individual_tariff', ...proRataMeta },
          created_by: triggeredBy,
        })
      }

    } else if (ind.tariff_type === 'per_lesson') {
      // Include separate_billing marks (числові відмітки) — they may have custom_amount set.
      // For null custom_amount marks: use individual tariff price (standard per_lesson).
      // For custom_amount marks: use their amount, but skip if an ACCRUAL already exists
      // (meaning it was created by the journal trigger when the mark was first saved).
      const marks = await db
        .selectFrom('attendance_logs')
        .select(['id as log_id', 'date', 'custom_amount'])
        .where('enrollment_id', '=', enrollment.enrollment_id)
        .where('status', 'in', ['present', 'special', 'separate_billing'])
        .where('date', '>=', billingDate)
        .where('date', '<=', new Date(monthLastDay))
        .execute()

      for (const mark of marks) {
        const markCustom = mark.custom_amount != null
          ? Math.round(parseFloat(String(mark.custom_amount)) * 100) / 100
          : null
        const accrualAmount = markCustom ?? price
        if (accrualAmount <= 0) continue

        const lessonDateStr = new Date(mark.date as Date).toISOString().slice(0, 10)

        // Marks with custom_amount may already have an ACCRUAL from the journal trigger — don't duplicate.
        if (markCustom !== null) {
          const existing = await db
            .selectFrom('transactions')
            .select('id')
            .where('enrollment_id', '=', enrollment.enrollment_id)
            .where('type', '=', 'ACCRUAL')
            .where('transaction_date', '=', new Date(lessonDateStr))
            .where('billing_month', 'is', null)
            .where('is_deleted', '=', false)
            .executeTakeFirst()
          if (existing) continue
        }

        await createTransaction({
          type: 'ACCRUAL',
          child_id: childId,
          account_id: enrollment.account_id as string,
          activity_id: activityId,
          enrollment_id: enrollment.enrollment_id,
          amount: accrualAmount,
          transaction_date: lessonDateStr,
          billing_month: null,
          note: `Нарахування за заняття ${lessonDateStr}`,
          metadata_json: { tariff_snapshot: { price: accrualAmount }, source: 'individual_tariff', attendance_log_id: mark.log_id },
          created_by: triggeredBy,
        })
      }
      await recalcBalance(childId, enrollment.account_id as string)
    }

    cur.setMonth(cur.getMonth() + 1)
  }
}
