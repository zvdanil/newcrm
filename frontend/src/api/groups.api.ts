import { apiClient } from './client'
import type { Group } from '../types'

export const groupsApi = {
  list: async (includeArchived = false) => {
    const params = includeArchived ? '?include_archived=true' : ''
    const { data } = await apiClient.get<Group[]>(`/groups${params}`)
    return data
  },

  create: async (payload: { name: string; sort_order?: number }) => {
    const { data } = await apiClient.post<Group>('/groups', payload)
    return data
  },

  update: async (id: string, payload: { name?: string; sort_order?: number }) => {
    const { data } = await apiClient.put<Group>(`/groups/${id}`, payload)
    return data
  },

  archive: async (id: string) => {
    await apiClient.delete(`/groups/${id}`)
  },

  restore: async (id: string) => {
    await apiClient.post(`/groups/${id}/restore`, {})
  },
}
