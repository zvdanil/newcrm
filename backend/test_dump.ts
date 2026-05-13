import { db } from './src/db/index.js'

async function run() {
  const staffId = 'c2203f81-5cb4-4d3d-b529-3a96f0a6996f'
  
  const rates = await db.selectFrom('staff_rates').selectAll().where('staff_id', '=', staffId).execute()
  console.log('--- RATES ---')
  console.table(rates.map(r => ({
    id: r.id.slice(0,4),
    cat: r.rate_category,
    type: r.rate_type,
    val: r.rate_value,
    from: r.valid_from,
    to: r.valid_to
  })))

  const txs = await db.selectFrom('salary_transactions').selectAll().where('staff_id', '=', staffId).orderBy('transaction_date').execute()
  console.log('--- TRANSACTIONS ---')
  console.table(txs.map(t => ({
    id: t.id.slice(0,4),
    type: t.type,
    rate: t.rate_id?.slice(0,4),
    date: t.transaction_date,
    gross: t.gross_amount,
    note: t.note
  })))

  process.exit(0)
}

run()
