import { apiClient } from './client'
import type { AttendanceLog, AttendanceStatus, JournalData } from '../types'

export const attendanceApi = {
  getJournal: async (activityId: string, from: string, to: string) => {
    const params = new URLSearchParams({ activity_id: activityId, from, to })
    const { data } = await apiClient.get<JournalData>(`/journals?${params}`)
    return data
  },

  mark: async (payload: {
    enrollment_id: string
    date: string
    status: AttendanceStatus
    custom_amount?: number | null
    note?: string | null
  }) => {
    const { data } = await apiClient.post<AttendanceLog>('/journals/attendance', payload)
    return data
  },

  update: async (id: string, payload: {
    status: AttendanceStatus
    custom_amount?: number | null
    note?: string | null
  }) => {
    const { data } = await apiClient.put<AttendanceLog>(`/journals/attendance/${id}`, payload)
    return data
  },

  remove: async (id: string) => {
    await apiClient.delete(`/journals/attendance/${id}`)
  },

  markGroup: async (payload: { activity_id: string; date: string; status: 'conducted' | 'cancelled'; lessons_count?: number }) => {
    const { data } = await apiClient.post<import('../types').GroupLessonLog>('/journals/group-attendance', payload)
    return data
  },

  removeGroup: async (id: string) => {
    await apiClient.delete(`/journals/group-attendance/${id}`)
  },
}
