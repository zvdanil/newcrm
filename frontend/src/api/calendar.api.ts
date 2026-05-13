import { apiClient } from './client'

export interface CalendarEvent {
  id:           string
  scheduleId:   string
  activityId:   string
  activityName: string
  date:         string
  startTime:    string   // HH:MM
  durationMin:  number
  room:         string | null
  staffId:      string | null
  staffName:    string | null
  journalStatus: 'future' | 'filled' | 'empty' | 'cancelled'
  isException:  boolean
  originalDate: string | null
  color:        string | null
  substitute:   {
    staffId:         string
    staffName:       string
    originalStaffId: string | null
    rateOverride:    number
  } | null
}

export interface CalendarSchedule {
  id:           string
  activity_id:  string
  activity_name: string
  staff_id:     string | null
  staff_name:   string | null
  room:         string | null
  start_time:   string
  duration_min: number
  rrule:        string
  dtstart:      string
  dtend:        string | null
  color:        string | null
  is_active:    boolean
  note:         string | null
}

export interface ConflictResult {
  scheduleId:   string
  activityId:   string
  activityName: string
  staffId:      string | null
  staffName:    string | null
  room:         string | null
  startTime:    string
  durationMin:  number
  conflictType: 'staff' | 'room' | 'both'
}

export const calendarApi = {
  getEvents: async (from: string, to: string): Promise<CalendarEvent[]> => {
    const params = new URLSearchParams({ from, to })
    const { data } = await apiClient.get<CalendarEvent[]>(`/calendar/events?${params}`)
    return data
  },

  getSchedules: async (): Promise<CalendarSchedule[]> => {
    const { data } = await apiClient.get<CalendarSchedule[]>('/calendar/schedules')
    return data
  },

  getSchedulesByActivity: async (activityId: string): Promise<CalendarSchedule[]> => {
    const params = new URLSearchParams({ activity_id: activityId })
    const { data } = await apiClient.get<CalendarSchedule[]>(`/calendar/schedules/by-activity?${params}`)
    return data
  },

  createSchedule: async (payload: {
    activity_id:  string
    staff_id?:    string
    room?:        string
    start_time:   string
    duration_min?: number
    days:         number[]
    dtstart:      string
    dtend?:       string
    color?:       string
    note?:        string
  }): Promise<CalendarSchedule> => {
    const { data } = await apiClient.post<CalendarSchedule>('/calendar/schedules', payload)
    return data
  },

  updateSchedule: async (id: string, payload: {
    staff_id?:     string | null
    room?:         string | null
    start_time?:   string
    duration_min?: number
    days?:         number[]
    dtend?:        string | null
    color?:        string | null
    note?:         string | null
  }): Promise<CalendarSchedule> => {
    const { data } = await apiClient.put<CalendarSchedule>(`/calendar/schedules/${id}`, payload)
    return data
  },

  deactivateSchedule: async (id: string): Promise<void> => {
    await apiClient.delete(`/calendar/schedules/${id}`)
  },

  createException: async (scheduleId: string, payload: {
    original_date:   string
    exception_type:  'cancelled' | 'moved'
    new_date?:       string
    new_start_time?: string
    note?:           string
  }): Promise<void> => {
    await apiClient.post(`/calendar/schedules/${scheduleId}/exceptions`, payload)
  },

  deleteException: async (scheduleId: string, originalDate: string): Promise<void> => {
    await apiClient.delete(`/calendar/schedules/${scheduleId}/exceptions/${originalDate}`)
  },

  createSubstitution: async (scheduleId: string, payload: {
    occurrence_date:     string
    substitute_staff_id: string
    rate_override:       number
    note?:               string
  }): Promise<void> => {
    await apiClient.post(`/calendar/schedules/${scheduleId}/substitutions`, payload)
  },

  deleteSubstitution: async (scheduleId: string, date: string): Promise<void> => {
    await apiClient.delete(`/calendar/schedules/${scheduleId}/substitutions/${date}`)
  },

  getConflicts: async (params: {
    staff_id?:           string
    room?:               string
    date:                string
    start_time:          string
    duration_min:        number
    exclude_schedule_id?: string
  }): Promise<ConflictResult[]> => {
    const q = new URLSearchParams()
    if (params.staff_id)           q.set('staff_id',           params.staff_id)
    if (params.room)               q.set('room',               params.room)
    if (params.exclude_schedule_id) q.set('exclude_schedule_id', params.exclude_schedule_id)
    q.set('date',         params.date)
    q.set('start_time',   params.start_time)
    q.set('duration_min', String(params.duration_min))
    const { data } = await apiClient.get<ConflictResult[]>(`/calendar/conflicts?${q}`)
    return data
  },
}
