import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'

export async function groupsRoutes(app: FastifyInstance) {
  // GET /api/groups?include_archived=true
  app.get<{ Querystring: { include_archived?: string } }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'manager', 'accountant', 'teacher') },
    async (request) => {
      const includeArchived = request.query.include_archived === 'true'

      let query = db.selectFrom('groups').selectAll().orderBy('sort_order', 'asc')
      if (!includeArchived) {
        query = query.where('is_active', '=', true)
      }

      return query.execute()
    }
  )

  // POST /api/groups
  app.post<{ Body: { name: string; sort_order?: number } }>(
    '/',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { name, sort_order = 0 } = request.body
      if (!name?.trim()) {
        return reply.status(400).send({ error: 'BadRequest', message: 'name є обовʼязковим' })
      }
      const group = await db
        .insertInto('groups')
        .values({ name: name.trim(), sort_order })
        .returningAll()
        .executeTakeFirstOrThrow()

      return reply.status(201).send(group)
    }
  )

  // PUT /api/groups/:id
  app.put<{ Params: { id: string }; Body: { name?: string; sort_order?: number } }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { name, ...rest } = request.body
      const payload = { ...rest, ...(name !== undefined ? { name: name.trim() } : {}) }

      if (name !== undefined && !name.trim()) {
        return reply.status(400).send({ error: 'BadRequest', message: 'name не може бути порожнім' })
      }

      const updated = await db
        .updateTable('groups')
        .set(payload)
        .where('id', '=', request.params.id)
        .returningAll()
        .executeTakeFirst()

      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return updated
    }
  )

  // DELETE /api/groups/:id — archive (soft delete)
  // Automatically clears group_id for all children in this group
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params

      const archived = await db.transaction().execute(async (trx) => {
        await trx
          .updateTable('children')
          .set({ group_id: null })
          .where('group_id', '=', id)
          .execute()

        return trx
          .updateTable('groups')
          .set({ is_active: false })
          .where('id', '=', id)
          .returningAll()
          .executeTakeFirst()
      })

      if (!archived) return reply.status(404).send({ error: 'NotFound' })
      return { ok: true }
    }
  )

  // POST /api/groups/:id/restore
  app.post<{ Params: { id: string } }>(
    '/:id/restore',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const restored = await db
        .updateTable('groups')
        .set({ is_active: true })
        .where('id', '=', request.params.id)
        .returningAll()
        .executeTakeFirst()

      if (!restored) return reply.status(404).send({ error: 'NotFound' })
      return { ok: true }
    }
  )
}
