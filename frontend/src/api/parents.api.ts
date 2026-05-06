import { apiClient } from './client'
import type { Parent, PaginatedResponse } from '../types'

export const parentsApi = {
  list: async (params: { search?: string } = {}) => {
    const query = new URLSearchParams()
    if (params.search) query.set('search', params.search)
    query.set('limit', '500')
    const { data } = await apiClient.get<PaginatedResponse<Parent>>(`/parents?${query}`)
    return data
  },

  create: async (payload: { full_name: string; phone?: string; email?: string; note?: string }) => {
    const { data } = await apiClient.post<Parent>('/parents', payload)
    return data
  },
}
