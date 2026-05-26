import { apiClient } from './client'

export interface ParentChild {
  id: string
  full_name: string
  birth_date: string | null
  note: string | null
  balances: { account_name: string; balance: string }[]
}

export interface ParentLedgerRow {
  id: string
  type: 'ACCRUAL' | 'PAYMENT' | 'REFUND' | 'ADJUSTMENT'
  amount: string
  transaction_date: string
  billing_month: string | null
  note: string | null
  activity_name: string | null
  account_name: string | null
}

export interface ParentAttendanceRow {
  id: string
  date: string
  status: 'present' | 'absent_excused' | 'absent_unexcused' | 'special'
  note: string | null
  activity_name: string
}

export const parentApi = {
  getChildren: async (): Promise<ParentChild[]> => {
    const { data } = await apiClient.get<ParentChild[]>('/parent/children')
    return data
  },

  getLedger: async (childId: string, params?: { from?: string; to?: string }): Promise<ParentLedgerRow[]> => {
    const q = new URLSearchParams()
    if (params?.from) q.set('from', params.from)
    if (params?.to)   q.set('to',   params.to)
    const { data } = await apiClient.get<ParentLedgerRow[]>(`/parent/children/${childId}/ledger?${q}`)
    return data
  },

  getAttendance: async (childId: string, month: string): Promise<ParentAttendanceRow[]> => {
    const { data } = await apiClient.get<ParentAttendanceRow[]>(
      `/parent/children/${childId}/attendance?month=${month}`
    )
    return data
  },
}
