import { apiClient } from './client'

export interface BankRow {
  row_index: number
  date: string
  counterparty_name: string
  edrpou: string | null
  iban: string | null
  amount: number
  description: string
}

export interface CandidateFamily {
  family_id: string
  family_name: string
  parent_name: string
}

export interface PreviewRow extends BankRow {
  status: 'matched' | 'conflict' | 'unmatched' | 'duplicate'
  match_method: 'edrpou' | 'iban' | 'name_fuzzy' | null
  matched_family_id: string | null
  matched_family_name: string | null
  matched_parent_name: string | null
  candidate_families: CandidateFamily[]
  bank_ref: string
  is_duplicate: boolean
  duplicate_tx_id: string | null
}

export interface PreviewResponse {
  rows: PreviewRow[]
}

export interface ApplyRow {
  row_index: number
  date: string
  amount: number
  family_id: string
  bank_ref: string
  counterparty_name: string
  edrpou: string | null
  note?: string
  force?: boolean
}

export interface ApplyAllocation {
  child_id: string
  child_name: string
  amount: number
  tx_id: string
}

export interface ApplyResponse {
  imported: number
  skipped_duplicates: number
  errors: { row_index: number; message: string }[]
  allocations: {
    row_index: number
    family_id: string
    family_name: string
    allocations: ApplyAllocation[]
  }[]
}

export const importApi = {
  preview: async (account_id: string, rows: BankRow[]): Promise<PreviewResponse> => {
    const { data } = await apiClient.post<PreviewResponse>('/import/preview', { account_id, rows })
    return data
  },

  apply: async (account_id: string, rows: ApplyRow[]): Promise<ApplyResponse> => {
    const { data } = await apiClient.post<ApplyResponse>('/import/apply', { account_id, rows })
    return data
  },
}
