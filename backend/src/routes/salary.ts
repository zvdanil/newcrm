import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'

async function countVacationDaysUsed(staffId: string, year: number, excludeTxId?: string): Promise<number> {
  let q = db
    .selectFrom('salary_transactions')
    .select(db.fn.count<string>('id').as('cnt'))
    .where('staff_id', '=', staffId)
    .where('type', '=', 'ACCRUAL')
    .where('is_deleted', '=', false)
    .where(sql<boolean>`EXTRACT(YEAR FROM transaction_date) = ${year}`)
    .where(sql<boolean>`metadata_json->>'source' = 'vacation_day'`)

  if (excludeTxId) {
    q = q.where('id', '!=', excludeTxId)
  }

  const row = await q.executeTakeFirst()
  return Number(row?.cnt ?? 0)
}

function workingDaysInMonth(dateStr: string): number {
  const [y, m] = dateStr.slice(0, 7).split('-').map(Number)
  const total = new Date(y, m, 0).getDate()
  let count = 0
  for (let d = 1; d <= total; d++) {
    const dow = new Date(y, m - 1, d).getDay()
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

function formatYmd(d: any): string {
  if (!d) return new Date().toISOString().slice(0, 10)
  if (d instanceof Date) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  const str = String(d).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10)
  }
  const dateObj = new Date(d)
  if (!isNaN(dateObj.getTime())) {
    const y = dateObj.getFullYear()
    const m = String(dateObj.getMonth() + 1).padStart(2, '0')
    const day = String(dateObj.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }
  return new Date().toISOString().slice(0, 10)
}

export async function salaryRoutes(app: FastifyInstance) {

  // GET /api/staff/:id/salary?month=YYYY-MM
  // Returns: transactions[], summary (gross/deduction/net/paid/balance)
  app.get<{ Params: { id: string }; Querystring: { month?: string } }>(
    '/staff/:id/salary',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      const rawMonth    = (req.query.month ?? new Date().toISOString().slice(0, 7)).slice(0, 7)
      const month       = rawMonth
      const billingStart = new Date(rawMonth + '-01')
      const billingEnd   = new Date(billingStart)
      billingEnd.setMonth(billingEnd.getMonth() + 1)

      const txs = await db
        .selectFrom('salary_transactions as st')
        .leftJoin('staff_rates as r', 'r.id', 'st.rate_id')
        .leftJoin('activities as a', 'a.id', 'st.activity_id')
        .leftJoin('accounts as ac', 'ac.id', 'st.account_id')
        .where('st.staff_id', '=', req.params.id)
        .where('st.transaction_date', '>=', billingStart)
        .where('st.transaction_date', '<', billingEnd)
        .where('st.is_deleted', '=', false)
        .select([
          'st.id', 'st.type', 'st.gross_amount', 'st.deduction_pct',
          'st.transaction_date', 'st.billing_month', 'st.note', 'st.edit_note',
          'st.metadata_json', 'st.created_at',
          'st.rate_id', 'r.rate_type', 'r.rate_category',
          'st.activity_id', 'a.name as activity_name',
          'st.account_id', 'ac.name as account_name',
        ])
        .orderBy('st.transaction_date', 'asc')
        .orderBy('st.created_at', 'asc')
        .execute()

      // Summary for current month
      let totalGross = 0, totalDeduction = 0, totalPaid = 0
      for (const tx of txs) {
        const gross = Number(tx.gross_amount)
        const ded   = Math.round(gross * Number(tx.deduction_pct) / 100 * 100) / 100
        if (tx.type === 'PAYMENT') {
          totalPaid += gross
        } else {
          totalGross    += gross
          totalDeduction += ded
        }
      }
      // Debt from previous periods with waterfall: current month payments cover past debts first
      const prevTxs = await db
        .selectFrom('salary_transactions')
        .where('staff_id',         '=', req.params.id)
        .where('transaction_date', '<', billingStart)
        .where('is_deleted',       '=', false)
        .select(['type', 'gross_amount', 'deduction_pct'])
        .execute()

      let prevNet = 0
      for (const tx of prevTxs) {
        const gross = Number(tx.gross_amount)
        const ded   = Math.round(gross * Number(tx.deduction_pct) / 100 * 100) / 100
        if (tx.type === 'PAYMENT') {
          prevNet -= gross
        } else {
          prevNet += (gross - ded)
        }
      }

      const totalNet = Math.round((totalGross - totalDeduction) * 100) / 100
      const paidPreviousPeriod = prevNet > 0 ? Math.round(Math.min(prevNet, totalPaid) * 100) / 100 : 0
      const debtPreviousPeriods = prevNet > 0 ? Math.round((prevNet - paidPreviousPeriod) * 100) / 100 : 0

      const paidCurrentMonth = Math.round((totalPaid - paidPreviousPeriod) * 100) / 100
      const overpaymentPreviousPeriods = prevNet < 0 ? -prevNet : 0
      const balance = Math.round((totalNet - (paidCurrentMonth + overpaymentPreviousPeriods)) * 100) / 100

      return {
        transactions: txs,
        summary: { gross: totalGross, deduction: totalDeduction, net: totalNet, paid: totalPaid, balance, debtPreviousPeriods, paidPreviousPeriod },
        month,
      }
    }
  )

  // POST /api/staff/:id/salary — manual accrual
  // For rate types hourly/per_lesson/per_child: pass quantity, gross = quantity × rate_value
  // For fixed_monthly/bonus or no rate: pass gross_amount directly
  app.post<{
    Params: { id: string }
    Body: {
      rate_id?: string
      activity_id?: string
      type?: 'ACCRUAL' | 'CORRECTION'
      quantity?: number        // hours / lessons / children — multiplied by rate_value
      gross_amount?: number    // used when no quantity-based rate (fixed, bonus, free-form)
      deduction_pct?: number
      transaction_date?: string
      note?: string
    }
  }>(
    '/staff/:id/salary',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const {
        rate_id, activity_id, type = 'ACCRUAL',
        quantity, gross_amount,
        deduction_pct = 0, transaction_date, note,
      } = req.body

      const today   = new Date().toISOString().slice(0, 10)
      const txDate  = transaction_date ?? today
      const billing = txDate.slice(0, 7) + '-01'

      let finalGross      = gross_amount ?? 0
      let finalDeduction  = deduction_pct
      let metadata: Record<string, unknown> = { source: 'manual' }
      let finalActivityId: string | null = activity_id ?? null

      if (rate_id) {
        const rate = await db
          .selectFrom('staff_rates')
          .select(['rate_value', 'rate_type', 'value_mode', 'deduction_pct', 'activity_id'])
          .where('id', '=', rate_id)
          .executeTakeFirst()

        if (!rate) return reply.status(404).send({ error: 'NotFound', message: 'Ставку не знайдено' })

        finalActivityId = activity_id ?? rate.activity_id ?? null

        finalDeduction = Number(rate.deduction_pct)

        if (rate.rate_type === 'vacation') {
          const vcfg = await db
            .selectFrom('staff_vacation_configs')
            .select(['day_rate_cached', 'vacation_days_limit', 'monthly_base_salary', 'calculation_base_type'])
            .where('rate_id', '=', rate_id!)
            .executeTakeFirst()

          if (!vcfg) return reply.status(400).send({ error: 'BadRequest', message: 'Конфігурацію відпускної ставки не знайдено' })

          const year      = new Date(txDate).getFullYear()
          const spent     = await countVacationDaysUsed(req.params.id, year)
          const limit     = vcfg.vacation_days_limit

          if (spent + 1 > limit) {
            return reply.status(409).send({
              error:   'VacationLimitExceeded',
              message: `Досягнуто максимальну кількість відпускних днів у цьому календарному році (Ліміт: ${limit} днів)`,
              spent,
              limit,
            })
          }

          const dayRateCached = Number(vcfg.day_rate_cached)
          finalGross = dayRateCached
          metadata = {
            source:               'vacation_day',
            mark:                 'В',
            day_rate:             dayRateCached,
            monthly_base_salary:  Number(vcfg.monthly_base_salary),
            calculation_base_type: vcfg.calculation_base_type,
            vacation_days_limit:  limit,
            spent_in_year:        spent,
          }
        } else if (rate.rate_type === 'monthly_by_day') {
          const monthlyRate  = Number(rate.rate_value)
          const workingDays  = workingDaysInMonth(txDate)
          const dailyRate    = Math.round(monthlyRate / workingDays * 100) / 100
          finalGross         = gross_amount !== undefined ? gross_amount : dailyRate
          metadata = {
            source:       'manual_daily',
            monthly_rate: monthlyRate,
            working_days: workingDays,
            daily_rate:   dailyRate,
          }
        } else if (quantity !== undefined) {
          if (rate.value_mode === 'percent_of_revenue') {
            finalGross = Math.round(quantity * Number(rate.rate_value) / 100 * 100) / 100
            metadata = { source: 'manual', revenue: quantity, rate_pct: Number(rate.rate_value), rate_type: rate.rate_type }
          } else {
            finalGross = Math.round(quantity * Number(rate.rate_value) * 100) / 100
            metadata = { source: 'manual', quantity, rate_value: Number(rate.rate_value), rate_type: rate.rate_type }
          }
        } else {
          // No quantity: use provided gross_amount or fall back to rate_value
          if (gross_amount === undefined) finalGross = Number(rate.rate_value)
          metadata = { source: 'manual', rate_type: rate.rate_type }
        }
      }


      const tx = await db.insertInto('salary_transactions').values({
        staff_id:         req.params.id,
        rate_id:          rate_id ?? null,
        activity_id:      finalActivityId,
        type,
        gross_amount:     finalGross,
        deduction_pct:    finalDeduction,
        transaction_date: txDate,
        billing_month:    billing,
        note:             note ?? null,
        metadata_json:    metadata,
        created_by:       req.user.sub,
      }).returningAll().executeTakeFirstOrThrow()

      return reply.status(201).send(tx)
    }
  )

  // PUT /api/staff/:id/salary/:txId — inline edit with mandatory comment
  app.put<{
    Params: { id: string; txId: string }
    Body: { gross_amount: number; edit_note: string; deduction_pct?: number }
  }>(
    '/staff/:id/salary/:txId',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { gross_amount, edit_note, deduction_pct } = req.body
      if (!edit_note?.trim()) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Причина редагування є обовʼязковою' })
      }
      if (!gross_amount || gross_amount <= 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Сума повинна бути більше 0' })
      }

      const tx = await db.selectFrom('salary_transactions')
        .select(['id', 'staff_id', 'type', 'is_deleted'])
        .where('id', '=', req.params.txId)
        .where('staff_id', '=', req.params.id)
        .executeTakeFirst()

      if (!tx || tx.is_deleted) return reply.status(404).send({ error: 'NotFound' })
      if (tx.type === 'PAYMENT') return reply.status(409).send({ error: 'Conflict', message: 'Виплату не можна редагувати' })

      const updates: Record<string, unknown> = { gross_amount, edit_note: edit_note.trim() }
      if (deduction_pct !== undefined) updates.deduction_pct = deduction_pct

      const updated = await db.updateTable('salary_transactions')
        .set(updates)
        .where('id', '=', req.params.txId)
        .returningAll()
        .executeTakeFirst()

      return updated
    }
  )

  // POST /api/staff/:id/salary/pay — salary payment
  app.post<{
    Params: { id: string }
    Body: {
      gross_amount: number
      transaction_date?: string
      billing_month?: string
      account_id?: string
      note?: string
      commission?: number
    }
  }>(
    '/staff/:id/salary/pay',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const { gross_amount, transaction_date, billing_month, account_id, note, commission } = req.body
      if (!gross_amount || gross_amount <= 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Сума повинна бути більше 0' })
      }

      const commissionAmt = Number(commission ?? 0)
      if (!Number.isFinite(commissionAmt) || commissionAmt < 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Комісія не може бути від\'ємною' })
      }
      if (commissionAmt > 0 && !account_id) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Для запису комісії необхідно вказати рахунок' })
      }

      const today   = new Date().toISOString().slice(0, 10)
      const txDate  = transaction_date ?? today

      const tx = await db.insertInto('salary_transactions').values({
        staff_id:         req.params.id,
        rate_id:          null,
        activity_id:      null,
        account_id:       account_id ?? null,
        type:             'PAYMENT',
        gross_amount,
        deduction_pct:    0,
        transaction_date: txDate,
        billing_month:    billing_month ?? (txDate.slice(0, 7) + '-01'),
        note:             note ?? null,
        metadata_json:    { source: 'manual_payment' },
        created_by:       req.user.sub,
      }).returningAll().executeTakeFirstOrThrow()

      let commissionExpense = null
      if (commissionAmt > 0) {
        const staff = await db.selectFrom('staff').select('full_name').where('id', '=', req.params.id).executeTakeFirst()
        const staffName = staff?.full_name ?? req.params.id

        const salaryCategory = await db.selectFrom('expense_categories')
          .select('id')
          .where('name', '=', 'Зарплата')
          .executeTakeFirst()

        commissionExpense = await db.insertInto('expenses').values({
          account_id:   account_id!,
          category_id:  salaryCategory?.id ?? null,
          amount:       commissionAmt,
          accrual_date: txDate,
          payment_date: txDate,
          status:       'paid',
          is_instant:   true,
          is_dividend:  false,
          note:         `Комісія за виплату ЗП: ${staffName}`,
          created_by:   req.user.sub,
        }).returningAll().executeTakeFirstOrThrow()
      }

      return reply.status(201).send({ tx, commission_expense: commissionExpense })
    }
  )

  // DELETE /api/staff/:id/salary/:txId — soft-delete a salary transaction
  app.delete<{ Params: { id: string; txId: string } }>(
    '/staff/:id/salary/:txId',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const tx = await db.selectFrom('salary_transactions')
        .select(['id', 'staff_id', 'is_deleted', 'dividend_payout_id', 'withdrawal_transfer_id', 'note', 'staff_id'])
        .where('id', '=', req.params.txId)
        .where('staff_id', '=', req.params.id)
        .executeTakeFirst()

      if (!tx || tx.is_deleted) return reply.status(404).send({ error: 'NotFound' })

      await db.transaction().execute(async (trx) => {
        // Soft delete the linked dividend payout if exists
        if (tx.dividend_payout_id) {
          await trx.updateTable('dividend_payouts')
            .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.sub })
            .where('id', '=', tx.dividend_payout_id)
            .execute()
        }

        // Cleanup withdrawal side effects
        if (tx.withdrawal_transfer_id) {
          const transfer = await trx.selectFrom('account_transfers')
            .select(['to_account_id'])
            .where('id', '=', tx.withdrawal_transfer_id)
            .executeTakeFirst()

          if (transfer) {
            // Need staff name for the expected note
            const staff = await trx.selectFrom('staff').select('full_name').where('id', '=', tx.staff_id).executeTakeFirst()
            const label = tx.note ?? staff?.full_name ?? tx.id
            const expectedNotePrefix = `% за вывод ${label}`

            await trx.updateTable('expenses')
              .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.sub })
              .where('account_id', '=', transfer.to_account_id)
              .where('note', 'like', `${expectedNotePrefix}%`)
              .where('is_deleted', '=', false)
              .execute()
          }

          await trx.deleteFrom('account_transfers')
            .where('id', '=', tx.withdrawal_transfer_id)
            .execute()
        }

        await trx.updateTable('salary_transactions')
          .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.sub })
          .where('id', '=', req.params.txId)
          .execute()
      })

      return reply.status(204).send()
    }
  )

  // GET /api/salary/grid?month=YYYY-MM — full transaction grid for all staff
  app.get<{ Querystring: { month?: string } }>(
    '/salary/grid',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      const month        = (req.query.month ?? new Date().toISOString().slice(0, 7)).slice(0, 7)
      const billingStart = new Date(month + '-01')
      const billingEnd   = new Date(billingStart)
      billingEnd.setMonth(billingEnd.getMonth() + 1)

      // All dates in the month
      const daysCount = new Date(billingStart.getFullYear(), billingStart.getMonth() + 1, 0).getDate()
      const dates: string[] = Array.from({ length: daysCount }, (_, i) => {
        const d = new Date(billingStart)
        d.setDate(i + 1)
        return d.toISOString().slice(0, 10)
      })

      const staff = await db
        .selectFrom('staff')
        .where('is_active', '=', true)
        .orderBy('full_name', 'asc')
        .selectAll()
        .execute()

      const txs = await db
        .selectFrom('salary_transactions as st')
        .leftJoin('staff_rates as r', 'r.id', 'st.rate_id')
        .leftJoin('activities as a', 'a.id', 'st.activity_id')
        .leftJoin('accounts as ac', 'ac.id', 'st.account_id')
        .where('st.transaction_date', '>=', billingStart)
        .where('st.transaction_date', '<', billingEnd)
        .where('st.is_deleted', '=', false)
        .select([
          'st.id', 'st.staff_id', 'st.type', 'st.gross_amount', 'st.deduction_pct',
          'st.transaction_date', 'st.billing_month', 'st.note', 'st.edit_note',
          'st.metadata_json', 'st.created_at',
          'st.rate_id', 'r.rate_type', 'r.rate_category',
          'st.activity_id', 'a.name as activity_name',
          'st.account_id', 'ac.name as account_name',
        ])
        .orderBy('st.transaction_date', 'asc')
        .orderBy('st.created_at', 'asc')
        .execute()

      // Load active rates for all staff (active in this billing month or later)
      const rates = await db
        .selectFrom('staff_rates as r')
        .leftJoin('activities as a', 'a.id', 'r.activity_id')
        .leftJoin('staff_vacation_configs as vc', 'vc.rate_id', 'r.id')
        .where(eb => eb.or([
          eb('r.valid_to', 'is', null),
          eb('r.valid_to', '>', billingStart),
        ]))
        .select([
          'r.id', 'r.staff_id', 'r.rate_type', 'r.rate_category',
          'r.value_mode', 'r.rate_value', 'r.deduction_pct',
          'r.valid_from', 'r.valid_to', 'r.note',
          'r.activity_id', 'a.name as activity_name',
          'vc.day_rate_cached', 'vc.vacation_days_limit',
        ])
        .orderBy('r.valid_from', 'asc')
        .execute()

      // Group transactions and rates by staff_id
      const txMap = new Map<string, typeof txs>()
      for (const tx of txs) {
        if (!txMap.has(tx.staff_id)) txMap.set(tx.staff_id, [])
        txMap.get(tx.staff_id)!.push(tx)
      }

      const rateMap = new Map<string, typeof rates>()
      for (const rate of rates) {
        if (!rateMap.has(rate.staff_id)) rateMap.set(rate.staff_id, [])
        rateMap.get(rate.staff_id)!.push(rate)
      }

      const rows = staff.map(s => {
        const staffTxs   = txMap.get(s.id) ?? []
        const staffRates = rateMap.get(s.id) ?? []
        let totalGross = 0, totalDeduction = 0, totalPaid = 0
        for (const tx of staffTxs) {
          const gross = Number(tx.gross_amount)
          const ded   = Math.round(gross * Number(tx.deduction_pct) / 100 * 100) / 100
          if (tx.type === 'PAYMENT') {
            totalPaid += gross
          } else {
            totalGross     += gross
            totalDeduction += ded
          }
        }
        const totalNet = Math.round((totalGross - totalDeduction) * 100) / 100
        const balance  = Math.round((totalNet - totalPaid) * 100) / 100
        return {
          ...s,
          rates: staffRates,
          transactions: staffTxs,
          summary: { gross: totalGross, deduction: totalDeduction, net: totalNet, paid: totalPaid, balance, debtPreviousPeriods: 0, paidPreviousPeriod: 0 },
        }
      })

      return { month, dates, rows }
    }
  )

  // GET /api/salary/journal?month=YYYY-MM — all staff summary
  app.get<{ Querystring: { month?: string } }>(
    '/salary/journal',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      const month        = (req.query.month ?? new Date().toISOString().slice(0, 7)).slice(0, 7)
      const billingStart = new Date(month + '-01')
      const billingEnd   = new Date(billingStart)
      billingEnd.setMonth(billingEnd.getMonth() + 1)

      const staff = await db.selectFrom('staff').where('is_active', '=', true).orderBy('full_name', 'asc').selectAll().execute()

      const allTxs = await db
        .selectFrom('salary_transactions')
        .where('is_deleted', '=', false)
        .select(['staff_id', 'type', 'gross_amount', 'deduction_pct', 'transaction_date'])
        .execute()

      const map = new Map<string, {
        gross: number; deduction: number; net: number; paid: number; balance: number;
        totalGross: number; totalDeduction: number; totalNet: number; totalPaid: number; totalBalance: number;
        debtPreviousPeriods: number; paidPreviousPeriod: number
      }>()

      for (const s of staff) {
        map.set(s.id, {
          gross: 0, deduction: 0, net: 0, paid: 0, balance: 0,
          totalGross: 0, totalDeduction: 0, totalNet: 0, totalPaid: 0, totalBalance: 0,
          debtPreviousPeriods: 0, paidPreviousPeriod: 0
        })
      }

      for (const tx of allTxs) {
        const entry = map.get(tx.staff_id)
        if (!entry) continue
        const gross = Number(tx.gross_amount)
        const ded   = Math.round(gross * Number(tx.deduction_pct) / 100 * 100) / 100

        if (tx.type === 'PAYMENT') {
          entry.totalPaid += gross
        } else {
          entry.totalGross     += gross
          entry.totalDeduction += ded
        }

        const txDate = new Date(tx.transaction_date)
        if (txDate >= billingStart && txDate < billingEnd) {
          if (tx.type === 'PAYMENT') {
            entry.paid += gross
          } else {
            entry.gross     += gross
            entry.deduction += ded
          }
        }
      }

      for (const entry of map.values()) {
        entry.net          = Math.round((entry.gross - entry.deduction) * 100) / 100
        entry.balance      = Math.round((entry.net - entry.paid) * 100) / 100
        entry.totalNet     = Math.round((entry.totalGross - entry.totalDeduction) * 100) / 100
        entry.totalBalance = Math.round((entry.totalNet - entry.totalPaid) * 100) / 100
      }

      const emptySummary = {
        gross: 0, deduction: 0, net: 0, paid: 0, balance: 0,
        totalGross: 0, totalDeduction: 0, totalNet: 0, totalPaid: 0, totalBalance: 0,
        debtPreviousPeriods: 0, paidPreviousPeriod: 0
      }

      return {
        month,
        rows: staff.map(s => ({
          ...s,
          summary: map.get(s.id) ?? emptySummary,
        })),
      }
    }
  )

  // ── Salary Payments — Expenses view ────────────────────────────────────────

  // GET /api/salary/payments?account_id=&from=&to=&is_dividend=
  // Returns all PAYMENT transactions (for display in Витрати / Зарплата tab)
  app.get<{
    Querystring: { account_id?: string; from?: string; to?: string; is_dividend?: string }
  }>(
    '/salary/payments',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      const { account_id, from, to, is_dividend } = req.query

      let q = db
        .selectFrom('salary_transactions as st')
        .innerJoin('staff as s', 's.id', 'st.staff_id')
        .leftJoin('accounts as ac', 'ac.id', 'st.account_id')
        .where('st.type', '=', 'PAYMENT')
        .where('st.is_deleted', '=', false)
        .select([
          'st.id', 'st.staff_id', 's.full_name as staff_name',
          'st.account_id', 'ac.name as account_name',
          'st.gross_amount', 'st.transaction_date', 'st.billing_month',
          'st.note', 'st.is_dividend', 'st.withdrawal_transfer_id', 'st.created_at',
          'st.dividend_payout_id'
        ])
        .orderBy('st.transaction_date', 'desc')
        .orderBy('st.created_at', 'desc')
        .limit(500)

      if (account_id)         q = q.where('st.account_id', '=', account_id)
      if (from)               q = q.where('st.transaction_date', '>=', new Date(from))
      if (to)                 q = q.where('st.transaction_date', '<=', new Date(to))
      if (is_dividend === 'true')  q = q.where('st.is_dividend', '=', true)
      if (is_dividend === 'false') q = q.where('st.is_dividend', '=', false)

      const rows = await q.execute()

      const total_amount = rows.reduce((s, r) => s + Number(r.gross_amount), 0)

      return { data: rows, total: rows.length, total_amount }
    }
  )

  // PUT /api/salary/payments/:txId/dividend — toggle is_dividend (Owner only)
  app.put<{ Params: { txId: string }; Body: { is_dividend: boolean } }>(
    '/salary/payments/:txId/dividend',
    { preHandler: requireRole('owner') },
    async (req, reply) => {
      const updated = await db.updateTable('salary_transactions')
        .set({ is_dividend: req.body.is_dividend })
        .where('id', '=', req.params.txId)
        .where('type', '=', 'PAYMENT')
        .where('is_deleted', '=', false)
        .returningAll()
        .executeTakeFirst()
      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return updated
    }
  )

  // POST /api/salary/payments/:txId/withdraw — cash-out a salary payment
  app.post<{
    Params: { txId: string }
    Body: { target_account_id: string; commission: number; transfer_date?: string }
  }>(
    '/salary/payments/:txId/withdraw',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { target_account_id, commission, transfer_date } = req.body

      if (!target_account_id) {
        return reply.status(400).send({ error: 'BadRequest', message: 'target_account_id є обовʼязковим' })
      }
      const commissionPct = Number(commission)
      if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Комісія має бути від 0 до 100 %' })
      }

      const tx = await db.selectFrom('salary_transactions')
        .innerJoin('staff as s', 's.id', 'salary_transactions.staff_id')
        .select([
          'salary_transactions.id', 'salary_transactions.account_id',
          'salary_transactions.gross_amount', 'salary_transactions.note',
          'salary_transactions.is_deleted', 'salary_transactions.withdrawal_transfer_id',
          's.full_name as staff_name',
        ])
        .where('salary_transactions.id', '=', req.params.txId)
        .where('salary_transactions.type', '=', 'PAYMENT')
        .executeTakeFirst()

      if (!tx || tx.is_deleted) return reply.status(404).send({ error: 'NotFound' })
      if (tx.withdrawal_transfer_id) {
        return reply.status(409).send({ error: 'AlreadyWithdrawn', message: 'Обналичування вже було виконано' })
      }
      if (!tx.account_id) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Виплата не прив\'язана до рахунку' })
      }

      const amount = Number(tx.gross_amount)
      const roundedCommission = Math.round(amount * commissionPct * 100) / 10000
      if (roundedCommission >= amount) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Комісія не може перевищувати суму транзакції' })
      }

      const dateStr = transfer_date ?? new Date().toISOString().slice(0, 10)
      const label   = tx.note ?? tx.staff_name ?? tx.id

      const withdrawalCategory = await db.selectFrom('expense_categories')
        .select('id')
        .where('name', '=', 'Вивід коштів')
        .executeTakeFirst()
      const categoryId = withdrawalCategory ? withdrawalCategory.id : null

      // 1. Transfer: money comes back (FULL amount) to target account
      const transfer = await db.insertInto('account_transfers')
        .values({
          from_account_id: tx.account_id,
          to_account_id:   target_account_id,
          amount:          amount,
          commission:      0,
          transfer_date:   dateStr,
          note: `Обналичування ЗП: ${label}`,
          created_by: req.user.sub,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      // 2. Commission as a separate expense on target account (if commission > 0)
      let commissionExpense = null
      if (roundedCommission > 0) {
        commissionExpense = await db.insertInto('expenses')
          .values({
            account_id:   target_account_id,
            category_id:  categoryId,
            amount:       roundedCommission,
            accrual_date: dateStr,
            payment_date: dateStr,
            status:       'paid',
            is_instant:   true,
            is_dividend:  false,
            note: `% за вывод ${label}`,
            created_by:   req.user.sub,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
      }

      // 3. Mark salary transaction as withdrawn
      await db.updateTable('salary_transactions')
        .set({ withdrawal_transfer_id: transfer.id })
        .where('id', '=', req.params.txId)
        .execute()

      return reply.status(201).send({ ok: true, transfer, commission_expense: commissionExpense })
    }
  )

  // GET /api/salary/payments/:txId/withdrawal — fetch current withdrawal info
  app.get<{ Params: { txId: string } }>(
    '/salary/payments/:txId/withdrawal',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const tx = await db.selectFrom('salary_transactions')
        .innerJoin('staff as s', 's.id', 'salary_transactions.staff_id')
        .select([
          'salary_transactions.id', 'salary_transactions.withdrawal_transfer_id',
          'salary_transactions.gross_amount', 'salary_transactions.note',
          's.full_name as staff_name'
        ])
        .where('salary_transactions.id', '=', req.params.txId)
        .where('salary_transactions.type', '=', 'PAYMENT')
        .where('salary_transactions.is_deleted', '=', false)
        .executeTakeFirst()

      if (!tx || !tx.withdrawal_transfer_id) {
        return reply.status(404).send({ error: 'NotFound', message: 'Обналичування не знайдено' })
      }

      const transfer = await db.selectFrom('account_transfers')
        .select(['id', 'from_account_id', 'to_account_id', 'amount', 'transfer_date'])
        .where('id', '=', tx.withdrawal_transfer_id)
        .executeTakeFirst()

      if (!transfer) {
        return reply.status(404).send({ error: 'NotFound', message: 'Переказ не знайдено' })
      }

      const withdrawalCategory = await db.selectFrom('expense_categories')
        .select('id')
        .where('name', '=', 'Вивід коштів')
        .executeTakeFirst()

      let commissionExpense = null
      if (withdrawalCategory) {
        commissionExpense = await db.selectFrom('expenses')
          .select(['id', 'amount'])
          .where('account_id', '=', transfer.to_account_id)
          .where('category_id', '=', withdrawalCategory.id)
          .where('accrual_date', '=', transfer.transfer_date)
          .where('note', 'like', `% за вывод %`)
          .where('is_deleted', '=', false)
          .executeTakeFirst()
      }

      const withdrawalAmount = Number(transfer.amount)
      const commissionAmount = commissionExpense ? Number(commissionExpense.amount) : 0
      const commissionPct = withdrawalAmount > 0 ? Math.round((commissionAmount / withdrawalAmount) * 10000) / 100 : 0

      return reply.send({
        target_account_id: transfer.to_account_id,
        withdrawal_amount: withdrawalAmount,
        commission: commissionPct,
        commission_amount: commissionAmount,
        transfer_date: formatYmd(transfer.transfer_date),
      })
    }
  )

  // PUT /api/salary/payments/:txId/withdraw — edit an existing cash-out for salary payment
  app.put<{
    Params: { txId: string }
    Body: { target_account_id: string; commission: number; transfer_date?: string }
  }>(
    '/salary/payments/:txId/withdraw',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { target_account_id, commission, transfer_date } = req.body

      if (!target_account_id) {
        return reply.status(400).send({ error: 'BadRequest', message: 'target_account_id є обовʼязковим' })
      }
      const commissionPct = Number(commission)
      if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Комісія має бути від 0 до 100 %' })
      }

      const tx = await db.selectFrom('salary_transactions')
        .innerJoin('staff as s', 's.id', 'salary_transactions.staff_id')
        .select([
          'salary_transactions.id', 'salary_transactions.account_id',
          'salary_transactions.gross_amount', 'salary_transactions.note',
          'salary_transactions.is_deleted', 'salary_transactions.withdrawal_transfer_id',
          's.full_name as staff_name',
        ])
        .where('salary_transactions.id', '=', req.params.txId)
        .where('salary_transactions.type', '=', 'PAYMENT')
        .executeTakeFirst()

      if (!tx || tx.is_deleted) return reply.status(404).send({ error: 'NotFound' })
      if (!tx.withdrawal_transfer_id) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Обналичування ще не створено' })
      }
      if (!tx.account_id) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Виплата не прив\'язана до рахунку' })
      }

      const amount = Number(tx.gross_amount)
      const roundedCommission = Math.round(amount * commissionPct * 100) / 10000
      if (roundedCommission >= amount) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Комісія не може перевищувати суму транзакції' })
      }

      const dateStr = transfer_date ?? new Date().toISOString().slice(0, 10)
      const label   = tx.note ?? tx.staff_name ?? tx.id

      const withdrawalCategory = await db.selectFrom('expense_categories')
        .select('id')
        .where('name', '=', 'Вивід коштів')
        .executeTakeFirst()
      const categoryId = withdrawalCategory ? withdrawalCategory.id : null

      await db.transaction().execute(async (trx) => {
        const transfer = await trx.selectFrom('account_transfers')
          .select(['id', 'to_account_id', 'transfer_date'])
          .where('id', '=', tx.withdrawal_transfer_id!)
          .executeTakeFirst()

        if (transfer) {
          await trx.updateTable('account_transfers')
            .set({
              from_account_id: tx.account_id!,
              to_account_id: target_account_id,
              amount: amount,
              transfer_date: dateStr,
              note: `Обналичування ЗП: ${label}`,
            })
            .where('id', '=', transfer.id)
            .execute()

          let existingCommission = null
          if (categoryId) {
            existingCommission = await trx.selectFrom('expenses')
              .select(['id'])
              .where('account_id', '=', transfer.to_account_id)
              .where('category_id', '=', categoryId)
              .where('accrual_date', '=', transfer.transfer_date)
              .where('note', 'like', `% за вывод %`)
              .where('is_deleted', '=', false)
              .executeTakeFirst()
          }

          if (roundedCommission > 0) {
            if (existingCommission) {
              await trx.updateTable('expenses')
                .set({
                  account_id: target_account_id,
                  amount: roundedCommission,
                  accrual_date: dateStr,
                  payment_date: dateStr,
                  note: `% за вывод ${label}`,
                })
                .where('id', '=', existingCommission.id)
                .execute()
            } else {
              await trx.insertInto('expenses')
                .values({
                  account_id: target_account_id,
                  category_id: categoryId,
                  amount: roundedCommission,
                  accrual_date: dateStr,
                  payment_date: dateStr,
                  status: 'paid',
                  is_instant: true,
                  is_dividend: false,
                  note: `% за вывод ${label}`,
                  created_by: req.user.sub,
                })
                .execute()
            }
          } else if (existingCommission) {
            await trx.updateTable('expenses')
              .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.sub })
              .where('id', '=', existingCommission.id)
              .execute()
          }
        }
      })

      return reply.send({ ok: true })
    }
  )

  // DELETE /api/salary/payments/:txId/withdraw — cancel/delete cash-out for salary payment
  app.delete<{ Params: { txId: string } }>(
    '/salary/payments/:txId/withdraw',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const tx = await db.selectFrom('salary_transactions')
        .select(['id', 'withdrawal_transfer_id'])
        .where('id', '=', req.params.txId)
        .where('is_deleted', '=', false)
        .executeTakeFirst()

      if (!tx || !tx.withdrawal_transfer_id) {
        return reply.status(404).send({ error: 'NotFound', message: 'Обналичування не знайдено' })
      }

      await db.transaction().execute(async (trx) => {
        const transfer = await trx.selectFrom('account_transfers')
          .select(['id', 'to_account_id', 'transfer_date'])
          .where('id', '=', tx.withdrawal_transfer_id!)
          .executeTakeFirst()

        if (transfer) {
          await trx.updateTable('expenses')
            .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.sub })
            .where('account_id', '=', transfer.to_account_id)
            .where('accrual_date', '=', transfer.transfer_date)
            .where('note', 'like', `% за вывод %`)
            .where('is_deleted', '=', false)
            .execute()

          await trx.deleteFrom('account_transfers')
            .where('id', '=', transfer.id)
            .execute()
        }

        await trx.updateTable('salary_transactions')
          .set({ withdrawal_transfer_id: null })
          .where('id', '=', tx.id)
          .execute()
      })

      return reply.send({ ok: true })
    }
  )

  // GET /api/staff/:id/salary/total — cumulative all-time salary summary
  app.get<{ Params: { id: string } }>(
    '/staff/:id/salary/total',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      const txs = await db
        .selectFrom('salary_transactions')
        .select(['type', 'gross_amount', 'deduction_pct'])
        .where('staff_id',   '=', req.params.id)
        .where('is_deleted', '=', false)
        .execute()

      let totalGross = 0, totalDeduction = 0, totalPaid = 0
      for (const tx of txs) {
        const gross = Number(tx.gross_amount)
        const ded   = Math.round(gross * Number(tx.deduction_pct) / 100 * 100) / 100
        if (tx.type === 'PAYMENT') {
          totalPaid += gross
        } else {
          totalGross     += gross
          totalDeduction += ded
        }
      }
      const totalNet = Math.round((totalGross - totalDeduction) * 100) / 100
      const balance  = Math.round((totalNet - totalPaid) * 100) / 100

      return { gross: totalGross, deduction: totalDeduction, net: totalNet, paid: totalPaid, balance, debtPreviousPeriods: 0, paidPreviousPeriod: 0 }
    }
  )

  // GET /api/staff/:id/vacation-days?year=YYYY — остаток отпускных дней
  app.get<{ Params: { id: string }; Querystring: { year?: string } }>(
    '/staff/:id/vacation-days',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear()

      // Find active vacation rate for this staff member
      const today = new Date().toISOString().slice(0, 10)
      const vacRate = await db
        .selectFrom('staff_rates as r')
        .innerJoin('staff_vacation_configs as vc', 'vc.rate_id', 'r.id')
        .where('r.staff_id', '=', req.params.id)
        .where('r.rate_type', '=', 'vacation')
        .where((eb) => eb.or([eb('r.valid_to', 'is', null), eb('r.valid_to', '>=', new Date(today))]))
        .select(['r.id', 'vc.vacation_days_limit', 'vc.day_rate_cached'])
        .orderBy('r.valid_from', 'desc')
        .executeTakeFirst()

      if (!vacRate) return { limit: 0, used: 0, remaining: 0 }

      const used      = await countVacationDaysUsed(req.params.id, year)
      const limit     = vacRate.vacation_days_limit
      const remaining = Math.max(0, limit - used)

      return { limit, used, remaining, day_rate: Number(vacRate.day_rate_cached) }
    }
  )

  // POST /api/staff/:id/vacation-marks-range — batch vacation marks for a date range
  app.post<{
    Params: { id: string }
    Body: { rate_id: string; date_from: string; date_to: string; note?: string }
  }>(
    '/staff/:id/vacation-marks-range',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { rate_id, date_from, date_to, note } = req.body

      const vcfg = await db
        .selectFrom('staff_vacation_configs')
        .select(['day_rate_cached', 'vacation_days_limit', 'monthly_base_salary', 'calculation_base_type'])
        .where('rate_id', '=', rate_id)
        .executeTakeFirst()

      if (!vcfg) return reply.status(400).send({ error: 'BadRequest', message: 'Конфігурацію відпускної ставки не знайдено' })

      // Enumerate every calendar day in the range
      const dates: string[] = []
      const cur = new Date(date_from + 'T00:00:00')
      const end = new Date(date_to   + 'T00:00:00')
      while (cur <= end) {
        dates.push(cur.toISOString().slice(0, 10))
        cur.setDate(cur.getDate() + 1)
      }

      if (dates.length === 0) return reply.status(400).send({ error: 'BadRequest', message: 'Порожній діапазон дат' })

      // Check limit for the whole range (use year of date_from)
      const year  = new Date(date_from + 'T00:00:00').getFullYear()
      const spent = await countVacationDaysUsed(req.params.id, year)
      const limit = vcfg.vacation_days_limit

      if (spent + dates.length > limit) {
        return reply.status(409).send({
          error:   'VacationLimitExceeded',
          message: `Досягнуто максимальну кількість відпускних днів у ${year} році (Ліміт: ${limit} дн., використано: ${spent}, запит: ${dates.length} дн.)`,
          spent, limit, requested: dates.length,
        })
      }

      const dayRateCached = Number(vcfg.day_rate_cached)
      const rateRow = await db.selectFrom('staff_rates').select(['deduction_pct', 'activity_id']).where('id', '=', rate_id).executeTakeFirst()
      const deductionPct     = rateRow ? Number(rateRow.deduction_pct) : 0
      const rateActivityId   = rateRow?.activity_id ?? null

      const rows = dates.map((d, i) => ({
        staff_id:         req.params.id,
        rate_id,
        activity_id:      rateActivityId,
        type:             'ACCRUAL' as const,
        gross_amount:     dayRateCached,
        deduction_pct:    deductionPct,
        transaction_date: d,
        billing_month:    d.slice(0, 7) + '-01',
        note:             note ?? null,
        metadata_json:    {
          source:               'vacation_day',
          mark:                 'В',
          day_rate:             dayRateCached,
          monthly_base_salary:  Number(vcfg.monthly_base_salary),
          calculation_base_type: vcfg.calculation_base_type,
          vacation_days_limit:  limit,
          spent_in_year:        spent + i,
        },
        created_by: req.user.sub,
      }))

      await db.insertInto('salary_transactions').values(rows).execute()

      return reply.status(201).send({ created: dates.length })
    }
  )

  // GET /api/staff/:id/vacation-history?rate_id=...&date_from=...&date_to=...
  app.get<{
    Params: { id: string }
    Querystring: { rate_id?: string; date_from?: string; date_to?: string }
  }>(
    '/staff/:id/vacation-history',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req) => {
      let q = db
        .selectFrom('salary_transactions')
        .select(['transaction_date', 'gross_amount', 'note', 'rate_id'])
        .where('staff_id',   '=', req.params.id)
        .where('type',       '=', 'ACCRUAL')
        .where('is_deleted', '=', false)
        .where(sql<boolean>`metadata_json->>'source' = 'vacation_day'`)

      // rate_id не фільтруємо — відпускні могли бути на різних версіях ставки (SCD), показуємо всі
      if (req.query.date_from) q = q.where(sql<boolean>`transaction_date >= CAST(${req.query.date_from} AS DATE)`)
      if (req.query.date_to)   q = q.where(sql<boolean>`transaction_date <= CAST(${req.query.date_to}   AS DATE)`)

      const rows = await q.orderBy('transaction_date', 'asc').execute()

      return rows.map(r => ({
        date:         new Date(r.transaction_date as Date).toISOString().slice(0, 10),
        gross_amount: Number(r.gross_amount),
        note:         r.note,
      }))
    }
  )
}
