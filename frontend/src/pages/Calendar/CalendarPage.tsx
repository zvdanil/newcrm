import { useState, useEffect, useRef, useCallback } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventInput, EventDropArg, EventClickArg, DatesSetArg } from '@fullcalendar/core'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { calendarApi } from '../../api/calendar.api'
import type { CalendarEvent } from '../../api/calendar.api'
import { staffApi } from '../../api/staff.api'

// ─── Status colors ─────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  filled:    '#16a34a',   // green
  empty:     '#dc2626',   // red
  future:    '#9ca3af',   // gray
  cancelled: '#374151',   // dark gray
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function parseRRule(rrule: string): number[] {
  const match = rrule.match(/BYDAY=([A-Z,]+)/)
  if (!match) return []
  const dayMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }
  return match[1].split(',').map(d => dayMap[d] ?? -1).filter(d => d >= 0)
}


// ─── Journal Modal ─────────────────────────────────────────────────────────────

interface JournalModalProps {
  activityId: string
  date:       string
  onClose:    () => void
}

function JournalModal({ activityId, date, onClose }: JournalModalProps) {
  const url = `/journals/${activityId}?mode=day&date=${date}&layout=none`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl flex flex-col"
        style={{ width: '90vw', maxWidth: 1100, height: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <span className="text-sm font-medium text-gray-700">Журнал · {date}</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 transition-colors text-lg font-bold leading-none"
            title="Закрити"
          >
            ✕
          </button>
        </div>
        <iframe
          src={url}
          className="flex-1 w-full border-0 rounded-b-xl"
          title="Журнал відвідування"
        />
      </div>
    </div>
  )
}

// ─── Move Dialog ───────────────────────────────────────────────────────────────

interface MoveDialogProps {
  eventData:   { scheduleId: string; originalDate: string; newDate: string; newTime?: string }
  onThisOnly:  () => void
  onAllFuture: () => void
  onCancel:    () => void
}

function MoveDialog({ onThisOnly, onAllFuture, onCancel }: MoveDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl p-6 w-80 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900">Перенести заняття</h3>
        <p className="text-sm text-gray-500">Які заняття перенести?</p>
        <div className="space-y-2">
          <button
            onClick={onThisOnly}
            className="w-full py-2.5 px-4 bg-iris-600 hover:bg-iris-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Тільки це заняття
          </button>
          <button
            onClick={onAllFuture}
            className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
          >
            Це та всі наступні
          </button>
          <button
            onClick={onCancel}
            className="w-full py-2 text-gray-400 hover:text-gray-700 text-sm"
          >
            Скасувати
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Substitution Dialog ────────────────────────────────────────────────────────

interface SubDialogProps {
  scheduleId:      string
  occurrenceDate:  string
  originalStaffId: string | null
  onSave:          (data: { substitute_staff_id: string; rate_override: number; note?: string }) => void
  onClose:         () => void
}

function SubstitutionDialog({ scheduleId: _scheduleId, occurrenceDate, originalStaffId: _orig, onSave, onClose }: SubDialogProps) {
  const [staffId, setStaffId] = useState('')
  const [rate, setRate]       = useState('')
  const [note, setNote]       = useState('')

  const { data: staffList = [] } = useQuery({
    queryKey: ['staff-list-active'],
    queryFn:  () => staffApi.list({ is_active: true }),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl p-6 w-96 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900">Замена педагога · {occurrenceDate}</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Педагог-замена</label>
          <select
            value={staffId}
            onChange={(e) => setStaffId(e.target.value)}
            className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
          >
            <option value="">— оберіть педагога —</option>
            {staffList.map((s: { id: string; full_name: string }) => (
              <option key={s.id} value={s.id}>{s.full_name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ставка за заняття (грн)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
            placeholder="напр. 350"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Примітка</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
            placeholder="необов'язково"
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={() => { if (!staffId || !rate) return; onSave({ substitute_staff_id: staffId, rate_override: Number(rate), note: note || undefined }) }}
            disabled={!staffId || !rate}
            className="flex-1 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Зберегти
          </button>
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm">Скасувати</button>
        </div>
      </div>
    </div>
  )
}

// ─── Event popup (click on event) ──────────────────────────────────────────────

interface EventPopupProps {
  event:   CalendarEvent
  pos:     { x: number; y: number }
  onOpenJournal:     () => void
  onAddSubstitution: () => void
  onCancel:          () => void
  onRestore:         () => void
  onClose:           () => void
}

function EventPopup({ event, pos, onOpenJournal, onAddSubstitution, onCancel, onRestore, onClose }: EventPopupProps) {
  const statusLabel: Record<string, string> = {
    filled:    'Журнал заповнено',
    empty:     'Журнал не заповнено',
    future:    'Майбутнє заняття',
    cancelled: 'Скасовано',
  }

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div
        className="absolute bg-white rounded-xl border border-gray-200 shadow-xl p-4 w-72 space-y-3 z-50"
        style={{ left: Math.min(pos.x, window.innerWidth - 300), top: Math.min(pos.y, window.innerHeight - 320) }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div className="flex items-start justify-between">
            <h3 className="font-semibold text-gray-900 text-sm leading-tight">{event.activityName}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 ml-2">✕</button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {event.date} · {event.startTime} · {event.durationMin} хв
          </p>
          {event.room && <p className="text-xs text-gray-500">Кімната: {event.room}</p>}
          {event.staffName && (
            <p className="text-xs text-gray-500">
              Педагог: {event.staffName}
              {event.substitute && <span className="ml-1 text-amber-600 font-medium">(замена)</span>}
            </p>
          )}
          <p className="text-xs mt-1" style={{ color: STATUS_COLOR[event.journalStatus] }}>
            {statusLabel[event.journalStatus]}
          </p>
        </div>

        <div className="space-y-1.5">
          {event.journalStatus !== 'cancelled' && (
            <button
              onClick={onOpenJournal}
              className="w-full py-2 px-3 bg-iris-600 hover:bg-iris-700 text-white text-xs font-medium rounded-lg transition-colors text-left"
            >
              Відкрити журнал
            </button>
          )}

          {event.journalStatus !== 'cancelled' && !event.substitute && (
            <button
              onClick={onAddSubstitution}
              className="w-full py-2 px-3 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-medium rounded-lg transition-colors text-left border border-amber-200"
            >
              Призначити заміну
            </button>
          )}

          {event.substitute && (
            <button
              onClick={onAddSubstitution}
              className="w-full py-2 px-3 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-medium rounded-lg transition-colors text-left border border-amber-200"
            >
              Змінити заміну
            </button>
          )}

          {event.journalStatus !== 'cancelled' && (
            <button
              onClick={onCancel}
              className="w-full py-2 px-3 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium rounded-lg transition-colors text-left border border-red-200"
            >
              Скасувати заняття
            </button>
          )}

          {event.journalStatus === 'cancelled' && event.isException && (
            <button
              onClick={onRestore}
              className="w-full py-2 px-3 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-medium rounded-lg transition-colors text-left border border-green-200"
            >
              Відновити заняття
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Calendar Page ─────────────────────────────────────────────────────────

export function CalendarPage() {
  const qc = useQueryClient()
  const calendarRef = useRef<FullCalendar>(null)

  const [dateRange, setDateRange] = useState<{ from: string; to: string }>(() => {
    const today = new Date()
    const from  = toDateStr(new Date(today.getFullYear(), today.getMonth(), 1))
    const to    = toDateStr(new Date(today.getFullYear(), today.getMonth() + 1, 0))
    return { from, to }
  })

  // Modal states
  const [journalModal, setJournalModal]   = useState<{ activityId: string; date: string } | null>(null)
  const [moveDialog, setMoveDialog]       = useState<{ scheduleId: string; originalDate: string; newDate: string; newTime?: string } | null>(null)
  const [subDialog, setSubDialog]         = useState<{ scheduleId: string; date: string; originalStaffId: string | null } | null>(null)
  const [eventPopup, setEventPopup]       = useState<{ event: CalendarEvent; pos: { x: number; y: number } } | null>(null)

  // Fetch events
  const { data: events = [] } = useQuery({
    queryKey: ['calendar-events', dateRange.from, dateRange.to],
    queryFn:  () => calendarApi.getEvents(dateRange.from, dateRange.to),
  })

  const refetch = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['calendar-events', dateRange.from, dateRange.to] })
  }, [qc, dateRange])

  // Listen for postMessage from journal iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === 'JOURNAL_SAVED') {
        setJournalModal(null)
        refetch()
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [refetch])

  // Mutation: create exception (cancel or move)
  const exceptionMutation = useMutation({
    mutationFn: ({ scheduleId, payload }: { scheduleId: string; payload: Parameters<typeof calendarApi.createException>[1] }) =>
      calendarApi.createException(scheduleId, payload),
    onSuccess: refetch,
  })

  const deleteExceptionMutation = useMutation({
    mutationFn: ({ scheduleId, date }: { scheduleId: string; date: string }) =>
      calendarApi.deleteException(scheduleId, date),
    onSuccess: refetch,
  })

  const subMutation = useMutation({
    mutationFn: ({ scheduleId, payload }: { scheduleId: string; payload: Parameters<typeof calendarApi.createSubstitution>[1] }) =>
      calendarApi.createSubstitution(scheduleId, payload),
    onSuccess: () => { setSubDialog(null); refetch() },
  })

  // Build FullCalendar events
  const fcEvents: EventInput[] = events.map(ev => {
    const [h, m] = ev.startTime.split(':').map(Number)
    const startDt = `${ev.date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`
    const endMs   = new Date(startDt).getTime() + ev.durationMin * 60_000
    const endDt   = new Date(endMs).toISOString().slice(0, 19)

    const baseColor = ev.color ?? STATUS_COLOR[ev.journalStatus]

    return {
      id:              ev.id,
      title:           ev.activityName,
      start:           startDt,
      end:             endDt,
      backgroundColor: baseColor,
      borderColor:     baseColor,
      textColor:       '#ffffff',
      extendedProps:   ev,
    }
  })

  // Handle event click — show popup
  const handleEventClick = (info: EventClickArg) => {
    const ev = info.event.extendedProps as CalendarEvent
    const rect = info.el.getBoundingClientRect()
    setEventPopup({ event: ev, pos: { x: rect.left, y: rect.bottom + 4 } })
  }

  // Handle drag-drop
  const handleEventDrop = (info: EventDropArg) => {
    const ev = info.event.extendedProps as CalendarEvent
    const newDate = toDateStr(info.event.start!)
    const newTime = info.event.start!.toTimeString().slice(0, 5)

    if (newDate === ev.date) { info.revert(); return }

    setMoveDialog({
      scheduleId:   ev.scheduleId,
      originalDate: ev.date,
      newDate,
      newTime,
    })
    info.revert() // revert visually — we'll re-fetch after mutation
  }

  const handleDatesSet = (arg: DatesSetArg) => {
    const from = toDateStr(arg.start)
    const to   = toDateStr(new Date(arg.end.getTime() - 1)) // FC end is exclusive
    setDateRange({ from, to })
  }

  // Current view state (for toolbar label)
  const [currentView, setCurrentView] = useState<'timeGridWeek' | 'timeGridDay' | 'dayGridMonth'>('timeGridWeek')

  const goToView = (view: typeof currentView) => {
    setCurrentView(view)
    calendarRef.current?.getApi().changeView(view)
  }

  const closePopup = () => setEventPopup(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-gray-900">Календар занять</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {([
              { key: 'dayGridMonth',  label: 'Місяць' },
              { key: 'timeGridWeek',  label: 'Тиждень' },
              { key: 'timeGridDay',   label: 'День' },
            ] as { key: typeof currentView; label: string }[]).map(v => (
              <button
                key={v.key}
                onClick={() => goToView(v.key)}
                className={`px-3 py-1.5 font-medium transition-colors ${currentView === v.key ? 'bg-iris-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        {Object.entries({ filled: 'Заповнено', empty: 'Не заповнено', future: 'Майбутнє', cancelled: 'Скасовано' }).map(([k, label]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: STATUS_COLOR[k] }} />
            {label}
          </span>
        ))}
      </div>

      {/* FullCalendar */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          locale="uk"
          firstDay={1}            // Monday first
          slotMinTime="07:00:00"
          slotMaxTime="22:00:00"
          allDaySlot={false}
          editable={true}
          events={fcEvents}
          datesSet={handleDatesSet}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          headerToolbar={{
            left:   'prev,next today',
            center: 'title',
            right:  '',           // we use our own view switcher
          }}
          buttonText={{ today: 'Сьогодні', prev: '‹', next: '›' }}
          eventContent={(arg) => {
            const ev = arg.event.extendedProps as CalendarEvent
            return (
              <div className="px-1 py-0.5 overflow-hidden h-full flex flex-col gap-0.5">
                <div className="text-xs font-semibold leading-tight truncate">{arg.event.title}</div>
                {ev.staffName && (
                  <div className="text-xs opacity-90 truncate">
                    {ev.staffName}
                    {ev.substitute && <span className="ml-1 text-yellow-200">(з)</span>}
                  </div>
                )}
                {ev.room && <div className="text-xs opacity-75 truncate">{ev.room}</div>}
              </div>
            )
          }}
          height="auto"
        />
      </div>

      {/* Journal modal */}
      {journalModal && (
        <JournalModal
          activityId={journalModal.activityId}
          date={journalModal.date}
          onClose={() => setJournalModal(null)}
        />
      )}

      {/* Move dialog */}
      {moveDialog && (
        <MoveDialog
          eventData={moveDialog}
          onThisOnly={() => {
            exceptionMutation.mutate({
              scheduleId: moveDialog.scheduleId,
              payload: {
                original_date:  moveDialog.originalDate,
                exception_type: 'moved',
                new_date:       moveDialog.newDate,
                new_start_time: moveDialog.newTime,
              },
            })
            setMoveDialog(null)
          }}
          onAllFuture={async () => {
            // Close current schedule at originalDate - 1 day, create new one starting from newDate
            const orig = new Date(moveDialog.originalDate)
            const prevDay = toDateStr(new Date(orig.getTime() - 86_400_000))

            // Get schedule details to fork
            try {
              const schedules = await calendarApi.getSchedules()
              const sched = schedules.find(s => s.id === moveDialog.scheduleId)
              if (sched) {
                // Close existing at prevDay
                await calendarApi.updateSchedule(moveDialog.scheduleId, { dtend: prevDay })
                // Parse days from rrule
                const days = parseRRule(sched.rrule)
                // Create new schedule from newDate
                await calendarApi.createSchedule({
                  activity_id:  sched.activity_id,
                  staff_id:     sched.staff_id ?? undefined,
                  room:         sched.room ?? undefined,
                  start_time:   moveDialog.newTime ?? sched.start_time,
                  duration_min: sched.duration_min,
                  days,
                  dtstart:      moveDialog.newDate,
                  color:        sched.color ?? undefined,
                  note:         sched.note ?? undefined,
                })
              }
            } finally {
              setMoveDialog(null)
              refetch()
            }
          }}
          onCancel={() => setMoveDialog(null)}
        />
      )}

      {/* Substitution dialog */}
      {subDialog && (
        <SubstitutionDialog
          scheduleId={subDialog.scheduleId}
          occurrenceDate={subDialog.date}
          originalStaffId={subDialog.originalStaffId}
          onSave={(payload) => subMutation.mutate({ scheduleId: subDialog.scheduleId, payload: { ...payload, occurrence_date: subDialog.date } })}
          onClose={() => setSubDialog(null)}
        />
      )}

      {/* Event popup */}
      {eventPopup && (
        <EventPopup
          event={eventPopup.event}
          pos={eventPopup.pos}
          onClose={closePopup}
          onOpenJournal={() => {
            setJournalModal({ activityId: eventPopup.event.activityId, date: eventPopup.event.date })
            closePopup()
          }}
          onAddSubstitution={() => {
            setSubDialog({
              scheduleId:      eventPopup.event.scheduleId,
              date:            eventPopup.event.date,
              originalStaffId: eventPopup.event.staffId,
            })
            closePopup()
          }}
          onCancel={() => {
            exceptionMutation.mutate({
              scheduleId: eventPopup.event.scheduleId,
              payload: {
                original_date:  eventPopup.event.originalDate ?? eventPopup.event.date,
                exception_type: 'cancelled',
              },
            })
            closePopup()
          }}
          onRestore={() => {
            if (eventPopup.event.originalDate) {
              deleteExceptionMutation.mutate({ scheduleId: eventPopup.event.scheduleId, date: eventPopup.event.originalDate })
            }
            closePopup()
          }}
        />
      )}
    </div>
  )
}
