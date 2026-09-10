import { db } from '../db/index.js'

async function checkDetails() {
  const child = await db
    .selectFrom('children')
    .selectAll()
    .where('full_name', 'ilike', '%Думчикова%')
    .executeTakeFirst()

  console.log('CHILD RECORD:', child)

  const history = await db
    .selectFrom('child_group_history as cgh')
    .leftJoin('groups as g', 'g.id', 'cgh.group_id')
    .select(['cgh.id', 'cgh.child_id', 'cgh.group_id', 'cgh.start_date', 'cgh.end_date', 'g.name as group_name'])
    .where('cgh.child_id', '=', child!.id)
    .orderBy('cgh.created_at', 'asc')
    .execute()

  console.log('HISTORY RECORDS:', history)

  process.exit(0)
}

checkDetails().catch(console.error)
