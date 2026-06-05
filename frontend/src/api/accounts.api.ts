import { apiClient } from './client'
import type { Account } from '../types'

export interface AccountWithBalance extends Account {
  balance: string
  open_imbalances?: number
}

export type LedgerKind = 'payment' | 'expense' | 'salary_payment' | 'transfer_in' | 'transfer_out' | 'cross_in' | 'income' | 'correction_in' | 'correction_out'

export interface PayerSearchResult {
  id: string
  full_name: string
  parent_name?: string | null
}

export interface LedgerRow {
  id:     string
  date:   string
  kind:   LedgerKind
  amount: string
  note:   string | null
  detail: string | null
  is_advance: boolean | null
  utilized_advance_amount: string | null
  is_obnal: boolean
  obnal_amount: string | null
}

export interface LedgerFilters {
  from?:   string
  to?:     string
  limit?:  number
  offset?: number
}

export interface Imbalance {
  id:                 string
  from_account_id:    string
  to_account_id:      string
  from_account_name:  string | null
  to_account_name:    string | null
  amount:             string
  note:               string | null
  created_at:         string
  transaction_id:     string | null
  tx_date:            string | null
  tx_amount:          string | null
  tx_note:            string | null
  child_name:         string | null
}

export const accountsApi = {
  list: async (): Promise<AccountWithBalance[]> => {
    const { data } = await apiClient.get<AccountWithBalance[]>('/accounts')
    return data
  },

  get: async (id: string): Promise<AccountWithBalance & { open_imbalances: number }> => {
    const { data } = await apiClient.get<AccountWithBalance & { open_imbalances: number }>(`/accounts/${id}`)
    return data
  },

  ledgerSummary: async (id: string, filters: { from?: string; to?: string } = {}): Promise<{ total_in: string; total_out: string }> => {
    const params = new URLSearchParams()
    if (filters.from) params.set('from', filters.from)
    if (filters.to)   params.set('to',   filters.to)
    const { data } = await apiClient.get<{ total_in: string; total_out: string }>(
      `/accounts/${id}/ledger/summary?${params}`
    )
    return data
  },

  ledger: async (id: string, filters: LedgerFilters = {}): Promise<{ data: LedgerRow[]; limit: number; offset: number }> => {
    const params = new URLSearchParams()
    if (filters.from)   params.set('from',   filters.from)
    if (filters.to)     params.set('to',     filters.to)
    if (filters.limit)  params.set('limit',  String(filters.limit))
    if (filters.offset) params.set('offset', String(filters.offset))
    const { data } = await apiClient.get<{ data: LedgerRow[]; limit: number; offset: number }>(
      `/accounts/${id}/ledger?${params}`
    )
    return data
  },

  imbalances: async (id: string): Promise<Imbalance[]> => {
    const { data } = await apiClient.get<Imbalance[]>(`/accounts/${id}/imbalances`)
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

  searchPayers: async (q: string): Promise<PayerSearchResult[]> => {
    const { data } = await apiClient.get<PayerSearchResult[]>(`/accounts/payer-search?q=${encodeURIComponent(q)}`)
    return data
  },

  createPayment: async (accountId: string, payload: {
    child_id: string
    amount: number
    transaction_date?: string
    note?: string
    debt_account_id?: string
  }) => {
    const { data } = await apiClient.post(`/accounts/${accountId}/payments`, payload)
    return data
  },

  createIncome: async (accountId: string, payload: {
    amount: number
    income_date?: string
    payer_name?: string
    note?: string
  }) => {
    const { data } = await apiClient.post(`/accounts/${accountId}/income`, payload)
    return data
  },

  createCorrection: async (accountId: string, payload: {
    amount: number
    correction_date?: string
    note?: string
  }) => {
    const { data } = await apiClient.post(`/accounts/${accountId}/corrections`, payload)
    return data
  },

  updateCorrection: async (accountId: string, corrId: string, payload: {
    amount?: number
    correction_date?: string
    note?: string
  }) => {
    const { data } = await apiClient.put(`/accounts/${accountId}/corrections/${corrId}`, payload)
    return data
  },

  deleteCorrection: async (accountId: string, corrId: string) => {
    await apiClient.delete(`/accounts/${accountId}/corrections/${corrId}`)
  },

  updateIncome: async (accountId: string, incomeId: string, payload: {
    amount?: number
    income_date?: string
    payer_name?: string
    note?: string
  }) => {
    const { data } = await apiClient.put(`/accounts/${accountId}/income/${incomeId}`, payload)
    return data
  },

  deleteIncome: async (accountId: string, incomeId: string) => {
    await apiClient.delete(`/accounts/${accountId}/income/${incomeId}`)
  },
}
