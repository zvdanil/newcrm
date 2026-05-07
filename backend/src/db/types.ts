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
  tariff_type: Generated<'monthly' | 'per_lesson' | 'smart'>
  is_rigid:    Generated<boolean>
  is_active:   Generated<boolean>
  note:        string | null
  created_at:  Generated<Date>
}

export interface SmartTariffConfigsTable {
  activity_id:           string
  base_lessons:          Generated<number>
  l1_threshold_absences: number | null
  l1_threshold_fee:      ColumnType<string | null, number | string | null, number | string | null>
  l2_max_refunds:        number | null
  l2_refund_per_absence: ColumnType<string | null, number | string | null, number | string | null>
  updated_at:            Generated<Date>
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

export type TransactionType = 'ACCRUAL' | 'PAYMENT' | 'REFUND' | 'REVERSAL' | 'ADJUSTMENT'

export interface TransactionsTable {
  id:               Generated<string>
  type:             TransactionType
  child_id:         string
  account_id:       string
  activity_id:      string | null
  enrollment_id:    string | null
  amount:           ColumnType<string, number | string, number | string>
  transaction_date: ColumnType<Date, string, string>
  billing_month:    ColumnType<Date | null, string | null, string | null>
  note:             string | null
  metadata_json:    ColumnType<unknown | null, object | null, object | null>
  is_deleted:       Generated<boolean>
  deleted_at:       ColumnType<Date | null, string | null, string | null>
  deleted_by:       string | null
  created_by:       string | null
  created_at:       Generated<Date>
}

export interface ChildBalancesTable {
  child_id:   string
  account_id: string
  balance:    ColumnType<string, number | string, number | string>
  updated_at: Generated<Date>
}

export interface InitialBalancesTable {
  id:         Generated<string>
  child_id:   string
  account_id: string
  amount:     ColumnType<string, number | string, number | string>
  note:       string | null
  created_by: string | null
  created_at: Generated<Date>
}

export interface BillingRunLogTable {
  id:             Generated<string>
  billing_month:  ColumnType<Date, string, string>
  started_at:     Generated<Date>
  finished_at:    ColumnType<Date | null, string | null, string | null>
  created_count:  Generated<number>
  adjusted_count: Generated<number>
  skipped_count:  Generated<number>
  triggered_by:   string | null
  error:          string | null
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
  transactions:          TransactionsTable
  child_balances:        ChildBalancesTable
  initial_balances:      InitialBalancesTable
  billing_run_log:       BillingRunLogTable
  smart_tariff_configs:  SmartTariffConfigsTable
}
