import { apiClient } from './client'

export interface ExpenseCategory {
  id: string
  name: string
  parent_id: string | null
  is_active: boolean
  sort_order: number
  created_at: string
}

export interface Expense {
  id: string
  account_id: string
  account_name: string
  category_id: string | null
  category_name: string | null
  parent_id: string | null
  parent_category_name: string | null
  amount: string
  accrual_date: string
  payment_date: string | null
  status: 'pending' | 'paid'
  is_instant: boolean
  is_dividend: boolean
  withdrawal_transfer_id: string | null
  dividend_payout_id: string | null
  note: string | null
  created_by_email: string | null
  created_at: string
}

export interface ExpensesResponse {
  data: Expense[]
  total: number
  total_amount: number
  limit: number
  offset: number
}

export interface AccountTransfer {
  id: string
  from_account_id: string
  from_account_name: string
  to_account_id: string
  to_account_name: string
  amount: string
  commission: string
  transfer_date: string
  note: string | null
  created_at: string
}

export const expensesApi = {
  // Categories
  getCategories: async (): Promise<ExpenseCategory[]> => {
    const { data } = await apiClient.get<ExpenseCategory[]>('/expenses/categories')
    return data
  },

  createCategory: async (payload: { name: string; parent_id?: string; sort_order?: number }) => {
    const { data } = await apiClient.post<ExpenseCategory>('/expenses/categories', payload)
    return data
  },

  updateCategory: async (id: string, payload: { name?: string; parent_id?: string | null; sort_order?: number; is_active?: boolean }) => {
    const { data } = await apiClient.put<ExpenseCategory>(`/expenses/categories/${id}`, payload)
    return data
  },

  deleteCategory: async (id: string) => {
    await apiClient.delete(`/expenses/categories/${id}`)
  },

  // Expenses
  list: async (params: {
    account_id?: string
    category_id?: string
    status?: 'pending' | 'paid' | ''
    from?: string
    to?: string
    is_dividend?: boolean
    limit?: number
    offset?: number
  } = {}): Promise<ExpensesResponse> => {
    const q = new URLSearchParams()
    if (params.account_id)             q.set('account_id', params.account_id)
    if (params.category_id)            q.set('category_id', params.category_id)
    if (params.status)                 q.set('status', params.status)
    if (params.from)                   q.set('from', params.from)
    if (params.to)                     q.set('to', params.to)
    if (params.is_dividend !== undefined) q.set('is_dividend', String(params.is_dividend))
    if (params.limit)                  q.set('limit', String(params.limit))
    if (params.offset)                 q.set('offset', String(params.offset))
    const { data } = await apiClient.get<ExpensesResponse>(`/expenses?${q}`)
    return data
  },

  create: async (payload: {
    account_id: string
    category_id?: string
    amount: number
    accrual_date?: string
    payment_date?: string
    is_instant?: boolean
    is_dividend?: boolean
    note?: string
  }) => {
    const { data } = await apiClient.post<Expense>('/expenses', payload)
    return data
  },

  update: async (id: string, payload: {
    account_id?: string
    category_id?: string | null
    amount?: number
    accrual_date?: string
    note?: string | null
    edit_note?: string
  }) => {
    const { data } = await apiClient.put<Expense>(`/expenses/${id}`, payload)
    return data
  },

  getEdits: async (id: string): Promise<Array<{
    id: string
    field_name: string
    old_value: string | null
    new_value: string | null
    edit_note: string | null
    edited_at: string
    editor_email: string | null
  }>> => {
    const { data } = await apiClient.get(`/expenses/${id}/edits`)
    return data
  },

  delete: async (id: string) => {
    await apiClient.delete(`/expenses/${id}`)
  },

  pay: async (id: string, payload: { payment_date?: string; account_id?: string } = {}) => {
    const { data } = await apiClient.post<Expense>(`/expenses/${id}/pay`, payload)
    return data
  },

  toggleDividend: async (id: string, is_dividend: boolean) => {
    const { data } = await apiClient.put<Expense>(`/expenses/${id}/dividend`, { is_dividend })
    return data
  },

  withdraw: async (id: string, payload: {
    target_account_id: string
    commission: number
    transfer_date?: string
  }) => {
    const { data } = await apiClient.post(`/expenses/${id}/withdraw`, payload)
    return data
  },

  // Transfers
  getTransfers: async (params: { account_id?: string; from?: string; to?: string } = {}): Promise<AccountTransfer[]> => {
    const q = new URLSearchParams()
    if (params.account_id) q.set('account_id', params.account_id)
    if (params.from)       q.set('from', params.from)
    if (params.to)         q.set('to', params.to)
    const { data } = await apiClient.get<AccountTransfer[]>(`/expenses/transfers?${q}`)
    return data
  },

  createTransfer: async (payload: {
    from_account_id: string
    to_account_id: string
    amount: number
    commission?: number
    transfer_date?: string
    note?: string
  }) => {
    const { data } = await apiClient.post<AccountTransfer>('/expenses/transfers', payload)
    return data
  },

  deleteTransfer: async (id: string) => {
    await apiClient.delete(`/expenses/transfers/${id}`)
  },
}

// ── Salary Payments (for Витрати / Зарплата tab) ───────────────────────────

export interface SalaryPayment {
  id: string
  staff_id: string
  staff_name: string
  account_id: string | null
  account_name: string | null
  gross_amount: string
  transaction_date: string
  billing_month: string | null
  note: string | null
  is_dividend: boolean
  withdrawal_transfer_id: string | null
  dividend_payout_id?: string | null
  created_at: string
}

export interface SalaryPaymentsResponse {
  data: SalaryPayment[]
  total: number
  total_amount: number
}

export const salaryPaymentsApi = {
  list: async (params: {
    account_id?: string
    from?: string
    to?: string
    is_dividend?: boolean
  } = {}): Promise<SalaryPaymentsResponse> => {
    const q = new URLSearchParams()
    if (params.account_id)             q.set('account_id', params.account_id)
    if (params.from)                   q.set('from', params.from)
    if (params.to)                     q.set('to', params.to)
    if (params.is_dividend !== undefined) q.set('is_dividend', String(params.is_dividend))
    const { data } = await apiClient.get<SalaryPaymentsResponse>(`/salary/payments?${q}`)
    return data
  },

  toggleDividend: async (id: string, is_dividend: boolean): Promise<SalaryPayment> => {
    const { data } = await apiClient.put<SalaryPayment>(`/salary/payments/${id}/dividend`, { is_dividend })
    return data
  },

  withdraw: async (id: string, payload: {
    target_account_id: string
    commission: number
    transfer_date?: string
  }) => {
    const { data } = await apiClient.post(`/salary/payments/${id}/withdraw`, payload)
    return data
  },
}
