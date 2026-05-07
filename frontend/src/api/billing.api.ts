import { apiClient } from './client'

export interface ChildBalance {
  account_id: string
  account_name: string
  balance: string
  updated_at: string
}

export interface LedgerEntry {
  id: string
  type: string
  amount: string
  transaction_date: string
  billing_month: string | null
  note: string | null
  is_deleted: boolean
  created_at: string
  account_id: string
  account_name: string
  activity_id: string | null
  activity_name: string | null
  enrollment_id: string | null
}

export interface LedgerResponse {
  data: LedgerEntry[]
  total: number
  limit: number
  offset: number
}

export interface ChildPrice {
  id: string
  activity_id: string
  activity_name: string
  price: string | null
  discount_pct: string | null
  valid_from: string
  valid_to: string | null
  created_at: string
}

export interface GlobalDiscount {
  id: string
  child_id: string
  discount_pct: string
  valid_from: string
  valid_to: string | null
  created_at: string
}

export const billingApi = {
  getBalance: async (childId: string): Promise<ChildBalance[]> => {
    const { data } = await apiClient.get<ChildBalance[]>(`/children/${childId}/balance`)
    return data
  },

  getLedger: async (childId: string, params?: { account_id?: string; from?: string; to?: string; limit?: number; offset?: number }): Promise<LedgerResponse> => {
    const q = new URLSearchParams()
    if (params?.account_id) q.set('account_id', params.account_id)
    if (params?.from)       q.set('from', params.from)
    if (params?.to)         q.set('to', params.to)
    if (params?.limit)      q.set('limit', String(params.limit))
    if (params?.offset)     q.set('offset', String(params.offset))
    const { data } = await apiClient.get<LedgerResponse>(`/children/${childId}/ledger?${q}`)
    return data
  },

  registerPayment: async (childId: string, payload: { account_id: string; amount: number; transaction_date?: string; note?: string }) => {
    const { data } = await apiClient.post(`/children/${childId}/payment`, payload)
    return data
  },

  setInitialBalance: async (childId: string, payload: { account_id: string; amount: number; note?: string }) => {
    const { data } = await apiClient.post(`/children/${childId}/initial-balance`, payload)
    return data
  },

  runBilling: async (billing_month?: string) => {
    const { data } = await apiClient.post('/billing/run', { billing_month })
    return data
  },

  getPrices: async (childId: string): Promise<ChildPrice[]> => {
    const { data } = await apiClient.get<ChildPrice[]>(`/children/${childId}/prices`)
    return data
  },

  setPrice: async (childId: string, payload: { activity_id: string; price?: number | null; discount_pct?: number | null; valid_from?: string }) => {
    const { data } = await apiClient.post(`/children/${childId}/prices`, payload)
    return data
  },

  deletePrice: async (childId: string, priceId: string, validTo?: string) => {
    const q = validTo ? `?valid_to=${validTo}` : ''
    const { data } = await apiClient.delete(`/children/${childId}/prices/${priceId}${q}`)
    return data
  },

  getGlobalDiscount: async (childId: string): Promise<GlobalDiscount | null> => {
    const { data } = await apiClient.get<GlobalDiscount | null>(`/children/${childId}/global-discount`)
    return data
  },

  setGlobalDiscount: async (childId: string, payload: { discount_pct: number; valid_from?: string }) => {
    const { data } = await apiClient.post(`/children/${childId}/global-discount`, payload)
    return data
  },

  deleteGlobalDiscount: async (childId: string) => {
    const { data } = await apiClient.delete(`/children/${childId}/global-discount`)
    return data
  },

  getRunLog: async (): Promise<Array<{
    id: string
    billing_month: string
    started_at: string
    finished_at: string | null
    created_count: number
    adjusted_count: number
    skipped_count: number
    triggered_by: string | null
    error: string | null
  }>> => {
    const { data } = await apiClient.get('/billing/run-log')
    return data
  },
}
