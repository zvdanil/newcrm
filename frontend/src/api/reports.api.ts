import { apiClient } from './client'

export interface DebtorRow {
  child_id: string
  child_name: string
  is_active: boolean
  family_id: string | null
  family_name: string | null
  primary_parent_name: string | null
  primary_parent_phone: string | null
  account_id: string
  account_name: string
  debt: number
}

export interface ARReport {
  rows: DebtorRow[]
  total_debt: number
  children_count: number
}

export interface ARFilters {
  from_month: string       // YYYY-MM or ''
  to_month: string         // YYYY-MM or ''
  account_ids: string[]
  is_active: 'true' | 'false' | ''
  min_debt: string
  sort: 'desc' | 'asc'
}

export interface PnLRow {
  month: string              // 'YYYY-MM-01'
  expected_revenue: number
  accrued_expense: number
  real_income: number
  expense_turnover: number
  expense_turnover_no_div: number
  balance_no_div: number
  account_balance: number
}

export interface PnLReport {
  rows: PnLRow[]
}

export interface ARAnalyticsMonthRow {
  month: string               // 'YYYY-MM-01'
  accrued_in_month: number
  paid_in_month: number
  balance_start_month: number
  balance_end_month: number
}

export interface ARAnalyticsRow {
  child_id: string
  child_name: string
  is_active: boolean
  family_id: string | null
  family_name: string | null
  primary_parent_phone: string | null
  account_id: string
  account_name: string
  balance_start: number
  accrued_in_period: number
  paid_in_period: number
  balance_end: number
  current_balance: number
  months: ARAnalyticsMonthRow[]
}

export interface ARAnalyticsTotals {
  balance_start: number
  accrued_in_period: number
  paid_in_period: number
  balance_end: number
  current_balance: number
}

export interface ARAnalyticsReport {
  rows: ARAnalyticsRow[]
  totals: ARAnalyticsTotals
  period_months: string[]
}

export interface ARAnalyticsFilters {
  from_month: string           // YYYY-MM
  to_month: string             // YYYY-MM
  account_ids: string[]
  balance_mode: 'all' | 'debtors' | 'advances'
  is_active: '' | 'true' | 'false'
}

export const reportsApi = {
  getAccountsReceivable: async (filters: ARFilters): Promise<ARReport> => {
    const params = new URLSearchParams()
    if (filters.from_month)           params.set('from_month', filters.from_month)
    if (filters.to_month)             params.set('to_month', filters.to_month)
    if (filters.account_ids.length)   params.set('account_ids', filters.account_ids.join(','))
    if (filters.is_active)            params.set('is_active', filters.is_active)
    if (filters.min_debt)             params.set('min_debt', filters.min_debt)
    params.set('sort', filters.sort)
    const { data } = await apiClient.get<ARReport>(`/reports/accounts-receivable?${params}`)
    return data
  },

  getARAnalytics: async (filters: ARAnalyticsFilters): Promise<ARAnalyticsReport> => {
    const params = new URLSearchParams()
    params.set('from_month', filters.from_month)
    params.set('to_month',   filters.to_month)
    if (filters.account_ids.length) params.set('account_ids', filters.account_ids.join(','))
    params.set('balance_mode', filters.balance_mode)
    if (filters.is_active) params.set('is_active', filters.is_active)
    const { data } = await apiClient.get<ARAnalyticsReport>(`/reports/ar-analytics?${params}`)
    return data
  },

  getPnL: async (from?: string, to?: string): Promise<PnLReport> => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to)   params.set('to', to)
    const { data } = await apiClient.get<PnLReport>(`/reports/pnl?${params}`)
    return data
  },
}
