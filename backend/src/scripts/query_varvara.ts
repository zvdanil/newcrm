import { db } from '../db/index.js'

async function run() {
  const smartConfigs = await db
    .selectFrom('smart_tariff_configs as stc')
    .leftJoin('tariffs as t', 'stc.tariff_id', 't.id')
    .select([
      'stc.tariff_id',
      'stc.activity_id',
      'stc.base_lessons',
      'stc.l1_threshold_absences',
      'stc.l1_threshold_fee',
      'stc.l1_min_attended_lessons',
      'stc.l2_max_refunds',
      'stc.l2_refund_per_absence',
      'stc.updated_at',
      't.valid_from',
      't.valid_to',
      't.base_fee'
    ])
    .where('stc.activity_id', '=', '2342a593-ae0d-48b5-9358-7ea8cf9eed4a')
    .execute()

  console.log('=== SMART TARIFF CONFIGS FOR FOOTBALL ===')
  console.log(JSON.stringify(smartConfigs, null, 2))

  await db.destroy()
}

run().catch(console.error)
