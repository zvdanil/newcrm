import { apiClient } from './client'

export interface ImportTemplate {
  id: string
  name: string
  description: string | null
  header_row_index: number
  data_start_row_index: number
  col_date: string
  col_amount: string
  col_type: string | null
  col_type_credit_value: string | null
  col_counterparty: string | null
  col_inn: string | null
  col_iban: string | null
  col_description: string | null
  col_doc_number: string | null
  col_reference: string | null
  amount_negate: boolean
  created_at: string
  updated_at: string
}

export type ImportTemplateInput = Omit<ImportTemplate, 'id' | 'created_at' | 'updated_at'>

export const importTemplatesApi = {
  list: async (): Promise<ImportTemplate[]> => {
    const { data } = await apiClient.get<ImportTemplate[]>('/import-templates')
    return data
  },

  create: async (input: ImportTemplateInput): Promise<ImportTemplate> => {
    const { data } = await apiClient.post<ImportTemplate>('/import-templates', input)
    return data
  },

  update: async (id: string, input: ImportTemplateInput): Promise<ImportTemplate> => {
    const { data } = await apiClient.put<ImportTemplate>(`/import-templates/${id}`, input)
    return data
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/import-templates/${id}`)
  },
}

export interface BankPayerProfile {
  id: string
  counterparty_name: string
  inn: string | null
  iban: string | null
  import_count: number
  last_import_date: string
  note: string | null
}

export const bankPayersApi = {
  listForChild: async (childId: string): Promise<BankPayerProfile[]> => {
    const { data } = await apiClient.get<BankPayerProfile[]>(`/children/${childId}/bank-payers`)
    return data
  },
}
