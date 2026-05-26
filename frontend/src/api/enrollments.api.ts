import { apiClient } from './client'
import type { Enrollment, PriceResolution } from '../types'

export interface RebindPayment {
  id: string
  date: string
  amount: number
  note: string | null
}

export const enrollmentsApi = {
  listByChild: async (childId: string) => {
    const { data } = await apiClient.get<Enrollment[]>(`/children/${childId}/enrollments`)
    return data
  },

  create: async (payload: { child_id: string; activity_id: string; account_id: string; start_date: string; end_date?: string; note?: string }) => {
    const { data } = await apiClient.post<Enrollment>('/enrollments', payload)
    return data
  },

  update: async (id: string, payload: { account_id?: string; start_date?: string; end_date?: string | null; note?: string | null }) => {
    const { data } = await apiClient.put<Enrollment>(`/enrollments/${id}`, payload)
    return data
  },

  freeze: async (id: string, payload: { frozen_from: string; frozen_to: string }) => {
    const { data } = await apiClient.post<Enrollment>(`/enrollments/${id}/freeze`, payload)
    return data
  },

  unfreeze: async (id: string) => {
    const { data } = await apiClient.post<Enrollment>(`/enrollments/${id}/unfreeze`, {})
    return data
  },

  archive: async (id: string, payload: { end_date?: string; cancel_month_accruals?: boolean } = {}) => {
    const { data } = await apiClient.post<Enrollment>(`/enrollments/${id}/archive`, payload)
    return data
  },

  resolvePrice: async (childId: string, activityId: string, date?: string) => {
    const params = new URLSearchParams({ child_id: childId, activity_id: activityId })
    if (date) params.set('date', date)
    const { data } = await apiClient.get<PriceResolution>(`/price-resolve?${params}`)
    return data
  },

  rebindAccount: async (
    id: string,
    payload: {
      new_account_id: string
      from_month: string
      to_month?: string
      update_future?: boolean
      force?: boolean
    }
  ): Promise<{ moved_count: number; updated_enrollment: boolean }> => {
    const { data } = await apiClient.post<{ moved_count: number; updated_enrollment: boolean }>(
      `/enrollments/${id}/rebind-account`,
      payload
    )
    return data
  },
}
