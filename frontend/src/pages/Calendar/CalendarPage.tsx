import { useState, useRef, useCallback } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventInput, EventDropArg, EventClickArg, DatesSetArg } from '@fullcalendar/core'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { calendarApi } from '../../api/calendar.api'
import type { CalendarEvent, CalendarSchedule } from '../../api/calendar.api'
import { staffApi } from '../../api/staff.api'
import { activitiesApi } from '../../api/activities.api'
import { mergedJournalsApi } from '../../api/mergedJournals.api'

import { localDateStr, today } from '../../utils/dateStr'

// ─── Constants ─────────────────────────────────────────────────────────────────

const STATUS_DOT_COLOR: Record<string, string> = {
  filled:    '#16a34a',
  empty:     '#dc2626',
  future:    '#e5e7eb',
  cancelled: '#374151',
}

const STATUS_COLOR: Record<string, string> = STATUS_DOT_COLOR

const DAY_LABELS: Record<number, string> = { 1: 'Пн', 2: 'Вт', 3: 'Ср', 4: 'Чт', 5: 'Пт', 6: 'Сб', 0: 'Нд' }
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0]

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return localDateStr(d)
}

function todayStr() { return today() }

function parseRRuleDays(rrule: string): number[] {
  const dayCodeMap: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }
  const match = rrule.match(/BYDAY=([A-Z,]+)/)
  if (!match) return []
  return match[1].split(',').map(c => dayCodeMap[c] ?? -1).filter(d => d >= 0)
}

function daysToLabel(rrule: string): string {
  return parseRRuleDays(rrule).map(d => DAY_LABELS[d]).join(', ') || '—'
}

// ─── Schedule Form ─────────────────────────────────────────────────────────────

type ScheduleFormData = {
  journal_type:        'activity' | 'merged'
  name:                string
  activity_id:         string
  merged_journal_id:   string
  color:               string
  staff_id:            string
  room:                string
  start_time:          string
  duration_min:        string
  days:                number[]
  dtstart:             string
  dtend:               string
  note:                string
}

const EMPTY_FORM: ScheduleFormData = {
  journal_type:        'activity',
  name:                '',
  activity_id:         '',
  merged_journal_id:   '',
  color:               '#6366f1',
  staff_id:            '',
  room:                '',
  start_time:          '09:00',
  duration_min:        '60',
  days:                [],
  dtstart:             todayStr(),
  dtend:               '',
  note:                '',
}

interface ScheduleFormProps {
  form:       ScheduleFormData
  setForm:    React.Dispatch<React.SetStateAction<ScheduleFormData>>
  isEdit:     boolean
  error:      string | null
  isSaving:   boolean
  onSave:     () => void
  onCancel:   () => void
}

function ScheduleForm({ form, setForm, isEdit, error, isSaving, onSave, onCancel }: ScheduleFormProps) {
  const { data: activities = [] } = useQuery({
    queryKey: ['activities-list'],
    queryFn:  () => activitiesApi.list(),
  })
  const { data: staffList = [] } = useQuery({
    queryKey: ['staff-list-active'],
    queryFn:  () => staffApi.list({ is_active: true }),
  })
  const { data: mergedJournals = [] } = useQuery({
    queryKey: ['merged-journals-list'],
    queryFn:  () => mergedJournalsApi.list(),
  })

  const toggleDay = (d: number) =>
    setForm(f => ({ ...f, days: f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d] }))

  const handleActivityChange = async (activityId: string) => {
    setForm(f => ({ ...f, activity_id: activityId }))
    if (!activityId) return
    try {
      const staffForActivity = await calendarApi.getStaffForActivity(activityId)
      if (staffForActivity.length > 0) {
        setForm(f => ({ ...f, staff_id: staffForActivity[0].id }))
      }
    } catch { /* ignore */ }
  }

  const isMerged = form.journal_type === 'merged'

  return (
    <div className="space-y-3">
      {/* Journal type toggle + color picker */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          {isMerged ? 'Об\'єднаний журнал *' : 'Активність *'}
        </label>
        <div className="flex items-center gap-2">
          {/* Type toggle */}
          {!isEdit && (
            <div className="flex rounded border border-gray-200 shrink-0 text-xs">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, journal_type: 'activity', merged_journal_id: '' }))}
                className={`px-2 py-1 rounded-l transition-colors ${!isMerged ? 'bg-iris-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                Активність
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, journal_type: 'merged', activity_id: '' }))}
                className={`px-2 py-1 rounded-r transition-colors ${isMerged ? 'bg-iris-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
              >
                ОЖ
              </button>
            </div>
          )}
          {/* Selector */}
          {isMerged ? (
            <select
              value={form.merged_journal_id}
              onChange={e => setForm(f => ({ ...f, merged_journal_id: e.target.value }))}
              disabled={isEdit}
              className="flex-1 min-w-0 rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500 disabled:bg-gray-100 disabled:text-gray-500"
            >
              <option value="">— оберіть журнал —</option>
              {mergedJournals.map((mj: { id: string; name: string }) => (
                <option key={mj.id} value={mj.id}>{mj.name}</option>
              ))}
            </select>
          ) : (
            <select
              value={form.activity_id}
              onChange={e => handleActivityChange(e.target.value)}
              disabled={isEdit}
              className="flex-1 min-w-0 rounded-lg border-gray-300 text-sm shadow-sm focus:border-iris-500 focus:ring-iris-500 disabled:bg-gray-100 disabled:text-gray-500"
            >
              <option value="">— оберіть активність —</option>
              {activities.map((a: { id: string; name: string }) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
          <input
            type="color"
            value={form.color}
            onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
            className="w-8 h-8 rounded border border-gray-300 cursor-pointer shrink-0 p-0.5"
            title="Колір заняття в календарі"
          />
        </div>
      </div>

      {/* Schedule name */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Назва заняття</label>
        <input
          type="text"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="залишити порожнім — буде назва активності"
          className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
        />
      </div>

      {/* Days of week */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Дні тижня *</label>
        <div className="flex gap-1">
          {ALL_DAYS.map(d => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={`flex-1 h-8 rounded-md text-xs font-semibold border transition-colors ${
                form.days.includes(d)
                  ? 'bg-iris-600 text-white border-iris-600'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-iris-300 hover:text-iris-600'
              }`}
            >
              {DAY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      {/* Time + Duration */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Час початку *</label>
          <input
            type="time"
            value={form.start_time}
            onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
            className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Тривалість (хв)</label>
          <input
            type="number"
            min="15"
            step="5"
            value={form.duration_min}
            onChange={e => setForm(f => ({ ...f, duration_min: e.target.value }))}
            className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
          />
        </div>
      </div>

      {/* Staff */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Педагог</label>
        <select
          value={form.staff_id}
          onChange={e => setForm(f => ({ ...f, staff_id: e.target.value }))}
          className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
        >
          <option value="">— без педагога —</option>
          {staffList.map((s: { id: string; full_name: string }) => (
            <option key={s.id} value={s.id}>{s.full_name}</option>
          ))}
        </select>
      </div>

      {/* Room */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Кімната / кабінет</label>
        <input
          type="text"
          value={form.room}
          onChange={e => setForm(f => ({ ...f, room: e.target.value }))}
          placeholder="напр. Кімната 1"
          className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
        />
      </div>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Дата початку *</label>
          <input
            type="date"
            value={form.dtstart}
            onChange={e => setForm(f => ({ ...f, dtstart: e.target.value }))}
            className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Дата завершення</label>
          <input
            type="date"
            value={form.dtend}
            onChange={e => setForm(f => ({ ...f, dtend: e.target.value }))}
            className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
          />
        </div>
      </div>

      {/* Note */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Примітка</label>
        <input
          type="text"
          value={form.note}
          onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
          className="w-full rounded-lg border-gray-300 text-sm shadow-sm"
          placeholder="необов'язково"
        />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onSave}
          disabled={isSaving}
          className="flex-1 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isSaving ? 'Збереження...' : isEdit ? 'Зберегти' : 'Додати розклад'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-gray-500 hover:text-gray-700 text-sm border border-gray-200 rounded-lg"
        >
          Скасувати
        </button>
      </div>
    </div>
  )
}

// ─── Schedule list item ────────────────────────────────────────────────────────

interface ScheduleItemProps {
  sched:    CalendarSchedule
  isEditing: boolean
  onEdit:   () => void
  onDelete: () => void
  isDeleting: boolean
}

function ScheduleItem({ sched, isEditing, onEdit, onDelete, isDeleting }: ScheduleItemProps) {
  const journalLabel = sched.merged_journal_id
    ? (sched.merged_journal_name ?? 'Об\'єднаний журнал')
    : (sched.activity_name ?? '')
  return (
    <div className={`rounded-lg border p-3 space-y-1 transition-colors ${isEditing ? 'border-iris-400 bg-iris-50' : 'border-gray-100 bg-gray-50 hover:border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-gray-900 truncate">{sched.name || journalLabel}</p>
            {sched.merged_journal_id && (
              <span className="shrink-0 text-[10px] font-medium px-1 py-0.5 rounded bg-purple-100 text-purple-600">ОЖ</span>
            )}
          </div>
          {sched.name && <p className="text-xs text-gray-400 truncate">{journalLabel}</p>}
          <p className="text-xs text-gray-600 mt-0.5">
            {daysToLabel(sched.rrule)}
            <span className="mx-1.5 text-gray-300">·</span>
            {String(sched.start_time).slice(0, 5)}
            <span className="mx-1.5 text-gray-300">·</span>
            {sched.duration_min} хв
          </p>
          {sched.staff_name && (
            <p className="text-xs text-gray-500 truncate">{sched.staff_name}</p>
          )}
          {sched.room && (
            <p className="text-xs text-gray-400 truncate">{sched.room}</p>
          )}
          <p className="text-xs text-gray-400">
            з {String(sched.dtstart).slice(0, 10)}
            {sched.dtend ? ` по ${String(sched.dtend).slice(0, 10)}` : ''}
          </p>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={onEdit}
            className={`text-xs px-2 py-1 rounded border transition-colors ${isEditing ? 'bg-iris-100 border-iris-300 text-iris-700' : 'border-gray-200 text-gray-400 hover:text-iris-600 hover:border-iris-300'}`}
          >
            Ред.
          </button>
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 disabled:opacity-40 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}



// ─── Move Dialog ───────────────────────────────────────────────────────────────

function MoveDialog({ onThisOnly, onAllFuture, onCancel }: { onThisOnly: () => void; onAllFuture: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl p-6 w-80 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900">Перенести заняття</h3>
        <p className="text-sm text-gray-500">Які заняття перенести?</p>
        <div className="space-y-2">
          <button onClick={onThisOnly}  className="w-full py-2.5 px-4 bg-iris-600 hover:bg-iris-700 text-white text-sm font-medium rounded-lg transition-colors">Тільки це заняття</button>
          <button onClick={onAllFuture} className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors">Це та всі наступні</button>
          <button onClick={onCancel}    className="w-full py-2 text-gray-400 hover:text-gray-700 text-sm">Скасувати</button>
        </div>
      </div>
    </div>
  )
}

// ─── Substitution Dialog ────────────────────────────────────────────────────────

function SubstitutionDialog({ occurrenceDate, onSave, onClose }: {
  occurrenceDate: string
  onSave: (d: { substitute_staff_id: string; rate_override: number; note?: string }) => void
  onClose: () => void
}) {
  const [staffId, setStaffId] = useState('')
  const [rate, setRate]       = useState('')
  const [note, setNote]       = useState('')
  const { data: staffList = [] } = useQuery({ queryKey: ['staff-list-active'], queryFn: () => staffApi.list({ is_active: true }) })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl border border-gray-200 shadow-xl p-6 w-96 space-y-4" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900">Замена педагога · {occurrenceDate}</h3>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Педагог-замена</label>
          <select value={staffId} onChange={e => setStaffId(e.target.value)} className="w-full rounded-lg border-gray-300 text-sm shadow-sm">
            <option value="">— оберіть педагога —</option>
            {staffList.map((s: { id: string; full_name: string }) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Ставка за заняття (грн)</label>
          <input type="number" min="0" step="0.01" value={rate} onChange={e => setRate(e.target.value)} className="w-full rounded-lg border-gray-300 text-sm shadow-sm" placeholder="напр. 350" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Примітка</label>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-lg border-gray-300 text-sm shadow-sm" placeholder="необов'язково" />
        </div>
        <div className="flex gap-3">
          <button onClick={() => { if (!staffId || !rate) return; onSave({ substitute_staff_id: staffId, rate_override: Number(rate), note: note || undefined }) }} disabled={!staffId || !rate} className="flex-1 py-2 bg-iris-600 hover:bg-iris-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">Зберегти</button>
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-900 text-sm">Скасувати</button>
        </div>
      </div>
    </div>
  )
}

// ─── Event popup ───────────────────────────────────────────────────────────────

function EventPopup({ event, pos, onOpenJournal, onAddSubstitution, onCancelOccurrence, onRestore, onClose }: {
  event: CalendarEvent
  pos:   { x: number; y: number }
  onOpenJournal:       () => void
  onAddSubstitution:   () => void
  onCancelOccurrence:  () => void
  onRestore:           () => void
  onClose:             () => void
}) {
  const statusLabel: Record<string, string> = { filled: 'Журнал заповнено', empty: 'Журнал не заповнено', future: 'Майбутнє заняття', cancelled: 'Скасовано' }
  const left = Math.min(pos.x, window.innerWidth  - 290)
  const top  = Math.min(pos.y, window.innerHeight - 300)

  return (
    <div className="fixed inset-0 z-40" onClick={onClose}>
      <div className="absolute bg-white rounded-xl border border-gray-200 shadow-xl p-4 w-68 space-y-3 z-50" style={{ left, top, width: 272 }} onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold text-gray-900 text-sm leading-tight">{event.activityName}</p>
            <p className="text-xs text-gray-500 mt-0.5">{event.date} · {event.startTime} · {event.durationMin} хв</p>
            {event.room      && <p className="text-xs text-gray-500">Кімната: {event.room}</p>}
            {event.staffName && <p className="text-xs text-gray-500">Педагог: {event.staffName}{event.substitute ? <span className="ml-1 text-amber-600 font-medium">(замена)</span> : null}</p>}
            <p className="text-xs mt-1 font-medium" style={{ color: STATUS_COLOR[event.journalStatus] }}>{statusLabel[event.journalStatus]}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 ml-2 text-base leading-none shrink-0">✕</button>
        </div>
        <div className="space-y-1.5 pt-1">
          {event.journalStatus !== 'cancelled' && (
            <button onClick={onOpenJournal} className="w-full py-2 px-3 bg-iris-600 hover:bg-iris-700 text-white text-xs font-medium rounded-lg text-left transition-colors">
              Відкрити журнал
            </button>
          )}
          {event.journalStatus !== 'cancelled' && (
            <button onClick={onAddSubstitution} className="w-full py-2 px-3 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-medium rounded-lg text-left border border-amber-200 transition-colors">
              {event.substitute ? 'Змінити заміну' : 'Призначити заміну'}
            </button>
          )}
          {event.journalStatus !== 'cancelled' && (
            <button onClick={onCancelOccurrence} className="w-full py-2 px-3 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-medium rounded-lg text-left border border-red-200 transition-colors">
              Скасувати це заняття
            </button>
          )}
          {event.journalStatus === 'cancelled' && event.isException && (
            <button onClick={onRestore} className="w-full py-2 px-3 bg-green-50 hover:bg-green-100 text-green-700 text-xs font-medium rounded-lg text-left border border-green-200 transition-colors">
              Відновити заняття
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export function CalendarPage() {
  const qc = useQueryClient()
  const calendarRef = useRef<FullCalendar>(null)

  const [dateRange, setDateRange] = useState<{ from: string; to: string }>(() => {
    const today = new Date()
    return {
      from: toDateStr(new Date(today.getFullYear(), today.getMonth(), 1)),
      to:   toDateStr(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    }
  })

  const [calView, setCalView] = useState<'timeGridWeek' | 'timeGridDay' | 'dayGridMonth'>('timeGridWeek')

  // Panel state
  const [panelMode, setPanelMode]   = useState<'list' | 'new' | 'edit'>('list')
  const [editingSched, setEditingSched] = useState<CalendarSchedule | null>(null)
  const [form, setForm]             = useState<ScheduleFormData>(EMPTY_FORM)
  const [formError, setFormError]   = useState<string | null>(null)

  // Modals
  const [moveDialog,    setMoveDialog]    = useState<{ scheduleId: string; origDate: string; newDate: string; newTime?: string } | null>(null)
  const [subDialog,     setSubDialog]     = useState<{ scheduleId: string; date: string; origStaffId: string | null } | null>(null)
  const [eventPopup,    setEventPopup]    = useState<{ event: CalendarEvent; pos: { x: number; y: number } } | null>(null)

  // Queries
  const { data: events    = [] } = useQuery({ queryKey: ['cal-events', dateRange.from, dateRange.to], queryFn: () => calendarApi.getEvents(dateRange.from, dateRange.to) })
  const { data: schedules = [] } = useQuery({ queryKey: ['cal-schedules'], queryFn: calendarApi.getSchedules })

  const refetchEvents = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['cal-events', dateRange.from, dateRange.to] })
  }, [qc, dateRange])

  const refetchAll = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['cal-events'] })
    qc.invalidateQueries({ queryKey: ['cal-schedules'] })
  }, [qc])

  // Mutations
  const createMutation = useMutation({
    mutationFn: () => calendarApi.createSchedule({
      activity_id:        form.journal_type === 'activity' ? (form.activity_id || undefined) : undefined,
      merged_journal_id:  form.journal_type === 'merged'   ? (form.merged_journal_id || undefined) : undefined,
      name:               form.name         || undefined,
      staff_id:           form.staff_id     || undefined,
      room:               form.room         || undefined,
      start_time:         form.start_time,
      duration_min:       Number(form.duration_min),
      days:               form.days,
      dtstart:            form.dtstart,
      dtend:              form.dtend        || undefined,
      color:              form.color        || undefined,
      note:               form.note         || undefined,
    }),
    onSuccess: () => { refetchAll(); setPanelMode('list'); setForm(EMPTY_FORM); setFormError(null) },
    onError:   () => setFormError('Помилка при збереженні'),
  })

  const updateMutation = useMutation({
    mutationFn: (id: string) => calendarApi.updateSchedule(id, {
      name:         form.name         || null,
      staff_id:     form.staff_id     || null,
      room:         form.room         || null,
      start_time:   form.start_time,
      duration_min: Number(form.duration_min),
      days:         form.days,
      dtstart:      form.dtstart,
      dtend:        form.dtend        || null,
      color:        form.color        || null,
      note:         form.note         || null,
    }),
    onSuccess: () => { refetchAll(); setPanelMode('list'); setEditingSched(null); setFormError(null) },
    onError:   () => setFormError('Помилка при збереженні'),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => calendarApi.deactivateSchedule(id),
    onSuccess:  refetchAll,
  })

  const exceptionMutation = useMutation({
    mutationFn: ({ scheduleId, payload }: { scheduleId: string; payload: Parameters<typeof calendarApi.createException>[1] }) =>
      calendarApi.createException(scheduleId, payload),
    onSuccess: refetchEvents,
  })

  const deleteExceptionMutation = useMutation({
    mutationFn: ({ scheduleId, date }: { scheduleId: string; date: string }) => calendarApi.deleteException(scheduleId, date),
    onSuccess: refetchEvents,
  })

  const subMutation = useMutation({
    mutationFn: ({ scheduleId, payload }: { scheduleId: string; payload: Parameters<typeof calendarApi.createSubstitution>[1] }) =>
      calendarApi.createSubstitution(scheduleId, payload),
    onSuccess: () => { setSubDialog(null); refetchEvents() },
  })

  // Form validation & submit
  const handleSave = () => {
    if (form.journal_type === 'activity' && !form.activity_id)   { setFormError('Оберіть активність'); return }
    if (form.journal_type === 'merged'   && !form.merged_journal_id) { setFormError('Оберіть об\'єднаний журнал'); return }
    if (form.days.length === 0) { setFormError('Оберіть хоча б один день тижня'); return }
    if (!form.start_time)       { setFormError('Вкажіть час початку'); return }
    if (!form.dtstart)          { setFormError('Вкажіть дату початку'); return }
    if (panelMode === 'edit' && editingSched) updateMutation.mutate(editingSched.id)
    else createMutation.mutate()
  }

  const startEdit = (sched: CalendarSchedule) => {
    setForm({
      journal_type:      sched.merged_journal_id ? 'merged' : 'activity',
      name:              sched.name              ?? '',
      activity_id:       sched.activity_id       ?? '',
      merged_journal_id: sched.merged_journal_id ?? '',
      color:             sched.color             ?? '#6366f1',
      staff_id:          sched.staff_id          ?? '',
      room:              sched.room              ?? '',
      start_time:        String(sched.start_time).slice(0, 5),
      duration_min:      String(sched.duration_min),
      days:              parseRRuleDays(sched.rrule),
      dtstart:           String(sched.dtstart).slice(0, 10),
      dtend:             sched.dtend ? String(sched.dtend).slice(0, 10) : '',
      note:              sched.note              ?? '',
    })
    setEditingSched(sched)
    setPanelMode('edit')
    setFormError(null)
  }

  const cancelForm = () => {
    setPanelMode('list')
    setEditingSched(null)
    setForm(EMPTY_FORM)
    setFormError(null)
  }

  // FullCalendar events
  const fcEvents: EventInput[] = events.map(ev => {
    const [h, m] = ev.startTime.split(':').map(Number)
    const startDt  = `${ev.date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`
    const endTotal = h * 60 + m + (ev.durationMin || 0)
    const endH     = String(Math.floor(endTotal / 60) % 24).padStart(2, '0')
    const endM     = String(endTotal % 60).padStart(2, '0')
    const endDt    = `${ev.date}T${endH}:${endM}:00`
    const bgColor  = ev.color ?? '#6b7280'
    return { id: ev.id, title: ev.scheduleName || ev.activityName, start: startDt, end: endDt, backgroundColor: bgColor, borderColor: bgColor, textColor: '#fff', extendedProps: ev }
  })

  const handleEventClick = (info: EventClickArg) => {
    const ev   = info.event.extendedProps as CalendarEvent
    const rect = info.el.getBoundingClientRect()
    setEventPopup({ event: ev, pos: { x: rect.left, y: rect.bottom + 6 } })
  }

  const handleEventDrop = (info: EventDropArg) => {
    const ev      = info.event.extendedProps as CalendarEvent
    const newDate = toDateStr(info.event.start!)
    const newTime = info.event.start!.toTimeString().slice(0, 5)
    if (newDate === ev.date) { info.revert(); return }
    setMoveDialog({ scheduleId: ev.scheduleId, origDate: ev.date, newDate, newTime })
    info.revert()
  }

  const handleDatesSet = (arg: DatesSetArg) => {
    setDateRange({ from: toDateStr(arg.start), to: toDateStr(new Date(arg.end.getTime() - 1)) })
  }

  const goView = (v: typeof calView) => { setCalView(v); calendarRef.current?.getApi().changeView(v) }

  const closePopup = () => setEventPopup(null)

  const isFormOpen = panelMode === 'new' || panelMode === 'edit'
  const isSaving   = createMutation.isPending || updateMutation.isPending

  return (
    <div className="flex gap-4 items-start">

      {/* ── Left panel: schedule management ── */}
      <div className="w-72 shrink-0 space-y-3">
        <div className="bg-white rounded-xl border border-gray-200 p-4">

          {/* Panel header */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Розклади занять</h2>
            {panelMode === 'list' && (
              <button
                onClick={() => { setForm(EMPTY_FORM); setFormError(null); setPanelMode('new') }}
                className="flex items-center gap-1 text-xs font-semibold text-white bg-iris-600 hover:bg-iris-700 px-3 py-1.5 rounded-lg transition-colors"
              >
                + Новий
              </button>
            )}
          </div>

          {/* Form (new or edit) */}
          {isFormOpen && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-iris-700 mb-3 uppercase tracking-wide">
                {panelMode === 'new' ? 'Новий розклад' : `Редагування: ${editingSched?.merged_journal_id ? (editingSched.merged_journal_name ?? 'ОЖ') : (editingSched?.activity_name ?? '')}`}
              </p>
              <ScheduleForm
                form={form}
                setForm={setForm}
                isEdit={panelMode === 'edit'}
                error={formError}
                isSaving={isSaving}
                onSave={handleSave}
                onCancel={cancelForm}
              />
            </div>
          )}

          {/* Schedule list */}
          {panelMode === 'list' && (
            <div className="space-y-2 max-h-[calc(100vh-220px)] overflow-y-auto">
              {schedules.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  <p className="text-sm">Розклад порожній</p>
                  <p className="text-xs mt-1">Натисніть «+ Новий» щоб додати заняття</p>
                </div>
              )}
              {schedules.map(sched => (
                <ScheduleItem
                  key={sched.id}
                  sched={sched}
                  isEditing={editingSched?.id === sched.id}
                  onEdit={() => startEdit(sched)}
                  onDelete={() => deactivateMutation.mutate(sched.id)}
                  isDeleting={deactivateMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Статуси</p>
          {Object.entries({ filled: 'Журнал заповнено', empty: 'Не заповнено', future: 'Майбутнє', cancelled: 'Скасовано' }).map(([k, label]) => (
            <div key={k} className="flex items-center gap-2 text-xs text-gray-600">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: STATUS_COLOR[k] }} />
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: calendar ── */}
      <div className="flex-1 min-w-0 space-y-3">
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">Календар занять</h1>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            {([
              { key: 'dayGridMonth',  label: 'Місяць' },
              { key: 'timeGridWeek',  label: 'Тиждень' },
              { key: 'timeGridDay',   label: 'День' },
            ] as { key: typeof calView; label: string }[]).map(v => (
              <button
                key={v.key}
                onClick={() => goView(v.key)}
                className={`px-3 py-1.5 font-medium transition-colors ${calView === v.key ? 'bg-iris-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* Calendar */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="timeGridWeek"
            locale="uk"
            firstDay={1}
            slotMinTime="07:00:00"
            slotMaxTime="22:00:00"
            allDaySlot={false}
            editable={true}
            events={fcEvents}
            datesSet={handleDatesSet}
            eventClick={handleEventClick}
            eventDrop={handleEventDrop}
            headerToolbar={{ left: 'prev,next today', center: 'title', right: '' }}
            buttonText={{ today: 'Сьогодні' }}
            eventContent={arg => {
              const ev = arg.event.extendedProps as CalendarEvent
              const dotColor = STATUS_DOT_COLOR[ev.journalStatus] ?? '#e5e7eb'
              return (
                <div className="px-1 py-0.5 h-full flex flex-col gap-0.5 overflow-hidden">
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                    <span className="text-xs font-semibold truncate leading-tight">{arg.event.title}</span>
                  </div>
                  {ev.staffName && <div className="text-xs opacity-90 truncate">{ev.staffName}{ev.substitute ? ' (з)' : ''}</div>}
                  {ev.room      && <div className="text-xs opacity-75 truncate">{ev.room}</div>}
                </div>
              )
            }}
            height="auto"
          />
        </div>
      </div>

      {/* ── Modals ── */}



      {moveDialog && (
        <MoveDialog
          onThisOnly={() => {
            exceptionMutation.mutate({ scheduleId: moveDialog.scheduleId, payload: { original_date: moveDialog.origDate, exception_type: 'moved', new_date: moveDialog.newDate, new_start_time: moveDialog.newTime } })
            setMoveDialog(null)
          }}
          onAllFuture={async () => {
            const prevDay = toDateStr(new Date(new Date(moveDialog.origDate).getTime() - 86_400_000))
            try {
              const sched = schedules.find(s => s.id === moveDialog.scheduleId)
              if (sched) {
                await calendarApi.updateSchedule(moveDialog.scheduleId, { dtend: prevDay })
                await calendarApi.createSchedule({
                  activity_id:       sched.activity_id       ?? undefined,
                  merged_journal_id: sched.merged_journal_id ?? undefined,
                  staff_id:          sched.staff_id          ?? undefined,
                  room:              sched.room              ?? undefined,
                  start_time:        moveDialog.newTime ?? String(sched.start_time).slice(0, 5),
                  duration_min:      sched.duration_min,
                  days:              parseRRuleDays(sched.rrule),
                  dtstart:           moveDialog.newDate,
                })
              }
            } finally { setMoveDialog(null); refetchAll() }
          }}
          onCancel={() => setMoveDialog(null)}
        />
      )}

      {subDialog && (
        <SubstitutionDialog
          occurrenceDate={subDialog.date}
          onSave={payload => subMutation.mutate({ scheduleId: subDialog.scheduleId, payload: { ...payload, occurrence_date: subDialog.date } })}
          onClose={() => setSubDialog(null)}
        />
      )}

      {eventPopup && (
        <EventPopup
          event={eventPopup.event}
          pos={eventPopup.pos}
          onClose={closePopup}
          onOpenJournal={() => {
            const ev = eventPopup.event
            const url = ev.mergedJournalId
              ? `/journals/merged/${ev.mergedJournalId}?mode=day&date=${ev.date}`
              : `/journals/${ev.activityId}?mode=day&date=${ev.date}`
            window.open(url, '_blank')
            closePopup()
          }}
          onAddSubstitution={() => { setSubDialog({ scheduleId: eventPopup.event.scheduleId, date: eventPopup.event.date, origStaffId: eventPopup.event.staffId }); closePopup() }}
          onCancelOccurrence={() => {
            exceptionMutation.mutate({ scheduleId: eventPopup.event.scheduleId, payload: { original_date: eventPopup.event.originalDate ?? eventPopup.event.date, exception_type: 'cancelled' } })
            closePopup()
          }}
          onRestore={() => {
            if (eventPopup.event.originalDate) deleteExceptionMutation.mutate({ scheduleId: eventPopup.event.scheduleId, date: eventPopup.event.originalDate })
            closePopup()
          }}
        />
      )}
    </div>
  )
}
