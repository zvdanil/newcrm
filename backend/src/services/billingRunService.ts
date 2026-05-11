import { db } from '../db/index.js'
import { createTransaction } from './balanceService.js'

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
    .where((eb) => eb.or([eb('cit.valid_to', 'is', null), eb('cit.valid_to', '>=', date)]))
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
      eb('valid_to', '>=', billingDate),
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
      eb('valid_to', '>=', billingDate),
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
      eb('valid_to', '>=', billingDate),
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
      if (price <= 0) { result.skipped_count++; continue }
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
