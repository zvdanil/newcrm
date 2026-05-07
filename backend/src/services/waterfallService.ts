import { db } from '../db/index.js'

export interface ChildDebt {
  child_id: string
  child_name: string
  account_id: string
  balance: number             // positive = advance, negative = debt
  debt: number                // abs(balance) if debt, else 0
  oldest_accrual_date: string | null
}

export interface WaterfallAllocation {
  child_id: string
  child_name: string
  amount: number
}

export interface WaterfallResult {
  allocations: WaterfallAllocation[]
  total_debt: number
  remainder: number   // amount not yet allocated (payment > total debt)
}

/**
 * Returns current debts for all children of a family on a given account.
 * Children with positive balance (advance) are included with debt=0.
 */
export async function getFamilyDebts(familyId: string, accountId: string): Promise<ChildDebt[]> {
  const children = await db
    .selectFrom('children as c')
    .leftJoin('child_balances as cb', (join) =>
      join.onRef('cb.child_id', '=', 'c.id').on('cb.account_id', '=', accountId)
    )
    .select(['c.id as child_id', 'c.full_name as child_name', 'cb.balance'])
    .where('c.family_id', '=', familyId)
    .orderBy('c.full_name', 'asc')
    .execute()

  const result: ChildDebt[] = []

  for (const child of children) {
    const balance = child.balance ? parseFloat(child.balance as string) : 0
    const debt = balance < 0 ? Math.round(Math.abs(balance) * 100) / 100 : 0

    let oldest_accrual_date: string | null = null
    if (debt > 0) {
      const row = await db
        .selectFrom('transactions')
        .select('transaction_date')
        .where('child_id', '=', child.child_id)
        .where('account_id', '=', accountId)
        .where('type', '=', 'ACCRUAL')
        .where('is_deleted', '=', false)
        .orderBy('transaction_date', 'asc')
        .executeTakeFirst()

      if (row?.transaction_date) {
        const d = row.transaction_date
        oldest_accrual_date = d instanceof Date
          ? d.toISOString().slice(0, 10)
          : String(d).slice(0, 10)
      }
    }

    result.push({
      child_id: child.child_id,
      child_name: child.child_name,
      account_id: accountId,
      balance: Math.round(balance * 100) / 100,
      debt,
      oldest_accrual_date,
    })
  }

  return result
}

/**
 * Computes FIFO waterfall allocation across children.
 * Debtors sorted by oldest_accrual_date ASC, then debt DESC.
 * Any remainder (payment > total debt) is allocated to advance_child_id
 * (defaults to the first child in the list).
 */
export function computeWaterfall(
  childDebts: ChildDebt[],
  totalAmount: number,
  advanceChildId?: string,
): WaterfallResult {
  const debtors = [...childDebts]
    .filter(c => c.debt > 0)
    .sort((a, b) => {
      const da = a.oldest_accrual_date ?? '9999-12-31'
      const db_ = b.oldest_accrual_date ?? '9999-12-31'
      if (da < db_) return -1
      if (da > db_) return 1
      return b.debt - a.debt
    })

  const total_debt = debtors.reduce((s, c) => s + c.debt, 0)
  const allocations: WaterfallAllocation[] = []
  let remaining = totalAmount

  for (const child of debtors) {
    if (remaining <= 0) break
    const pay = Math.round(Math.min(child.debt, remaining) * 100) / 100
    allocations.push({ child_id: child.child_id, child_name: child.child_name, amount: pay })
    remaining = Math.round((remaining - pay) * 100) / 100
  }

  // Allocate remainder as advance to the designated child
  if (remaining > 0.009) {
    const target = advanceChildId
      ? childDebts.find(c => c.child_id === advanceChildId)
      : childDebts[0]

    if (target) {
      const existing = allocations.find(a => a.child_id === target.child_id)
      if (existing) {
        existing.amount = Math.round((existing.amount + remaining) * 100) / 100
      } else {
        allocations.push({ child_id: target.child_id, child_name: target.child_name, amount: remaining })
      }
      remaining = 0
    }
  }

  return { allocations, total_debt: Math.round(total_debt * 100) / 100, remainder: remaining }
}
