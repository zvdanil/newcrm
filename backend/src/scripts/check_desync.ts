import { db } from '../db/index.js'

async function checkDesync() {
  console.log('=== CHECKING DESYNCHRONIZATION BETWEEN CHILDREN.GROUP_ID AND CHILD_GROUP_HISTORY ===\n')

  const mismatches = await db
    .selectFrom('children as c')
    .innerJoin('child_group_history as cgh', (join) =>
      join.onRef('cgh.child_id', '=', 'c.id').on('cgh.end_date', 'is', null)
    )
    .leftJoin('groups as g1', 'g1.id', 'c.group_id')
    .leftJoin('groups as g2', 'g2.id', 'cgh.group_id')
    .select([
      'c.id',
      'c.full_name',
      'c.group_id as children_group_id',
      'g1.name as children_group_name',
      'cgh.group_id as history_group_id',
      'g2.name as history_group_name',
      'cgh.start_date as history_start_date',
    ])
    .whereRef('c.group_id', '!=', 'cgh.group_id')
    .execute()

  console.log(`Found ${mismatches.length} mismatches:`)
  console.dir(mismatches, { depth: null })

  process.exit(0)
}

checkDesync().catch(console.error)
