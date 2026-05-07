import type { Generated, ColumnType } from 'kysely'

export type UserRole = 'owner' | 'admin' | 'manager' | 'accountant' | 'teacher' | 'parent'

export interface UsersTable {
  id: Generated<string>
  email: string
  password_hash: string
  role: UserRole
  is_active: Generated<boolean>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface GroupsTable {
  id: Generated<string>
  name: string
  sort_order: Generated<number>
  is_active: Generated<boolean>
  created_at: Generated<Date>
}

export interface ParentsTable {
  id: Generated<string>
  full_name: string
  phone: string | null
  email: string | null
  user_id: string | null
  note: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface FamiliesTable {
  id: Generated<string>
  name: string
  primary_parent_id: string
  note: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface FamilyMembersTable {
  family_id: string
  parent_id: string
}

export interface ChildrenTable {
  id: Generated<string>
  full_name: string
  birth_date: ColumnType<Date | null, string | null, string | null>
  family_id: string | null
  group_id: string | null
  is_active: Generated<boolean>
  note: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface AccountsTable {
  id:         Generated<string>
  name:       string
  type:       'fop' | 'cash' | 'bank'
  currency:   Generated<string>
  is_active:  Generated<boolean>
  note:       string | null
  created_at: Generated<Date>
}

export interface ActivitiesTable {
  id:          Generated<string>
  name:        string
  account_id:  string | null
  tariff_type: Generated<'monthly' | 'per_lesson'>
  is_rigid:    Generated<boolean>
  is_active:   Generated<boolean>
  note:        string | null
  created_at:  Generated<Date>
}

export interface TariffsTable {
  id:          Generated<string>
  activity_id: string
  base_fee:    ColumnType<string, number | string, number | string>
  valid_from:  ColumnType<Date, string, string>
  valid_to:    ColumnType<Date | null, string | null, string | null>
  created_at:  Generated<Date>
}

export interface LinkedActivitiesTable {
  parent_activity_id: string
  child_activity_id:  string
}

export interface EnrollmentsTable {
  id:          Generated<string>
  child_id:    string
  activity_id: string
  account_id:  string
  status:      Generated<'active' | 'frozen' | 'archived'>
  start_date:  ColumnType<Date, string, string>
  end_date:    ColumnType<Date | null, string | null, string | null>
  frozen_from: ColumnType<Date | null, string | null, string | null>
  frozen_to:   ColumnType<Date | null, string | null, string | null>
  note:        string | null
  created_at:  Generated<Date>
  updated_at:  Generated<Date>
}

export interface ChildPricesTable {
  id:           Generated<string>
  child_id:     string
  activity_id:  string
  price:        ColumnType<string | null, number | string | null, number | string | null>
  discount_pct: ColumnType<string | null, number | string | null, number | string | null>
  valid_from:   ColumnType<Date, string, string>
  valid_to:     ColumnType<Date | null, string | null, string | null>
  created_at:   Generated<Date>
}

export interface ChildGlobalDiscountsTable {
  id:           Generated<string>
  child_id:     string
  discount_pct: ColumnType<string, number | string, number | string>
  valid_from:   ColumnType<Date, string, string>
  valid_to:     ColumnType<Date | null, string | null, string | null>
  created_at:   Generated<Date>
}

export interface AttendanceLogsTable {
  id:            Generated<string>
  enrollment_id: string
  child_id:      string
  activity_id:   string
  date:          ColumnType<Date, string, string>
  status:        'present' | 'absent_excused' | 'absent_unexcused' | 'special'
  custom_amount: ColumnType<string | null, number | string | null, number | string | null>
  note:          string | null
  created_by:    string | null
  created_at:    Generated<Date>
  updated_at:    Generated<Date>
}

export interface RefundConfigsTable {
  id:                Generated<string>
  activity_id:       string
  refund_on_excused: Generated<boolean>
  refund_amount:     ColumnType<string | null, number | string | null, number | string | null>
  refund_pct:        ColumnType<string | null, number | string | null, number | string | null>
  note:              string | null
  updated_at:        Generated<Date>
}

export interface Database {
  users:                 UsersTable
  groups:                GroupsTable
  parents:               ParentsTable
  families:              FamiliesTable
  family_members:        FamilyMembersTable
  children:              ChildrenTable
  accounts:              AccountsTable
  activities:            ActivitiesTable
  tariffs:               TariffsTable
  linked_activities:     LinkedActivitiesTable
  enrollments:           EnrollmentsTable
  child_prices:          ChildPricesTable
  child_global_discounts: ChildGlobalDiscountsTable
  refund_configs:        RefundConfigsTable
  attendance_logs:       AttendanceLogsTable
}
