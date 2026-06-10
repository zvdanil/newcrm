import { apiClient } from './client'

export interface EquityParticipant {
  id: string
  name: string
  share_pct: string | number
  is_active: boolean
  created_at: string
}

export interface DividendSettings {
  id: number
  default_tax_pct: string | number
  initial_skew_amount: string | number
  initial_skew_participant_id: string | null
}

export interface LedgerParticipant extends EquityParticipant {
  target_net: number
  actual_net: number
  skew: number
}

export interface LedgerLeveling {
  participant_id: string
  recommendation_amount: number
}

export interface DividendLedger {
  total_net: number
  participants: LedgerParticipant[]
  leveling: LedgerLeveling[]
}

export interface DividendPayoutSource {
  id: string
  amount: string | number
  account_name: string | null
  dividend_amount: string | number | null
  note: string | null
  is_salary?: boolean
}

export interface DividendPayout {
  id: string
  participant_id: string
  participant_name: string
  date: string
  type: 'cash' | 'cashless'
  tax_pct: string | number
  gross_amount: string | number
  net_amount: string | number
  note: string | null
  created_at: string
  sources: DividendPayoutSource[]
}

export const dividendsApi = {
  getParticipants: async () => {
    const { data } = await apiClient.get<EquityParticipant[]>('/dividends/participants')
    return data
  },

  createParticipant: async (payload: { name: string; share_pct: number }) => {
    const { data } = await apiClient.post<EquityParticipant>('/dividends/participants', payload)
    return data
  },

  updateParticipant: async (id: string, payload: Partial<{ name: string; share_pct: number; is_active: boolean }>) => {
    const { data } = await apiClient.put<EquityParticipant>(`/dividends/participants/${id}`, payload)
    return data
  },

  deleteParticipant: async (id: string) => {
    const { data } = await apiClient.delete(`/dividends/participants/${id}`)
    return data
  },

  getSettings: async () => {
    const { data } = await apiClient.get<DividendSettings>('/dividends/settings')
    return data
  },

  updateSettings: async (payload: { default_tax_pct?: number; initial_skew_amount?: number; initial_skew_participant_id?: string | null }) => {
    const { data } = await apiClient.put<DividendSettings>('/dividends/settings', payload)
    return data
  },

  getLedger: async (filters?: { from?: string; to?: string }) => {
    const params = new URLSearchParams()
    if (filters?.from) params.set('from', filters.from)
    if (filters?.to) params.set('to', filters.to)
    const { data } = await apiClient.get<DividendLedger>(`/dividends/ledger${params.toString() ? '?' + params.toString() : ''}`)
    return data
  },

  getPayouts: async (filters?: { from?: string; to?: string }) => {
    const params = new URLSearchParams()
    if (filters?.from) params.set('from', filters.from)
    if (filters?.to) params.set('to', filters.to)
    const { data } = await apiClient.get<DividendPayout[]>(`/dividends/payouts${params.toString() ? '?' + params.toString() : ''}`)
    return data
  },

  createPayout: async (payload: {
    participant_id: string
    date?: string
    type: 'cash' | 'cashless'
    tax_pct: number
    note?: string
    sources: Array<{ type: 'new'; account_id: string; amount: number } | { type: 'existing'; expense_id: string } | { type: 'existing_salary'; expense_id: string }>
  }) => {
    const { data } = await apiClient.post<DividendPayout>('/dividends/payouts', payload)
    return data
  },

  deletePayout: async (id: string) => {
    const { data } = await apiClient.delete(`/dividends/payouts/${id}`)
    return data
  },
}
