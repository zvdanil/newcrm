import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'
import { sql } from 'kysely'

export async function dividendsRoutes(app: FastifyInstance) {

  // ── 1. Equity Participants ─────────────────────────────────────────────────

  app.get('/participants', { preHandler: requireRole('owner') }, async () => {
    return db.selectFrom('equity_participants')
      .selectAll()
      .orderBy('name', 'asc')
      .execute()
  })

  app.post<{ Body: { name: string; share_pct: number; is_active?: boolean } }>(
    '/participants',
    { preHandler: requireRole('owner') },
    async (req, reply) => {
      const { name, share_pct, is_active = true } = req.body
      if (!name?.trim()) return reply.status(400).send({ error: 'BadRequest', message: 'Імʼя є обовʼязковим' })
      if (share_pct < 0 || share_pct > 100) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Доля повинна бути від 0 до 100' })
      }

      const row = await db.insertInto('equity_participants')
        .values({ name: name.trim(), share_pct, is_active })
        .returningAll()
        .executeTakeFirstOrThrow()
      return reply.status(201).send(row)
    }
  )

  app.put<{ Params: { id: string }; Body: { name?: string; share_pct?: number; is_active?: boolean } }>(
    '/participants/:id',
    { preHandler: requireRole('owner') },
    async (req, reply) => {
      const { name, share_pct, is_active } = req.body
      const updates: any = {}
      if (name !== undefined) updates.name = name.trim()
      if (share_pct !== undefined) {
        if (share_pct < 0 || share_pct > 100) return reply.status(400).send({ error: 'BadRequest', message: 'Доля повинна бути від 0 до 100' })
        updates.share_pct = share_pct
      }
      if (is_active !== undefined) updates.is_active = is_active

      const updated = await db.updateTable('equity_participants')
        .set(updates)
        .where('id', '=', req.params.id)
        .returningAll()
        .executeTakeFirst()
      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return updated
    }
  )

  app.delete<{ Params: { id: string } }>(
    '/participants/:id',
    { preHandler: requireRole('owner') },
    async (req, reply) => {
      // Check if participant has payouts
      const payouts = await db.selectFrom('dividend_payouts')
        .select('id')
        .where('participant_id', '=', req.params.id)
        .where('is_deleted', '=', false)
        .executeTakeFirst()
      
      if (payouts) {
        return reply.status(409).send({ error: 'Conflict', message: 'Учасник має привʼязані виплати. Видалення неможливе.' })
      }

      const deleted = await db.deleteFrom('equity_participants')
        .where('id', '=', req.params.id)
        .returningAll()
        .executeTakeFirst()
      if (!deleted) return reply.status(404).send({ error: 'NotFound' })
      return { ok: true }
    }
  )

  // ── 2. Settings ────────────────────────────────────────────────────────────

  app.get('/settings', { preHandler: requireRole('owner') }, async () => {
    let settings = await db.selectFrom('dividend_settings').selectAll().where('id', '=', 1).executeTakeFirst()
    if (!settings) {
      settings = await db.insertInto('dividend_settings').values({ id: 1, default_tax_pct: 0 }).returningAll().executeTakeFirstOrThrow()
    }
    return settings
  })

  app.put<{ Body: { default_tax_pct: number } }>(
    '/settings',
    { preHandler: requireRole('owner') },
    async (req, reply) => {
      if (req.body.default_tax_pct < 0 || req.body.default_tax_pct > 100) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Відсоток податку повинен бути від 0 до 100' })
      }
      const updated = await db.updateTable('dividend_settings')
        .set({ default_tax_pct: req.body.default_tax_pct })
        .where('id', '=', 1)
        .returningAll()
        .executeTakeFirst()
      if (!updated) {
        return db.insertInto('dividend_settings').values({ id: 1, default_tax_pct: req.body.default_tax_pct }).returningAll().executeTakeFirstOrThrow()
      }
      return updated
    }
  )

  // ── 3. Ledger & Balances ───────────────────────────────────────────────────

  app.get('/ledger', { preHandler: requireRole('owner') }, async () => {
    const participants = await db.selectFrom('equity_participants')
      .selectAll()
      .where('is_active', '=', true)
      .execute()

    const payouts = await db.selectFrom('dividend_payouts')
      .select(['participant_id', sql<number>`SUM(net_amount)`.as('actual_net')])
      .where('is_deleted', '=', false)
      .groupBy('participant_id')
      .execute()

    let totalNet = 0
    const participantStats = participants.map(p => {
      const actualNet = Number(payouts.find(po => po.participant_id === p.id)?.actual_net ?? 0)
      totalNet += actualNet
      return {
        id: p.id,
        name: p.name,
        share_pct: Number(p.share_pct),
        actual_net: actualNet,
      }
    })

    let maxRatio = 0
    const balances = participantStats.map(p => {
      const targetNet = totalNet * (p.share_pct / 100)
      const skew = p.actual_net - targetNet
      const ratio = p.share_pct > 0 ? p.actual_net / (p.share_pct / 100) : 0
      if (ratio > maxRatio) maxRatio = ratio

      return {
        ...p,
        target_net: targetNet,
        skew,
      }
    })

    const targetTotalNet = maxRatio
    const leveling = balances.map(b => {
      const requiredNet = (targetTotalNet * (b.share_pct / 100)) - b.actual_net
      return {
        participant_id: b.id,
        recommendation_amount: Math.max(0, requiredNet)
      }
    })

    return {
      total_net: totalNet,
      participants: balances,
      leveling
    }
  })

  // ── 4. Payouts ─────────────────────────────────────────────────────────────

  app.get('/payouts', { preHandler: requireRole('owner') }, async () => {
    const payouts = await db.selectFrom('dividend_payouts as dp')
      .innerJoin('equity_participants as ep', 'ep.id', 'dp.participant_id')
      .select([
        'dp.id', 'dp.date', 'dp.type', 'dp.tax_pct', 'dp.gross_amount', 'dp.net_amount', 'dp.note', 'dp.created_at',
        'dp.participant_id', 'ep.name as participant_name'
      ])
      .where('dp.is_deleted', '=', false)
      .orderBy('dp.date', 'desc')
      .orderBy('dp.created_at', 'desc')
      .execute()

    // Attach sources (expenses)
    const expenses = await db.selectFrom('expenses as e')
      .leftJoin('accounts as a', 'a.id', 'e.account_id')
      .select(['e.id', 'e.amount', 'e.dividend_payout_id', 'a.name as account_name'])
      .where('e.dividend_payout_id', 'is not', null)
      .where('e.is_deleted', '=', false)
      .execute()

    return payouts.map(p => ({
      ...p,
      sources: expenses.filter(e => e.dividend_payout_id === p.id)
    }))
  })

  app.post<{
    Body: {
      participant_id: string
      date?: string
      type: 'cash' | 'cashless'
      tax_pct: number
      note?: string
      sources: Array<{ type: 'new', account_id: string, amount: number } | { type: 'existing', expense_id: string }>
    }
  }>(
    '/payouts',
    { preHandler: requireRole('owner') },
    async (req, reply) => {
      const { participant_id, type, tax_pct, note, sources } = req.body
      const dateStr = req.body.date ?? new Date().toISOString().slice(0, 10)

      if (!sources || sources.length === 0) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Джерела не вказані' })
      }

      // 1. Calculate Gross Amount
      let grossAmount = 0
      const existingExpenses = []
      
      for (const src of sources) {
        if (src.type === 'new') {
          grossAmount += src.amount
        } else if (src.type === 'existing') {
          const expense = await db.selectFrom('expenses')
            .select(['id', 'amount', 'is_dividend', 'dividend_payout_id'])
            .where('id', '=', src.expense_id)
            .where('is_deleted', '=', false)
            .executeTakeFirst()
          
          if (!expense) return reply.status(404).send({ error: 'NotFound', message: `Расход ${src.expense_id} не знайдено` })
          if (!expense.is_dividend) return reply.status(400).send({ error: 'BadRequest', message: `Расход ${src.expense_id} не є дивідендом` })
          if (expense.dividend_payout_id) return reply.status(409).send({ error: 'Conflict', message: `Расход ${src.expense_id} вже привʼязаний до виплати` })
          
          grossAmount += Number(expense.amount)
          existingExpenses.push(expense.id)
        }
      }

      // 2. Calculate Net Amount
      const netAmount = type === 'cashless' 
        ? grossAmount * (1 - tax_pct / 100) 
        : grossAmount

      // 3. Begin Transaction
      const result = await db.transaction().execute(async (trx) => {
        // Create payout
        const payout = await trx.insertInto('dividend_payouts')
          .values({
            participant_id,
            date: dateStr,
            type,
            tax_pct,
            gross_amount: grossAmount,
            net_amount: netAmount,
            note: note ?? null,
            created_by: req.user.sub,
          })
          .returningAll()
          .executeTakeFirstOrThrow()

        // Process sources
        for (const src of sources) {
          if (src.type === 'new') {
            await trx.insertInto('expenses')
              .values({
                account_id: src.account_id,
                amount: src.amount,
                accrual_date: dateStr,
                payment_date: dateStr,
                status: 'paid',
                is_instant: true,
                is_dividend: true,
                dividend_payout_id: payout.id,
                note: note ? `Виплата дивідендів: ${note}` : 'Виплата дивідендів',
                created_by: req.user.sub,
              })
              .execute()
          } else if (src.type === 'existing') {
            await trx.updateTable('expenses')
              .set({ 
                dividend_payout_id: payout.id,
                status: 'paid',
                payment_date: dateStr
              })
              .where('id', '=', src.expense_id)
              .execute()
          }
        }

        return payout
      })

      return reply.status(201).send(result)
    }
  )

  app.delete<{ Params: { id: string } }>(
    '/payouts/:id',
    { preHandler: requireRole('owner') },
    async (req, reply) => {
      const payout = await db.selectFrom('dividend_payouts')
        .select('id')
        .where('id', '=', req.params.id)
        .where('is_deleted', '=', false)
        .executeTakeFirst()
      
      if (!payout) return reply.status(404).send({ error: 'NotFound' })

      await db.transaction().execute(async (trx) => {
        // Soft delete payout
        await trx.updateTable('dividend_payouts')
          .set({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.sub })
          .where('id', '=', req.params.id)
          .execute()

        // Unlink expenses (but keep them as is_dividend)
        await trx.updateTable('expenses')
          .set({ dividend_payout_id: null })
          .where('dividend_payout_id', '=', req.params.id)
          .execute()
      })

      return { ok: true }
    }
  )
}
