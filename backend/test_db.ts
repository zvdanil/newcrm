import { db } from './src/db/index.js'
import { recalcRetroAccruals } from './src/services/salaryService.js'

async function run() {
  try {
    const staff_id = 'c2203f81-5cb4-4d3d-b529-3a96f0a6996f'
    const rate_type = 'fixed_monthly'
    const rate_category = 'auto'
    const activity_id = undefined

    console.log('Finding old rate...')
    let q = db
      .selectFrom('staff_rates')
      .select(['id', 'rate_value'])
      .where('staff_id',    '=', staff_id)
      .where('rate_type',   '=', rate_type)
      .where('valid_to', 'is', null)

    if (activity_id) {
      q = q.where('activity_id', '=', activity_id)
    } else {
      q = q.where('activity_id', 'is', null)
    }

    const oldRate = await q.executeTakeFirst()
    console.log('oldRate', oldRate)

  } catch (err) {
    console.error('Error:', err)
  }
  process.exit(0)
}

run()
