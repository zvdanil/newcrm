import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'

interface TemplateBody {
  name: string
  description?: string | null
  header_row_index?: number
  data_start_row_index?: number
  col_date: string
  col_amount: string
  col_type?: string | null
  col_type_credit_value?: string | null
  col_counterparty?: string | null
  col_inn?: string | null
  col_iban?: string | null
  col_description?: string | null
  col_doc_number?: string | null
  col_reference?: string | null
  amount_negate?: boolean
}

export async function importTemplatesRoutes(app: FastifyInstance) {

  // GET /api/import-templates
  app.get(
    '/',
    { preHandler: requireRole('owner', 'admin') },
    async () => {
      return db
        .selectFrom('import_templates')
        .selectAll()
        .orderBy('name', 'asc')
        .execute()
    }
  )

  // POST /api/import-templates
  app.post<{ Body: TemplateBody }>(
    '/',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const b = request.body
      if (!b.name?.trim()) return reply.status(400).send({ error: 'BadRequest', message: 'name є обовʼязковим' })
      if (!b.col_date?.trim()) return reply.status(400).send({ error: 'BadRequest', message: 'col_date є обовʼязковим' })
      if (!b.col_amount?.trim()) return reply.status(400).send({ error: 'BadRequest', message: 'col_amount є обовʼязковим' })

      const row = await db
        .insertInto('import_templates')
        .values({
          name:                 b.name.trim(),
          description:          b.description ?? null,
          header_row_index:     b.header_row_index ?? 1,
          data_start_row_index: b.data_start_row_index ?? 2,
          col_date:             b.col_date.trim(),
          col_amount:           b.col_amount.trim(),
          col_type:             b.col_type ?? null,
          col_type_credit_value: b.col_type_credit_value ?? null,
          col_counterparty:     b.col_counterparty ?? null,
          col_inn:              b.col_inn ?? null,
          col_iban:             b.col_iban ?? null,
          col_description:      b.col_description ?? null,
          col_doc_number:       b.col_doc_number ?? null,
          col_reference:        b.col_reference ?? null,
          amount_negate:        b.amount_negate ?? false,
          created_by:           request.user.sub,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      return reply.status(201).send(row)
    }
  )

  // PUT /api/import-templates/:id
  app.put<{ Params: { id: string }; Body: TemplateBody }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params
      const b = request.body
      if (!b.name?.trim()) return reply.status(400).send({ error: 'BadRequest', message: 'name є обовʼязковим' })
      if (!b.col_date?.trim()) return reply.status(400).send({ error: 'BadRequest', message: 'col_date є обовʼязковим' })
      if (!b.col_amount?.trim()) return reply.status(400).send({ error: 'BadRequest', message: 'col_amount є обовʼязковим' })

      const row = await db
        .updateTable('import_templates')
        .set({
          name:                 b.name.trim(),
          description:          b.description ?? null,
          header_row_index:     b.header_row_index ?? 1,
          data_start_row_index: b.data_start_row_index ?? 2,
          col_date:             b.col_date.trim(),
          col_amount:           b.col_amount.trim(),
          col_type:             b.col_type ?? null,
          col_type_credit_value: b.col_type_credit_value ?? null,
          col_counterparty:     b.col_counterparty ?? null,
          col_inn:              b.col_inn ?? null,
          col_iban:             b.col_iban ?? null,
          col_description:      b.col_description ?? null,
          col_doc_number:       b.col_doc_number ?? null,
          col_reference:        b.col_reference ?? null,
          amount_negate:        b.amount_negate ?? false,
          updated_at:           new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst()

      if (!row) return reply.status(404).send({ error: 'NotFound' })
      return row
    }
  )

  // DELETE /api/import-templates/:id
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params
      const deleted = await db
        .deleteFrom('import_templates')
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirst()

      if (!deleted) return reply.status(404).send({ error: 'NotFound' })
      return { ok: true }
    }
  )
}
