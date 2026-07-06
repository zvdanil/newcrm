import { sql } from 'kysely'
import { db } from '../db/index.js'
import { recalcBalance } from '../services/balanceService.js'
import { toDbDateStr } from '../services/dateUtils.js'

async function runCleanup() {
  console.log('Starting transaction cleanup...')
  
  // 1. Find orphaned ACCRUAL transactions (per-lesson)
  // These are active transactions linked to an enrollment, with no billing_month (meaning per-lesson),
  // but where the corresponding attendance log does not exist or does not have a chargeable status.
  const orphanedAccruals = await db
    .selectFrom('transactions as tx')
    .select(['tx.id', 'tx.child_id', 'tx.account_id', 'tx.transaction_date', 'tx.amount'])
    .where('tx.type', '=', 'ACCRUAL')
    .where('tx.billing_month', 'is', null)
    .where('tx.is_deleted', '=', false)
    .where('tx.enrollment_id', 'is not', null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb.selectFrom('attendance_logs as al')
            .select('al.id')
            .whereRef('al.enrollment_id', '=', 'tx.enrollment_id')
            .whereRef('al.date', '=', 'tx.transaction_date')
            .where('al.status', 'in', ['present', 'special', 'separate_billing'])
        )
      )
    )
    .execute()

  console.log(`Found ${orphanedAccruals.length} orphaned ACCRUAL transactions.`)

  // 2. Find orphaned REFUND transactions (per-lesson absences)
  // These are active transactions linked to an enrollment, with type REFUND,
  // excluding smart_benefit refunds, but where the corresponding attendance log
  // does not exist or does not have an excused absence status.
  const orphanedRefunds = await db
    .selectFrom('transactions as tx')
    .select(['tx.id', 'tx.child_id', 'tx.account_id', 'tx.transaction_date', 'tx.amount'])
    .where('tx.type', '=', 'REFUND')
    .where('tx.is_deleted', '=', false)
    .where('tx.enrollment_id', 'is not', null)
    // Exclude smart benefits which are processed monthly
    .where((eb) =>
      eb.or([
        eb('tx.metadata_json', 'is', null),
        eb('tx.metadata_json', '!=', JSON.stringify({ source: 'smart_benefit' })), // Kysely JSON check
      ])
    )
    // Also ignore smart benefit flag inside metadata_json if structured as object
    .where(sql`coalesce(tx.metadata_json->>'source', '')`, '!=', 'smart_benefit')
    .where((eb) =>
      eb.not(
        eb.exists(
          eb.selectFrom('attendance_logs as al')
            .select('al.id')
            .whereRef('al.enrollment_id', '=', 'tx.enrollment_id')
            .whereRef('al.date', '=', 'tx.transaction_date')
            .where('al.status', 'in', ['absent_excused', 'absent_excused_30'])
        )
      )
    )
    .execute()

  console.log(`Found ${orphanedRefunds.length} orphaned REFUND transactions.`)

  const allOrphans = [...orphanedAccruals, ...orphanedRefunds]
  
  if (allOrphans.length === 0) {
    console.log('No orphaned transactions found. Database is clean!')
    process.exit(0)
  }

  // Soft-delete orphans
  const nowStr = new Date().toISOString()
  const affectedBalancePairs = new Set<string>()

  for (const tx of allOrphans) {
    console.log(`Soft-deleting orphaned transaction ID: ${tx.id}, date: ${toDbDateStr(tx.transaction_date as Date)}, amount: ${tx.amount}`)
    await db.updateTable('transactions')
      .set({
        is_deleted: true,
        deleted_at: nowStr,
        deleted_by: null, // system cleanup
        note: sql`coalesce(note, '') || ' (Авто-видалення дублю/сироти)'`
      })
      .where('id', '=', tx.id)
      .execute()

    affectedBalancePairs.add(`${tx.child_id}:${tx.account_id}`)
  }

  // Recalculate balances
  console.log('Recalculating balances for affected children...')
  for (const pair of affectedBalancePairs) {
    const [childId, accountId] = pair.split(':')
    console.log(`Recalculating balance for child: ${childId}, account: ${accountId}`)
    await recalcBalance(childId, accountId)
  }

  console.log('Cleanup finished successfully!')
  process.exit(0)
}

runCleanup().catch((err) => {
  console.error('Cleanup failed with error:', err)
  process.exit(1)
})
