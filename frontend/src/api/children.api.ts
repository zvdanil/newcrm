import { apiClient } from './client'
import type { Child, PaginatedResponse } from '../types'

export interface ChildrenFilters {
  search?: string
  group_id?: string
  is_active?: boolean
  limit?: number
  offset?: number
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
}
