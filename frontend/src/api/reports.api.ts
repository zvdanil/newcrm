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

export interface OtherAccountBalance {
  account_id: string
  account_name: string
  current_balance: number
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
  other_accounts?: OtherAccountBalance[]
  net_balance?: number
  has_cross_imbalance?: boolean
  cross_prepayment_total?: number
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

export interface InvoiceConsumedServiceItem {
  activity_id?: string
  activity_name: string
  tariff_type?: string
  month?: string
  visit_count?: number
  amount: number
}

export interface InvoiceSubscriptionItem {
  activity_id?: string
  activity_name: string
  tariff_type?: string
  month?: string
  amount: number
}

export interface InvoiceTransferItem {
  type: 'TRANSFER_IN' | 'TRANSFER_OUT'
  amount: number
  note?: string | null
}

export interface InvoicesAndPaymentsAccountDetail {
  account_id: string
  account_name: string
  account_type?: string
  balance_start: number
  consumed_services: InvoiceConsumedServiceItem[]
  consumed_services_total: number
  subscriptions: InvoiceSubscriptionItem[]
  subscriptions_total: number
  invoice_total: number
  paid_in_period: number
  paid_after_period: number
  transfers_in_period?: number
  transfers_out_period?: number
  transfers?: InvoiceTransferItem[]
  balance_end: number
  current_balance: number
}

export interface InvoicesAndPaymentsChildRow {
  child_id: string
  child_name: string
  is_active: boolean
  family_name: string | null
  primary_parent_phone: string | null
  balance_start: number
  consumed_services_total: number
  subscriptions_total: number
  invoice_total: number
  paid_in_period: number
  paid_after_period: number
  transfers_in_period?: number
  transfers_out_period?: number
  balance_end: number
  current_balance: number
  accounts: InvoicesAndPaymentsAccountDetail[]
}

export interface InvoicesAndPaymentsTotals {
  invoice_total: number
  consumed_services_total: number
  subscriptions_total: number
  paid_in_period: number
  paid_after_period: number
  transfers_in_total?: number
  transfers_out_total?: number
  balance_end: number
  current_balance: number
  children_count: number
}

export interface InvoicesAndPaymentsReport {
  rows: InvoicesAndPaymentsChildRow[]
  totals: InvoicesAndPaymentsTotals
  period_months: string[]
}

export interface InvoicesAndPaymentsFilters {
  from_month: string
  to_month: string
  account_ids: string[]
  is_active: '' | 'true' | 'false'
  debt_filter: 'all' | 'debt_period_end' | 'debt_today'
}

export interface ARAnalyticsFilters {
  from_month: string           // YYYY-MM
  to_month: string             // YYYY-MM
  account_ids: string[]
  balance_mode: 'all' | 'debtors' | 'advances'
  is_active: '' | 'true' | 'false'
  only_imbalances?: boolean
}

export const reportsApi = {
  getInvoicesAndPayments: async (filters: InvoicesAndPaymentsFilters): Promise<InvoicesAndPaymentsReport> => {
    const params = new URLSearchParams()
    params.set('from_month', filters.from_month)
    params.set('to_month', filters.to_month)
    if (filters.account_ids.length) params.set('account_ids', filters.account_ids.join(','))
    if (filters.is_active) params.set('is_active', filters.is_active)
    if (filters.debt_filter) params.set('debt_filter', filters.debt_filter)
    const { data } = await apiClient.get<InvoicesAndPaymentsReport>(`/reports/invoices-and-payments?${params}`)
    return data
  },

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
    if (filters.only_imbalances) params.set('only_imbalances', 'true')
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

  getPnL2: async (from?: string, to?: string, account_ids?: string[]): Promise<PnL2Report> => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to)   params.set('to', to)
    if (account_ids && account_ids.length > 0) params.set('account_ids', account_ids.join(','))
    const { data } = await apiClient.get<PnL2Report>(`/reports/pnl2?${params}`)
    return data
  },

  getPnL3: async (from?: string, to?: string, account_ids?: string[], salary_basis?: 'payment' | 'accrual', staff_type?: 'all' | 'employee' | 'partner'): Promise<PnL3Report> => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to)   params.set('to', to)
    if (account_ids && account_ids.length > 0) params.set('account_ids', account_ids.join(','))
    if (salary_basis) params.set('salary_basis', salary_basis)
    if (staff_type && staff_type !== 'all') params.set('staff_type', staff_type)
    const { data } = await apiClient.get<PnL3Report>(`/reports/pnl3?${params}`)
    return data
  },

  getPnL3Accrual: async (from?: string, to?: string, account_ids?: string[], staff_type?: 'all' | 'employee' | 'partner'): Promise<PnL3Report> => {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to)   params.set('to', to)
    if (account_ids && account_ids.length > 0) params.set('account_ids', account_ids.join(','))
    if (staff_type && staff_type !== 'all') params.set('staff_type', staff_type)
    const { data } = await apiClient.get<PnL3Report>(`/reports/pnl3-accrual?${params}`)
    return data
  },

  getChildOSV: async (childId: string, params?: { start_date?: string; end_date?: string; account_id?: string }) => {
    const { data } = await apiClient.get<ChildOSVReportResponse>(`/reports/osv/child/${childId}`, { params })
    return data
  },
}

export interface OSVAccrualItem {
  id: string
  activity_name: string
  amount: number
  gross_amount?: number
  refund_amount?: number
  count?: number
  account_id: string
  account_name: string
  transaction_date: string
  note: string | null
}

export interface OSVPaymentItem {
  id: string
  transaction_date: string
  created_at: string
  amount: number
  payment_method: string
  account_id: string
  account_name: string
  note: string | null
  receipt_url: string | null
}

export interface OSVRefundItem {
  account_id: string
  account_name: string
  amount: number
}

export interface OSVMonthData {
  month: string
  month_label: string
  balance_start: number
  balance_end: number
  accruals: {
    total: number
    items: OSVAccrualItem[]
  }
  payments: {
    total: number
    items: OSVPaymentItem[]
  }
  refunds: {
    total: number
    items: OSVRefundItem[]
  }
}

export interface ChildOSVReportResponse {
  child: {
    id: string
    full_name: string
    group_name: string | null
  }
  period: {
    start_date: string
    end_date: string
  }
  account_id: string | null
  opening_balance: number
  closing_balance: number
  totals: {
    accruals: number
    payments: number
    refunds: number
  }
  months: OSVMonthData[]
}

export interface PnL2ChildDetail {
  child_id: string
  child_name: string
  accrued: number
  paid: number
}

export interface PnL2ActivityDetail {
  activity_id: string
  activity_name: string
  accrued: number
  paid: number
  children: PnL2ChildDetail[]
}

export interface PnL2Account {
  account_id: string
  name: string
  accrued: number
  paid: number
  transfers_in?: number
  transfers_out?: number
  transfers_in_items?: PnL3TransferItem[]
  transfers_out_items?: PnL3TransferItem[]
  details: PnL2ActivityDetail[]
}

export interface PnL2StaffDetail {
  staff_id: string
  staff_name: string
  staff_type?: 'employee' | 'partner'
  accrued: number
  paid: number
}

export interface PnL2ExpenseTxDetail {
  id: string
  date: string
  amount: number
  note: string
  type: 'accrued' | 'paid'
}

export interface PnL2CategoryDetail {
  category_id: string
  category_name: string
  accrued: number
  paid: number
  transactions: PnL2ExpenseTxDetail[]
}

export interface PnL2WithdrawalTxDetail {
  id: string
  date: string
  amount: number
  note: string
}

export interface PnL2DividendTxDetail {
  id: string
  date: string
  recipient: string
  amount: number
  note: string
}

export interface PnL2Row {
  month: string
  accounts: PnL2Account[]
  refunds: { accrued: number; paid: number; details: PnL2Account[] }
  salary: { accrued: number; paid: number; details: PnL2StaffDetail[] }
  expenses: { accrued: number; paid: number; details: PnL2CategoryDetail[] }
  withdrawals: { paid: number; transactions: PnL2WithdrawalTxDetail[] }
  dividends: { paid: number; transactions: PnL2DividendTxDetail[] }
}

export interface PnL2Report {
  months: string[]
  accounts: Array<{ id: string; name: string }>
  rows: PnL2Row[]
}

export interface PnL3TransferItem {
  id: string
  date: string
  from_account_id: string
  from_account_name: string
  to_account_id: string
  to_account_name: string
  amount: number
  note: string
}

export interface PnL3Totals {
  income_accrued: number
  refunds_accrued: number
  net_income: number
  salary_paid: number
  operating_expenses_paid: number
  total_operating_expenses: number
  operating_profit: number
  non_operating_expenses_paid: number
  profit_before_distribution: number
  dividends_paid: number
  withdrawals_paid: number
  retained_profit: number
}

export interface PnL3Row {
  month: string
  accounts: PnL2Account[]
  refunds: { accrued: number; paid: number; details: PnL2Account[] }
  salary: { accrued: number; paid: number; employee_paid?: number; partner_paid?: number; details: PnL2StaffDetail[] }
  operating_expenses: { paid: number; details: PnL2CategoryDetail[] }
  obnal_commissions: { paid: number; transactions: PnL2WithdrawalTxDetail[] }
  non_operating_expenses: { paid: number; details: PnL2CategoryDetail[] }
  expenses: { accrued: number; paid: number; details: PnL2CategoryDetail[] }
  withdrawals: { paid: number; transactions: PnL2WithdrawalTxDetail[] }
  dividends: { paid: number; transactions: PnL2DividendTxDetail[] }
  transfers: { total_amount: number; items: PnL3TransferItem[] }
  totals: PnL3Totals
}

export interface PnL3Report {
  months: string[]
  accounts: Array<{ id: string; name: string }>
  rows: PnL3Row[]
}
