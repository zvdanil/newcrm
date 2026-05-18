export type UserRole = 'owner' | 'admin' | 'manager' | 'accountant' | 'teacher' | 'parent'

export interface AuthUser {
  id: string
  email: string
  role: UserRole
}

export interface Child {
  id: string
  full_name: string
  birth_date: string | null
  is_active: boolean
  note: string | null
  created_at: string
  updated_at?: string
  group_id: string | null
  group_name: string | null
  family_id: string | null
  family_name: string | null
  primary_parent_id?: string | null
  primary_parent_name?: string | null
  primary_parent_phone?: string | null
}

export interface Group {
  id: string
  name: string
  sort_order: number
  is_active: boolean
  created_at: string
}

export interface Parent {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  note: string | null
  edrpou: string | null
  iban: string | null
  created_at: string
}

export interface Family {
  id: string
  name: string
  note: string | null
  created_at: string
  primary_parent_id: string
  primary_parent_name: string
  primary_parent_phone: string | null
  children?: Child[]
  members?: Parent[]
}

export interface Account {
  id: string
  name: string
  type: 'fop' | 'cash' | 'bank'
  currency: string
  is_active: boolean
  note: string | null
  created_at: string
}

export interface Tariff {
  id: string
  activity_id: string
  base_fee: string
  valid_from: string
  valid_to: string | null
  created_at: string
}

export interface SmartTariffConfig {
  activity_id: string
  base_lessons: number
  l1_threshold_absences: number | null
  l1_threshold_fee: string | null
  l2_max_refunds: number | null
  l2_refund_per_absence: string | null
  updated_at: string
}

export interface Activity {
  id: string
  name: string
  account_id: string | null
  account_name: string | null
  tariff_type: 'monthly' | 'per_lesson' | 'smart'
  is_rigid: boolean
  is_active: boolean
  has_group_classes: boolean
  auto_group_classes: boolean
  note: string | null
  created_at: string
  current_tariff?: Tariff | null
  linked_activities?: { id: string; name: string; tariff_type: 'monthly' | 'per_lesson' | 'smart' }[]
}

export interface RefundConfig {
  id: string
  activity_id: string
  refund_on_excused: boolean
  refund_amount: string | null
  refund_pct: string | null
  note: string | null
  updated_at: string
}

export interface Enrollment {
  id: string
  child_id: string
  activity_id: string
  activity_name: string
  account_id: string
  account_name: string
  tariff_type: 'monthly' | 'per_lesson' | 'smart'
  is_rigid: boolean
  status: 'active' | 'frozen' | 'archived'
  start_date: string
  end_date: string | null
  frozen_from: string | null
  frozen_to: string | null
  base_fee: string | null
  note: string | null
  created_at: string
}

export type AttendanceStatus = 'present' | 'absent_excused' | 'absent_unexcused' | 'special'

export interface AttendanceLog {
  id: string
  enrollment_id: string
  child_id: string
  activity_id: string
  date: string
  status: AttendanceStatus
  custom_amount: string | null
  note: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface GroupLessonLog {
  id: string
  activity_id: string
  date: string
  status: 'conducted' | 'cancelled'
  lessons_count: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface JournalRow {
  enrollment_id: string
  child_id: string
  child_name: string
  status: 'active' | 'frozen' | 'archived'
  frozen_from: string | null
  frozen_to: string | null
  group_name?: string | null
  logs: Record<string, AttendanceLog>
}

export interface JournalData {
  activity: {
    id: string
    name: string
    tariff_type: 'monthly' | 'per_lesson' | 'smart'
    is_rigid: boolean
    has_group_classes: boolean
    auto_group_classes: boolean
    account_name: string | null
    refund_config: import('./index').RefundConfig | null
  }
  dates: string[]
  rows: JournalRow[]
  group_logs: Record<string, GroupLessonLog>
}

export interface PriceResolution {
  price: number
  rule: 'child_price' | 'child_discount' | 'global_discount' | 'base_fee'
  base_fee?: number
  detail: unknown
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  limit: number
  offset: number
}
