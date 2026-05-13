import { db } from '../db/index.js'

function billingMonthOf(date: string): string {
  return date.slice(0, 7) + '-01'
}

/**
 * Retroactive recalculation when a rate is created backdated.
 * Finds all ACCRUALs for oldRateId in the retro period,
 * computes delta per billing_month, creates CORRECTION transactions.
 *
 * Supported source types: auto_per_lesson, auto_per_child, auto_fixed_monthly,
 * manual with quantity in metadata.
 */
export async function recalcRetroAccruals(
  staffId:      string,
  oldRateId:    string,
  newRateId:    string,
  newRateValue: number,
  fromDate:     Date,
): Promise<{ corrections: number }> {
  const today = new Date()

  const accruals = await db
    .selectFrom('salary_transactions')
    .select(['gross_amount', 'deduction_pct', 'billing_month', 'transaction_date', 'metadata_json'])
    .where('staff_id',   '=', staffId)
    .where('rate_id',    '=', oldRateId)
    .where('type',       '=', 'ACCRUAL')
    .where('is_deleted', '=', false)
    .where('transaction_date', '>=', fromDate)
    .where('transaction_date', '<=', today)
    .execute()

  if (accruals.length === 0) return { corrections: 0 }

  // Fetch new rate deduction_pct for CORRECTION entries
  const newRate = await db
    .selectFrom('staff_rates')
    .select('deduction_pct')
    .where('id', '=', newRateId)
    .executeTakeFirst()
  const deductionPct = newRate ? Number(newRate.deduction_pct) : 0

  // Aggregate delta per billing_month
  const monthDelta = new Map<string, number>()

  for (const accrual of accruals) {
    const meta      = accrual.metadata_json as Record<string, unknown> | null
    const source    = meta?.source as string | undefined
    const quantity  = typeof meta?.quantity === 'number' ? meta.quantity as number : null
    const revenue   = typeof meta?.revenue  === 'number' ? meta.revenue  as number : null
    const oldAmount = Number(accrual.gross_amount)

    let newAmount: number

    if (revenue !== null) {
      // percent_of_revenue mode — reapply new % to the same revenue base
      newAmount = Math.round(revenue * newRateValue / 100 * 100) / 100
    } else if (quantity !== null && quantity > 0) {
      // fixed mode with quantity: per_lesson (qty=1), per_child (qty=N), hourly/manual
      newAmount = Math.round(quantity * newRateValue * 100) / 100
    } else if (source === 'auto_fixed_monthly') {
      newAmount = newRateValue
    } else {
      // free-form manual without quantity — skip
      continue
    }

    const delta = Math.round((newAmount - oldAmount) * 100) / 100
    if (Math.abs(delta) < 0.001) continue

    const billing = String(accrual.billing_month).slice(0, 10)
    monthDelta.set(billing, (monthDelta.get(billing) ?? 0) + delta)
  }

  let corrections = 0
  for (const [billing, delta] of monthDelta) {
    if (Math.abs(delta) < 0.001) continue

    const billingDate = new Date(billing)
    const billingStr  = billing  // already 'YYYY-MM-DD'

    // Soft-delete any existing retro CORRECTION for same rate+billing_month
    // (prevents duplicate if admin re-creates the same retroactive rate)
    const existingRetro = await db
      .selectFrom('salary_transactions')
      .select('id')
      .where('staff_id',   '=', staffId)
      .where('rate_id',    '=', newRateId)
      .where('type',       '=', 'CORRECTION')
      .where('billing_month', '=', billingDate)
      .where('is_deleted', '=', false)
      .executeTakeFirst()

    if (existingRetro) {
      await db.updateTable('salary_transactions')
        .set({ is_deleted: true, deleted_at: new Date().toISOString() })
        .where('id', '=', existingRetro.id)
        .execute()
    }

    await db.insertInto('salary_transactions').values({
      staff_id:         staffId,
      rate_id:          newRateId,
      activity_id:      null,
      type:             'CORRECTION',
      gross_amount:     Math.abs(delta),
      deduction_pct:    deductionPct,
      transaction_date: billingStr,
      billing_month:    billingStr,
      note:             delta > 0
        ? `Ретро-коригування +${Math.abs(delta).toFixed(2)} грн (нова ставка)`
        : `Ретро-коригування −${Math.abs(delta).toFixed(2)} грн (нова ставка)`,
      metadata_json: {
        source:         'retro_correction',
        old_rate_id:    oldRateId,
        new_rate_value: newRateValue,
        delta,
      },
    }).execute()

    corrections++
  }

  return { corrections }
}

/** Returns total child billing revenue for an activity on a specific date. */
async function revenueForActivityDate(activityId: string, dateObj: Date): Promise<number> {
  const result = await db
    .selectFrom('transactions')
    .select((eb) => eb.fn.sum<string>('amount').as('total'))
    .where('activity_id', '=', activityId)
    .where('transaction_date', '=', dateObj)
    .where('type', '=', 'ACCRUAL')
    .where('is_deleted', '=', false)
    .executeTakeFirst()
  return Math.round(Number(result?.total ?? 0) * 100) / 100
}

/** Returns total child billing revenue for an activity in a billing month. */
async function revenueForActivityMonth(activityId: string, billingStart: Date): Promise<number> {
  const billingEnd = new Date(billingStart)
  billingEnd.setMonth(billingEnd.getMonth() + 1)
  const result = await db
    .selectFrom('transactions')
    .select((eb) => eb.fn.sum<string>('amount').as('total'))
    .where('activity_id', '=', activityId)
    .where('transaction_date', '>=', billingStart)
    .where('transaction_date', '<', billingEnd)
    .where('type', '=', 'ACCRUAL')
    .where('is_deleted', '=', false)
    .executeTakeFirst()
  return Math.round(Number(result?.total ?? 0) * 100) / 100
}

/**
 * Computes gross for a rate given attendance data.
 * Supports both value_mode: 'fixed' and 'percent_of_revenue'.
 */
async function computeGross(
  rate: { rate_type: string; value_mode: string; rate_value: string },
  activityId: string,
  dateObj: Date,
  presentCount: number,
  groupLessonCount: number = 1
): Promise<{ gross: number; meta: Record<string, unknown> }> {
  const rv = Number(rate.rate_value)

  if (rate.value_mode === 'percent_of_revenue') {
    const revenue = await revenueForActivityDate(activityId, dateObj)
    const gross   = Math.round(revenue * rv / 100 * 100) / 100
    return { gross, meta: { source: `auto_${rate.rate_type}_pct`, revenue, rate_pct: rv } }
  }

  if (rate.rate_type === 'per_lesson') {
    return { gross: rv, meta: { source: 'auto_per_lesson', quantity: 1, rate_value: rv } }
  }
  if (rate.rate_type === 'group_lesson') {
    return { gross: Math.round(rv * groupLessonCount * 100) / 100, meta: { source: 'auto_group_lesson', quantity: groupLessonCount, rate_value: rv } }
  }

  // per_child
  const gross = Math.round(rv * presentCount * 100) / 100
  return { gross, meta: { source: 'auto_per_child', quantity: presentCount, rate_value: rv } }
}

/**
 * Recalculates staff salary accruals for a given activity+date after any attendance change.
 * Handles: per_lesson, per_child — both fixed and percent_of_revenue modes.
 */
export async function recalcStaffAccruals(activityId: string, date: string): Promise<void> {
  const dateObj = new Date(date)
  const now     = new Date().toISOString()

  // Check if a substitution exists for this activity+date.
  // If so, skip auto-accrual for the original teacher (sub's ACCRUAL already created at substitution save).
  const substitution = await db
    .selectFrom('substitutions as sub')
    .innerJoin('activity_schedules as s', 's.id', 'sub.schedule_id')
    .select(['sub.original_staff_id', 'sub.substitute_staff_id'])
    .where('s.activity_id', '=', activityId)
    .where('sub.occurrence_date', '=', dateObj)
    .executeTakeFirst()

  const blockedStaffId = substitution?.original_staff_id ?? null

  const rates = await db
    .selectFrom('staff_rates')
    .where('activity_id', '=', activityId)
    .where('rate_category', '=', 'auto')
    .where((eb) => eb.or([
      eb('rate_type', '=', 'per_lesson'),
      eb('rate_type', '=', 'per_child'),
      eb('rate_type', '=', 'group_lesson'),
    ]))
    .where('valid_from', '<=', dateObj)
    .where((eb) => eb.or([
      eb('valid_to', 'is', null),
      eb('valid_to', '>=', dateObj),
    ]))
    .selectAll()
    .execute()

  if (rates.length === 0) return

  const presentResult = await db
    .selectFrom('attendance_logs')
    .select((eb) => eb.fn.countAll<number>().as('cnt'))
    .where('activity_id', '=', activityId)
    .where('date', '=', dateObj)
    .where('status', 'in', ['present', 'special'])
    .executeTakeFirst()

  const presentCount = Number(presentResult?.cnt ?? 0)

  const groupLog = await db
    .selectFrom('group_lesson_logs')
    .select(['status', 'lessons_count'])
    .where('activity_id', '=', activityId)
    .where('date', '=', dateObj)
    .executeTakeFirst()

  const groupConducted = groupLog?.status === 'conducted'
  const groupLessonCount = groupLog?.lessons_count ?? 1
  const billing        = billingMonthOf(date)

  for (const rate of rates) {
    // Skip auto-accrual for the teacher replaced by a substitution
    if (blockedStaffId && rate.staff_id === blockedStaffId) continue

    const existing = await db
      .selectFrom('salary_transactions')
      .select(['id', 'gross_amount'])
      .where('staff_id',         '=', rate.staff_id)
      .where('rate_id',          '=', rate.id)
      .where('activity_id',      '=', activityId)
      .where('transaction_date', '=', dateObj)
      .where('type',             '=', 'ACCRUAL')
      .where('is_deleted',       '=', false)
      .executeTakeFirst()

    const { gross: newAmount, meta } = await computeGross(rate, activityId, dateObj, presentCount, groupLessonCount)
    let hasLesson = false
    if (rate.rate_type === 'group_lesson') {
      hasLesson = groupConducted || rate.value_mode === 'percent_of_revenue'
    } else {
      hasLesson = presentCount > 0 || rate.value_mode === 'percent_of_revenue'
    }

    if (!hasLesson || newAmount <= 0) {
      // No lesson or zero revenue → remove existing accrual
      if (existing) {
        await db.updateTable('salary_transactions')
          .set({ is_deleted: true, deleted_at: now })
          .where('id', '=', existing.id)
          .execute()
      }
      continue
    }

    if (!existing) {
      await db.insertInto('salary_transactions').values({
        staff_id:         rate.staff_id,
        rate_id:          rate.id,
        activity_id:      activityId,
        type:             'ACCRUAL',
        gross_amount:     newAmount,
        deduction_pct:    rate.deduction_pct,
        transaction_date: date,
        billing_month:    billing,
        metadata_json:    meta,
      }).execute()
    } else if (Math.abs(Number(existing.gross_amount) - newAmount) > 0.001) {
      await db.updateTable('salary_transactions')
        .set({ is_deleted: true, deleted_at: now })
        .where('id', '=', existing.id)
        .execute()
      await db.insertInto('salary_transactions').values({
        staff_id:         rate.staff_id,
        rate_id:          rate.id,
        activity_id:      activityId,
        type:             'ACCRUAL',
        gross_amount:     newAmount,
        deduction_pct:    rate.deduction_pct,
        transaction_date: date,
        billing_month:    billing,
        metadata_json:    meta,
      }).execute()
    }
  }
}

/**
 * Recalculates smart staff rate for a given rate+billing_month.
 * If total absences in month >= absence_threshold → CORRECTION to bring total to threshold_rate.
 * Otherwise removes any existing CORRECTION.
 */
export async function recalcSmartStaffBenefit(rateId: string, billingMonth: string): Promise<void> {
  const billingObj = new Date(billingMonth)
  const now = new Date().toISOString()

  const [rate, config] = await Promise.all([
    db.selectFrom('staff_rates').selectAll().where('id', '=', rateId).executeTakeFirst(),
    db.selectFrom('staff_smart_configs').selectAll().where('rate_id', '=', rateId).executeTakeFirst(),
  ])

  if (!rate || !config || !rate.activity_id) return

  const nextMonth = new Date(billingObj)
  nextMonth.setMonth(nextMonth.getMonth() + 1)

  const absenceResult = await db
    .selectFrom('attendance_logs')
    .select((eb) => eb.fn.countAll<number>().as('cnt'))
    .where('activity_id', '=', rate.activity_id)
    .where('date', '>=', billingObj)
    .where('date', '<', nextMonth)
    .where('status', 'in', ['absent_excused', 'absent_unexcused'])
    .executeTakeFirst()

  const absences = Number(absenceResult?.cnt ?? 0)
  const baseAmount = Number(rate.rate_value) * config.base_lessons
  const thresholdRate = Number(config.threshold_rate)

  const existingAccrual = await db
    .selectFrom('salary_transactions')
    .select('gross_amount')
    .where('staff_id', '=', rate.staff_id)
    .where('rate_id', '=', rateId)
    .where('billing_month', '=', billingObj)
    .where('type', '=', 'ACCRUAL')
    .where('is_deleted', '=', false)
    .executeTakeFirst()

  const existingCorrection = await db
    .selectFrom('salary_transactions')
    .select(['id', 'gross_amount'])
    .where('staff_id', '=', rate.staff_id)
    .where('rate_id', '=', rateId)
    .where('billing_month', '=', billingObj)
    .where('type', '=', 'CORRECTION')
    .where('is_deleted', '=', false)
    .executeTakeFirst()

  if (absences >= config.absence_threshold) {
    const correction = Math.round((thresholdRate - baseAmount) * 100) / 100
    if (!existingCorrection) {
      if (!existingAccrual) return
      await db.insertInto('salary_transactions').values({
        staff_id:         rate.staff_id,
        rate_id:          rateId,
        activity_id:      rate.activity_id,
        type:             'CORRECTION',
        gross_amount:     correction,
        deduction_pct:    rate.deduction_pct,
        transaction_date: billingMonth,
        billing_month:    billingMonth,
        note:             `Смарт коригування: пропусків ${absences} ≥ ${config.absence_threshold}`,
        metadata_json:    { source: 'smart_staff', absences, threshold: config.absence_threshold, threshold_rate: thresholdRate },
      }).execute()
    } else if (Math.abs(Number(existingCorrection.gross_amount) - correction) > 0.001) {
      await db.updateTable('salary_transactions')
        .set({ is_deleted: true, deleted_at: now })
        .where('id', '=', existingCorrection.id)
        .execute()
      await db.insertInto('salary_transactions').values({
        staff_id:         rate.staff_id,
        rate_id:          rateId,
        activity_id:      rate.activity_id,
        type:             'CORRECTION',
        gross_amount:     correction,
        deduction_pct:    rate.deduction_pct,
        transaction_date: billingMonth,
        billing_month:    billingMonth,
        note:             `Смарт коригування: пропусків ${absences} ≥ ${config.absence_threshold}`,
        metadata_json:    { source: 'smart_staff', absences, threshold: config.absence_threshold, threshold_rate: thresholdRate },
      }).execute()
    }
  } else if (existingCorrection) {
    await db.updateTable('salary_transactions')
      .set({ is_deleted: true, deleted_at: now })
      .where('id', '=', existingCorrection.id)
      .execute()
  }
}

/**
 * Creates fixed_monthly ACCRUAL for all active staff_rates of type fixed_monthly
 * for the given billing month. Called by Cron on 1st of each month.
 */
export async function runFixedMonthlyAccruals(billingMonth: string): Promise<void> {
  const billingObj = new Date(billingMonth)

  const rates = await db
    .selectFrom('staff_rates')
    .where('rate_type', '=', 'fixed_monthly')
    .where('rate_category', '=', 'auto')
    .where('valid_from', '<=', billingObj)
    .where((eb) => eb.or([
      eb('valid_to', 'is', null),
      eb('valid_to', '>=', billingObj),
    ]))
    .selectAll()
    .execute()

  for (const rate of rates) {
    const existing = await db
      .selectFrom('salary_transactions')
      .select('id')
      .where('staff_id',    '=', rate.staff_id)
      .where('rate_id',     '=', rate.id)
      .where('billing_month', '=', billingObj)
      .where('type',        '=', 'ACCRUAL')
      .where('is_deleted',  '=', false)
      .executeTakeFirst()

    if (existing) continue

    const rv = Number(rate.rate_value)
    let gross = rv
    let meta: Record<string, unknown> = { source: 'auto_fixed_monthly', rate_value: rv }

    if (rate.value_mode === 'percent_of_revenue' && rate.activity_id) {
      const revenue = await revenueForActivityMonth(rate.activity_id, billingObj)
      gross = Math.round(revenue * rv / 100 * 100) / 100
      meta  = { source: 'auto_fixed_monthly_pct', revenue, rate_pct: rv }
    }

    if (gross <= 0) continue

    await db.insertInto('salary_transactions').values({
      staff_id:         rate.staff_id,
      rate_id:          rate.id,
      activity_id:      rate.activity_id ?? null,
      type:             'ACCRUAL',
      gross_amount:     gross,
      deduction_pct:    rate.deduction_pct,
      transaction_date: billingMonth,
      billing_month:    billingMonth,
      metadata_json:    meta,
    }).execute()
  }
}

/**
 * Creates smart staff ACCRUAL (B × base_lessons) on 1st of month for all active smart rates.
 */
export async function runSmartStaffAccruals(billingMonth: string): Promise<void> {
  const billingObj = new Date(billingMonth)

  const rates = await db
    .selectFrom('staff_rates as r')
    .innerJoin('staff_smart_configs as sc', 'sc.rate_id', 'r.id')
    .where('r.rate_type', '=', 'smart')
    .where('r.rate_category', '=', 'auto')
    .where('r.valid_from', '<=', billingObj)
    .where((eb) => eb.or([
      eb('r.valid_to', 'is', null),
      eb('r.valid_to', '>=', billingObj),
    ]))
    .select(['r.id', 'r.staff_id', 'r.activity_id', 'r.rate_value', 'r.deduction_pct', 'sc.base_lessons'])
    .execute()

  for (const rate of rates) {
    const existing = await db
      .selectFrom('salary_transactions')
      .select('id')
      .where('staff_id', '=', rate.staff_id)
      .where('rate_id', '=', rate.id)
      .where('billing_month', '=', billingObj)
      .where('type', '=', 'ACCRUAL')
      .where('is_deleted', '=', false)
      .executeTakeFirst()

    if (existing) continue

    const baseAmount = Math.round(Number(rate.rate_value) * rate.base_lessons * 100) / 100

    await db.insertInto('salary_transactions').values({
      staff_id:         rate.staff_id,
      rate_id:          rate.id,
      activity_id:      rate.activity_id ?? null,
      type:             'ACCRUAL',
      gross_amount:     baseAmount,
      deduction_pct:    rate.deduction_pct,
      transaction_date: billingMonth,
      billing_month:    billingMonth,
      metadata_json:    { source: 'auto_smart', base_rate: Number(rate.rate_value), base_lessons: rate.base_lessons },
    }).execute()
  }
}
