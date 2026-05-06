import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'

export async function parentsRoutes(app: FastifyInstance) {
  // GET /api/parents?search=&limit=&offset=
  app.get<{ Querystring: { search?: string; limit?: string; offset?: string } }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'manager', 'accountant') },
    async (request) => {
      const limit = Math.min(Number(request.query.limit ?? 500), 500)
      const offset = Number(request.query.offset ?? 0)
      const search = request.query.search?.trim()

      let query = db.selectFrom('parents').selectAll()

      if (search) {
        query = query.where((eb) =>
          eb.or([
            eb('full_name', 'ilike', `%${search}%`),
            eb('phone', 'ilike', `%${search}%`),
            eb('email', 'ilike', `%${search}%`),
          ])
        )
      }

      const [data, totalRow] = await Promise.all([
        query.orderBy('full_name', 'asc').limit(limit).offset(offset).execute(),
        db
          .selectFrom('parents')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .executeTakeFirst(),
      ])

      return { data, total: Number(totalRow?.count ?? 0), limit, offset }
    }
  )

  // GET /api/parents/:id
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin', 'manager', 'accountant') },
    async (request, reply) => {
      const parent = await db
        .selectFrom('parents')
        .selectAll()
        .where('id', '=', request.params.id)
        .executeTakeFirst()

      if (!parent) return reply.status(404).send({ error: 'NotFound' })
      return parent
    }
  )

  // POST /api/parents
  app.post<{
    Body: { full_name: string; phone?: string; email?: string; note?: string }
  }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (request, reply) => {
      const parent = await db
        .insertInto('parents')
        .values(request.body)
        .returningAll()
        .executeTakeFirstOrThrow()

      return reply.status(201).send(parent)
    }
  )

  // PUT /api/parents/:id
  app.put<{
    Params: { id: string }
    Body: { full_name?: string; phone?: string; email?: string; note?: string }
  }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (request, reply) => {
      const updated = await db
        .updateTable('parents')
        .set(request.body)
        .where('id', '=', request.params.id)
        .returningAll()
        .executeTakeFirst()

      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return updated
    }
  )
}
