import { sql } from 'kysely'
import { db } from '../db'
import { createTransaction, recalcBalance } from './balanceService'
import { getEffectivePrice } from './billingRunService'

/**
 * Recalculates the smart benefit REFUND for an enrollment in a billing month.
 * Called after every attendance change for a smart-tariff activity.
 * Idempotent — always produces exactly one REFUND with source='smart_benefit' per
 * enrollment+billing_month (or none if benefit == 0).
 */
export async function recalcSmartBenefit(enrollmentId: string, billingMonth: string): Promise<void> {
  const enrollment = await db
    .selectFrom('enrollments')
    .select(['child_id', 'account_id', 'activity_id'])
    .where('id', '=', enrollmentId)
    .executeTakeFirst()

  if (!enrollment) return

  const config = await db
    .selectFrom('smart_tariff_configs')
    .selectAll()
    .where('activity_id', '=', enrollment.activity_id)
    .executeTakeFirst()

  if (!config) return

  const billingDate = new Date(billingMonth)

  const B = await getEffectivePrice(enrollment.child_id, enrollment.activity_id, billingDate)
  if (!B || B <= 0) return

  // Count excused absences in the billing month
  const nextMonth = new Date(billingDate)
  nextMonth.setMonth(nextMonth.getMonth() + 1)

  const { count: rawCount } = await db
    .selectFrom('attendance_logs')
    .select((eb) => eb.fn.count<string>('id').as('count'))
    .where('enrollment_id', '=', enrollmentId)
    .where('status', '=', 'absent_excused')
    .where('date', '>=', billingDate)
    .where('date', '<', nextMonth)
    .executeTakeFirstOrThrow()

  const absenceCount = Number(rawCount)

  // Calculate benefit using whichever logic gives the larger amount
  let benefitL1 = 0
  let benefitL2 = 0

  if (config.l1_threshold_absences !== null && config.l1_threshold_fee !== null) {
    if (absenceCount >= config.l1_threshold_absences) {
      benefitL1 = Math.max(0, B - parseFloat(config.l1_threshold_fee as string))
    }
  }

  if (config.l2_max_refunds !== null && config.l2_refund_per_absence !== null) {
    benefitL2 = Math.min(absenceCount, config.l2_max_refunds) * parseFloat(config.l2_refund_per_absence as string)
  }

  const benefit = Math.round(Math.max(benefitL1, benefitL2) * 100) / 100

  // Find existing smart_benefit REFUND for this enrollment+billing_month
  const existing = await db
    .selectFrom('transactions')
    .select(['id', 'amount'])
    .where('enrollment_id', '=', enrollmentId)
    .where('type', '=', 'REFUND')
    .where('billing_month', '=', billingDate)
    .where('is_deleted', '=', false)
    .where(sql<string>`metadata_json->>'source'`, '=', 'smart_benefit')
    .executeTakeFirst()

  if (existing && Math.abs(parseFloat(existing.amount as string) - benefit) < 0.01) return

  if (existing) {
    await db
      .updateTable('transactions')
      .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: null })
      .where('id', '=', existing.id)
      .execute()
    await recalcBalance(enrollment.child_id, enrollment.account_id)
  }

  if (benefit > 0) {
    await createTransaction({
      type: 'REFUND',
      child_id: enrollment.child_id,
      account_id: enrollment.account_id,
      activity_id: enrollment.activity_id,
      enrollment_id: enrollmentId,
      amount: benefit,
      transaction_date: billingMonth,
      billing_month: billingMonth,
      note: `Смарт-пільга за ${billingMonth.slice(0, 7)}: ${absenceCount} пропусків`,
      metadata_json: {
        source: 'smart_benefit',
        absences: absenceCount,
        benefit_l1: benefitL1,
        benefit_l2: benefitL2,
        base_fee: B,
      },
    })
  }
}

/**
 * Creates ACCRUAL=B for all active smart-tariff enrollments for a billing month.
 * Called by cron on the 1st of each month alongside the regular monthly billing run.
 */
export async function runSmartAccruals(
  billingMonthStr: string,
  triggeredBy: string | null = null,
): Promise<{ created: number; skipped: number }> {
  let created = 0
  let skipped = 0

  const billingDate = new Date(billingMonthStr)

  const enrollments = await db
    .selectFrom('enrollments as e')
    .innerJoin('activities as act', 'act.id', 'e.activity_id')
    .select(['e.id as enrollment_id', 'e.child_id', 'e.account_id', 'e.activity_id', 'e.start_date', 'e.status'])
    .where('act.tariff_type', '=', 'smart')
    .where('e.status', '=', 'active')
    .execute()

  for (const enrollment of enrollments) {
    const startDate = new Date(enrollment.start_date as Date)
    if (startDate > billingDate) {
      skipped++
      continue
    }

    const B = await getEffectivePrice(enrollment.child_id, enrollment.activity_id, billingDate)
    if (!B || B <= 0) {
      skipped++
      continue
    }

    const existing = await db
      .selectFrom('transactions')
      .select('id')
      .where('enrollment_id', '=', enrollment.enrollment_id)
      .where('billing_month', '=', billingDate)
      .where('type', '=', 'ACCRUAL')
      .where('is_deleted', '=', false)
      .executeTakeFirst()

    if (existing) {
      skipped++
      continue
    }

    await createTransaction({
      type: 'ACCRUAL',
      child_id: enrollment.child_id,
      account_id: enrollment.account_id,
      activity_id: enrollment.activity_id,
      enrollment_id: enrollment.enrollment_id,
      amount: B,
      transaction_date: billingMonthStr,
      billing_month: billingMonthStr,
      note: `Нарахування (smart) за ${billingMonthStr.slice(0, 7)}`,
      metadata_json: { tariff_snapshot: { price: B, billing_month: billingMonthStr }, smart: true },
      created_by: triggeredBy,
    })
    created++
  }

  return { created, skipped }
}
