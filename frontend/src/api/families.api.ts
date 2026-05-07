import { apiClient } from './client'
import type { Family, PaginatedResponse } from '../types'

export interface ChildDebt {
  child_id: string
  child_name: string
  account_id: string
  balance: number
  debt: number
  oldest_accrual_date: string | null
}

export interface FamilyDebtsResponse {
  debts: ChildDebt[]
  total_debt: number
}

export interface WaterfallAllocation {
  child_id: string
  child_name: string
  amount: number
  tx_id: string
}

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

  getDebts: async (familyId: string, accountId: string): Promise<FamilyDebtsResponse> => {
    const { data } = await apiClient.get<FamilyDebtsResponse>(`/families/${familyId}/debts?account_id=${accountId}`)
    return data
  },

  payment: async (familyId: string, payload: {
    account_id: string
    payment_account_id?: string
    amount: number
    transaction_date?: string
    note?: string
    advance_child_id?: string
    manual_match?: { child_id: string; amount: number }[]
  }): Promise<{ ok: boolean; allocations: WaterfallAllocation[]; cross_account: boolean }> => {
    const { data } = await apiClient.post(`/families/${familyId}/payment`, payload)
    return data
  },
}
