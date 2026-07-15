import { db } from '../db/index.js';

async function main() {
  try {
    // 1. Find the child
    const childRes = await db
      .selectFrom('children')
      .select(['id', 'full_name', 'note'])
      .where('full_name', 'ilike', '%Архипенко%')
      .execute();
    console.log("Children found:", childRes);

    if (childRes.length === 0) {
      console.log("No child found matching Архипенко");
      return;
    }

    const childId = childRes[0].id;
    console.log("Using childId:", childId);

    // 2. Get initial balances
    const initRes = await db
      .selectFrom('initial_balances as ib')
      .innerJoin('accounts as a', 'a.id', 'ib.account_id')
      .select(['ib.account_id', 'ib.amount', 'ib.note', 'a.name as account_name'])
      .where('ib.child_id', '=', childId)
      .execute();
    console.log("\nInitial Balances:", initRes);

    // 3. Get all transactions
    const txRes = await db
      .selectFrom('transactions as t')
      .innerJoin('accounts as a', 'a.id', 't.account_id')
      .leftJoin('activities as act', 'act.id', 't.activity_id')
      .select([
        't.id', 't.type', 't.amount', 't.transaction_date', 't.billing_month', 't.note',
        'a.name as account_name', 'act.name as activity_name'
      ])
      .where('t.child_id', '=', childId)
      .where('t.is_deleted', '=', false)
      .orderBy('t.transaction_date', 'asc')
      .orderBy('t.created_at', 'asc')
      .execute();

    console.log("\nTransactions count:", txRes.length);
    for (const tx of txRes) {
      const billingMonthStr = tx.billing_month ? new Date(tx.billing_month).toISOString().slice(0, 7) : 'none';
      const txDateStr = new Date(tx.transaction_date).toISOString().slice(0, 10);
      console.log(
        `[${txDateStr}] ${tx.account_name} | ${tx.type} | Amount: ${tx.amount} | Month: ${billingMonthStr} | Note: ${tx.note} | Activity: ${tx.activity_name}`
      );
    }
  } catch (err) {
    console.error(err);
  }
}

main();
