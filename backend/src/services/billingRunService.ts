import { db } from '../db'
import { createTransaction } from './balanceService'

interface RunResult {
  billing_month: string
  created_count: number
  adjusted_count: number
  skipped_count: number
  error?: string
}

/**
 * Returns the effective price for an enrollment on a given date.
 * Priority (highest first):
 *   1. Individual child price for this activity (child_prices)
 *   2. Base tariff for the activity (tariffs)
 * Global discount and activity discount are applied on top.
 * custom_amount from attendance is only for per_lesson (not billing run).
 */
async function getEffectivePrice(childId: string, activityId: string, billingDate: Date): Promise<number | null> {
  // 1. Individual child price (SCD Type 2)
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

  // 2. Base tariff
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
      // Fixed individual price overrides base tariff
      price = parseFloat(childPrice.price as string)
    } else if (childPrice.discount_pct !== null) {
      // Discount on top of base tariff
      const disc = parseFloat(childPrice.discount_pct as string)
      price = price * (1 - disc / 100)
    }
  }

  // Global child discount
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
    const disc = parseFloat(globalDiscount.discount_pct as string)
    price = price * (1 - disc / 100)
  }

  return Math.round(price * 100) / 100
}

/**
 * Runs the billing for a given month (1st of month as DATE string "YYYY-MM-01").
 * Idempotent: skips enrollments that already have an up-to-date ACCRUAL,
 * creates ADJUSTMENT for changed tariff, creates new ACCRUAL if none exists.
 */
export async function runBilling(billingMonthStr: string, triggeredBy: string | null = null): Promise<RunResult> {
  const result: RunResult = {
    billing_month: billingMonthStr,
    created_count: 0,
    adjusted_count: 0,
    skipped_count: 0,
  }

  // Create run log entry
  const runLog = await db
    .insertInto('billing_run_log')
    .values({
      billing_month: billingMonthStr,
      triggered_by: triggeredBy,
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  const billingDate = new Date(billingMonthStr)

  try {
    // Get all active enrollments for monthly activities
    const enrollments = await db
      .selectFrom('enrollments as e')
      .innerJoin('activities as act', 'act.id', 'e.activity_id')
      .select([
        'e.id as enrollment_id',
        'e.child_id',
        'e.account_id',
        'e.activity_id',
        'e.start_date',
        'e.status',
        'act.tariff_type',
      ])
      .where('act.tariff_type', '=', 'monthly')
      .where('e.status', 'in', ['active', 'frozen'])
      .execute()

    for (const enrollment of enrollments) {
      // Skip if enrollment started after billing month
      const startDate = new Date(enrollment.start_date as Date)
      if (startDate > billingDate) {
        result.skipped_count++
        continue
      }

      // Skip frozen for the entire billing month
      if (enrollment.status === 'frozen') {
        result.skipped_count++
        continue
      }

      const price = await getEffectivePrice(enrollment.child_id, enrollment.activity_id, billingDate)
      if (price === null || price <= 0) {
        result.skipped_count++
        continue
      }

      // Check for existing ACCRUAL for this enrollment+billing_month
      const existing = await db
        .selectFrom('transactions')
        .select(['id', 'amount'])
        .where('enrollment_id', '=', enrollment.enrollment_id)
        .where('billing_month', '=', billingDate)
        .where('type', '=', 'ACCRUAL')
        .where('is_deleted', '=', false)
        .executeTakeFirst()

      if (!existing) {
        // Create new ACCRUAL
        const metadata = { tariff_snapshot: { price, billing_month: billingMonthStr } }
        await createTransaction({
          type: 'ACCRUAL',
          child_id: enrollment.child_id,
          account_id: enrollment.account_id,
          activity_id: enrollment.activity_id,
          enrollment_id: enrollment.enrollment_id,
          amount: price,
          transaction_date: billingMonthStr,
          billing_month: billingMonthStr,
          note: `Нарахування за ${billingMonthStr.slice(0, 7)}`,
          metadata_json: metadata,
          created_by: triggeredBy,
        })
        result.created_count++
      } else {
        const existingAmount = parseFloat(existing.amount as string)
        if (Math.abs(existingAmount - price) < 0.01) {
          // Same amount — skip
          result.skipped_count++
        } else {
          // Tariff changed — create ADJUSTMENT for the delta
          const delta = Math.abs(price - existingAmount)
          const isIncrease = price > existingAmount
          const metadata = {
            tariff_snapshot: { price, billing_month: billingMonthStr },
            adjustment_reason: 'tariff_changed',
            original_amount: existingAmount,
            new_amount: price,
          }
          await createTransaction({
            type: 'ADJUSTMENT',
            child_id: enrollment.child_id,
            account_id: enrollment.account_id,
            activity_id: enrollment.activity_id,
            enrollment_id: enrollment.enrollment_id,
            amount: delta,
            transaction_date: new Date().toISOString().slice(0, 10),
            billing_month: billingMonthStr,
            note: isIncrease
              ? `Доначислення за ${billingMonthStr.slice(0, 7)} (тариф змінено)`
              : `Зменшення нарахування за ${billingMonthStr.slice(0, 7)} (тариф змінено)`,
            metadata_json: metadata,
            created_by: triggeredBy,
          })
          result.adjusted_count++
        }
      }
    }

    // Mark run as finished
    await db
      .updateTable('billing_run_log')
      .set({
        finished_at: new Date().toISOString(),
        created_count: result.created_count,
        adjusted_count: result.adjusted_count,
        skipped_count: result.skipped_count,
      })
      .where('id', '=', runLog.id)
      .execute()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    result.error = message
    await db
      .updateTable('billing_run_log')
      .set({ finished_at: new Date().toISOString(), error: message })
      .where('id', '=', runLog.id)
      .execute()
  }

  return result
}

/**
 * Returns the billing month string for the current month (or overridden).
 * Format: "YYYY-MM-01"
 */
export function currentBillingMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
}
