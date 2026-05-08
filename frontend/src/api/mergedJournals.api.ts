import { apiClient } from './client'

export interface MergedJournal {
  id:             string
  name:           string
  note:           string | null
  created_at:     string
  activity_count: string
}

export interface MergedJournalActivity {
  id:          string
  name:        string
  tariff_type: string
  is_active:   boolean
  sort_order:  number
}

export interface MergedJournalRow {
  enrollment_id: string
  child_id:      string
  child_name:    string
  activity_id:   string
  group_id:      string | null
  group_name:    string | null
  status:        string
  frozen_from:   string | null
  frozen_to:     string | null
  logs:          Record<string, {
    id: string
    status: string
    custom_amount: string | null
    note: string | null
  }>
}

export interface MergedJournalResponse {
  merged_journal: MergedJournal
  activities:     MergedJournalActivity[]
  dates:          string[]
  rows:           MergedJournalRow[]
}

export const mergedJournalsApi = {
  list: async (): Promise<MergedJournal[]> => {
    const { data } = await apiClient.get<MergedJournal[]>('/merged-journals')
    return data
  },

  create: async (payload: { name: string; note?: string; activity_ids?: string[] }): Promise<MergedJournal> => {
    const { data } = await apiClient.post<MergedJournal>('/merged-journals', payload)
    return data
  },

  update: async (id: string, payload: { name?: string; note?: string }): Promise<MergedJournal> => {
    const { data } = await apiClient.put<MergedJournal>(`/merged-journals/${id}`, payload)
    return data
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/merged-journals/${id}`)
  },

  getActivities: async (id: string): Promise<MergedJournalActivity[]> => {
    const { data } = await apiClient.get<MergedJournalActivity[]>(`/merged-journals/${id}/activities`)
    return data
  },

  addActivity: async (id: string, activity_id: string): Promise<void> => {
    await apiClient.post(`/merged-journals/${id}/activities`, { activity_id })
  },

  removeActivity: async (id: string, activityId: string): Promise<void> => {
    await apiClient.delete(`/merged-journals/${id}/activities/${activityId}`)
  },

  getJournal: async (id: string, from: string, to: string): Promise<MergedJournalResponse> => {
    const { data } = await apiClient.get<MergedJournalResponse>(
      `/merged-journals/${id}/journal?from=${from}&to=${to}`
    )
    return data
  },
}
