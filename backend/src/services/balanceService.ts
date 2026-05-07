import { db } from '../db'
import type { TransactionType } from '../db/types'

/**
 * Recalculates and upserts child_balances for a given child+account pair.
 * Formula: SUM(PAYMENT) + SUM(REFUND) - SUM(ACCRUAL) + SUM(initial_balances)
 * Called after every transaction mutation.
 */
export async function recalcBalance(childId: string, accountId: string): Promise<void> {
  const txRows = await db
    .selectFrom('transactions')
    .select(['type', 'amount'])
    .where('child_id', '=', childId)
    .where('account_id', '=', accountId)
    .where('is_deleted', '=', false)
    .execute()

  let balance = 0
  for (const row of txRows) {
    const amt = parseFloat(row.amount as string)
    if (row.type === 'PAYMENT' || row.type === 'REFUND') {
      balance += amt
    } else if (row.type === 'ACCRUAL' || row.type === 'ADJUSTMENT') {
      balance -= amt
    }
    // REVERSAL: sums cancel each other — the reversed tx is soft-deleted,
    // the REVERSAL itself is positive (restores balance like a REFUND)
    else if (row.type === 'REVERSAL') {
      balance += amt
    }
  }

  const initRow = await db
    .selectFrom('initial_balances')
    .select('amount')
    .where('child_id', '=', childId)
    .where('account_id', '=', accountId)
    .executeTakeFirst()

  if (initRow) {
    balance += parseFloat(initRow.amount as string)
  }

  await db
    .insertInto('child_balances')
    .values({ child_id: childId, account_id: accountId, balance })
    .onConflict((oc) =>
      oc.columns(['child_id', 'account_id']).doUpdateSet({ balance })
    )
    .execute()
}

/**
 * Creates a transaction and immediately recalculates the child's balance.
 */
export async function createTransaction(params: {
  type: TransactionType
  child_id: string
  account_id: string
  activity_id?: string | null
  enrollment_id?: string | null
  amount: number
  transaction_date?: string
  billing_month?: string | null
  note?: string | null
  metadata_json?: object | null
  created_by?: string | null
}): Promise<string> {
  const result = await db
    .insertInto('transactions')
    .values({
      type: params.type,
      child_id: params.child_id,
      account_id: params.account_id,
      activity_id: params.activity_id ?? null,
      enrollment_id: params.enrollment_id ?? null,
      amount: params.amount,
      transaction_date: params.transaction_date ?? new Date().toISOString().slice(0, 10),
      billing_month: params.billing_month ?? null,
      note: params.note ?? null,
      metadata_json: params.metadata_json ?? null,
      created_by: params.created_by ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow()

  await recalcBalance(params.child_id, params.account_id)
  return result.id
}
