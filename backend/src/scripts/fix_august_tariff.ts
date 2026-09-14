import { db } from '../db/index.js'
import { recalcActivityAccruals } from '../services/billingRunService.js'

async function run() {
  console.log('Updating smart_tariff_config for August tariff (6f651e87-2215-4af7-81c5-5bd715c8a6bb)...')

  // Update August tariff smart config l1_min_attended_lessons to 5
  const updateResult = await db
    .updateTable('smart_tariff_configs')
    .set({
      l1_min_attended_lessons: 5,
      updated_at: new Date()
    })
    .where('tariff_id', '=', '6f651e87-2215-4af7-81c5-5bd715c8a6bb')
    .executeTakeFirst()

  console.log('Update result count:', updateResult.numUpdatedRows)

  // Run recalculation for Football for August 2026 for child Troshkina Varvara
  const child = (await db
    .selectFrom('children')
    .selectAll()
    .where('full_name', 'ilike', '%Трошкіна%')
    .execute())[0]

  console.log(`Running recalculation for Football for ${child.full_name} (${child.id}) for August 2026...`)
  const res = await recalcActivityAccruals(
    '2342a593-ae0d-48b5-9358-7ea8cf9eed4a',
    new Date('2026-08-01T00:00:00Z'),
    new Date('2026-08-31T23:59:59Z'),
    null,
    child.id
  )

  console.log('Recalculation result:', res)

  // Check transactions for child after recalc
  const txs = await db
    .selectFrom('transactions')
    .selectAll()
    .where('child_id', '=', child.id)
    .where('activity_id', '=', '2342a593-ae0d-48b5-9358-7ea8cf9eed4a')
    .where('is_deleted', '=', false)
    .orderBy('created_at', 'desc')
    .execute()

  console.log('\n=== ACTIVE FOOTBALL TRANSACTIONS FOR VARVARA ===')
  for (const t of txs) {
    console.log(`[ID: ${t.id}] Created: ${t.created_at.toISOString()} | Date: ${t.transaction_date.toISOString().split('T')[0]} | Month: ${t.billing_month ? t.billing_month.toISOString().split('T')[0] : 'N/A'} | Type: ${t.type} | Amount: ${t.amount} | Note: ${t.note}`)
  }

  await db.destroy()
}

run().catch(console.error)
