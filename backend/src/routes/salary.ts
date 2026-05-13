import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'

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

      // Summary
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
      const totalNet = Math.round((totalGross - totalDeduction) * 100) / 100
      const balance  = Math.round((totalNet - totalPaid) * 100) / 100

      return {
        transactions: txs,
        summary: { gross: totalGross, deduction: totalDeduction, net: totalNet, paid: totalPaid, balance },
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

      let finalGross     = gross_amount ?? 0
      let finalDeduction = deduction_pct
      let metadata: Record<string, unknown> = { source: 'manual' }

      if (rate_id) {
        const rate = await db
          .selectFrom('staff_rates')
          .select(['rate_value', 'rate_type', 'value_mode', 'deduction_pct', 'activity_id'])
          .where('id', '=', rate_id)
          .executeTakeFirst()

        if (!rate) return reply.status(404).send({ error: 'NotFound', message: 'Ставку не знайдено' })

        finalDeduction = Number(rate.deduction_pct)

        if (quantity !== undefined && quantity > 0) {
          if (rate.value_mode === 'percent_of_revenue') {
            // quantity = revenue base; gross = base × rate_value%
            finalGross = Math.round(quantity * Number(rate.rate_value) / 100 * 100) / 100
            metadata = { source: 'manual', revenue: quantity, rate_pct: Number(rate.rate_value), rate_type: rate.rate_type }
          } else {
            // fixed: quantity × rate_value (for hourly / per_lesson / per_child)
            finalGross = Math.round(quantity * Number(rate.rate_value) * 100) / 100
            metadata = { source: 'manual', quantity, rate_value: Number(rate.rate_value), rate_type: rate.rate_type }
          }
        } else {
          // No quantity: use provided gross_amount or fall back to rate_value
          if (!finalGross) finalGross = Number(rate.rate_value)
          metadata = { source: 'manual', rate_type: rate.rate_type }
        }
      }

      if (!finalGross || finalGross <= 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Сума нарахування повинна бути більше 0' })
      }

      const tx = await db.insertInto('salary_transactions').values({
        staff_id:         req.params.id,
        rate_id:          rate_id ?? null,
        activity_id:      activity_id ?? null,
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
    }
  }>(
    '/staff/:id/salary/pay',
    { preHandler: requireRole('owner', 'admin', 'accountant') },
    async (req, reply) => {
      const { gross_amount, transaction_date, billing_month, account_id, note } = req.body
      if (!gross_amount || gross_amount <= 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Сума повинна бути більше 0' })
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

      return reply.status(201).send(tx)
    }
  )

  // DELETE /api/staff/:id/salary/:txId — soft-delete a salary transaction
  app.delete<{ Params: { id: string; txId: string } }>(
    '/staff/:id/salary/:txId',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const tx = await db.selectFrom('salary_transactions')
        .select(['id', 'staff_id', 'is_deleted'])
        .where('id', '=', req.params.txId)
        .where('staff_id', '=', req.params.id)
        .executeTakeFirst()

      if (!tx || tx.is_deleted) return reply.status(404).send({ error: 'NotFound' })

      await db.updateTable('salary_transactions')
        .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.sub })
        .where('id', '=', req.params.txId)
        .execute()

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
        .where(eb => eb.or([
          eb('r.valid_to', 'is', null),
          eb('r.valid_to', '>', billingStart),
        ]))
        .select([
          'r.id', 'r.staff_id', 'r.rate_type', 'r.rate_category',
          'r.value_mode', 'r.rate_value', 'r.deduction_pct',
          'r.valid_from', 'r.valid_to', 'r.note',
          'r.activity_id', 'a.name as activity_name',
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
          summary: { gross: totalGross, deduction: totalDeduction, net: totalNet, paid: totalPaid, balance },
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

      const txs = await db
        .selectFrom('salary_transactions')
        .where('transaction_date', '>=', billingStart)
        .where('transaction_date', '<', billingEnd)
        .where('is_deleted', '=', false)
        .select(['staff_id', 'type', 'gross_amount', 'deduction_pct'])
        .execute()

      const map = new Map<string, { gross: number; deduction: number; net: number; paid: number; balance: number }>()

      for (const s of staff) {
        map.set(s.id, { gross: 0, deduction: 0, net: 0, paid: 0, balance: 0 })
      }

      for (const tx of txs) {
        const entry = map.get(tx.staff_id)
        if (!entry) continue
        const gross = Number(tx.gross_amount)
        const ded   = Math.round(gross * Number(tx.deduction_pct) / 100 * 100) / 100
        if (tx.type === 'PAYMENT') {
          entry.paid += gross
        } else {
          entry.gross      += gross
          entry.deduction  += ded
        }
      }

      for (const entry of map.values()) {
        entry.net     = Math.round((entry.gross - entry.deduction) * 100) / 100
        entry.balance = Math.round((entry.net - entry.paid) * 100) / 100
      }

      return {
        month,
        rows: staff.map(s => ({
          ...s,
          summary: map.get(s.id) ?? { gross: 0, deduction: 0, net: 0, paid: 0, balance: 0 },
        })),
      }
    }
  )
}
