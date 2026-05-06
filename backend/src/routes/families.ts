import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'

export async function familiesRoutes(app: FastifyInstance) {
  // GET /api/families?search=&limit=&offset=
  app.get<{ Querystring: { search?: string; limit?: string; offset?: string } }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'manager', 'accountant') },
    async (request) => {
      const limit = Math.min(Number(request.query.limit ?? 500), 500)
      const offset = Number(request.query.offset ?? 0)
      const search = request.query.search?.trim()

      let query = db
        .selectFrom('families as f')
        .innerJoin('parents as p', 'p.id', 'f.primary_parent_id')
        .select([
          'f.id',
          'f.name',
          'f.note',
          'f.created_at',
          'p.id as primary_parent_id',
          'p.full_name as primary_parent_name',
          'p.phone as primary_parent_phone',
        ])

      if (search) {
        query = query.where((eb) =>
          eb.or([
            eb('f.name', 'ilike', `%${search}%`),
            eb('p.full_name', 'ilike', `%${search}%`),
            eb('p.phone', 'ilike', `%${search}%`),
          ])
        )
      }

      const countQuery = db
        .selectFrom('families as f')
        .innerJoin('parents as p', 'p.id', 'f.primary_parent_id')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .$if(!!search, (q) =>
          q.where((eb) =>
            eb.or([
              eb('f.name', 'ilike', `%${search}%`),
              eb('p.full_name', 'ilike', `%${search}%`),
              eb('p.phone', 'ilike', `%${search}%`),
            ])
          )
        )

      const [data, totalRow] = await Promise.all([
        query.orderBy('f.name', 'asc').limit(limit).offset(offset).execute(),
        countQuery.executeTakeFirst(),
      ])

      return { data, total: Number(totalRow?.count ?? 0), limit, offset }
    }
  )

  // GET /api/families/:id (с детьми и участниками)
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin', 'manager', 'accountant') },
    async (request, reply) => {
      const family = await db
        .selectFrom('families as f')
        .innerJoin('parents as p', 'p.id', 'f.primary_parent_id')
        .select([
          'f.id', 'f.name', 'f.note', 'f.created_at',
          'p.id as primary_parent_id',
          'p.full_name as primary_parent_name',
          'p.phone as primary_parent_phone',
        ])
        .where('f.id', '=', request.params.id)
        .executeTakeFirst()

      if (!family) return reply.status(404).send({ error: 'NotFound' })

      const [children, members] = await Promise.all([
        db
          .selectFrom('children as c')
          .leftJoin('groups as g', 'g.id', 'c.group_id')
          .select(['c.id', 'c.full_name', 'c.birth_date', 'c.is_active', 'g.name as group_name'])
          .where('c.family_id', '=', request.params.id)
          .orderBy('c.full_name', 'asc')
          .execute(),
        db
          .selectFrom('family_members as fm')
          .innerJoin('parents as p', 'p.id', 'fm.parent_id')
          .select(['p.id', 'p.full_name', 'p.phone', 'p.email'])
          .where('fm.family_id', '=', request.params.id)
          .execute(),
      ])

      return { ...family, children, members }
    }
  )

  // POST /api/families
  app.post<{
    Body: { name: string; primary_parent_id: string; note?: string }
  }>(
    '/',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (request, reply) => {
      const { name, primary_parent_id, note } = request.body

      if (!name?.trim()) {
        return reply.status(400).send({ error: 'BadRequest', message: 'name є обовʼязковим' })
      }
      if (!primary_parent_id?.trim()) {
        return reply.status(400).send({ error: 'BadRequest', message: 'primary_parent_id є обовʼязковим' })
      }

      const family = await db.transaction().execute(async (trx) => {
        const f = await trx
          .insertInto('families')
          .values({ name, primary_parent_id, note })
          .returningAll()
          .executeTakeFirstOrThrow()

        await trx
          .insertInto('family_members')
          .values({ family_id: f.id, parent_id: primary_parent_id })
          .execute()

        return f
      })

      return reply.status(201).send(family)
    }
  )

  // POST /api/families/:id/members (добавить участника)
  app.post<{ Params: { id: string }; Body: { parent_id: string } }>(
    '/:id/members',
    { preHandler: requireRole('owner', 'admin', 'manager') },
    async (request, reply) => {
      await db
        .insertInto('family_members')
        .values({ family_id: request.params.id, parent_id: request.body.parent_id })
        .onConflict((oc) => oc.doNothing())
        .execute()

      return reply.status(201).send({ ok: true })
    }
  )
}
