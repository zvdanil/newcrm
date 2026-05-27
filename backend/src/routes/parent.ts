import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { authenticate } from '../plugins/authenticate.js'

async function getParentId(userId: string): Promise<string | null> {
  const user = await db.selectFrom('users').select('parent_id').where('id', '=', userId).executeTakeFirst()
  return user?.parent_id ?? null
}

async function assertChildAccess(parentId: string, childId: string): Promise<boolean> {
  const link = await db.selectFrom('child_parents')
    .select('child_id')
    .where('parent_id', '=', parentId)
    .where('child_id', '=', childId)
    .executeTakeFirst()
  return !!link
}

export async function parentRoutes(app: FastifyInstance) {
  // All routes require authenticated parent
  app.addHook('preHandler', authenticate)
  app.addHook('preHandler', async (req, reply) => {
    if ((req as { user?: { role?: string } }).user?.role !== 'parent') {
      return reply.status(403).send({ error: 'Forbidden' })
    }
  })

  // GET /api/parent/children — all children with balances
  app.get('/children', async (req) => {
    const userId = (req as { user?: { sub?: string } }).user?.sub ?? ''
    const parentId = await getParentId(userId)
    if (!parentId) return []

    const children = await db
      .selectFrom('child_parents as cp')
      .innerJoin('children as c', 'c.id', 'cp.child_id')
      .select(['c.id', 'c.full_name', 'c.birth_date', 'c.note'])
      .where('cp.parent_id', '=', parentId)
      .where('c.is_active', '=', true)
      .orderBy('c.full_name', 'asc')
      .execute()

    const result = await Promise.all(children.map(async (child) => {
      const balances = await db
        .selectFrom('child_balances as cb')
        .innerJoin('accounts as a', 'a.id', 'cb.account_id')
        .select(['a.name as account_name', 'cb.balance'])
        .where('cb.child_id', '=', child.id)
        .execute()

      return { ...child, balances }
    }))

    return result
  })

  // GET /api/parent/children/:childId/ledger?from=&to=
  app.get<{
    Params: { childId: string }
    Querystring: { from?: string; to?: string }
  }>('/children/:childId/ledger', async (req, reply) => {
    const userId = (req as { user?: { sub?: string } }).user?.sub ?? ''
    const parentId = await getParentId(userId)
    if (!parentId) return reply.status(403).send({ error: 'Forbidden' })

    const hasAccess = await assertChildAccess(parentId, req.params.childId)
    if (!hasAccess) return reply.status(403).send({ error: 'Forbidden' })

    const { from, to } = req.query

    const rows = await db
      .selectFrom('transactions as t')
      .leftJoin('activities as a', 'a.id', 't.activity_id')
      .leftJoin('accounts as ac', 'ac.id', 't.account_id')
      .select([
        't.id', 't.type', 't.amount', 't.transaction_date', 't.billing_month',
        't.note', 'a.name as activity_name', 'ac.name as account_name',
      ])
      .where('t.child_id', '=', req.params.childId)
      .where('t.type', 'in', ['ACCRUAL', 'PAYMENT', 'REFUND', 'ADJUSTMENT'])
      .where('t.is_deleted', '=', false)
      .$if(!!from, (q) => q.where('t.transaction_date', '>=', new Date(from!)))
      .$if(!!to,   (q) => q.where('t.transaction_date', '<=', new Date(to!)))
      .orderBy('t.transaction_date', 'desc')
      .limit(200)
      .execute()

    return rows
  })

  // GET /api/parent/children/:childId/month-summary?month=YYYY-MM
  app.get<{
    Params: { childId: string }
    Querystring: { month?: string }
  }>('/children/:childId/month-summary', async (req, reply) => {
    const userId = (req as { user?: { sub?: string } }).user?.sub ?? ''
    const parentId = await getParentId(userId)
    if (!parentId) return reply.status(403).send({ error: 'Forbidden' })

    const hasAccess = await assertChildAccess(parentId, req.params.childId)
    if (!hasAccess) return reply.status(403).send({ error: 'Forbidden' })

    const month = req.query.month ?? new Date().toISOString().slice(0, 7)
    const [y, m] = month.split('-').map(Number)
    const from = `${y}-${String(m).padStart(2, '0')}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const txFields = [
      't.id', 't.type', 't.amount', 't.transaction_date', 't.billing_month', 't.note',
      'a.id as activity_id', 'a.name as activity_name', 'a.is_active as activity_is_active',
    ] as const

    const [enrollments, accruals, refunds, attendanceLogs] = await Promise.all([
      db.selectFrom('enrollments as e')
        .innerJoin('activities as a', 'a.id', 'e.activity_id')
        .select(['a.id as activity_id', 'a.name as activity_name', 'a.is_active as activity_is_active'])
        .where('e.child_id', '=', req.params.childId)
        .where('e.status', 'in', ['active', 'frozen'])
        .execute(),

      db.selectFrom('transactions as t')
        .leftJoin('activities as a', 'a.id', 't.activity_id')
        .select(txFields)
        .where('t.child_id', '=', req.params.childId)
        .where('t.type', '=', 'ACCRUAL')
        .where('t.is_deleted', '=', false)
        .where('t.billing_month', '>=', new Date(from))
        .where('t.billing_month', '<=', new Date(to))
        .execute(),

      db.selectFrom('transactions as t')
        .leftJoin('activities as a', 'a.id', 't.activity_id')
        .select(txFields)
        .where('t.child_id', '=', req.params.childId)
        .where('t.type', '=', 'REFUND')
        .where('t.is_deleted', '=', false)
        .where('t.transaction_date', '>=', new Date(from))
        .where('t.transaction_date', '<=', new Date(to))
        .execute(),

      db.selectFrom('attendance_logs as al')
        .select(['al.activity_id', 'al.status'])
        .where('al.child_id', '=', req.params.childId)
        .where('al.date', '>=', new Date(from))
        .where('al.date', '<=', new Date(to))
        .execute(),
    ])

    const allTransactions = [...accruals, ...refunds].sort(
      (a, b) => new Date(String(b.transaction_date)).getTime() - new Date(String(a.transaction_date)).getTime()
    )

    // Aggregate attendance counts by activity
    const attendance: Record<string, { visit_count: number; excused_count: number }> = {}
    for (const log of attendanceLogs) {
      const key = log.activity_id ?? 'none'
      attendance[key] ??= { visit_count: 0, excused_count: 0 }
      if (log.status === 'present' || log.status === 'special') attendance[key].visit_count++
      else if (log.status === 'absent_excused') attendance[key].excused_count++
    }

    type TxRow = typeof allTransactions[number]
    type Summary = {
      activity_id: string; activity_name: string; activity_is_active: boolean
      accrual_total: number; refund_total: number; visit_count: number; excused_count: number
      transactions: TxRow[]
    }
    const map = new Map<string, Summary>()

    for (const e of enrollments) {
      if (!map.has(e.activity_id)) {
        map.set(e.activity_id, {
          activity_id: e.activity_id, activity_name: e.activity_name,
          activity_is_active: e.activity_is_active,
          accrual_total: 0, refund_total: 0, visit_count: 0, excused_count: 0, transactions: [],
        })
      }
    }

    for (const t of allTransactions) {
      const actId = t.activity_id ?? 'unknown'
      if (!map.has(actId)) {
        map.set(actId, {
          activity_id: actId, activity_name: t.activity_name ?? 'Невідома активність',
          activity_is_active: t.activity_is_active ?? false,
          accrual_total: 0, refund_total: 0, visit_count: 0, excused_count: 0, transactions: [],
        })
      }
      const entry = map.get(actId)!
      entry.transactions.push(t)
      const amt = parseFloat(String(t.amount))
      if (t.type === 'ACCRUAL') entry.accrual_total += amt
      else if (t.type === 'REFUND') entry.refund_total += amt
    }

    for (const [actId, counts] of Object.entries(attendance)) {
      const entry = map.get(actId)
      if (entry) {
        entry.visit_count = counts.visit_count
        entry.excused_count = counts.excused_count
      }
    }

    return Array.from(map.values())
      .filter((a) => a.activity_is_active || a.transactions.length > 0)
      .sort((a, b) => a.activity_name.localeCompare(b.activity_name, 'uk'))
  })

  // GET /api/parent/children/:childId/attendance?month=YYYY-MM
  app.get<{
    Params: { childId: string }
    Querystring: { month?: string }
  }>('/children/:childId/attendance', async (req, reply) => {
    const userId = (req as { user?: { sub?: string } }).user?.sub ?? ''
    const parentId = await getParentId(userId)
    if (!parentId) return reply.status(403).send({ error: 'Forbidden' })

    const hasAccess = await assertChildAccess(parentId, req.params.childId)
    if (!hasAccess) return reply.status(403).send({ error: 'Forbidden' })

    const month = req.query.month ?? new Date().toISOString().slice(0, 7)
    const [y, m] = month.split('-').map(Number)
    const from = `${y}-${String(m).padStart(2, '0')}-01`
    const lastDay = new Date(y, m, 0).getDate()
    const to = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`

    const rows = await db
      .selectFrom('attendance_logs as al')
      .innerJoin('activities as a', 'a.id', 'al.activity_id')
      .select(['al.id', 'al.date', 'al.status', 'al.note', 'a.name as activity_name'])
      .where('al.child_id', '=', req.params.childId)
      .where('al.date', '>=', new Date(from))
      .where('al.date', '<=', new Date(to))
      .orderBy('al.date', 'desc')
      .orderBy('a.name', 'asc')
      .execute()

    return rows
  })
}
