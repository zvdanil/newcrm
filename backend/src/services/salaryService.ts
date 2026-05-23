import { sql } from 'kysely'
import { db } from '../db/index.js'

function billingMonthOf(date: string): string {
  return date.slice(0, 7) + '-01'
}

function toLocalDateString(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Computes the salary amount for one child given visit count and smart_per_child config.
 *
 * Ranges:
 *   0 visits                          → 0
 *   1 .. attendance_threshold-1       → starter_rate
 *   attendance_threshold .. base_lessons → threshold_rate (base rate)
 *   > base_lessons                    → threshold_rate + (N - base_lessons) * extra_lesson_price
 */
function calcSmartPerChildAmount(
  visits: number,
  config: { attendance_threshold: number; starter_rate: number; threshold_rate: number; base_lessons: number; extra_lesson_price: number }
): number {
  if (visits === 0) return 0
  if (visits < config.attendance_threshold) return config.starter_rate
  if (visits <= config.base_lessons) return config.threshold_rate
  return config.threshold_rate + (visits - config.base_lessons) * config.extra_lesson_price
}

/**
 * Recalculates "smart_per_child" ACCRUAL for a given rate+billing_month.
 *
 * Logic per child:
 *   Count attendance marks (present/special) for this activity in the billing month.
 *   Apply three-tier formula:
 *     0 visits          → 0
 *     1..(threshold-1)  → starter_rate
 *     threshold..base   → threshold_rate (base rate)
 *     >base             → threshold_rate + extras * extra_lesson_price
 *
 * Stores one combined ACCRUAL per rate per billing_month (upserts on change).
 * metadata_json contains breakdown per child for UI display.
 */
export async function recalcSmartPerChildBenefit(rateId: string, billingMonth: string): Promise<void> {
  const now = new Date().toISOString()

  const [rate, config] = await Promise.all([
    db.selectFrom('staff_rates').selectAll().where('id', '=', rateId).executeTakeFirst(),
    db.selectFrom('staff_smart_configs').selectAll().where('rate_id', '=', rateId).executeTakeFirst(),
  ])

  if (!rate || !config || !rate.activity_id) return

  const cfg = {
    attendance_threshold: Number(config.attendance_threshold),
    starter_rate:         Number(config.starter_rate),
    threshold_rate:       Number(config.threshold_rate),
    base_lessons:         Number(config.base_lessons),
    extra_lesson_price:   Number(config.extra_lesson_price),
    trial_lesson_price:   Number(config.trial_lesson_price),
  }

  // Calculate date range for the billing month
  const billingStart = billingMonth // 'YYYY-MM-01'
  const startDate = new Date(billingMonth)
  const endDate = new Date(startDate)
  endDate.setMonth(endDate.getMonth() + 1)
  const billingEnd = endDate.toISOString().slice(0, 10)

  // Fetch all present/special marks per child, split by trial (custom_amount set) vs regular
  const allMarks = await db
    .selectFrom('attendance_logs as al')
    .innerJoin('children as c', 'c.id', 'al.child_id')
    .select(['al.child_id', 'c.full_name', 'al.custom_amount', 'al.date'])
    .where('al.activity_id', '=', rate.activity_id!)
    .where('al.date', '>=', new Date(billingStart))
    .where('al.date', '<', new Date(billingEnd))
    .where('al.status', 'in', ['present', 'special'])
    .execute()

  // Group by child and date to ensure we count distinct visits (days attended)
  const byChild = new Map<string, { name: string; standardCount: number; customSum: number; customCount: number }>()
  const childDates = new Map<string, Map<string, { customAmount: string | null }>>()

  for (const m of allMarks) {
    if (!byChild.has(m.child_id)) {
      byChild.set(m.child_id, { name: m.full_name, standardCount: 0, customSum: 0, customCount: 0 })
    }
    
    if (!childDates.has(m.child_id)) {
      childDates.set(m.child_id, new Map())
    }
    const dates = childDates.get(m.child_id)!
    const dateKey = toLocalDateString(m.date)
    
    // If multiple marks on the same day, prioritize the one with custom_amount
    if (!dates.has(dateKey) || (m.custom_amount !== null && dates.get(dateKey)?.customAmount === null)) {
      dates.set(dateKey, { customAmount: m.custom_amount })
    }
  }

  // Now aggregate the distinct daily visits into the byChild map
  for (const [childId, dates] of childDates.entries()) {
    const entry = byChild.get(childId)!
    for (const visit of dates.values()) {
      if (visit.customAmount !== null) {
        const val = Number(visit.customAmount)
        entry.customSum += isNaN(val) ? 0 : val
        entry.customCount++
      } else {
        entry.standardCount++
      }
    }
  }

  type ChildMode = 'trial' | 'regular' | 'none'
  type ChildRange = 'none' | 'starter' | 'base' | 'extra'

  const children = Array.from(byChild.entries()).map(([child_id, { name, standardCount, customSum, customCount }]) => {
    let mode: ChildMode
    let amount: number
    let range: ChildRange = 'none'

    const totalVisits = standardCount + customCount

    if (customCount > 0) {
      // Any manual mark triggers trial mode for the whole child
      mode = 'trial'
      amount = totalVisits * cfg.trial_lesson_price
      range = totalVisits > 0 ? 'starter' : 'none'
    } else if (standardCount > 0) {
      // Only standard marks -> regular tiered formula
      mode = 'regular'
      amount = calcSmartPerChildAmount(standardCount, cfg)
      
      if (totalVisits === 0)                             range = 'none'
      else if (totalVisits < cfg.attendance_threshold)   range = 'starter'
      else if (totalVisits <= cfg.base_lessons)          range = 'base'
      else                                               range = 'extra'
    } else {
      mode = 'none'
      amount = 0
      range = 'none'
    }

    return { 
      child_id, 
      child_name: name, 
      standardCount, 
      customCount, 
      customSum, 
      mode, 
      range, 
      amount: Math.round(amount * 100) / 100 
    }
  })

  const totalGross = Math.round(children.reduce((s, c) => s + c.amount, 0) * 100) / 100

  const existingAccrual = await db
    .selectFrom('salary_transactions')
    .select(['id', 'gross_amount'])
    .where('staff_id',    '=', rate.staff_id)
    .where('rate_id',     '=', rateId)
    .where('billing_month', '=', new Date(billingMonth))
    .where('type',        '=', 'ACCRUAL')
    .where('is_deleted',  '=', false)
    .executeTakeFirst()

  const childLines = children
    .filter(c => c.amount > 0)
    .map(c => {
      const total = c.standardCount + c.customCount
      let detail = ''
      if (c.customCount > 0) {
        detail = c.standardCount > 0 
          ? `${c.standardCount} ст. + ${c.customCount} спец.` 
          : `${c.customCount} спец.`
      } else {
        if (total < cfg.attendance_threshold) {
          detail = `відвід <= ${cfg.attendance_threshold} (ставка ${cfg.starter_rate})`
        } else {
          detail = `відвід >= ${cfg.attendance_threshold} (ставка ${cfg.threshold_rate})`
        }
      }
      return `${c.child_name}: ${detail} → ${c.amount.toFixed(2)} грн`
    })
    .join('; ')
  const noteStr = `Смарт за дитину. ${childLines}`

  const meta = {
    source:   'smart_per_child',
    children,
    total:    totalGross,
    config:   cfg,
  }

  if (totalGross <= 0) {
    if (existingAccrual) {
      await db.updateTable('salary_transactions')
        .set({ is_deleted: true, deleted_at: now })
        .where('id', '=', existingAccrual.id)
        .execute()
    }
    return
  }

  if (!existingAccrual) {
    await db.insertInto('salary_transactions').values({
      staff_id:         rate.staff_id,
      rate_id:          rateId,
      activity_id:      rate.activity_id,
      type:             'ACCRUAL',
      gross_amount:     totalGross,
      deduction_pct:    rate.deduction_pct,
      transaction_date: billingMonth,
      billing_month:    billingMonth,
      note:             noteStr,
      metadata_json:    meta,
    }).execute()
  } else if (Math.abs(Number(existingAccrual.gross_amount) - totalGross) > 0.001) {
    await db.updateTable('salary_transactions')
      .set({ is_deleted: true, deleted_at: now })
      .where('id', '=', existingAccrual.id)
      .execute()
    await db.insertInto('salary_transactions').values({
      staff_id:         rate.staff_id,
      rate_id:          rateId,
      activity_id:      rate.activity_id,
      type:             'ACCRUAL',
      gross_amount:     totalGross,
      deduction_pct:    rate.deduction_pct,
      transaction_date: billingMonth,
      billing_month:    billingMonth,
      note:             noteStr,
      metadata_json:    meta,
    }).execute()
  }
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

    const billingRaw = accrual.billing_month as unknown
    const billing = toLocalDateString(billingRaw as Date | string)
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
    .where('transaction_date', '=', new Date(dateObj))
    .where('type', '=', 'ACCRUAL')
    .where('is_deleted', '=', false)
    .executeTakeFirst()

  return Math.round(Number(result?.total ?? 0) * 100) / 100
}

/** Returns total child billing revenue for an activity in a billing month. */
async function revenueForActivityMonth(activityId: string, billingStart: Date): Promise<number> {
  const result = await db
    .selectFrom('transactions')
    .select((eb) => eb.fn.sum<string>('amount').as('total'))
    .where('activity_id', '=', activityId)
    .where('billing_month', '=', new Date(billingStart))
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
    .where('sub.occurrence_date', '=', new Date(date))
    .executeTakeFirst()

  const blockedStaffId = substitution?.original_staff_id ?? null

  const allRates = await db
    .selectFrom('staff_rates')
    .where('activity_id', '=', activityId)
    .where('rate_category', '=', 'auto')
    .where((eb) => eb.or([
      eb('rate_type', '=', 'per_lesson'),
      eb('rate_type', '=', 'per_child'),
      eb('rate_type', '=', 'group_lesson'),
    ]))
    .where('valid_from', '<=', new Date(date))
    .where((eb) => eb.or([
      eb('valid_to', 'is', null),
      eb('valid_to', '>', new Date(date)),
    ]))
    .selectAll()
    .orderBy('valid_from', 'desc')
    .orderBy('created_at', 'desc')
    .execute()

  // One rate per (staff_id, rate_type) — picks the most recent valid one per combination.
  const ratesMap = new Map<string, typeof allRates[0]>()
  for (const r of allRates) {
    const key = `${r.staff_id}::${r.rate_type}`
    if (!ratesMap.has(key)) {
      ratesMap.set(key, r)
    }
  }
  const rates = Array.from(ratesMap.values())

  if (rates.length === 0) return

  const presentResult = await db
    .selectFrom('attendance_logs')
    .select((eb) => eb.fn.countAll<number>().as('cnt'))
    .where('activity_id', '=', activityId)
    .where('date', '=', new Date(date))
    .where('status', 'in', ['present', 'special'])
    .executeTakeFirst()

  const presentCount = Number(presentResult?.cnt ?? 0)

  const groupLog = await db
    .selectFrom('group_lesson_logs')
    .select(['status', 'lessons_count'])
    .where('activity_id', '=', activityId)
    .where('date', '=', new Date(date))
    .executeTakeFirst()

  const groupConducted = groupLog?.status === 'conducted'
  const groupLessonCount = groupLog?.lessons_count ?? 1
  const billing        = billingMonthOf(date)

  const existingAccruals = await db
    .selectFrom('salary_transactions as st')
    .innerJoin('staff_rates as sr', 'sr.id', 'st.rate_id')
    .select(['st.id', 'st.rate_id', 'st.gross_amount'])
    .where('st.activity_id',      '=', activityId)
    .where('st.transaction_date', '=', new Date(date))
    .where('st.type',             '=', 'ACCRUAL')
    .where('st.is_deleted',       '=', false)
    .where('sr.rate_category',    '=', 'auto') // Только автоматические
    .execute()

  // Clean up any other "competing" AUTO accruals for this activity on this date
  // that are not part of the current active rates loop.
  for (const ext of existingAccruals) {
    if (!rates.some(r => r.id === ext.rate_id)) {
      await db.updateTable('salary_transactions')
        .set({ is_deleted: true, deleted_at: now })
        .where('id', '=', ext.id)
        .execute()
    }
  }

  for (const rate of rates) {
    // Skip auto-accrual for the teacher replaced by a substitution
    if (blockedStaffId && rate.staff_id === blockedStaffId) continue

    const existing = existingAccruals.find(a => a.rate_id === rate.id)

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

  // Also trigger recalculation for any "smart" rates associated with this activity
  // since they depend on monthly attendance totals.
  const smartRates = await db
    .selectFrom('staff_rates')
    .select('id')
    .where('activity_id', '=', activityId)
    .where('rate_type', '=', 'smart')
    .where('valid_from', '<=', new Date(date))
    .where((eb) => eb.or([
      eb('valid_to', 'is', null),
      eb('valid_to', '>', new Date(date)),
    ]))
    .execute()

  await Promise.all(smartRates.map(async (sr) => {
    await recalcSmartPerChildBenefit(sr.id, billing)
    await recalcSmartStaffBenefit(sr.id, billing)
  }))
}

/**
 * Recalculates smart staff rate for a given rate+billing_month.
 * If total absences in month >= absence_threshold → CORRECTION to bring total to threshold_rate.
 * Otherwise removes any existing CORRECTION.
 */
export async function recalcSmartStaffBenefit(rateId: string, billingMonth: string): Promise<void> {
  const now = new Date().toISOString()

  const [rate, config] = await Promise.all([
    db.selectFrom('staff_rates').selectAll().where('id', '=', rateId).executeTakeFirst(),
    db.selectFrom('staff_smart_configs').selectAll().where('rate_id', '=', rateId).executeTakeFirst(),
  ])

  if (!rate || !config || !rate.activity_id) return

  const startDate = new Date(billingMonth)
  const endDate = new Date(startDate)
  endDate.setMonth(endDate.getMonth() + 1)
  const billingEnd = toLocalDateString(endDate)

  const absenceResult = await db
    .selectFrom('attendance_logs')
    .select((eb) => eb.fn.countAll<number>().as('cnt'))
    .where('activity_id', '=', rate.activity_id)
    .where('date', '>=', new Date(billingMonth))
    .where('date', '<', new Date(billingEnd))
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
    .where('billing_month', '=', new Date(billingMonth))
    .where('type', '=', 'ACCRUAL')
    .where('is_deleted', '=', false)
    .executeTakeFirst()

  const existingCorrection = await db
    .selectFrom('salary_transactions')
    .select(['id', 'gross_amount'])
    .where('staff_id', '=', rate.staff_id)
    .where('rate_id', '=', rateId)
    .where('billing_month', '=', new Date(billingMonth))
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
      eb('valid_to', '>', billingObj),
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
  const rates = await db
    .selectFrom('staff_rates as r')
    .innerJoin('staff_smart_configs as sc', 'sc.rate_id', 'r.id')
    .where('r.rate_type', '=', 'smart')
    .where('r.rate_category', '=', 'auto')
    .where('r.valid_from', '<=', new Date(billingMonth))
    .where((eb) => eb.or([
      eb('r.valid_to', 'is', null),
      eb('r.valid_to', '>=', new Date(billingMonth)),
    ]))
    .select(['r.id', 'r.staff_id', 'r.activity_id', 'r.rate_value', 'r.deduction_pct', 'sc.base_lessons'])
    .execute()

  for (const rate of rates) {
    const existing = await db
      .selectFrom('salary_transactions')
      .select('id')
      .where('staff_id', '=', rate.staff_id)
      .where('rate_id', '=', rate.id)
      .where('billing_month', '=', new Date(billingMonth))
      .where('type', '=', 'ACCRUAL')
      .where('is_deleted', '=', false)
      .executeTakeFirst()

    if (!existing) {
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
    
    // Always trigger recalculation of corrections and per-child benefits
    // to ensure the month is fully up-to-date.
    await recalcSmartStaffBenefit(rate.id, billingMonth)
    await recalcSmartPerChildBenefit(rate.id, billingMonth)
  }
}
/**
 * Принудительный перерасчет всех начислений сотрудника за период.
 * Используется при вводе ставки задним числом для создания пропущенных записей.
 */
export async function triggerRetroAccruals(staffId: string, activityId: string | null, fromDate: Date, toDate: Date) {
  // 1. Находим все уникальные даты, где есть активность (логи)
  let dates: Date[] = []

  const fromStr = toLocalDateString(fromDate)
  const toStr   = toLocalDateString(toDate)

  if (activityId) {
    const attendanceDates = await db
      .selectFrom('attendance_logs')
      .select('date')
      .distinct()
      .where('activity_id', '=', activityId)
      .where('date', '>=', new Date(fromStr))
      .where('date', '<=', new Date(toStr))
      .execute()

    const groupDates = await db
      .selectFrom('group_lesson_logs')
      .select('date')
      .distinct()
      .where('activity_id', '=', activityId)
      .where('date', '>=', new Date(fromStr))
      .where('date', '<=', new Date(toStr))
      .execute()

    const allDates = [...attendanceDates, ...groupDates].map(d => toLocalDateString(new Date(d.date)))
    dates = Array.from(new Set(allDates)).map(d => new Date(d))
  }

  // 2. Для каждой даты запускаем стандартный перерасчет
  for (const d of dates) {
    const dateStr = toLocalDateString(d)
    await recalcStaffAccruals(activityId!, dateStr)
  }

  // 3. Если это фиксированный оклад (activityId === null или специфика rate_type),
  // нужно также проверить 1-е числа месяцев.
  // Но recalcStaffAccruals уже вызывается внутри цикла выше.
  // Если ставка глобальная (activityId === null), логика сложнее, 
  // но в текущей архитектуре авто-ставки всегда привязаны к активности.
}
