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
  // Returns data grouped by account → activity (fixes double-activity bug and per-lesson ACCRUAL bug)
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
      't.account_id',
      'a.id as activity_id', 'a.name as activity_name', 'a.is_active as activity_is_active',
      'ac.name as account_name',
    ] as const

    const [enrollments, transactions, attendanceLogs] = await Promise.all([
      // Active/frozen enrollments with account info
      db.selectFrom('enrollments as e')
        .innerJoin('activities as a', 'a.id', 'e.activity_id')
        .innerJoin('accounts as ac', 'ac.id', 'e.account_id')
        .select([
          'e.account_id', 'ac.name as account_name', 'e.status as enrollment_status',
          'a.id as activity_id', 'a.name as activity_name', 'a.is_active as activity_is_active',
        ])
        .where('e.child_id', '=', req.params.childId)
        .where('e.status', 'in', ['active', 'frozen'])
        .execute(),

      // ACCRUAL + REFUND filtered by transaction_date (catches per-lesson ACCRUALs with null billing_month too)
      db.selectFrom('transactions as t')
        .leftJoin('activities as a', 'a.id', 't.activity_id')
        .leftJoin('accounts as ac', 'ac.id', 't.account_id')
        .select(txFields)
        .where('t.child_id', '=', req.params.childId)
        .where('t.type', 'in', ['ACCRUAL', 'REFUND'])
        .where('t.is_deleted', '=', false)
        .where('t.transaction_date', '>=', new Date(from))
        .where('t.transaction_date', '<=', new Date(to))
        .orderBy('t.transaction_date', 'desc')
        .execute(),

      db.selectFrom('attendance_logs as al')
        .select(['al.activity_id', 'al.status'])
        .where('al.child_id', '=', req.params.childId)
        .where('al.date', '>=', new Date(from))
        .where('al.date', '<=', new Date(to))
        .execute(),
    ])

    // Attendance map: activity_id → { visit_count, excused_count }
    const attendanceMap: Record<string, { visit_count: number; excused_count: number }> = {}
    for (const log of attendanceLogs) {
      const key = log.activity_id ?? 'none'
      attendanceMap[key] ??= { visit_count: 0, excused_count: 0 }
      if (log.status === 'present' || log.status === 'special') attendanceMap[key].visit_count++
      else if (log.status === 'absent_excused') attendanceMap[key].excused_count++
    }

    type TxRow = typeof transactions[number]
    type ActivityEntry = {
      activity_id: string; activity_name: string; activity_is_active: boolean
      enrollment_status: string | null  // null = has transactions but no active/frozen enrollment
      accrual_total: number; refund_total: number; visit_count: number; excused_count: number
      transactions: TxRow[]
    }
    type AccountEntry = { account_id: string; account_name: string; activities: Map<string, ActivityEntry> }

    const accountMap = new Map<string, AccountEntry>()

    function ensureActivity(accountId: string, accountName: string, activityId: string, activityName: string, activityIsActive: boolean, enrollmentStatus: string | null): ActivityEntry {
      let acct = accountMap.get(accountId)
      if (!acct) {
        acct = { account_id: accountId, account_name: accountName, activities: new Map() }
        accountMap.set(accountId, acct)
      }
      let entry = acct.activities.get(activityId)
      if (!entry) {
        entry = {
          activity_id: activityId, activity_name: activityName,
          activity_is_active: activityIsActive, enrollment_status: enrollmentStatus,
          accrual_total: 0, refund_total: 0, visit_count: 0, excused_count: 0, transactions: [],
        }
        acct.activities.set(activityId, entry)
      }
      return entry
    }

    // Seed from active/frozen enrollments (guaranteed to show even if no transactions this month)
    for (const e of enrollments) {
      ensureActivity(e.account_id, e.account_name, e.activity_id, e.activity_name, e.activity_is_active, e.enrollment_status)
    }

    // Add transaction data (grouped by account_id + activity_id — fixes double-activity across accounts)
    for (const t of transactions) {
      const accountId = t.account_id ?? 'unknown'
      const accountName = t.account_name ?? 'Невідомий рахунок'
      const activityId = t.activity_id ?? 'unknown'
      const activityName = t.activity_name ?? 'Невідома активність'
      const entry = ensureActivity(accountId, accountName, activityId, activityName, t.activity_is_active ?? false, null)
      entry.transactions.push(t)
      const amt = parseFloat(String(t.amount))
      if (t.type === 'ACCRUAL') entry.accrual_total += amt
      else if (t.type === 'REFUND') entry.refund_total += amt
    }

    // Attach attendance counts (activity_id applies to all accounts for that activity)
    for (const [actId, counts] of Object.entries(attendanceMap)) {
      for (const acct of accountMap.values()) {
        const entry = acct.activities.get(actId)
        if (entry) { entry.visit_count = counts.visit_count; entry.excused_count = counts.excused_count }
      }
    }

    return Array.from(accountMap.values())
      .map(acct => ({
        account_id: acct.account_id,
        account_name: acct.account_name,
        activities: Array.from(acct.activities.values())
          .filter(a => a.enrollment_status !== null || a.transactions.length > 0)
          .sort((a, b) => a.activity_name.localeCompare(b.activity_name, 'uk')),
      }))
      .filter(acct => acct.activities.length > 0)
      .sort((a, b) => a.account_name.localeCompare(b.account_name, 'uk'))
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
