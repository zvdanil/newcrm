import { apiClient } from './client'
import type { Family, PaginatedResponse } from '../types'

export const familiesApi = {
  list: async (params: { search?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams()
    if (params.search)  query.set('search', params.search)
    query.set('limit',  String(params.limit  ?? 500))
    query.set('offset', String(params.offset ?? 0))
    const { data } = await apiClient.get<PaginatedResponse<Family>>(`/families?${query}`)
    return data
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<Family>(`/families/${id}`)
    return data
  },

  create: async (payload: { name: string; primary_parent_id: string; note?: string }) => {
    const { data } = await apiClient.post<Family>('/families', payload)
    return data
  },

  addMember: async (familyId: string, parentId: string) => {
    await apiClient.post(`/families/${familyId}/members`, { parent_id: parentId })
  },
}
