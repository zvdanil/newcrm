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

export interface MonthSummaryTransaction {
  id: string
  type: 'ACCRUAL' | 'REFUND'
  amount: string
  transaction_date: string
  billing_month: string | null
  note: string | null
  account_id: string | null
  activity_id: string | null
  activity_name: string | null
  account_name: string | null
}

export interface ActivityMonthlySummary {
  activity_id: string
  activity_name: string
  activity_is_active: boolean
  enrollment_status: string | null  // null = archived enrollment (has transactions but no active enrollment)
  accrual_total: number
  refund_total: number
  visit_count: number
  excused_count: number
  transactions: MonthSummaryTransaction[]
}

export interface AccountMonthlySummary {
  account_id: string
  account_name: string
  activities: ActivityMonthlySummary[]
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

  getMonthSummary: async (childId: string, month: string): Promise<AccountMonthlySummary[]> => {
    const { data } = await apiClient.get<AccountMonthlySummary[]>(
      `/parent/children/${childId}/month-summary?month=${month}`
    )
    return data
  },
}
