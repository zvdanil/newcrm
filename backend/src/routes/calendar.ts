import type { FastifyInstance } from 'fastify'
import rruleLib from 'rrule'
const { RRule } = rruleLib as unknown as { RRule: typeof import('rrule').RRule }
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'
import { toDbDateStr } from '../services/dateUtils.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return toDbDateStr(d)
}

function parseLocalDate(s: string): Date {
  const [y, m, day] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, day))
}

// Expand an RRULE string + dtstart into concrete dates within [from, to]
function expandRRule(rruleStr: string, dtstart: string, dtend: string | null, from: string, to: string): string[] {
  try {
    const opts = RRule.parseString(rruleStr)
    const startDate = parseLocalDate(dtstart)
    const rule = new RRule({ ...opts, dtstart: startDate })

    const fromDate = parseLocalDate(from)
    const toDate   = parseLocalDate(to)

    // Respect dtend from schedule
    const effectiveTo = dtend
      ? new Date(Math.min(parseLocalDate(dtend).getTime(), toDate.getTime()))
      : toDate

    return rule
      .between(fromDate, effectiveTo, true)
      .map(toDateStr)
  } catch {
    return []
  }
}

// Build RRULE string from days-of-week array (0=MO..6=SU using JS convention Sun=0)
function buildRRule(days: number[]): string {
  const dayMap: Record<number, string> = { 0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA' }
  const byDay = days.map(d => dayMap[d]).filter(Boolean).join(',')
  return `FREQ=WEEKLY;BYDAY=${byDay}`
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function calendarRoutes(app: FastifyInstance) {

  // ── GET /api/calendar/events ─────────────────────────────────────────────
  // Returns expanded occurrences with journal_status for each event
  app.get<{ Querystring: { from: string; to: string } }>(
    '/events',
    { preHandler: requireRole('owner', 'admin', 'manager', 'accountant', 'teacher', 'duty_admin') },
    async (req, reply) => {
      const { from, to } = req.query
      if (!from || !to) return reply.status(400).send({ error: 'BadRequest', message: 'from і to є обовʼязковими' })

      const today = toDateStr(new Date())

      // 1. Load all active schedules in range (start before to, end after from or null)
      const schedules = await db
        .selectFrom('activity_schedules as s')
        .leftJoin('activities as a', 'a.id', 's.activity_id')
        .leftJoin('merged_journals as mj', 'mj.id', 's.merged_journal_id')
        .leftJoin('staff as st', 'st.id', 's.staff_id')
        .select([
          's.id',
          's.activity_id',
          'a.name as activity_name',
          's.merged_journal_id',
          'mj.name as merged_journal_name',
          's.name',
          's.staff_id',
          'st.full_name as staff_name',
          's.room',
          's.start_time',
          's.duration_min',
          's.rrule',
          's.dtstart',
          's.dtend',
          's.color',
          's.note',
        ])
        .where('s.is_active', '=', true)
        .where('s.dtstart', '<=', new Date(to))
        .where((eb) => eb.or([
          eb('s.dtend', 'is', null),
          eb('s.dtend', '>=', new Date(from)),
        ]))
        .execute()

      if (schedules.length === 0) return []

      const scheduleIds = schedules.map(s => s.id)

      // 2. Load exceptions for all schedules
      const exceptions = await db
        .selectFrom('schedule_exceptions')
        .select(['schedule_id', 'original_date', 'exception_type', 'new_date', 'new_start_time', 'note'])
        .where('schedule_id', 'in', scheduleIds)
        .execute()

      const exceptionMap = new Map<string, typeof exceptions>()
      for (const ex of exceptions) {
        const key = ex.schedule_id
        if (!exceptionMap.has(key)) exceptionMap.set(key, [])
        exceptionMap.get(key)!.push(ex)
      }

      // 3. Load substitutions for all schedules in range
      const subs = await db
        .selectFrom('substitutions as sub')
        .innerJoin('staff as st', 'st.id', 'sub.substitute_staff_id')
        .select([
          'sub.schedule_id',
          'sub.occurrence_date',
          'sub.original_staff_id',
          'sub.substitute_staff_id',
          'sub.rate_override',
          'st.full_name as substitute_name',
          'sub.note as sub_note',
        ])
        .where('sub.schedule_id', 'in', scheduleIds)
        .where('sub.occurrence_date', '>=', new Date(from))
        .where('sub.occurrence_date', '<=', new Date(to))
        .execute()

      type SubRow = typeof subs[number]
      const subMap = new Map<string, SubRow>()
      for (const sub of subs) {
        subMap.set(`${sub.schedule_id}_${toDateStr(sub.occurrence_date as unknown as Date)}`, sub)
      }

      // 4. Build full activity ID set (direct + via merged journals)
      const directActivityIds = schedules.map(s => s.activity_id).filter(Boolean) as string[]
      const mergedJournalIds  = [...new Set(schedules.map(s => s.merged_journal_id).filter(Boolean) as string[])]

      // Fetch activity IDs belonging to merged journals
      const mjActivityMap = new Map<string, string[]>() // mjId → activityIds
      if (mergedJournalIds.length > 0) {
        const mjActivities = await db
          .selectFrom('merged_journal_activities')
          .select(['merged_journal_id', 'activity_id'])
          .where('merged_journal_id', 'in', mergedJournalIds)
          .execute()
        for (const row of mjActivities) {
          if (!mjActivityMap.has(row.merged_journal_id)) mjActivityMap.set(row.merged_journal_id, [])
          mjActivityMap.get(row.merged_journal_id)!.push(row.activity_id)
        }
      }

      const allActivityIds = [...new Set([...directActivityIds, ...[...mjActivityMap.values()].flat()])]

      // Load attendance counts for all relevant activities
      const attendanceCounts = allActivityIds.length > 0
        ? await db
            .selectFrom('attendance_logs')
            .select(['activity_id', 'date'])
            .where('activity_id', 'in', allActivityIds)
            .where('date', '>=', new Date(from))
            .where('date', '<=', new Date(to))
            .where('status', 'in', ['present', 'special', 'absent_excused', 'absent_excused_30', 'absent_unexcused'])
            .execute()
        : []

      // Key: activityId_date → true
      const attendanceSet = new Set<string>()
      for (const row of attendanceCounts) {
        attendanceSet.add(`${row.activity_id}_${toDateStr(row.date as unknown as Date)}`)
      }

      // Per-merged-journal: which dates have any attendance
      const mjDateSet = new Map<string, Set<string>>()
      for (const [mjId, actIds] of mjActivityMap) {
        const dates = new Set<string>()
        for (const row of attendanceCounts) {
          if (actIds.includes(row.activity_id as string)) {
            dates.add(toDateStr(row.date as unknown as Date))
          }
        }
        mjDateSet.set(mjId, dates)
      }

      const groupLogs = allActivityIds.length > 0
        ? await db
            .selectFrom('group_lesson_logs')
            .select(['activity_id', 'date', 'status'])
            .where('activity_id', 'in', allActivityIds)
            .where('date', '>=', new Date(from))
            .where('date', '<=', new Date(to))
            .execute()
        : []

      const groupLogMap = new Map<string, string>()
      for (const gl of groupLogs) {
        groupLogMap.set(`${gl.activity_id}_${toDateStr(gl.date as unknown as Date)}`, gl.status)
      }

      // Per-merged-journal: group lesson status per date (conducted wins over cancelled)
      const mjGroupLogMap = new Map<string, Map<string, string>>()
      for (const [mjId, actIds] of mjActivityMap) {
        const dateMap = new Map<string, string>()
        for (const gl of groupLogs) {
          if (actIds.includes(gl.activity_id as string)) {
            const dateStr = toDateStr(gl.date as unknown as Date)
            if (!dateMap.has(dateStr) || gl.status === 'conducted') dateMap.set(dateStr, gl.status)
          }
        }
        mjGroupLogMap.set(mjId, dateMap)
      }

      // 5. Expand and build events
      const events: object[] = []

      for (const sched of schedules) {
        const dtstart = toDateStr(sched.dtstart as unknown as Date)
        const dtend   = sched.dtend ? toDateStr(sched.dtend as unknown as Date) : null

        const rawDates = expandRRule(sched.rrule, dtstart, dtend, from, to)

        // Apply exceptions
        const schedExceptions = exceptionMap.get(sched.id) ?? []
        const cancelledDates  = new Set(schedExceptions.filter(e => e.exception_type === 'cancelled').map(e => toDateStr(e.original_date as unknown as Date)))
        const movedMap        = new Map(schedExceptions.filter(e => e.exception_type === 'moved').map(e => [
          toDateStr(e.original_date as unknown as Date),
          { newDate: e.new_date ? toDateStr(e.new_date as unknown as Date) : null, newTime: e.new_start_time }
        ]))

        // Collect all occurrence dates (including moved-to dates)
        const occurrences: { date: string; isException: boolean; isCancelled: boolean; originalDate?: string; startTime: string }[] = []

        for (const rawDate of rawDates) {
          if (cancelledDates.has(rawDate)) {
            occurrences.push({ date: rawDate, isException: true, isCancelled: true, startTime: String(sched.start_time) })
          } else if (movedMap.has(rawDate)) {
            const mv = movedMap.get(rawDate)!
            const newDate = mv.newDate ?? rawDate
            if (newDate >= from && newDate <= to) {
              occurrences.push({
                date: newDate,
                isException: true,
                isCancelled: false,
                originalDate: rawDate,
                startTime: mv.newTime ? String(mv.newTime) : String(sched.start_time),
              })
            }
          } else {
            occurrences.push({ date: rawDate, isException: false, isCancelled: false, startTime: String(sched.start_time) })
          }
        }

        const mjId = sched.merged_journal_id

        for (const occ of occurrences) {
          let hasAtt: boolean
          let glStatus: string | undefined

          if (mjId) {
            hasAtt   = mjDateSet.get(mjId)?.has(occ.date) ?? false
            glStatus = mjGroupLogMap.get(mjId)?.get(occ.date)
          } else {
            const attKey = `${sched.activity_id}_${occ.date}`
            hasAtt   = attendanceSet.has(attKey)
            glStatus = groupLogMap.get(attKey)
          }

          let journalStatus: string
          if (occ.isCancelled || glStatus === 'cancelled') {
            journalStatus = 'cancelled'
          } else if (occ.date > today) {
            journalStatus = 'future'
          } else if (hasAtt || glStatus === 'conducted') {
            journalStatus = 'filled'
          } else {
            journalStatus = 'empty'
          }

          const subKey = `${sched.id}_${occ.date}`
          const sub    = subMap.get(subKey)

          const displayStaffId   = sub ? sub.substitute_staff_id : sched.staff_id
          const displayStaffName = sub ? sub.substitute_name     : sched.staff_name

          const displayName = mjId
            ? (sched.merged_journal_name ?? 'Об\'єднаний журнал')
            : (sched.activity_name ?? '')

          events.push({
            id:                `${sched.id}_${occ.date}`,
            scheduleId:        sched.id,
            activityId:        sched.activity_id ?? null,
            activityName:      displayName,
            mergedJournalId:   mjId ?? null,
            mergedJournalName: sched.merged_journal_name ?? null,
            scheduleName:      sched.name ?? null,
            date:              occ.date,
            startTime:         occ.startTime.slice(0, 5),
            durationMin:       sched.duration_min,
            room:              sched.room,
            staffId:           displayStaffId,
            staffName:         displayStaffName,
            journalStatus,
            isException:       occ.isException,
            originalDate:      occ.originalDate ?? null,
            color:             sched.color,
            substitute:        sub ? {
              staffId:         sub.substitute_staff_id,
              staffName:       sub.substitute_name,
              originalStaffId: sub.original_staff_id,
              rateOverride:    Number(sub.rate_override),
            } : null,
          })
        }
      }

      return events
    }
  )

  // ── GET /api/calendar/schedules ──────────────────────────────────────────
  app.get(
    '/schedules',
    { preHandler: requireRole('owner', 'admin', 'manager', 'duty_admin') },
    async () => {
      return db
        .selectFrom('activity_schedules as s')
        .leftJoin('activities as a', 'a.id', 's.activity_id')
        .leftJoin('merged_journals as mj', 'mj.id', 's.merged_journal_id')
        .leftJoin('staff as st', 'st.id', 's.staff_id')
        .select([
          's.id',
          's.activity_id',
          'a.name as activity_name',
          's.merged_journal_id',
          'mj.name as merged_journal_name',
          's.name',
          's.staff_id',
          'st.full_name as staff_name',
          's.room',
          's.start_time',
          's.duration_min',
          's.rrule',
          's.dtstart',
          's.dtend',
          's.color',
          's.is_active',
          's.note',
          's.created_at',
        ])
        .where('s.is_active', '=', true)
        .orderBy('a.name', 'asc')
        .orderBy('s.start_time', 'asc')
        .execute()
    }
  )

  // GET /api/calendar/schedules by activity
  app.get<{ Querystring: { activity_id?: string } }>(
    '/schedules/by-activity',
    { preHandler: requireRole('owner', 'admin', 'manager', 'teacher', 'duty_admin') },
    async (req) => {
      let q = db
        .selectFrom('activity_schedules as s')
        .leftJoin('activities as a', 'a.id', 's.activity_id')
        .leftJoin('merged_journals as mj', 'mj.id', 's.merged_journal_id')
        .leftJoin('staff as st', 'st.id', 's.staff_id')
        .select([
          's.id',
          's.activity_id',
          'a.name as activity_name',
          's.merged_journal_id',
          'mj.name as merged_journal_name',
          's.name',
          's.staff_id',
          'st.full_name as staff_name',
          's.room',
          's.start_time',
          's.duration_min',
          's.rrule',
          's.dtstart',
          's.dtend',
          's.color',
          's.is_active',
          's.note',
        ])
        .where('s.is_active', '=', true)
        .orderBy('s.start_time', 'asc')

      if (req.query.activity_id) {
        q = q.where('s.activity_id', '=', req.query.activity_id)
      }

      return q.execute()
    }
  )

  // ── POST /api/calendar/schedules ─────────────────────────────────────────
  app.post<{
    Body: {
      activity_id?:        string
      merged_journal_id?:  string
      name?:               string
      staff_id?:           string
      room?:               string
      start_time:          string
      duration_min?:       number
      days:                number[]   // 0=Sun,1=Mon,...6=Sat
      dtstart:             string
      dtend?:              string
      color?:              string
      note?:               string
    }
  }>(
    '/schedules',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { activity_id, merged_journal_id, name, staff_id, room, start_time, duration_min = 60, days, dtstart, dtend, color, note } = req.body

      if (!activity_id && !merged_journal_id) {
        return reply.status(400).send({ error: 'BadRequest', message: 'Потрібна activity_id або merged_journal_id' })
      }
      if (!start_time || !dtstart || !days?.length) {
        return reply.status(400).send({ error: 'BadRequest', message: 'start_time, dtstart, days є обовʼязковими' })
      }

      const rrule = buildRRule(days)

      const row = await db
        .insertInto('activity_schedules')
        .values({
          activity_id:        activity_id        ?? null,
          merged_journal_id:  merged_journal_id  ?? null,
          name:               name               ?? null,
          staff_id:           staff_id           ?? null,
          room:               room               ?? null,
          start_time,
          duration_min,
          rrule,
          dtstart,
          dtend:              dtend              ?? null,
          color:              color              ?? null,
          note:               note               ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      return reply.status(201).send(row)
    }
  )

  // ── PUT /api/calendar/schedules/:id ──────────────────────────────────────
  app.put<{
    Params: { id: string }
    Body: {
      name?:         string | null
      staff_id?:     string | null
      room?:         string | null
      start_time?:   string
      duration_min?: number
      days?:         number[]
      dtstart?:      string
      dtend?:        string | null
      color?:        string | null
      note?:         string | null
    }
  }>(
    '/schedules/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { id } = req.params
      const { name, staff_id, room, start_time, duration_min, days, dtstart, dtend, color, note } = req.body

      const sched = await db.selectFrom('activity_schedules').selectAll().where('id', '=', id).executeTakeFirst()
      if (!sched) return reply.status(404).send({ error: 'NotFound' })

      const updates: Record<string, unknown> = {}
      if (name       !== undefined) updates.name        = name
      if (staff_id   !== undefined) updates.staff_id    = staff_id
      if (room       !== undefined) updates.room        = room
      if (start_time !== undefined) updates.start_time  = start_time
      if (duration_min !== undefined) updates.duration_min = duration_min
      if (days       !== undefined) updates.rrule       = buildRRule(days)
      if (dtstart    !== undefined) updates.dtstart     = dtstart
      if (dtend      !== undefined) updates.dtend       = dtend
      if (color      !== undefined) updates.color       = color
      if (note       !== undefined) updates.note        = note

      const updated = await db
        .updateTable('activity_schedules')
        .set(updates)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow()

      return updated
    }
  )

  // ── DELETE /api/calendar/schedules/:id ───────────────────────────────────
  app.delete<{ Params: { id: string } }>(
    '/schedules/:id',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { id } = req.params
      const sched = await db.selectFrom('activity_schedules').select('id').where('id', '=', id).executeTakeFirst()
      if (!sched) return reply.status(404).send({ error: 'NotFound' })

      await db.updateTable('activity_schedules').set({ is_active: false }).where('id', '=', id).execute()
      return reply.status(204).send()
    }
  )

  // ── POST /api/calendar/schedules/:id/exceptions ──────────────────────────
  app.post<{
    Params: { id: string }
    Body: {
      original_date:  string
      exception_type: 'cancelled' | 'moved'
      new_date?:      string
      new_start_time?: string
      note?:          string
    }
  }>(
    '/schedules/:id/exceptions',
    { preHandler: requireRole('owner', 'admin', 'manager', 'duty_admin') },
    async (req, reply) => {
      const { id } = req.params
      const { original_date, exception_type, new_date, new_start_time, note } = req.body

      const sched = await db.selectFrom('activity_schedules').select('id').where('id', '=', id).executeTakeFirst()
      if (!sched) return reply.status(404).send({ error: 'NotFound' })

      // Upsert: delete existing then insert
      await db.deleteFrom('schedule_exceptions')
        .where('schedule_id', '=', id)
        .where('original_date', '=', new Date(original_date))
        .execute()

      const row = await db
        .insertInto('schedule_exceptions')
        .values({
          schedule_id:    id,
          original_date,
          exception_type,
          new_date:       new_date       ?? null,
          new_start_time: new_start_time ?? null,
          note:           note           ?? null,
          created_by:     (req.user as { sub: string }).sub,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      // When cancelling an occurrence, soft-delete the substitute's salary accrual (if any)
      if (exception_type === 'cancelled') {
        const sub = await db
          .selectFrom('substitutions')
          .select('salary_tx_id')
          .where('schedule_id', '=', id)
          .where('occurrence_date', '=', new Date(original_date))
          .executeTakeFirst()
        if (sub?.salary_tx_id) {
          await db.updateTable('salary_transactions')
            .set({ is_deleted: true, deleted_at: new Date().toISOString() })
            .where('id', '=', sub.salary_tx_id)
            .where('is_deleted', '=', false)
            .execute()
        }
      }

      return reply.status(201).send(row)
    }
  )

  // ── DELETE /api/calendar/schedules/:id/exceptions/:originalDate ──────────
  app.delete<{ Params: { id: string; originalDate: string } }>(
    '/schedules/:id/exceptions/:originalDate',
    { preHandler: requireRole('owner', 'admin', 'manager', 'duty_admin') },
    async (req, reply) => {
      // Check if this was a cancellation exception (restore salary accrual if so)
      const exception = await db
        .selectFrom('schedule_exceptions')
        .select('exception_type')
        .where('schedule_id', '=', req.params.id)
        .where('original_date', '=', new Date(req.params.originalDate))
        .executeTakeFirst()

      await db
        .deleteFrom('schedule_exceptions')
        .where('schedule_id', '=', req.params.id)
        .where('original_date', '=', new Date(req.params.originalDate))
        .execute()

      // Restore the substitute's salary accrual when a cancellation is undone
      if (exception?.exception_type === 'cancelled') {
        const sub = await db
          .selectFrom('substitutions')
          .select('salary_tx_id')
          .where('schedule_id', '=', req.params.id)
          .where('occurrence_date', '=', new Date(req.params.originalDate))
          .executeTakeFirst()
        if (sub?.salary_tx_id) {
          await db.updateTable('salary_transactions')
            .set({ is_deleted: false, deleted_at: null })
            .where('id', '=', sub.salary_tx_id)
            .where('is_deleted', '=', true)
            .execute()
        }
      }

      return reply.status(204).send()
    }
  )

  // ── POST /api/calendar/schedules/:id/substitutions ───────────────────────
  app.post<{
    Params: { id: string }
    Body: {
      occurrence_date:     string
      substitute_staff_id: string
      rate_override:       number
      note?:               string
    }
  }>(
    '/schedules/:id/substitutions',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const { id } = req.params
      const { occurrence_date, substitute_staff_id, rate_override, note } = req.body

      const sched = await db
        .selectFrom('activity_schedules')
        .select(['id', 'staff_id', 'activity_id'])
        .where('id', '=', id)
        .executeTakeFirst()
      if (!sched) return reply.status(404).send({ error: 'NotFound' })

      // Check if substitution already exists
      const existing = await db
        .selectFrom('substitutions')
        .select(['id', 'salary_tx_id'])
        .where('schedule_id', '=', id)
        .where('occurrence_date', '=', new Date(occurrence_date))
        .executeTakeFirst()

      // Soft-delete previous salary tx if updating
      if (existing?.salary_tx_id) {
        await db
          .updateTable('salary_transactions')
          .set({ is_deleted: true, deleted_at: new Date().toISOString() })
          .where('id', '=', existing.salary_tx_id)
          .execute()
        await db.deleteFrom('substitutions').where('id', '=', existing.id).execute()
      }

      // Create ACCRUAL for substitute
      const billingMonth = (() => {
        const d = new Date(occurrence_date)
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
      })()

      const salaryTx = await db
        .insertInto('salary_transactions')
        .values({
          staff_id:         substitute_staff_id,
          rate_id:          null,
          activity_id:      sched.activity_id,
          type:             'ACCRUAL',
          gross_amount:     rate_override,
          deduction_pct:    0,
          transaction_date: occurrence_date,
          billing_month:    billingMonth,
          note:             note ? `Замена: ${note}` : 'Замена педагога',
          metadata_json:    { source: 'substitution', schedule_id: id, occurrence_date },
          created_by:       (req.user as { sub: string }).sub,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      // Save substitution record
      const sub = await db
        .insertInto('substitutions')
        .values({
          schedule_id:         id,
          occurrence_date,
          original_staff_id:   sched.staff_id ?? null,
          substitute_staff_id,
          rate_override,
          salary_tx_id:        salaryTx.id,
          note:                note ?? null,
          created_by:          (req.user as { sub: string }).sub,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      return reply.status(201).send({ ...sub, salary_tx_id: salaryTx.id })
    }
  )

  // ── DELETE /api/calendar/schedules/:id/substitutions/:date ───────────────
  app.delete<{ Params: { id: string; date: string } }>(
    '/schedules/:id/substitutions/:date',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      const sub = await db
        .selectFrom('substitutions')
        .select(['id', 'salary_tx_id'])
        .where('schedule_id', '=', req.params.id)
        .where('occurrence_date', '=', new Date(req.params.date))
        .executeTakeFirst()

      if (!sub) return reply.status(404).send({ error: 'NotFound' })

      // Soft-delete the salary tx
      if (sub.salary_tx_id) {
        await db
          .updateTable('salary_transactions')
          .set({ is_deleted: true, deleted_at: new Date().toISOString() })
          .where('id', '=', sub.salary_tx_id)
          .execute()
      }

      await db.deleteFrom('substitutions').where('id', '=', sub.id).execute()
      return reply.status(204).send()
    }
  )

  // ── GET /api/calendar/conflicts ──────────────────────────────────────────
  // Check if a proposed time slot conflicts with existing schedules
  app.get<{
    Querystring: {
      staff_id?:          string
      room?:              string
      date:               string
      start_time:         string
      duration_min:       string
      exclude_schedule_id?: string
    }
  }>(
    '/conflicts',
    { preHandler: requireRole('owner', 'admin') },
    async (req) => {
      const { staff_id, room, date, start_time, duration_min, exclude_schedule_id } = req.query
      const durationMin = Number(duration_min) || 60

      // Parse proposed slot
      const [propH, propM] = start_time.split(':').map(Number)
      const propStart = propH * 60 + propM
      const propEnd   = propStart + durationMin

      // Load all active schedules that could overlap this date
      let q = db
        .selectFrom('activity_schedules as s')
        .innerJoin('activities as a', 'a.id', 's.activity_id')
        .leftJoin('staff as st', 'st.id', 's.staff_id')
        .select([
          's.id', 's.activity_id', 'a.name as activity_name',
          's.staff_id', 'st.full_name as staff_name',
          's.room', 's.start_time', 's.duration_min', 's.rrule', 's.dtstart', 's.dtend',
        ])
        .where('s.is_active', '=', true)
        .where('s.dtstart', '<=', new Date(date))
        .where((eb) => eb.or([
          eb('s.dtend', 'is', null),
          eb('s.dtend', '>=', new Date(date)),
        ]))

      if (exclude_schedule_id) {
        q = q.where('s.id', '!=', exclude_schedule_id)
      }

      const schedules = await q.execute()
      const conflicts: object[] = []

      for (const sched of schedules) {
        const dtstart = toDateStr(sched.dtstart as unknown as Date)
        const dtend   = sched.dtend ? toDateStr(sched.dtend as unknown as Date) : null

        const dates = expandRRule(sched.rrule, dtstart, dtend, date, date)
        if (!dates.includes(date)) continue

        // Check time overlap
        const [schedH, schedM] = String(sched.start_time).slice(0, 5).split(':').map(Number)
        const schedStart = schedH * 60 + schedM
        const schedEnd   = schedStart + sched.duration_min

        const overlaps = propStart < schedEnd && propEnd > schedStart

        if (!overlaps) continue

        const staffConflict = staff_id && sched.staff_id === staff_id
        const roomConflict  = room     && sched.room && sched.room.toLowerCase() === room.toLowerCase()

        if (staffConflict || roomConflict) {
          conflicts.push({
            scheduleId:   sched.id,
            activityId:   sched.activity_id,
            activityName: sched.activity_name,
            staffId:      sched.staff_id,
            staffName:    sched.staff_name,
            room:         sched.room,
            startTime:    String(sched.start_time).slice(0, 5),
            durationMin:  sched.duration_min,
            conflictType: staffConflict && roomConflict ? 'both' : staffConflict ? 'staff' : 'room',
          })
        }
      }

      return conflicts
    }
  )

  // ── GET /api/calendar/staff-for-activity ─────────────────────────────────
  // Returns staff members who have an active rate for the given activity
  app.get<{ Querystring: { activity_id: string } }>(
    '/staff-for-activity',
    { preHandler: requireRole('owner', 'admin', 'manager', 'duty_admin') },
    async (req, reply) => {
      const { activity_id } = req.query
      if (!activity_id) return reply.status(400).send({ error: 'BadRequest', message: 'activity_id є обовʼязковим' })

      const rows = await db
        .selectFrom('staff as s')
        .innerJoin('staff_rates as sr', 'sr.staff_id', 's.id')
        .select(['s.id', 's.full_name'])
        .where('sr.activity_id', '=', activity_id)
        .where('sr.valid_to', 'is', null)
        .where('s.is_active', '=', true)
        .distinct()
        .orderBy('s.full_name', 'asc')
        .execute()

      return rows
    }
  )
}
