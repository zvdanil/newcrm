import { sql } from 'kysely'
import { db } from '../db/index.js'
import { toDbDateStr } from '../services/dateUtils.js'

async function checkBob() {
  console.log('--- DIAGNOSTIC START ---')

  // 1. Find child
  const child = await db
    .selectFrom('children')
    .select(['id', 'full_name'])
    .where('full_name', 'ilike', '%Боб Марк%')
    .executeTakeFirst()

  if (!child) {
    console.error('Child "Боб Марк" not found!')
    process.exit(1)
  }
  console.log(`Found child: ${child.full_name} (ID: ${child.id})`)

  // 2. Find activity
  const activity = await db
    .selectFrom('activities')
    .select(['id', 'name', 'tariff_type', 'account_id'])
    .where('name', 'ilike', '%Кикбоксинг%')
    .executeTakeFirst()

  if (!activity) {
    console.error('Activity "Кикбоксинг" not found!')
    process.exit(1)
  }
  console.log(`Found activity: ${activity.name} (ID: ${activity.id}, tariff_type: ${activity.tariff_type})`)

  // 3. Find enrollment
  const enrollment = await db
    .selectFrom('enrollments')
    .select(['id', 'status', 'start_date', 'account_id'])
    .where('child_id', '=', child.id)
    .where('activity_id', '=', activity.id)
    .executeTakeFirst()

  if (!enrollment) {
    console.error(`Enrollment for ${child.full_name} in ${activity.name} not found!`)
    process.exit(1)
  }
  console.log(`Found enrollment ID: ${enrollment.id} (status: ${enrollment.status})`)

  // 4. Fetch June 2026 attendance logs
  // June is month 06, from 2026-06-01 to 2026-06-30
  const logs = await db
    .selectFrom('attendance_logs')
    .select(['id', 'date', 'status', 'custom_amount', 'note'])
    .where('enrollment_id', '=', enrollment.id)
    .where('date', '>=', sql<Date>`CAST('2026-06-01' AS DATE)`)
    .where('date', '<=', sql<Date>`CAST('2026-06-30' AS DATE)`)
    .orderBy('date', 'asc')
    .execute()

  console.log('\n--- ATTENDANCE LOGS FOR JUNE 2026 ---')
  if (logs.length === 0) {
    console.log('No attendance logs found for June 2026.')
  } else {
    for (const log of logs) {
      console.log(`Date: ${toDbDateStr(log.date as Date)}, Status: ${log.status}, Custom Amount: ${log.custom_amount ?? 'none'}, Note: ${log.note ?? ''}`)
    }
  }

  // 5. Fetch June 2026 transactions
  const transactions = await db
    .selectFrom('transactions')
    .select(['id', 'type', 'amount', 'transaction_date', 'billing_month', 'is_deleted', 'note', 'metadata_json'])
    .where('child_id', '=', child.id)
    .where('activity_id', '=', activity.id)
    .where((eb) =>
      eb.or([
        // either transaction_date is in June
        eb.and([
          eb('transaction_date', '>=', sql<Date>`CAST('2026-06-01' AS DATE)`),
          eb('transaction_date', '<=', sql<Date>`CAST('2026-06-30' AS DATE)`),
        ]),
        // or billing_month is June
        eb('billing_month', '=', sql<Date>`CAST('2026-06-01' AS DATE)`),
      ])
    )
    .orderBy('transaction_date', 'asc')
    .orderBy('created_at', 'asc')
    .execute()

  console.log('\n--- TRANSACTIONS (ACCRUALS / REFUNDS / ADJUSTMENTS) ---')
  if (transactions.length === 0) {
    console.log('No transactions found.')
  } else {
    for (const tx of transactions) {
      const deletedTag = tx.is_deleted ? ' [DELETED]' : ''
      const billingMonthTag = tx.billing_month ? ` (Billing Month: ${toDbDateStr(tx.billing_month as Date)})` : ''
      console.log(
        `ID: ${tx.id}${deletedTag}, Type: ${tx.type}, Date: ${toDbDateStr(tx.transaction_date as Date)}${billingMonthTag}, Amount: ${tx.amount} UAH, Note: "${tx.note ?? ''}"`
      )
    }
  }

  console.log('\n--- DIAGNOSTIC END ---')
  process.exit(0)
}

checkBob().catch((err) => {
  console.error('Diagnostic script failed with error:', err)
  process.exit(1)
})
