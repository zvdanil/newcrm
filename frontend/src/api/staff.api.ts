import { apiClient } from './client'

export type StaffType    = 'employee' | 'partner'
export type RateCategory = 'auto' | 'manual'
export type RateType     = 'per_lesson' | 'per_child' | 'group_lesson' | 'fixed_monthly' | 'hourly' | 'smart' | 'bonus' | 'smart_per_child' | 'monthly_by_day' | 'vacation'
export type ValueMode    = 'fixed' | 'percent_of_revenue'
export type SalaryTxType = 'ACCRUAL' | 'PAYMENT' | 'CORRECTION'

export interface StaffMember {
  id:             string
  full_name:      string
  specialization: string | null
  type:           StaffType
  phone:          string | null
  start_date:     string | null
  is_active:      boolean
  note:           string | null
  created_at:     string
}

export interface StaffRate {
  id:              string
  staff_id:        string
  activity_id:     string | null
  activity_name:   string | null
  rate_category:   RateCategory
  rate_type:       RateType
  value_mode:      ValueMode
  rate_value:      string
  deduction_pct:   string
  valid_from:      string
  valid_to:        string | null
  note:            string | null
  created_at:      string
  // smart config (joined)
  base_lessons:         number | null
  absence_threshold:    number | null
  threshold_rate:       string | null
  attendance_threshold: number | null
  starter_rate:         string | null
  extra_lesson_price:   string | null
  trial_lesson_price:   string | null
  // vacation config (joined)
  monthly_base_salary:   string | null
  vacation_days_limit:   number | null
  period_start_date:     string | null
  period_end_date:       string | null
  calculation_base_type: 'CALENDAR_DAYS' | 'WORKING_DAYS' | null
  day_rate_cached:       string | null
  salary_calc_mode:      'fixed' | 'actual' | null
  included_rate_ids:     string[] | null
}

export interface SalaryTransaction {
  id:               string
  type:             SalaryTxType
  gross_amount:     string
  deduction_pct:    string
  transaction_date: string
  billing_month:    string | null
  note:             string | null
  edit_note:        string | null
  metadata_json:    unknown
  created_at:       string
  rate_id:          string | null
  rate_type:        RateType | null
  rate_category:    RateCategory | null
  activity_id:      string | null
  activity_name:    string | null
  account_id:       string | null
  account_name:     string | null
}

export interface SalarySummary {
  gross:      number
  deduction:  number
  net:        number
  paid:       number
  balance:    number
}

export interface SalaryMonthResponse {
  transactions: SalaryTransaction[]
  summary:      SalarySummary
  month:        string
}

export interface SalaryJournalRow extends StaffMember {
  summary: SalarySummary
}

export interface SalaryJournalResponse {
  month: string
  rows:  SalaryJournalRow[]
}

export interface SalaryGridRate {
  id:            string
  rate_type:     RateType
  rate_category: 'auto' | 'manual'
  value_mode:    'fixed' | 'percent_of_revenue'
  rate_value:    string
  deduction_pct: string
  valid_from:    string
  valid_to:      string | null
  activity_id:   string | null
  activity_name: string | null
  note:          string | null
  // vacation config (optional — populated for vacation rates)
  day_rate_cached:     string | null
  vacation_days_limit: number | null
  salary_calc_mode:    'fixed' | 'actual' | null
  included_rate_ids:   string[] | null
}

export interface SalaryGridStaffRow extends StaffMember {
  rates:        SalaryGridRate[]
  transactions: (SalaryTransaction & { staff_id: string })[]
  summary:      SalarySummary
}

export interface SalaryGridResponse {
  month: string
  dates: string[]
  rows:  SalaryGridStaffRow[]
}

export const staffApi = {
  list: async (params: { type?: StaffType; is_active?: boolean } = {}): Promise<StaffMember[]> => {
    const q = new URLSearchParams()
    if (params.type !== undefined)      q.set('type', params.type)
    if (params.is_active !== undefined) q.set('is_active', String(params.is_active))
    const { data } = await apiClient.get<StaffMember[]>(`/staff?${q}`)
    return data
  },

  get: async (id: string): Promise<StaffMember> => {
    const { data } = await apiClient.get<StaffMember>(`/staff/${id}`)
    return data
  },

  create: async (payload: {
    full_name: string
    specialization?: string
    type?: StaffType
    phone?: string
    start_date?: string
    note?: string
  }): Promise<StaffMember> => {
    const { data } = await apiClient.post<StaffMember>('/staff', payload)
    return data
  },

  update: async (id: string, payload: Partial<StaffMember>): Promise<StaffMember> => {
    const { data } = await apiClient.put<StaffMember>(`/staff/${id}`, payload)
    return data
  },

  // Rates
  getRates: async (staffId: string): Promise<StaffRate[]> => {
    const { data } = await apiClient.get<StaffRate[]>(`/staff/${staffId}/rates`)
    return data
  },

  createRate: async (staffId: string, payload: {
    activity_id?: string
    rate_category?: RateCategory
    rate_type: RateType
    value_mode?: ValueMode
    rate_value: number
    deduction_pct?: number
    valid_from?: string
    note?: string
    smart_config?: {
      base_lessons: number
      absence_threshold: number
      threshold_rate: number
      attendance_threshold?: number
      starter_rate?: number
      extra_lesson_price?: number
      trial_lesson_price?: number
    }
    vacation_config?: {
      monthly_base_salary:   number
      vacation_days_limit?:  number
      period_start_date:     string
      period_end_date:       string
      calculation_base_type: 'CALENDAR_DAYS' | 'WORKING_DAYS'
      salary_calc_mode?:     'fixed' | 'actual'
      included_rate_ids?:    string[]
    }
  }): Promise<StaffRate> => {
    const { data } = await apiClient.post<StaffRate>(`/staff/${staffId}/rates`, payload)
    return data
  },

  updateRate: async (staffId: string, rateId: string, payload: {
    deduction_pct?: number
    valid_to?: string | null
    note?: string | null
    smart_config?: {
      base_lessons: number
      absence_threshold: number
      threshold_rate: number
      attendance_threshold?: number
      starter_rate?: number
      extra_lesson_price?: number
      trial_lesson_price?: number
    }
    vacation_config?: {
      monthly_base_salary?:   number
      vacation_days_limit?:   number
      period_start_date?:     string
      period_end_date?:       string
      calculation_base_type?: 'CALENDAR_DAYS' | 'WORKING_DAYS'
      salary_calc_mode?:      'fixed' | 'actual'
      included_rate_ids?:     string[]
    }
  }): Promise<StaffRate> => {
    const { data } = await apiClient.put<StaffRate>(`/staff/${staffId}/rates/${rateId}`, payload)
    return data
  },

  getVacationDays: async (staffId: string, year?: number): Promise<{ limit: number; used: number; remaining: number; day_rate: number }> => {
    const q = year ? `?year=${year}` : ''
    const { data } = await apiClient.get(`/staff/${staffId}/vacation-days${q}`)
    return data
  },

  getVacationHistory: async (
    staffId: string,
    params: { rate_id?: string; date_from?: string; date_to?: string },
  ): Promise<{ date: string; gross_amount: number; note: string | null }[]> => {
    const q = new URLSearchParams()
    if (params.rate_id)   q.set('rate_id',   params.rate_id)
    if (params.date_from) q.set('date_from', params.date_from)
    if (params.date_to)   q.set('date_to',   params.date_to)
    const { data } = await apiClient.get(`/staff/${staffId}/vacation-history?${q}`)
    return data
  },

  vacationMarkRange: async (staffId: string, payload: {
    rate_id: string
    date_from: string
    date_to:   string
    note?:     string
  }): Promise<{ created: number }> => {
    const { data } = await apiClient.post(`/staff/${staffId}/vacation-marks-range`, payload)
    return data
  },

  closeRate: async (staffId: string, rateId: string): Promise<void> => {
    await apiClient.delete(`/staff/${staffId}/rates/${rateId}`)
  },

  // Salary
  getSalary: async (staffId: string, month?: string): Promise<SalaryMonthResponse> => {
    const q = month ? `?month=${month}` : ''
    const { data } = await apiClient.get<SalaryMonthResponse>(`/staff/${staffId}/salary${q}`)
    return data
  },

  getSalaryTotal: async (staffId: string): Promise<SalarySummary> => {
    const { data } = await apiClient.get<SalarySummary>(`/staff/${staffId}/salary/total`)
    return data
  },

  addManualAccrual: async (staffId: string, payload: {
    rate_id?: string
    activity_id?: string
    quantity?: number       // for hourly / per_lesson / per_child → gross = quantity × rate_value
    gross_amount?: number   // for fixed_monthly / bonus / free-form
    deduction_pct?: number
    transaction_date?: string
    note?: string
  }): Promise<SalaryTransaction> => {
    const { data } = await apiClient.post<SalaryTransaction>(`/staff/${staffId}/salary`, payload)
    return data
  },

  recalc: async (staffId: string, month: string): Promise<void> => {
    await apiClient.post(`/staff/${staffId}/recalc`, { month })
  },

  deleteAccrual: async (staffId: string, txId: string): Promise<void> => {
    await apiClient.delete(`/staff/${staffId}/salary/${txId}`)
  },

  editAccrual: async (staffId: string, txId: string, payload: {
    gross_amount: number
    edit_note: string
    deduction_pct?: number
  }): Promise<SalaryTransaction> => {
    const { data } = await apiClient.put<SalaryTransaction>(`/staff/${staffId}/salary/${txId}`, payload)
    return data
  },

  pay: async (staffId: string, payload: {
    gross_amount: number
    transaction_date?: string
    billing_month?: string
    account_id?: string
    note?: string
    commission?: number
  }): Promise<{ tx: SalaryTransaction; commission_expense: unknown | null }> => {
    const { data } = await apiClient.post<{ tx: SalaryTransaction; commission_expense: unknown | null }>(`/staff/${staffId}/salary/pay`, payload)
    return data
  },

  getJournal: async (month?: string): Promise<SalaryJournalResponse> => {
    const q = month ? `?month=${month}` : ''
    const { data } = await apiClient.get<SalaryJournalResponse>(`/salary/journal${q}`)
    return data
  },

  getGrid: async (month?: string): Promise<SalaryGridResponse> => {
    const q = month ? `?month=${month}` : ''
    const { data } = await apiClient.get<SalaryGridResponse>(`/salary/grid${q}`)
    return data
  },
}
