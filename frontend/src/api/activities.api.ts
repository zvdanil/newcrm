import { apiClient } from './client'
import type { Activity, Tariff, RefundConfig, SmartTariffConfig } from '../types'

export const activitiesApi = {
  list: async (includeArchived = false) => {
    const { data } = await apiClient.get<Activity[]>(`/activities${includeArchived ? '?include_archived=true' : ''}`)
    return data
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<Activity>(`/activities/${id}`)
    return data
  },

  create: async (payload: { name: string; account_id?: string; tariff_type?: 'monthly' | 'per_lesson' | 'smart'; is_rigid?: boolean; note?: string; base_fee?: number }) => {
    const { data } = await apiClient.post<Activity>('/activities', payload)
    return data
  },

  update: async (id: string, payload: Partial<Pick<Activity, 'name' | 'account_id' | 'tariff_type' | 'is_rigid' | 'is_active' | 'note'>>) => {
    const { data } = await apiClient.put<Activity>(`/activities/${id}`, payload)
    return data
  },

  getTariffHistory: async (id: string) => {
    const { data } = await apiClient.get<Tariff[]>(`/activities/${id}/tariff-history`)
    return data
  },

  setTariff: async (id: string, payload: { base_fee: number; valid_from?: string }) => {
    const { data } = await apiClient.post<Tariff>(`/activities/${id}/tariff`, payload)
    return data
  },

  getRefundConfig: async (id: string) => {
    const { data } = await apiClient.get<RefundConfig | null>(`/activities/${id}/refund-config`)
    return data
  },

  setRefundConfig: async (id: string, payload: { refund_on_excused: boolean; refund_amount?: number | null; refund_pct?: number | null; note?: string | null }) => {
    const { data } = await apiClient.put<RefundConfig>(`/activities/${id}/refund-config`, payload)
    return data
  },

  link: async (parentId: string, childId: string) => {
    await apiClient.post(`/activities/${parentId}/link`, { child_activity_id: childId })
  },

  unlink: async (parentId: string, childId: string) => {
    await apiClient.delete(`/activities/${parentId}/link/${childId}`)
  },

  getSmartTariff: async (id: string): Promise<SmartTariffConfig | null> => {
    const { data } = await apiClient.get<SmartTariffConfig | null>(`/activities/${id}/smart-tariff`)
    return data
  },

  setSmartTariff: async (id: string, payload: {
    base_lessons?: number
    l1_threshold_absences?: number | null
    l1_threshold_fee?: number | null
    l2_max_refunds?: number | null
    l2_refund_per_absence?: number | null
  }): Promise<SmartTariffConfig> => {
    const { data } = await apiClient.put<SmartTariffConfig>(`/activities/${id}/smart-tariff`, payload)
    return data
  },

  retroRecalc: async (id: string, from_date: string): Promise<{ adjusted: number; skipped: number }> => {
    const { data } = await apiClient.post<{ adjusted: number; skipped: number }>(`/activities/${id}/retro-recalc`, { from_date })
    return data
  },
}
