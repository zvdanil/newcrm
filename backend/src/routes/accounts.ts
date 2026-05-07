import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'

export async function accountsRoutes(app: FastifyInstance) {
  // GET /api/accounts
  app.get('/', { preHandler: authenticate }, async () => {
    return db.selectFrom('accounts').selectAll().orderBy('name', 'asc').execute()
  })

  // GET /api/accounts/:id
  app.get<{ Params: { id: string } }>('/:id', { preHandler: authenticate }, async (req, reply) => {
    const account = await db.selectFrom('accounts').selectAll().where('id', '=', req.params.id).executeTakeFirst()
    if (!account) return reply.status(404).send({ error: 'NotFound' })
    return account
  })

  // POST /api/accounts
  app.post<{ Body: { name: string; type: 'fop' | 'cash' | 'bank'; currency?: string; note?: string } }>(
    '/',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { name, type, currency = 'UAH', note } = req.body
      if (!name?.trim()) return reply.status(400).send({ error: 'BadRequest', message: 'name є обовʼязковим' })
      if (!['fop', 'cash', 'bank'].includes(type)) return reply.status(400).send({ error: 'BadRequest', message: 'type має бути fop, cash або bank' })

      const account = await db.insertInto('accounts')
        .values({ name: name.trim(), type, currency, note: note || null })
        .returningAll()
        .executeTakeFirstOrThrow()
      return reply.status(201).send(account)
    }
  )

  // PUT /api/accounts/:id
  app.put<{ Params: { id: string }; Body: { name?: string; type?: 'fop' | 'cash' | 'bank'; currency?: string; note?: string; is_active?: boolean } }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const updated = await db.updateTable('accounts').set(req.body).where('id', '=', req.params.id).returningAll().executeTakeFirst()
      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return updated
    }
  )
}
