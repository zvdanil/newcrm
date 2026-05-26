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
