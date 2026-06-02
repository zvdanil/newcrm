import { apiClient } from './client'

export interface ExpenseBankRow {
  row_index:         number
  date:              string
  amount:            number
  counterparty_name: string
  edrpou:            string | null
  iban:              string | null
  description:       string
  doc_number:        string | null
  bank_reference:    string | null
}

export interface ExpensePreviewRow extends ExpenseBankRow {
  status:                'matched' | 'unmatched' | 'skip' | 'duplicate'
  match_method:          'edrpou_keyword' | 'iban_keyword' | 'edrpou' | 'iban' | 'keyword' | null
  matched_rule_id:       string | null
  matched_category_id:   string | null
  matched_category_name: string | null
  bank_ref:              string
  is_duplicate:          boolean
  duplicate_expense_id:  string | null
}

export interface ApplyExpenseRow {
  row_index:              number
  date:                   string
  amount:                 number
  counterparty_name:      string
  edrpou:                 string | null
  iban:                   string | null
  description:            string
  doc_number:             string | null
  bank_reference:         string | null
  bank_ref:               string
  category_id:            string | null
  matched_rule_id?:       string | null
  note?:                  string
  save_rule?:             boolean
  rule_edrpou?:           string | null
  rule_iban?:             string | null
  rule_keyword_pattern?:  string | null
  is_skip_rule?:          boolean
}

export interface ExpenseImportRule {
  id:                    string
  account_id:            string
  edrpou:                string | null
  iban:                  string | null
  keyword_pattern:       string | null
  category_id:           string | null
  category_name:         string | null
  category_parent_id:    string | null
  parent_category_name:  string | null
  is_skip:               boolean
  match_count:           number
  last_matched_at:       string | null
  created_at:            string
  updated_at:            string
}

export interface ExpenseImportRuleInput {
  account_id:       string
  edrpou?:          string | null
  iban?:            string | null
  keyword_pattern?: string | null
  category_id?:     string | null
  is_skip?:         boolean
}

export const expenseImportApi = {
  preview: async (accountId: string, rows: ExpenseBankRow[]): Promise<{ rows: ExpensePreviewRow[] }> => {
    const { data } = await apiClient.post('/expense-import/preview', { account_id: accountId, rows })
    return data
  },

  apply: async (accountId: string, rows: ApplyExpenseRow[]): Promise<{ imported: number; skipped: number; errors: { row_index: number; message: string }[] }> => {
    const { data } = await apiClient.post('/expense-import/apply', { account_id: accountId, rows })
    return data
  },

  listRules: async (accountId: string): Promise<ExpenseImportRule[]> => {
    const { data } = await apiClient.get<ExpenseImportRule[]>('/expense-import/rules', { params: { account_id: accountId } })
    return data
  },

  createRule: async (input: ExpenseImportRuleInput): Promise<ExpenseImportRule> => {
    const { data } = await apiClient.post<ExpenseImportRule>('/expense-import/rules', input)
    return data
  },

  updateRule: async (id: string, input: Omit<ExpenseImportRuleInput, 'account_id'>): Promise<ExpenseImportRule> => {
    const { data } = await apiClient.put<ExpenseImportRule>(`/expense-import/rules/${id}`, input)
    return data
  },

  deleteRule: async (id: string): Promise<void> => {
    await apiClient.delete(`/expense-import/rules/${id}`)
  },
}
