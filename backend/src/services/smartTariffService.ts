import { sql } from 'kysely'
import { db } from '../db/index.js'
import { createTransaction, recalcBalance } from './balanceService.js'
import { getChildIndividualTariff } from './billingRunService.js'

type SmartConfig = {
  base_lessons:          number | null
  l1_threshold_absences: number | null
  l1_threshold_fee:      string | null
  l2_max_refunds:        number | null
  l2_refund_per_absence: string | null
}

/**
 * Recalculates the smart benefit REFUND for an enrollment in a billing month.
 * Supports both activity-level and child-level smart configs.
 */
export async function recalcSmartBenefit(enrollmentId: string, billingMonth: string): Promise<void> {
  const enrollment = await db
    .selectFrom('enrollments')
    .select(['child_id', 'account_id', 'activity_id'])
    .where('id', '=', enrollmentId)
    .executeTakeFirst()

  if (!enrollment) return

  const billingDate = new Date(billingMonth)

  // Resolve config and base price — child individual tariff takes priority
  const ind = await getChildIndividualTariff(enrollment.child_id, enrollment.activity_id, billingDate)

  let config: SmartConfig | null = null
  let B: number

  if (ind && ind.tariff_type === 'smart') {
    // Child has individual smart tariff — use its own config and price
    if (ind.l1_threshold_absences === null && ind.l2_max_refunds === null) return // no config yet
    config = {
      base_lessons:          ind.base_lessons,
      l1_threshold_absences: ind.l1_threshold_absences,
      l1_threshold_fee:      ind.l1_threshold_fee as string | null,
      l2_max_refunds:        ind.l2_max_refunds,
      l2_refund_per_absence: ind.l2_refund_per_absence as string | null,
    }
    B = Math.round(parseFloat(ind.price as string) * 100) / 100
  } else {
    // Activity-level smart config
    const actConfig = await db
      .selectFrom('smart_tariff_configs')
      .selectAll()
      .where('activity_id', '=', enrollment.activity_id)
      .executeTakeFirst()

    if (!actConfig) return

    config = {
      base_lessons:          actConfig.base_lessons,
      l1_threshold_absences: actConfig.l1_threshold_absences,
      l1_threshold_fee:      actConfig.l1_threshold_fee as string | null,
      l2_max_refunds:        actConfig.l2_max_refunds,
      l2_refund_per_absence: actConfig.l2_refund_per_absence as string | null,
    }

    // Use individual price if activity-level override exists, otherwise tariff base_fee
    const tariff = await db
      .selectFrom('tariffs')
      .select('base_fee')
      .where('activity_id', '=', enrollment.activity_id)
      .where('valid_from', '<=', billingDate)
      .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>=', billingDate)]))
      .orderBy('valid_from', 'desc')
      .executeTakeFirst()

    if (!tariff) return
    B = parseFloat(tariff.base_fee as string)
  }

  if (!config || B <= 0) return

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

  let benefitL1 = 0
  let benefitL2 = 0

  if (config.l1_threshold_absences !== null && config.l1_threshold_fee !== null) {
    if (absenceCount >= config.l1_threshold_absences) {
      benefitL1 = Math.max(0, B - parseFloat(config.l1_threshold_fee))
    }
  }
  if (config.l2_max_refunds !== null && config.l2_refund_per_absence !== null) {
    benefitL2 = Math.min(absenceCount, config.l2_max_refunds) * parseFloat(config.l2_refund_per_absence)
  }

  const benefit = Math.round(Math.max(benefitL1, benefitL2) * 100) / 100

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
    await db.updateTable('transactions')
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
      metadata_json: { source: 'smart_benefit', absences: absenceCount, benefit_l1: benefitL1, benefit_l2: benefitL2, base_fee: B },
    })
  }
}

/**
 * Creates ACCRUAL=price for all enrollments whose EFFECTIVE tariff type is 'smart'.
 *
 * Pass 1: smart-activity enrollments without individual override (or with individual smart)
 * Pass 2: non-smart-activity enrollments with individual smart tariff
 */
export async function runSmartAccruals(
  billingMonthStr: string,
  triggeredBy: string | null = null,
): Promise<{ created: number; skipped: number }> {
  let created = 0
  let skipped = 0
  const billingDate = new Date(billingMonthStr)

  // ── Pass 1: smart activity enrollments ───────────────────────────────────────
  const smartEnrollments = await db
    .selectFrom('enrollments as e')
    .innerJoin('activities as act', 'act.id', 'e.activity_id')
    .select(['e.id as enrollment_id', 'e.child_id', 'e.account_id', 'e.activity_id', 'e.start_date', 'e.status'])
    .where('act.tariff_type', '=', 'smart')
    .where('e.status', '=', 'active')
    .execute()

  for (const e of smartEnrollments) {
    if (new Date(e.start_date as Date) > billingDate) { skipped++; continue }

    const ind = await getChildIndividualTariff(e.child_id, e.activity_id, billingDate)
    if (ind && ind.tariff_type !== 'smart') { skipped++; continue } // overridden to monthly/per_lesson

    const price = ind
      ? Math.round(parseFloat(ind.price as string) * 100) / 100
      : await resolveSmartPrice(e.child_id, e.activity_id, billingDate)

    if (!price || price <= 0) { skipped++; continue }

    if (await hasSmartAccrual(e.enrollment_id, billingDate)) { skipped++; continue }

    await createSmartAccrual(e.enrollment_id, e.child_id, e.account_id, e.activity_id, price, billingMonthStr, triggeredBy)
    created++
  }

  // ── Pass 2: non-smart enrollments with individual smart tariff ────────────────
  const individualSmart = await db
    .selectFrom('child_individual_tariffs as cit')
    .innerJoin('enrollments as e', (join) =>
      join.onRef('e.child_id', '=', 'cit.child_id').onRef('e.activity_id', '=', 'cit.activity_id')
    )
    .innerJoin('activities as act', 'act.id', 'e.activity_id')
    .select([
      'e.id as enrollment_id', 'e.child_id', 'e.account_id', 'e.activity_id',
      'e.start_date', 'e.status', 'cit.price as ind_price',
    ])
    .where('cit.tariff_type', '=', 'smart')
    .where('act.tariff_type', '!=', 'smart')
    .where('e.status', '=', 'active')
    .where('cit.valid_from', '<=', billingDate)
    .where((eb) => eb.or([eb('cit.valid_to', 'is', null), eb('cit.valid_to', '>=', billingDate)]))
    .execute()

  for (const e of individualSmart) {
    if (new Date(e.start_date as Date) > billingDate) { skipped++; continue }
    const price = Math.round(parseFloat(e.ind_price as string) * 100) / 100
    if (price <= 0) { skipped++; continue }
    if (await hasSmartAccrual(e.enrollment_id, billingDate)) { skipped++; continue }
    await createSmartAccrual(e.enrollment_id, e.child_id, e.account_id, e.activity_id, price, billingMonthStr, triggeredBy)
    created++
  }

  return { created, skipped }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function resolveSmartPrice(childId: string, activityId: string, billingDate: Date): Promise<number | null> {
  const tariff = await db
    .selectFrom('tariffs')
    .select('base_fee')
    .where('activity_id', '=', activityId)
    .where('valid_from', '<=', billingDate)
    .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>=', billingDate)]))
    .orderBy('valid_from', 'desc')
    .executeTakeFirst()
  if (!tariff) return null
  return parseFloat(tariff.base_fee as string)
}

async function hasSmartAccrual(enrollmentId: string, billingDate: Date): Promise<boolean> {
  const existing = await db
    .selectFrom('transactions')
    .select('id')
    .where('enrollment_id', '=', enrollmentId)
    .where('billing_month', '=', billingDate)
    .where('type', '=', 'ACCRUAL')
    .where('is_deleted', '=', false)
    .executeTakeFirst()
  return !!existing
}

async function createSmartAccrual(
  enrollmentId: string, childId: string, accountId: string, activityId: string,
  price: number, billingMonthStr: string, triggeredBy: string | null,
) {
  await createTransaction({
    type: 'ACCRUAL',
    child_id: childId,
    account_id: accountId,
    activity_id: activityId,
    enrollment_id: enrollmentId,
    amount: price,
    transaction_date: billingMonthStr,
    billing_month: billingMonthStr,
    note: `Нарахування (smart) за ${billingMonthStr.slice(0, 7)}`,
    metadata_json: { tariff_snapshot: { price, billing_month: billingMonthStr }, smart: true },
    created_by: triggeredBy,
  })
}
