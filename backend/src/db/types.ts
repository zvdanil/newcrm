import type { Generated, ColumnType } from 'kysely'

export type UserRole = 'owner' | 'admin' | 'manager' | 'accountant' | 'teacher' | 'parent' | 'duty_admin'

export interface UsersTable {
  id: Generated<string>
  email: string
  password_hash: string
  role: UserRole
  name: string | null
  staff_id: string | null
  parent_id: string | null
  is_active: Generated<boolean>
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export type InviteType = 'invite' | 'reset'

export interface UserInvitesTable {
  id: Generated<string>
  token: string
  email: string | null
  role: UserRole | null
  staff_id: string | null
  parent_id: string | null
  invited_by: string
  type: InviteType
  expires_at: ColumnType<Date, string, string>
  used_at: ColumnType<Date | null, string | null, string | null>
  created_at: Generated<Date>
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
  edrpou: string | null
  iban: string | null
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
  role: string | null
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
  has_group_classes: Generated<boolean>
  auto_group_classes: Generated<boolean>
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
  status:        'present' | 'absent_excused' | 'absent_unexcused' | 'special' | 'separate_billing'
  custom_amount: ColumnType<string | null, number | string | null, number | string | null>
  note:          string | null
  created_by:    string | null
  created_at:    Generated<Date>
  updated_at:    Generated<Date>
}

export interface GroupLessonLogsTable {
  id:          Generated<string>
  activity_id: string
  date:        ColumnType<Date, string, string>
  status:      'conducted' | 'cancelled'
  lessons_count: Generated<number>
  created_by:  string | null
  created_at:  Generated<Date>
  updated_at:  Generated<Date>
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

export type ExpenseStatus = 'pending' | 'paid'

export interface ExpenseCategoriesTable {
  id:         Generated<string>
  name:       string
  parent_id:  string | null
  is_active:  Generated<boolean>
  sort_order: Generated<number>
  created_at: Generated<Date>
}

export interface ExpensesTable {
  id:                     Generated<string>
  account_id:             string
  category_id:            string | null
  amount:                 ColumnType<string, number | string, number | string>
  accrual_date:           ColumnType<Date, string, string>
  payment_date:           ColumnType<Date | null, string | null, string | null>
  status:                 Generated<ExpenseStatus>
  is_instant:             Generated<boolean>
  is_dividend:            Generated<boolean>
  note:                   string | null
  created_by:             string | null
  withdrawal_transfer_id: string | null
  withdrawal_amount:      ColumnType<string | null, number | string | null, number | string | null>
  dividend_payout_id:     string | null
  dividend_amount:        ColumnType<string | null, number | string | null, number | string | null>
  is_deleted:             Generated<boolean>
  deleted_at:             ColumnType<Date | null, string | null, string | null>
  deleted_by:             string | null
  created_at:             Generated<Date>
  staff_id:               string | null
  is_advance:             Generated<boolean>
  is_advance_return:      Generated<boolean>
  utilized_advance_id:    string | null
  utilized_advance_amount: ColumnType<string | null, number | string | null, number | string | null>
  advance_staff_id:       string | null
}

export interface ExpenseAdvanceUsagesTable {
  id:         Generated<string>
  expense_id: string
  advance_id: string
  amount:     ColumnType<string, number | string, number | string>
  created_at: Generated<Date>
}

export interface AccountTransfersTable {
  id:              Generated<string>
  from_account_id: string
  to_account_id:   string
  amount:          ColumnType<string, number | string, number | string>
  commission:      ColumnType<string, number | string, number | string>
  transfer_date:   ColumnType<Date, string, string>
  note:            string | null
  created_by:      string | null
  created_at:      Generated<Date>
}

export interface InterAccountImbalancesTable {
  id:              Generated<string>
  from_account_id: string
  to_account_id:   string
  amount:          ColumnType<string, number | string, number | string>
  transaction_id:  string | null
  note:            string | null
  created_at:      Generated<Date>
  resolved_at:     ColumnType<Date | null, string | null, string | null>
  resolved_by:     string | null
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

export type StaffType     = 'employee' | 'partner'
export type RateCategory  = 'auto' | 'manual'
export type RateType      = 'per_lesson' | 'per_child' | 'fixed_monthly' | 'hourly' | 'smart' | 'bonus' | 'group_lesson' | 'smart_per_child' | 'monthly_by_day' | 'vacation'
export type SalaryTxType  = 'ACCRUAL' | 'PAYMENT' | 'CORRECTION'

export interface StaffTable {
  id:             Generated<string>
  full_name:      string
  specialization: string | null
  type:           Generated<StaffType>
  phone:          string | null
  start_date:     ColumnType<Date | null, string | null, string | null>
  is_active:      Generated<boolean>
  note:           string | null
  created_at:     Generated<Date>
}

export interface StaffRatesTable {
  id:            Generated<string>
  staff_id:      string
  activity_id:   string | null
  rate_category: Generated<RateCategory>
  rate_type:     RateType
  value_mode:    Generated<'fixed' | 'percent_of_revenue'>
  rate_value:    ColumnType<string, number | string, number | string>
  deduction_pct: ColumnType<string, number | string, number | string>
  valid_from:    ColumnType<Date, string, string>
  valid_to:      ColumnType<Date | null, string | null, string | null>
  note:          string | null
  created_at:    Generated<Date>
}

export interface StaffSmartConfigsTable {
  rate_id:              string
  base_lessons:         Generated<number>
  absence_threshold:    number
  threshold_rate:       ColumnType<string, number | string, number | string>
  attendance_threshold: Generated<number>
  starter_rate:         ColumnType<string, number | string, number | string>
  extra_lesson_price:   ColumnType<string, number | string, number | string>
  trial_lesson_price:   ColumnType<string, number | string, number | string>
  updated_at:           Generated<Date>
}

export interface StaffVacationConfigsTable {
  rate_id:               string
  monthly_base_salary:   ColumnType<string, number | string, number | string>
  vacation_days_limit:   Generated<number>
  period_start_date:     ColumnType<Date, string, string>
  period_end_date:       ColumnType<Date, string, string>
  calculation_base_type: Generated<'CALENDAR_DAYS' | 'WORKING_DAYS'>
  day_rate_cached:       ColumnType<string, number | string, number | string>
  salary_calc_mode:      Generated<'fixed' | 'actual'>
  included_rate_ids:     ColumnType<unknown | null, string | null, string | null>
  updated_at:            Generated<Date>
}

export interface SalaryTransactionsTable {
  id:               Generated<string>
  staff_id:         string
  rate_id:          string | null
  activity_id:      string | null
  account_id:       string | null
  type:             SalaryTxType
  gross_amount:     ColumnType<string, number | string, number | string>
  deduction_pct:    ColumnType<string, number | string, number | string>
  transaction_date: ColumnType<Date, string, string>
  billing_month:    ColumnType<Date | null, string | null, string | null>
  note:             string | null
  edit_note:        string | null
  metadata_json:    ColumnType<unknown | null, object | null, object | null>
  is_dividend:              Generated<boolean>
  withdrawal_transfer_id:   string | null
  dividend_payout_id:       string | null
  is_deleted:       Generated<boolean>
  deleted_at:       ColumnType<Date | null, string | null, string | null>
  deleted_by:       string | null
  created_by:       string | null
  created_at:       Generated<Date>
}

export interface ChildIndividualTariffsTable {
  id:          Generated<string>
  child_id:    string
  activity_id: string
  tariff_type: 'monthly' | 'per_lesson' | 'smart'
  price:       ColumnType<string, number | string, number | string>
  valid_from:  ColumnType<Date, string, string>
  valid_to:    ColumnType<Date | null, string | null, string | null>
  created_at:  Generated<Date>
  created_by:  string | null
}

export interface ChildSmartTariffConfigsTable {
  individual_tariff_id:  string
  base_lessons:          Generated<number>
  l1_threshold_absences: number | null
  l1_threshold_fee:      ColumnType<string | null, number | string | null, number | string | null>
  l2_max_refunds:        number | null
  l2_refund_per_absence: ColumnType<string | null, number | string | null, number | string | null>
  updated_at:            Generated<Date>
}

export interface ChildParentsTable {
  child_id:   string
  parent_id:  string
  role:       string | null
  created_at: Generated<Date>
}

export interface MergedJournalsTable {
  id:         Generated<string>
  name:       string
  note:       string | null
  created_at: Generated<Date>
  created_by: string | null
}

export interface MergedJournalActivitiesTable {
  merged_journal_id: string
  activity_id:       string
  sort_order:        Generated<number>
}

export interface ActivitySchedulesTable {
  id:                Generated<string>
  activity_id:       string | null
  merged_journal_id: string | null
  staff_id:          string | null
  room:              string | null
  name:              string | null
  start_time:        string           // TIME stored as string HH:MM:SS
  duration_min:      Generated<number>
  rrule:             string
  dtstart:           ColumnType<Date, string, string>
  dtend:             ColumnType<Date | null, string | null, string | null>
  color:             string | null
  is_active:         Generated<boolean>
  note:              string | null
  created_at:        Generated<Date>
  updated_at:        Generated<Date>
}

export interface ScheduleExceptionsTable {
  id:             Generated<string>
  schedule_id:    string
  original_date:  ColumnType<Date, string, string>
  exception_type: 'cancelled' | 'moved'
  new_date:       ColumnType<Date | null, string | null, string | null>
  new_start_time: string | null
  note:           string | null
  created_by:     string | null
  created_at:     Generated<Date>
}

export interface ExpenseEditsTable {
  id:         Generated<string>
  expense_id: string
  edited_by:  string | null
  edited_at:  Generated<Date>
  field_name: string
  old_value:  string | null
  new_value:  string | null
  edit_note:  string | null
}
export interface SubstitutionsTable {
  id:                  Generated<string>
  schedule_id:         string
  occurrence_date:     ColumnType<Date, string, string>
  original_staff_id:   string | null
  substitute_staff_id: string
  rate_override:       ColumnType<string, number | string, number | string>
  salary_tx_id:        string | null
  note:                string | null
  created_by:          string | null
  created_at:          Generated<Date>
}

export interface ImportTemplatesTable {
  id:                   Generated<string>
  name:                 string
  description:          string | null
  header_row_index:     Generated<number>
  data_start_row_index: Generated<number>
  col_date:             string
  col_amount:           string
  col_type:             string | null
  col_type_credit_value: string | null
  col_counterparty:     string | null
  col_inn:              string | null
  col_iban:             string | null
  col_description:      string | null
  col_doc_number:       string | null
  col_reference:        string | null
  amount_negate:        Generated<boolean>
  created_by:           string | null
  created_at:           Generated<Date>
  updated_at:           Generated<Date>
}

export interface ExpenseImportRulesTable {
  id:              Generated<string>
  account_id:      string
  edrpou:          string | null
  iban:            string | null
  keyword_pattern: string | null
  category_id:     string | null
  is_skip:         Generated<boolean>
  match_count:     Generated<number>
  last_matched_at: Date | null
  created_at:      Generated<Date>
  updated_at:      Generated<Date>
}

export interface BankPayerProfilesTable {
  id:                Generated<string>
  child_id:          string
  counterparty_name: string
  inn:               string | null
  iban:              string | null
  import_count:      Generated<number>
  last_import_date:  ColumnType<Date, string, string>
  note:              string | null
  created_at:        Generated<Date>
  updated_at:        Generated<Date>
}

export interface AccountIncomeTable {
  id:          Generated<string>
  account_id:  string
  income_date: ColumnType<Date, string, string>
  amount:      ColumnType<string, number | string, number | string>
  payer_name:  string | null
  note:        string | null
  created_at:  Generated<Date>
  created_by:  string | null
  is_deleted:  Generated<boolean>
  deleted_at:  ColumnType<Date | null, string | null, string | null>
  deleted_by:  string | null
}

export interface AccountCorrectionsTable {
  id:              Generated<string>
  account_id:      string
  correction_date: ColumnType<Date, string, string>
  amount:          ColumnType<string, number | string, number | string>
  note:            string | null
  created_at:      Generated<Date>
  created_by:      string | null
  is_deleted:      Generated<boolean>
  deleted_at:      ColumnType<Date | null, string | null, string | null>
  deleted_by:      string | null
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
  smart_tariff_configs:       SmartTariffConfigsTable
  inter_account_imbalances:   InterAccountImbalancesTable
  expense_categories:         ExpenseCategoriesTable
  expenses:                   ExpensesTable
  account_transfers:          AccountTransfersTable
  staff:                      StaffTable
  staff_rates:                StaffRatesTable
  staff_smart_configs:        StaffSmartConfigsTable
  staff_vacation_configs:     StaffVacationConfigsTable
  salary_transactions:        SalaryTransactionsTable
  merged_journals:            MergedJournalsTable
  merged_journal_activities:  MergedJournalActivitiesTable
  child_individual_tariffs:   ChildIndividualTariffsTable
  child_smart_tariff_configs: ChildSmartTariffConfigsTable
  group_lesson_logs:          GroupLessonLogsTable
  activity_schedules:         ActivitySchedulesTable
  schedule_exceptions:        ScheduleExceptionsTable
  substitutions:              SubstitutionsTable
  equity_participants:        EquityParticipantsTable
  dividend_settings:          DividendSettingsTable
  dividend_payouts:           DividendPayoutsTable
  expense_edits:              ExpenseEditsTable
  user_invites:               UserInvitesTable
  child_parents:              ChildParentsTable
  import_templates:           ImportTemplatesTable
  expense_import_rules:       ExpenseImportRulesTable
  bank_payer_profiles:        BankPayerProfilesTable
  account_income:             AccountIncomeTable
  account_corrections:        AccountCorrectionsTable
  expense_advance_usages:     ExpenseAdvanceUsagesTable
}

export interface EquityParticipantsTable {
  id:         Generated<string>
  name:       string
  share_pct:  ColumnType<string, number | string, number | string>
  is_active:  Generated<boolean>
  created_at: Generated<Date>
}

export interface DividendSettingsTable {
  id:              Generated<number>
  default_tax_pct: ColumnType<string, number | string, number | string>
}

export interface DividendPayoutsTable {
  id:             Generated<string>
  participant_id: string
  date:           ColumnType<Date, string, string>
  type:           'cash' | 'cashless'
  tax_pct:        ColumnType<string, number | string, number | string>
  gross_amount:   ColumnType<string, number | string, number | string>
  net_amount:     ColumnType<string, number | string, number | string>
  note:           string | null
  is_deleted:     Generated<boolean>
  deleted_at:     ColumnType<Date | null, string | null, string | null>
  deleted_by:     string | null
  created_by:     string | null
  created_at:     Generated<Date>
}
