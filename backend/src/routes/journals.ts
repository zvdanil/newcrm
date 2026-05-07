import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function generateDates(from: string, to: string): string[] {
  const dates: string[] = []
  const current = new Date(from)
  const end = new Date(to)
  while (current <= end) {
    dates.push(toDateStr(current))
    current.setDate(current.getDate() + 1)
  }
  return dates
}

export async function journalsRoutes(app: FastifyInstance) {
  // GET /api/journals?activity_id=&from=&to=
  // Возвращает данные журнала: активность + строки (дети + логи по датам)
  app.get<{ Querystring: { activity_id: string; from: string; to: string } }>(
    '/',
    { preHandler: authenticate },
    async (req, reply) => {
      const { activity_id, from, to } = req.query
      if (!activity_id || !from || !to) {
        return reply.status(400).send({ error: 'BadRequest', message: 'activity_id, from, to є обовʼязковими' })
      }

      const [activity, refundConfig, enrollments, logs] = await Promise.all([
        db.selectFrom('activities as a')
          .leftJoin('accounts as ac', 'ac.id', 'a.account_id')
          .select(['a.id', 'a.name', 'a.tariff_type', 'a.is_rigid', 'ac.name as account_name'])
          .where('a.id', '=', activity_id)
          .executeTakeFirst(),

        db.selectFrom('refund_configs')
          .selectAll()
          .where('activity_id', '=', activity_id)
          .executeTakeFirst(),

        db.selectFrom('enrollments as e')
          .innerJoin('children as c', 'c.id', 'e.child_id')
          .select([
            'e.id as enrollment_id', 'e.status', 'e.frozen_from', 'e.frozen_to', 'e.note as enrollment_note',
            'c.id as child_id', 'c.full_name as child_name',
          ])
          .where('e.activity_id', '=', activity_id)
          .where('e.status', '!=', 'archived')
          .orderBy('c.full_name', 'asc')
          .execute(),

        db.selectFrom('attendance_logs')
          .selectAll()
          .where('activity_id', '=', activity_id)
          .where('date', '>=', new Date(from))
          .where('date', '<=', new Date(to))
          .execute(),
      ])

      if (!activity) return reply.status(404).send({ error: 'NotFound' })

      // Индекс логов: enrollment_id → date → log
      const logsIndex: Record<string, Record<string, typeof logs[0]>> = {}
      for (const log of logs) {
        if (!logsIndex[log.enrollment_id]) logsIndex[log.enrollment_id] = {}
        logsIndex[log.enrollment_id][toDateStr(log.date)] = log
      }

      return {
        activity: { ...activity, refund_config: refundConfig ?? null },
        dates: generateDates(from, to),
        rows: enrollments.map((e) => ({
          enrollment_id: e.enrollment_id,
          child_id: e.child_id,
          child_name: e.child_name,
          status: e.status,
          frozen_from: e.frozen_from ? toDateStr(e.frozen_from as unknown as Date) : null,
          frozen_to:   e.frozen_to   ? toDateStr(e.frozen_to   as unknown as Date) : null,
          logs: logsIndex[e.enrollment_id] ?? {},
        })),
      }
    }
  )

  // POST /api/attendance — поставить отметку (с каскадом на связанные активности)
  app.post<{
    Body: {
      enrollment_id: string
      date: string
      status: 'present' | 'absent_excused' | 'absent_unexcused' | 'special'
      custom_amount?: number | null
      note?: string | null
    }
  }>(
    '/attendance',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher') },
    async (req, reply) => {
      const { enrollment_id, date, status, custom_amount, note } = req.body
      if (!enrollment_id || !date || !status) {
        return reply.status(400).send({ error: 'BadRequest', message: 'enrollment_id, date, status є обовʼязковими' })
      }

      const enrollment = await db.selectFrom('enrollments')
        .selectAll()
        .where('id', '=', enrollment_id)
        .executeTakeFirst()

      if (!enrollment) return reply.status(404).send({ error: 'NotFound', message: 'Підписку не знайдено' })
      if (enrollment.status === 'archived') return reply.status(409).send({ error: 'Conflict', message: 'Підписка в архіві' })

      // Перевірка заморозки
      if (enrollment.status === 'frozen' && enrollment.frozen_from && enrollment.frozen_to) {
        const logDate = new Date(date)
        const fFrom = new Date(enrollment.frozen_from as unknown as string)
        const fTo   = new Date(enrollment.frozen_to   as unknown as string)
        if (logDate >= fFrom && logDate <= fTo) {
          return reply.status(409).send({ error: 'Frozen', message: 'Підписка заморожена на цю дату' })
        }
      }

      const createdBy = (req.user as { sub: string }).sub

      const log = await db.transaction().execute(async (trx) => {
        // Основна відмітка (upsert)
        const main = await trx.insertInto('attendance_logs')
          .values({
            enrollment_id,
            child_id: enrollment.child_id,
            activity_id: enrollment.activity_id,
            date,
            status,
            custom_amount: custom_amount ?? null,
            note: note ?? null,
            created_by: createdBy,
          })
          .onConflict((oc) =>
            oc.columns(['enrollment_id', 'date']).doUpdateSet({
              status,
              custom_amount: custom_amount ?? null,
              note: note ?? null,
              updated_at: new Date().toISOString() as unknown as Date,
            })
          )
          .returningAll()
          .executeTakeFirstOrThrow()

        // Каскад: знаходимо пов'язані активності (де поточна — батьківська)
        const linked = await trx
          .selectFrom('linked_activities')
          .select('child_activity_id')
          .where('parent_activity_id', '=', enrollment.activity_id)
          .execute()

        for (const { child_activity_id } of linked) {
          const linkedEnrollment = await trx
            .selectFrom('enrollments')
            .select(['id', 'activity_id', 'status', 'frozen_from', 'frozen_to'])
            .where('child_id', '=', enrollment.child_id)
            .where('activity_id', '=', child_activity_id)
            .where('status', '!=', 'archived')
            .executeTakeFirst()

          if (!linkedEnrollment) continue

          // Пропускаємо якщо дата в заморозці пов'язаної підписки
          if (linkedEnrollment.status === 'frozen' && linkedEnrollment.frozen_from && linkedEnrollment.frozen_to) {
            const logDate = new Date(date)
            const fFrom = new Date(linkedEnrollment.frozen_from as unknown as string)
            const fTo   = new Date(linkedEnrollment.frozen_to   as unknown as string)
            if (logDate >= fFrom && logDate <= fTo) continue
          }

          await trx.insertInto('attendance_logs')
            .values({
              enrollment_id: linkedEnrollment.id,
              child_id: enrollment.child_id,
              activity_id: child_activity_id,
              date,
              status,
              custom_amount: null, // спец-тариф не каскадується
              note: null,
              created_by: createdBy,
            })
            .onConflict((oc) =>
              oc.columns(['enrollment_id', 'date']).doUpdateSet({
                status,
                updated_at: new Date().toISOString() as unknown as Date,
              })
            )
            .execute()
        }

        return main
      })

      return reply.status(201).send(log)
    }
  )

  // PUT /api/attendance/:id — оновити відмітку
  app.put<{
    Params: { id: string }
    Body: {
      status: 'present' | 'absent_excused' | 'absent_unexcused' | 'special'
      custom_amount?: number | null
      note?: string | null
    }
  }>(
    '/attendance/:id',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher') },
    async (req, reply) => {
      const { status, custom_amount, note } = req.body

      const existing = await db.selectFrom('attendance_logs').selectAll().where('id', '=', req.params.id).executeTakeFirst()
      if (!existing) return reply.status(404).send({ error: 'NotFound' })

      const updated = await db.transaction().execute(async (trx) => {
        const main = await trx.updateTable('attendance_logs')
          .set({ status, custom_amount: custom_amount ?? null, note: note ?? null })
          .where('id', '=', req.params.id)
          .returningAll()
          .executeTakeFirstOrThrow()

        // Каскад оновлення
        const linked = await trx
          .selectFrom('linked_activities')
          .select('child_activity_id')
          .where('parent_activity_id', '=', existing.activity_id)
          .execute()

        for (const { child_activity_id } of linked) {
          await trx.updateTable('attendance_logs')
            .set({ status })
            .where('child_id', '=', existing.child_id)
            .where('activity_id', '=', child_activity_id)
            .where('date', '=', existing.date)
            .execute()
        }

        return main
      })

      return updated
    }
  )

  // DELETE /api/attendance/:id — зняти відмітку
  app.delete<{ Params: { id: string } }>(
    '/attendance/:id',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher') },
    async (req, reply) => {
      const deleted = await db.deleteFrom('attendance_logs')
        .where('id', '=', req.params.id)
        .returningAll()
        .executeTakeFirst()
      if (!deleted) return reply.status(404).send({ error: 'NotFound' })
      return { ok: true }
    }
  )
}
