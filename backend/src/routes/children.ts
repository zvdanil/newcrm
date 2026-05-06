import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'

export async function childrenRoutes(app: FastifyInstance) {
  // GET /api/children?search=&group_id=&is_active=&limit=&offset=
  app.get<{
    Querystring: {
      search?: string
      group_id?: string
      is_active?: string
      limit?: string
      offset?: string
    }
  }>(
    '/',
    { preHandler: authenticate },
    async (request) => {
      const limit = Math.min(Number(request.query.limit ?? 500), 500)
      const offset = Number(request.query.offset ?? 0)
      const search = request.query.search?.trim()
      const { group_id, is_active } = request.query

      // Parent видит только своих детей
      const role = request.user.role
      const userId = request.user.sub

      let query = db
        .selectFrom('children as c')
        .leftJoin('groups as g', 'g.id', 'c.group_id')
        .leftJoin('families as f', 'f.id', 'c.family_id')
        .select([
          'c.id', 'c.full_name', 'c.birth_date', 'c.is_active',
          'c.note', 'c.created_at',
          'g.id as group_id', 'g.name as group_name',
          'f.id as family_id', 'f.name as family_name',
        ])

      if (role === 'parent') {
        // Ограничиваем видимость: только дети семей, в которых состоит родитель
        const parentRow = await db
          .selectFrom('parents')
          .select('id')
          .where('user_id', '=', userId)
          .executeTakeFirst()

        if (!parentRow) return { data: [], total: 0, limit, offset }

        const familyIds = await db
          .selectFrom('family_members')
          .select('family_id')
          .where('parent_id', '=', parentRow.id)
          .execute()

        const ids = familyIds.map((r) => r.family_id)
        if (ids.length === 0) return { data: [], total: 0, limit, offset }

        query = query.where('c.family_id', 'in', ids)
      }

      if (search) {
        query = query.where('c.full_name', 'ilike', `%${search}%`)
      }

      if (group_id) {
        query = query.where('c.group_id', '=', group_id)
      }

      if (is_active !== undefined) {
        query = query.where('c.is_active', '=', is_active === 'true')
      }

      const [data, totalRow] = await Promise.all([
        query.orderBy('c.full_name', 'asc').limit(limit).offset(offset).execute(),
        query
          .clearSelect()
          .clearOrderBy()
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .executeTakeFirst(),
      ])

      return { data, total: Number(totalRow?.count ?? 0), limit, offset }
    }
  )

  // GET /api/children/:id
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const child = await db
        .selectFrom('children as c')
        .leftJoin('groups as g', 'g.id', 'c.group_id')
        .leftJoin('families as f', 'f.id', 'c.family_id')
        .leftJoin('parents as p', 'p.id', 'f.primary_parent_id')
        .select([
          'c.id', 'c.full_name', 'c.birth_date', 'c.is_active', 'c.note',
          'c.created_at', 'c.updated_at',
          'g.id as group_id', 'g.name as group_name',
          'f.id as family_id', 'f.name as family_name',
          'p.id as primary_parent_id', 'p.full_name as primary_parent_name',
          'p.phone as primary_parent_phone',
        ])
        .where('c.id', '=', request.params.id)
        .executeTakeFirst()

      if (!child) return reply.status(404).send({ error: 'NotFound' })

      // Parent: проверяем, что ребёнок принадлежит его семье
      if (request.user.role === 'parent') {
        const access = await db
          .selectFrom('parents as p')
          .innerJoin('family_members as fm', 'fm.parent_id', 'p.id')
          .where('p.user_id', '=', request.user.sub)
          .where('fm.family_id', '=', child.family_id ?? '')
          .executeTakeFirst()

        if (!access) return reply.status(403).send({ error: 'Forbidden' })
      }

      return child
    }
  )

  // POST /api/children
  app.post<{
    Body: {
      full_name: string
      birth_date?: string
      family_id?: string
      group_id?: string
      note?: string
    }
  }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (request, reply) => {
      const child = await db
        .insertInto('children')
        .values(request.body)
        .returningAll()
        .executeTakeFirstOrThrow()

      return reply.status(201).send(child)
    }
  )

  // PUT /api/children/:id
  app.put<{
    Params: { id: string }
    Body: {
      full_name?: string
      birth_date?: string
      family_id?: string
      group_id?: string
      is_active?: boolean
      note?: string
    }
  }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (request, reply) => {
      const updated = await db
        .updateTable('children')
        .set(request.body)
        .where('id', '=', request.params.id)
        .returningAll()
        .executeTakeFirst()

      if (!updated) return reply.status(404).send({ error: 'NotFound' })
      return updated
    }
  )
}
