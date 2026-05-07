import { apiClient } from './client'
import type { Account } from '../types'

export const accountsApi = {
  list: async () => {
    const { data } = await apiClient.get<Account[]>('/accounts')
    return data
  },

  get: async (id: string) => {
    const { data } = await apiClient.get<Account>(`/accounts/${id}`)
    return data
  },

  create: async (payload: { name: string; type: 'fop' | 'cash' | 'bank'; currency?: string; note?: string }) => {
    const { data } = await apiClient.post<Account>('/accounts', payload)
    return data
  },

  update: async (id: string, payload: Partial<Pick<Account, 'name' | 'type' | 'currency' | 'note' | 'is_active'>>) => {
    const { data } = await apiClient.put<Account>(`/accounts/${id}`, payload)
    return data
  },
}
