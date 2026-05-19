import { apiClient } from './client'
import type { Child, PaginatedResponse } from '../types'

export interface ChildrenFilters {
  search?: string
  group_id?: string
  is_active?: boolean
  limit?: number
  offset?: number
}

export type IndTariffType = 'monthly' | 'per_lesson' | 'smart'

export interface IndividualTariff {
  id:                    string
  activity_id:           string
  tariff_type:           IndTariffType
  price:                 string
  valid_from:            string
  valid_to:              string | null
  created_at:            string
  base_lessons:          number | null
  l1_threshold_absences: number | null
  l1_threshold_fee:      string | null
  l2_max_refunds:        number | null
  l2_refund_per_absence: string | null
}

export interface IndividualTariffPayload {
  activity_id:            string
  tariff_type:            IndTariffType
  price:                  number
  valid_from:             string
  base_lessons?:          number
  l1_threshold_absences?: number | null
  l1_threshold_fee?:      number | null
  l2_max_refunds?:        number | null
  l2_refund_per_absence?: number | null
}

export interface OpenAccrual {
  id: string
  transaction_date: string
  billing_month: string | null
  activity_name: string | null
  amount: number
  remaining: number
}

export const childrenApi = {
  list: async (filters: ChildrenFilters = {}) => {
    const params = new URLSearchParams()
    if (filters.search)    params.set('search', filters.search)
    if (filters.group_id)  params.set('group_id', filters.group_id)
    if (filters.is_active !== undefined) params.set('is_active', String(filters.is_active))
    params.set('limit',  String(filters.limit  ?? 500))
    params.set('offset', String(filters.offset ?? 0))

    const { data } = await apiClient.get<PaginatedResponse<Child>>(`/children?${params}`)
    return data
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<Child>(`/children/${id}`)
    return data
  },

  create: async (payload: Partial<Child>) => {
    const { data } = await apiClient.post<Child>('/children', payload)
    return data
  },

  update: async (id: string, payload: Partial<Child>) => {
    const { data } = await apiClient.put<Child>(`/children/${id}`, payload)
    return data
  },

  listIndividualTariffs: async (childId: string): Promise<IndividualTariff[]> => {
    const { data } = await apiClient.get<IndividualTariff[]>(`/children/${childId}/individual-tariffs`)
    return data
  },

  setIndividualTariff: async (childId: string, payload: IndividualTariffPayload): Promise<void> => {
    await apiClient.post(`/children/${childId}/individual-tariffs`, payload)
  },

  updateSmartConfig: async (childId: string, tariffId: string, config: {
    base_lessons?: number
    l1_threshold_absences?: number | null
    l1_threshold_fee?: number | null
    l2_max_refunds?: number | null
    l2_refund_per_absence?: number | null
  }): Promise<void> => {
    await apiClient.put(`/children/${childId}/individual-tariffs/${tariffId}/smart-config`, config)
  },

  closeIndividualTariff: async (childId: string, tariffId: string, validTo?: string): Promise<void> => {
    const params = validTo ? `?valid_to=${validTo}` : ''
    await apiClient.delete(`/children/${childId}/individual-tariffs/${tariffId}${params}`)
  },

  getOpenAccruals: async (childId: string, accountId: string): Promise<OpenAccrual[]> => {
    const { data } = await apiClient.get<OpenAccrual[]>(`/children/${childId}/open-accruals?account_id=${accountId}`)
    return data
  },

  createEnrollment: async (childId: string, payload: {
    activity_id: string
    account_id: string
    start_date: string
    end_date?: string
    note?: string
  }) => {
    const { data } = await apiClient.post('/enrollments', { ...payload, child_id: childId })
    return data
  },
}
