/**
 * ETL Migration: Old Supabase → КіндерCRM
 *
 * Recommended (Supabase REST API, no row limits):
 *   node db/import_from_supabase/index.js \
 *     --from 2026-05-01 --to 2026-05-31 \
 *     --source-api "https://YOUR_PROJECT.supabase.co/rest/v1" \
 *     --api-key   "YOUR_SERVICE_ROLE_KEY" \
 *     [--dry-run]
 *
 * Alternative (direct DB):
 *   node db/import_from_supabase/index.js \
 *     --from 2026-05-01 --to 2026-05-31 \
 *     --source-db "postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres" \
 *     [--dry-run]
 *
 * Fallback (JSON files):
 *   node db/import_from_supabase/index.js \
 *     --from 2026-05-01 --to 2026-05-31 \
 *     [--data ./db/migration_data] [--dry-run]
 *
 * Env:
 *   DATABASE_URL — connection string for the NEW КіндерCRM database
 */

import { readFileSync, existsSync } from 'fs'
import { randomUUID }               from 'crypto'
import { parseArgs }                from 'util'
import { join, dirname }            from 'path'
import { fileURLToPath }            from 'url'
import pg                           from 'pg'
import { config }                   from 'dotenv'

config({ path: '.env' })

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── CLI ───────────────────────────────────────────────────────────────────────
const { values: args } = parseArgs({
  options: {
    from:        { type: 'string' },
    to:          { type: 'string' },
    'source-db': { type: 'string' },
    data:        { type: 'string', default: join(__dirname, '../migration_data') },
    'dry-run':   { type: 'boolean', default: false },
  },
  strict: false,
})

const FROM_DATE  = args.from
const TO_DATE    = args.to
const SOURCE_DB  = args['source-db']
const DATA_DIR   = args.data
const DRY_RUN    = args['dry-run']

if (!FROM_DATE || !TO_DATE) {
  console.error('Usage: node index.js --from YYYY-MM-DD --to YYYY-MM-DD [--source-db URL]')
  process.exit(1)
}

// ── Mapping ───────────────────────────────────────────────────────────────────

const mapActivityType = (t) => ({
  subscription: 'monthly',
  per_session:  'per_lesson',
  monthly:      'monthly',
  per_lesson:   'per_lesson',
  smart:        'smart',
}[t] ?? 'monthly')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const mapAttendanceStatus = (s) => {
  if (!s)              return 'present'
  if (UUID_RE.test(s)) return 'special'
  return {
    present:          'present',
    attended:         'present',
    absent:           'absent_unexcused',
    absent_excused:   'absent_excused',
    excused:          'absent_excused',
    sick:             'absent_excused',
    vacation:         'absent_excused',
    absent_unexcused: 'absent_unexcused',
    special:          'special',
  }[s] ?? 'present'
}

const mapEnrollmentStatus = (isActive) => (isActive ? 'active' : 'archived')
const mapStudentActive    = (s) => !['inactive', 'archived', 'left'].includes(s)

const mapStaffRateType = (t) => ({
  per_session: 'per_lesson',
  per_lesson:  'per_lesson',
  per_student: 'per_child',
  per_child:   'per_child',
  fixed:       'fixed_monthly',
  monthly:     'fixed_monthly',
  hourly:      'hourly',
  bonus:       'bonus',
  smart:       'smart',
}[t] ?? 'per_lesson')

// ── Constants ─────────────────────────────────────────────────────────────────
const MIGRATION_USER_ID = '00000000-0000-0000-0000-000000000001'

// ── DB connections ────────────────────────────────────────────────────────────
const targetPool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
let   sourcePool = null

if (SOURCE_DB) {
  sourcePool = new pg.Pool({
    connectionString: SOURCE_DB,
    ssl: { rejectUnauthorized: false },  // required for Supabase
  })
}

// ── Data loader: DB or JSON file ──────────────────────────────────────────────
async function load(filename, query, params = []) {
  if (sourcePool) {
    const { rows } = await sourcePool.query(query, params)
    return rows
  }
  const p = join(DATA_DIR, filename)
  if (!existsSync(p)) { console.warn(`  ⚠  ${filename} not found — skipping`); return [] }
  const raw = JSON.parse(readFileSync(p, 'utf8'))
  return Array.isArray(raw) ? raw : (raw.data ?? [])
}

// ── Insert helper ─────────────────────────────────────────────────────────────
async function insert(client, table, row) {
  const clean = Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined))
  if (DRY_RUN) {
    console.log(`  [dry] INSERT ${table}:`, JSON.stringify(clean).slice(0, 120))
    return
  }
  const keys = Object.keys(clean)
  const vals = keys.map((_, i) => `$${i + 1}`)
  await client.query(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT (id) DO NOTHING`,
    Object.values(clean)
  )
}

function billingMonthFrom(s) {
  if (!s) return null
  const m = s.match(/(\d{4})[^\d](\d{1,2})/)
  return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-01` : null
}

// ── Migration steps ───────────────────────────────────────────────────────────

async function ensureMigrationUser(client) {
  if (!DRY_RUN) {
    await client.query(`
      INSERT INTO users (id, email, password_hash, role, is_active)
      VALUES ($1, 'migration@system.internal', 'n/a', 'admin', false)
      ON CONFLICT (id) DO NOTHING
    `, [MIGRATION_USER_ID])
  }
  console.log('✓ migration system user')
}

async function importGroups(client) {
  const rows = await load('groups.json', 'SELECT id, name, created_at FROM groups ORDER BY name')
  for (const r of rows) {
    await insert(client, 'groups', { id: r.id, name: r.name, sort_order: 0, is_active: true, created_at: r.created_at })
  }
  console.log(`✓ groups: ${rows.length}`)
}

async function importAccounts(client) {
  const rows = await load('payment_accounts.json', `
    SELECT id, name, description, is_active, created_at, updated_at
    FROM payment_accounts
    WHERE is_active = true
       OR id IN (
         SELECT DISTINCT account_id FROM finance_transactions
         WHERE date BETWEEN $1 AND $2
         UNION
         SELECT DISTINCT account_id FROM staff_payouts
         WHERE payout_date BETWEEN $1 AND $2
       )
    ORDER BY name
  `, [FROM_DATE, TO_DATE])
  for (const r of rows) {
    await insert(client, 'accounts', {
      id: r.id, name: r.name, type: 'fop', currency: 'UAH',
      is_active: r.is_active ?? true, note: r.description ?? null, created_at: r.created_at,
    })
  }
  console.log(`✓ accounts: ${rows.length}`)
}

async function importStudents(client) {
  const rows = await load('students.json', `
    SELECT id, full_name, birth_date, guardian_name, guardian_phone,
           guardian_email, status, custom_fields, group_id, created_at, updated_at
    FROM students
    WHERE id IN (
      SELECT DISTINCT student_id FROM enrollments
      WHERE enrolled_at::date <= $2
        AND (unenrolled_at IS NULL OR unenrolled_at::date >= $1)
    )
    ORDER BY full_name
  `, [FROM_DATE, TO_DATE])

  for (const r of rows) {
    const parentId = randomUUID()
    await insert(client, 'parents', {
      id: parentId, full_name: r.guardian_name ?? r.full_name,
      phone: r.guardian_phone ?? null, email: r.guardian_email ?? null,
      user_id: null, note: null, created_at: r.created_at, updated_at: r.updated_at,
    })
    const familyId = randomUUID()
    await insert(client, 'families', {
      id: familyId, name: r.guardian_name ?? r.full_name,
      primary_parent_id: parentId, note: null, created_at: r.created_at, updated_at: r.updated_at,
    })
    if (!DRY_RUN) {
      await client.query(
        'INSERT INTO family_members (family_id, parent_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [familyId, parentId]
      )
    }
    await insert(client, 'children', {
      id: r.id, full_name: r.full_name, birth_date: r.birth_date ?? null,
      family_id: familyId, group_id: r.group_id ?? null,
      is_active: mapStudentActive(r.status),
      note: r.custom_fields ? JSON.stringify(r.custom_fields) : null,
      created_at: r.created_at, updated_at: r.updated_at,
    })
  }
  console.log(`✓ students → children + families + parents: ${rows.length}`)
}

async function importActivities(client) {
  const rows = await load('activities.json', `
    SELECT id, name, default_price, payment_type, description, is_active, account_id, created_at, updated_at
    FROM activities
    WHERE id IN (
      SELECT DISTINCT activity_id FROM enrollments
      WHERE enrolled_at::date <= $2
        AND (unenrolled_at IS NULL OR unenrolled_at::date >= $1)
    )
    ORDER BY name
  `, [FROM_DATE, TO_DATE])

  for (const r of rows) {
    await insert(client, 'activities', {
      id: r.id, name: r.name, account_id: r.account_id ?? null,
      tariff_type: mapActivityType(r.payment_type), is_rigid: false,
      is_active: r.is_active ?? true, show_in_children: true, show_in_journals: true,
      note: r.description ?? null, created_at: r.created_at,
    })
    if (r.default_price != null) {
      await insert(client, 'tariffs', {
        id: randomUUID(), activity_id: r.id, base_fee: r.default_price,
        valid_from: FROM_DATE, valid_to: null, created_at: r.created_at,
      })
    }
  }
  console.log(`✓ activities: ${rows.length}`)
}

async function importEnrollments(client) {
  const rows = await load('enrollments.json', `
    SELECT id, student_id, activity_id, account_id, is_active, effective_from,
           enrolled_at, unenrolled_at, custom_price, discount_percent, created_at, updated_at
    FROM enrollments
    WHERE enrolled_at::date <= $2
      AND (unenrolled_at IS NULL OR unenrolled_at::date >= $1)
    ORDER BY enrolled_at
  `, [FROM_DATE, TO_DATE])

  for (const r of rows) {
    const startDate = r.effective_from ?? r.enrolled_at?.slice(0, 10) ?? FROM_DATE
    const endDate   = r.unenrolled_at ? r.unenrolled_at.slice(0, 10) : null
    await insert(client, 'enrollments', {
      id: r.id, child_id: r.student_id, activity_id: r.activity_id,
      account_id: r.account_id ?? null, status: mapEnrollmentStatus(r.is_active),
      start_date: startDate, end_date: endDate, note: null,
      created_at: r.created_at, updated_at: r.updated_at,
    })
    if (r.custom_price != null || r.discount_percent != null) {
      await insert(client, 'child_prices', {
        id: randomUUID(), child_id: r.student_id, activity_id: r.activity_id,
        price: r.custom_price ?? null, discount_pct: r.discount_percent ?? null,
        valid_from: startDate, valid_to: endDate, created_at: r.created_at,
      })
    }
  }
  console.log(`✓ enrollments: ${rows.length}`)
}

async function importAttendance(client) {
  const rows = await load('attendance.json', `
    SELECT a.id, a.enrollment_id, e.student_id AS child_id, e.activity_id,
           a.date, a.status, a.charged_amount, a.notes, a.created_at, a.updated_at
    FROM attendance a
    JOIN enrollments e ON e.id = a.enrollment_id
    WHERE a.date BETWEEN $1 AND $2
    ORDER BY a.date, e.student_id
  `, [FROM_DATE, TO_DATE])

  for (const r of rows) {
    const status = mapAttendanceStatus(r.status)
    await insert(client, 'attendance_logs', {
      id: r.id, enrollment_id: r.enrollment_id, child_id: r.child_id,
      activity_id: r.activity_id, date: r.date, status,
      custom_amount: status === 'special' && r.charged_amount > 0 ? r.charged_amount : null,
      note: r.notes ?? null, created_by: MIGRATION_USER_ID,
      created_at: r.created_at, updated_at: r.updated_at,
    })
  }
  console.log(`✓ attendance_logs: ${rows.length}`)
}

async function importParentPayments(client) {
  const rows = await load('parent_payments.json', `
    SELECT id, student_id, activity_id, account_id, amount, date, description, created_at
    FROM finance_transactions
    WHERE student_id IS NOT NULL
      AND date BETWEEN $1 AND $2
      AND type IN ('income', 'payment')
    ORDER BY date, student_id
  `, [FROM_DATE, TO_DATE])

  for (const r of rows) {
    await insert(client, 'transactions', {
      id: r.id, type: 'PAYMENT', child_id: r.student_id,
      account_id: r.account_id ?? null, activity_id: r.activity_id ?? null,
      enrollment_id: null, amount: r.amount, transaction_date: r.date,
      billing_month: null, note: r.description ?? null,
      metadata_json: JSON.stringify({ source_id: r.id, migrated: true }),
      is_deleted: false, created_by: MIGRATION_USER_ID, created_at: r.created_at,
    })
  }

  if (!DRY_RUN) {
    await client.query(`
      INSERT INTO child_balances (child_id, account_id, balance, updated_at)
      SELECT child_id, account_id,
             COALESCE(SUM(CASE
               WHEN type IN ('PAYMENT','REFUND') THEN  amount
               WHEN type = 'ACCRUAL'             THEN -amount
               ELSE 0 END), 0), NOW()
      FROM transactions WHERE is_deleted = false AND account_id IS NOT NULL
      GROUP BY child_id, account_id
      ON CONFLICT (child_id, account_id)
      DO UPDATE SET balance = EXCLUDED.balance, updated_at = NOW()
    `)
    console.log('  → child_balances recalculated')
  }
  console.log(`✓ transactions (PAYMENT): ${rows.length}`)
}

async function importStaff(client) {
  const rows = await load('staff.json', `
    SELECT id, full_name, position, tariff_type, tariff_value, is_active,
           accrual_mode, manual_rate_type, manual_rate_value, created_at, updated_at
    FROM staff
    WHERE is_active = true
       OR id IN (
         SELECT DISTINCT staff_id FROM staff_payouts
         WHERE payout_date BETWEEN $1 AND $2 AND is_deleted = false
         UNION
         SELECT DISTINCT staff_id FROM staff_journal_entries
         WHERE date BETWEEN $1 AND $2
       )
    ORDER BY full_name
  `, [FROM_DATE, TO_DATE])

  for (const r of rows) {
    await insert(client, 'staff', {
      id: r.id, full_name: r.full_name, specialization: r.position ?? null,
      type: 'employee', is_active: r.is_active ?? true, note: null, created_at: r.created_at,
    })
    const rateValue = r.tariff_value ?? r.manual_rate_value
    if (rateValue != null && rateValue > 0) {
      await insert(client, 'staff_rates', {
        id: randomUUID(), staff_id: r.id, activity_id: null, rate_category: 'auto',
        rate_type: mapStaffRateType(r.tariff_type ?? r.manual_rate_type),
        value_mode: 'fixed', rate_value: rateValue, deduction_pct: 0,
        valid_from: FROM_DATE, valid_to: null,
        note: 'Мігровано зі старої системи', created_at: r.created_at,
      })
    }
  }
  console.log(`✓ staff: ${rows.length}`)
}

async function importSalaryPayments(client) {
  const rows = await load('staff_payouts.json', `
    SELECT id, staff_id, amount, payout_date, notes, account_id,
           payout_for_period, is_deleted, created_at, updated_at
    FROM staff_payouts
    WHERE payout_date BETWEEN $1 AND $2 AND is_deleted = false
    ORDER BY payout_date, staff_id
  `, [FROM_DATE, TO_DATE])

  for (const r of rows) {
    if (r.is_deleted) continue
    await insert(client, 'salary_transactions', {
      id: r.id, staff_id: r.staff_id, rate_id: null, activity_id: null,
      type: 'PAYMENT', gross_amount: r.amount, deduction_pct: 0,
      transaction_date: r.payout_date, billing_month: billingMonthFrom(r.payout_for_period),
      note: r.notes ?? null, edit_note: null,
      metadata_json: JSON.stringify({ source_id: r.id, account_id: r.account_id, migrated: true }),
      is_deleted: false, created_by: MIGRATION_USER_ID, created_at: r.created_at,
    })
  }
  console.log(`✓ salary_transactions (PAYMENT): ${rows.length}`)
}

async function importSalaryAccruals(client) {
  const rows = await load('staff_journal_entries.json', `
    SELECT id, staff_id, activity_id, date, amount, calculated_amount,
           description, notes, bonus, bonus_notes, created_at, updated_at
    FROM staff_journal_entries
    WHERE date BETWEEN $1 AND $2
    ORDER BY date, staff_id
  `, [FROM_DATE, TO_DATE])

  let accruals = 0, bonuses = 0
  for (const r of rows) {
    const amount = r.amount ?? r.calculated_amount ?? 0
    if (amount > 0) {
      await insert(client, 'salary_transactions', {
        id: r.id, staff_id: r.staff_id, rate_id: null, activity_id: r.activity_id ?? null,
        type: 'ACCRUAL', gross_amount: amount, deduction_pct: 0,
        transaction_date: r.date, billing_month: null,
        note: r.description ?? r.notes ?? null, edit_note: null,
        metadata_json: JSON.stringify({ source_id: r.id, migrated: true }),
        is_deleted: false, created_by: MIGRATION_USER_ID, created_at: r.created_at,
      })
      accruals++
    }
    if (r.bonus != null && r.bonus > 0) {
      await insert(client, 'salary_transactions', {
        id: randomUUID(), staff_id: r.staff_id, rate_id: null, activity_id: r.activity_id ?? null,
        type: 'ACCRUAL', gross_amount: r.bonus, deduction_pct: 0,
        transaction_date: r.date, billing_month: null,
        note: r.bonus_notes ?? 'Бонус', edit_note: null,
        metadata_json: JSON.stringify({ source_id: r.id, is_bonus: true, migrated: true }),
        is_deleted: false, created_by: MIGRATION_USER_ID, created_at: r.created_at,
      })
      bonuses++
    }
  }
  console.log(`✓ salary_transactions (ACCRUAL): ${accruals}, бонусы: ${bonuses}`)
}

async function printVerification(client) {
  if (DRY_RUN) return
  const { rows } = await client.query(`
    SELECT 'children'               AS entity, COUNT(*)::int AS cnt FROM children
    UNION ALL SELECT 'activities',             COUNT(*) FROM activities
    UNION ALL SELECT 'enrollments',            COUNT(*) FROM enrollments
    UNION ALL SELECT 'attendance_logs',        COUNT(*) FROM attendance_logs
    UNION ALL SELECT 'transactions (PAYMENT)', COUNT(*) FROM transactions WHERE type='PAYMENT'
    UNION ALL SELECT 'staff',                  COUNT(*) FROM staff
    UNION ALL SELECT 'salary PAYMENT',         COUNT(*) FROM salary_transactions WHERE type='PAYMENT'
    UNION ALL SELECT 'salary ACCRUAL',         COUNT(*) FROM salary_transactions WHERE type='ACCRUAL'
  `)
  console.log('\n── Итог в новой БД ─────────────────────────────')
  rows.forEach(r => console.log(`  ${r.entity.padEnd(28)} ${r.cnt}`))
  const { rows: t } = await client.query(
    `SELECT SUM(amount)::numeric AS s FROM transactions WHERE type='PAYMENT' AND is_deleted=false`
  )
  console.log(`\n  Сумма оплат (PAYMENT):           ${t[0].s}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const mode = SOURCE_DB ? 'direct DB' : 'JSON files'
  console.log(`\n=== Миграция ${FROM_DATE} → ${TO_DATE} [${mode}]${DRY_RUN ? ' [DRY-RUN]' : ''} ===\n`)

  const client = await targetPool.connect()
  try {
    await client.query('BEGIN')
    await ensureMigrationUser(client)
    await importGroups(client)
    await importAccounts(client)
    await importStudents(client)
    await importActivities(client)
    await importEnrollments(client)
    await importAttendance(client)
    await importParentPayments(client)
    await importStaff(client)
    await importSalaryPayments(client)
    await importSalaryAccruals(client)
    await printVerification(client)

    if (DRY_RUN) {
      await client.query('ROLLBACK')
      console.log('\n✅ DRY-RUN завершён — изменения не записаны')
    } else {
      await client.query('COMMIT')
      console.log('\n✅ Миграция завершена успешно')
    }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\n❌ Ошибка:', err.message)
    process.exit(1)
  } finally {
    client.release()
    await targetPool.end()
    if (sourcePool) await sourcePool.end()
  }
}

main()
