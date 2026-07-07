import type { FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { db } from '../db/index.js'
import { authenticate, requireRole } from '../plugins/authenticate.js'
import { toDbDateStr } from '../services/dateUtils.js'

function toDateStr(d: Date | string): string {
  return toDbDateStr(d)
}

interface AttributedNote { role: string; name: string; text: string }

function transformLogNotes(
  log: any,
  userId: string,
  role: string
): { note: string | null; attributed_notes: AttributedNote[]; has_note: boolean } {
  const entries: Array<{ user_id: string; role: string; name: string; text: string }> =
    Array.isArray(log.notes_json) ? log.notes_json : []

  if (role === 'duty_admin') {
    const mine = entries.find(n => n.user_id === userId)
    return { note: mine?.text ?? null, attributed_notes: [], has_note: !!mine?.text }
  }

  const mine   = entries.find(n => n.user_id === userId)
  const others = entries.filter(n => n.user_id !== userId)
  let myNote   = mine?.text ?? null
  if (!myNote && role === 'owner') myNote = (log.note as string | null) ?? null

  return {
    note:             myNote,
    attributed_notes: others.map(n => ({ role: n.role, name: n.name, text: n.text })),
    has_note:         !!myNote || others.length > 0,
  }
}

function generateDates(from: string, to: string): string[] {
  const dates: string[] = []
  const current = new Date(from)
  const end = new Date(to)
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10))
    current.setDate(current.getDate() + 1)
  }
  return dates
}

export async function mergedJournalsRoutes(app: FastifyInstance) {

  // GET /api/merged-journals — список
  app.get('/', { preHandler: authenticate }, async () => {
    const rows = await db
      .selectFrom('merged_journals as mj')
      .leftJoin('merged_journal_activities as ma', 'ma.merged_journal_id', 'mj.id')
      .select((eb) => [
        'mj.id', 'mj.name', 'mj.note', 'mj.created_at',
        eb.fn.count<string>('ma.activity_id').as('activity_count'),
      ])
      .groupBy('mj.id')
      .orderBy('mj.name', 'asc')
      .execute()
    return rows
  })

  // POST /api/merged-journals — создать
  app.post<{
    Body: { name: string; note?: string; activity_ids?: string[] }
  }>('/', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { name, note, activity_ids = [] } = req.body
    if (!name?.trim()) {
      return reply.status(400).send({ error: 'BadRequest', message: 'name є обов\'язковим' })
    }

    const mj = await db.insertInto('merged_journals').values({
      name:       name.trim(),
      note:       note ?? null,
      created_by: req.user.sub,
    }).returningAll().executeTakeFirstOrThrow()

    if (activity_ids.length > 0) {
      await db.insertInto('merged_journal_activities').values(
        activity_ids.map((aid, i) => ({
          merged_journal_id: mj.id,
          activity_id:       aid,
          sort_order:        i,
        }))
      ).execute()
    }

    return reply.status(201).send(mj)
  })

  // PUT /api/merged-journals/:id — переименовать
  app.put<{
    Params: { id: string }
    Body: { name?: string; note?: string }
  }>('/:id', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { name, note } = req.body
    const updates: Record<string, unknown> = {}
    if (name !== undefined) updates.name = name.trim()
    if (note !== undefined) updates.note = note

    const updated = await db.updateTable('merged_journals')
      .set(updates)
      .where('id', '=', req.params.id)
      .returningAll()
      .executeTakeFirst()

    if (!updated) return reply.status(404).send({ error: 'NotFound' })
    return updated
  })

  // DELETE /api/merged-journals/:id — удалить
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      await db.deleteFrom('merged_journals').where('id', '=', req.params.id).execute()
      return reply.status(204).send()
    }
  )

  // GET /api/merged-journals/:id/activities — активности внутри
  app.get<{ Params: { id: string } }>(
    '/:id/activities',
    { preHandler: authenticate },
    async (req, reply) => {
      const mj = await db.selectFrom('merged_journals').select('id').where('id', '=', req.params.id).executeTakeFirst()
      if (!mj) return reply.status(404).send({ error: 'NotFound' })

      return db.selectFrom('merged_journal_activities as ma')
        .innerJoin('activities as a', 'a.id', 'ma.activity_id')
        .where('ma.merged_journal_id', '=', req.params.id)
        .select(['a.id', 'a.name', 'a.tariff_type', 'a.is_active', 'ma.sort_order'])
        .orderBy('ma.sort_order', 'asc')
        .execute()
    }
  )

  // POST /api/merged-journals/:id/activities — добавить активность
  app.post<{
    Params: { id: string }
    Body: { activity_id: string }
  }>('/:id/activities', { preHandler: requireRole('owner', 'admin') }, async (req, reply) => {
    const { activity_id } = req.body
    if (!activity_id) return reply.status(400).send({ error: 'BadRequest', message: 'activity_id є обов\'язковим' })

    // Получаем максимальный sort_order
    const maxRow = await db.selectFrom('merged_journal_activities')
      .select((eb) => eb.fn.max<number>('sort_order').as('max_order'))
      .where('merged_journal_id', '=', req.params.id)
      .executeTakeFirst()

    await db.insertInto('merged_journal_activities').values({
      merged_journal_id: req.params.id,
      activity_id,
      sort_order: (maxRow?.max_order ?? -1) + 1,
    }).onConflict((oc) => oc.columns(['merged_journal_id', 'activity_id']).doNothing()).execute()

    return reply.status(201).send({ ok: true })
  })

  // DELETE /api/merged-journals/:id/activities/:activityId — убрать активность
  app.delete<{ Params: { id: string; activityId: string } }>(
    '/:id/activities/:activityId',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      await db.deleteFrom('merged_journal_activities')
        .where('merged_journal_id', '=', req.params.id)
        .where('activity_id', '=', req.params.activityId)
        .execute()
      return reply.status(204).send()
    }
  )

  // GET /api/merged-journals/:id/journal?from=&to= — агрегированный журнал
  app.get<{
    Params: { id: string }
    Querystring: { from: string; to: string }
  }>('/:id/journal', { preHandler: authenticate }, async (req, reply) => {
    const { from, to } = req.query
    if (!from || !to) {
      return reply.status(400).send({ error: 'BadRequest', message: 'from, to є обов\'язковими' })
    }

    const mj = await db.selectFrom('merged_journals').selectAll().where('id', '=', req.params.id).executeTakeFirst()
    if (!mj) return reply.status(404).send({ error: 'NotFound' })

    const activities = await db.selectFrom('merged_journal_activities as ma')
      .innerJoin('activities as a', 'a.id', 'ma.activity_id')
      .where('ma.merged_journal_id', '=', req.params.id)
      .select(['a.id', 'a.name', 'a.tariff_type', 'a.is_rigid', 'ma.sort_order'])
      .orderBy('ma.sort_order', 'asc')
      .execute()

    if (activities.length === 0) {
      return { merged_journal: mj, activities: [], dates: generateDates(from, to), rows: [] }
    }

    const activityIds = activities.map(a => a.id)

    const enrollments = await db.selectFrom('enrollments as e')
      .innerJoin('children as c', 'c.id', 'e.child_id')
      .leftJoin('groups as g', 'g.id', 'c.group_id')
      .where('e.activity_id', 'in', activityIds)
      .where(eb => eb.or([
        eb('e.status', '!=', 'archived'),
        eb('e.id', 'in',
          db.selectFrom('attendance_logs')
            .select('enrollment_id')
            .where('activity_id', 'in', activityIds)
            .where('date', '>=', sql<Date>`CAST(${from} AS DATE)`)
            .where('date', '<=', sql<Date>`CAST(${to} AS DATE)`)
        )
      ]))
      .select([
        'e.id as enrollment_id', 'e.activity_id', 'e.status',
        'e.frozen_from', 'e.frozen_to', 'e.account_id',
        'c.id as child_id', 'c.full_name as child_name',
        'c.group_id', 'g.name as group_name',
      ])
      .orderBy('c.full_name', 'asc')
      .execute()

    const enrollmentIds = enrollments.map(e => e.enrollment_id)

    const logs = enrollmentIds.length > 0
      ? await db.selectFrom('attendance_logs')
          .selectAll()
          .where('enrollment_id', 'in', enrollmentIds)
          .where('date', '>=', new Date(from))
          .where('date', '<=', new Date(to))
          .execute()
      : []

    const requestUserId = req.user.sub
    const requestRole   = req.user.role
    const isDutyAdmin   = requestRole === 'duty_admin'

    const logsIndex: Record<string, Record<string, typeof logs[0]>> = {}
    for (const log of logs) {
      if (!logsIndex[log.enrollment_id]) logsIndex[log.enrollment_id] = {}
      logsIndex[log.enrollment_id][toDateStr(log.date as unknown as Date)] = log
    }

    const rows = enrollments.map(e => {
      const rowLogs = logsIndex[e.enrollment_id] ?? {}
      const maskedLogs = Object.fromEntries(
        Object.entries(rowLogs).map(([d, l]) => {
          const notesInfo = transformLogNotes(l, requestUserId, requestRole)
          return [d, {
            ...l,
            custom_amount:    isDutyAdmin && l.status === 'special' ? null : l.custom_amount,
            note:             notesInfo.note,
            attributed_notes: notesInfo.attributed_notes,
            has_note:         notesInfo.has_note,
            notes_json:       undefined,
          }]
        })
      )
      return {
        enrollment_id: e.enrollment_id,
        child_id:      e.child_id,
        child_name:    e.child_name,
        activity_id:   e.activity_id,
        group_id:      e.group_id,
        group_name:    e.group_name,
        status:        e.status,
        frozen_from:   e.frozen_from ? toDateStr(e.frozen_from as unknown as Date) : null,
        frozen_to:     e.frozen_to   ? toDateStr(e.frozen_to   as unknown as Date) : null,
        logs:          maskedLogs,
      }
    })

    return {
      merged_journal: mj,
      activities,
      dates: generateDates(from, to),
      rows,
    }
  })
}
