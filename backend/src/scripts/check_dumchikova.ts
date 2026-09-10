import { sql } from 'kysely'
import { db } from '../db/index.js'

async function checkDumchikova() {
  console.log('=== DIAGNOSTIC FOR DUMCHIKOVA ARINA ===\n')

  // 1. Child & current group
  const child = await db
    .selectFrom('children as c')
    .leftJoin('groups as g', 'g.id', 'c.group_id')
    .select(['c.id', 'c.full_name', 'c.group_id', 'c.is_active', 'g.name as current_group_name'])
    .where('c.full_name', 'ilike', '%Думчикова%')
    .executeTakeFirst()

  console.log('1. CHILD RECORD:', child)

  if (!child) {
    console.log('Child not found!')
    process.exit(0)
  }

  // 2. Child Group History
  const histories = await db
    .selectFrom('child_group_history as cgh')
    .leftJoin('groups as g', 'g.id', 'cgh.group_id')
    .select(['cgh.id', 'cgh.child_id', 'cgh.group_id', 'g.name as group_name', 'cgh.start_date', 'cgh.end_date', 'cgh.created_at'])
    .where('cgh.child_id', '=', child.id)
    .orderBy('cgh.start_date', 'asc')
    .execute()

  console.log('\n2. CHILD GROUP HISTORY (SCD Type 2):', histories)

  // 3. Enrollments & Activities
  const enrollments = await db
    .selectFrom('enrollments as e')
    .innerJoin('activities as a', 'a.id', 'e.activity_id')
    .select(['e.id as enrollment_id', 'e.activity_id', 'a.name as activity_name', 'e.status', 'e.created_at'])
    .where('e.child_id', '=', child.id)
    .execute()

  console.log('\n3. ENROLLMENTS:', enrollments)

  // 4. Merged Journals containing these activities
  const actIds = enrollments.map(e => e.activity_id)
  if (actIds.length > 0) {
    const mergedJournals = await db
      .selectFrom('merged_journals as mj')
      .innerJoin('merged_journal_activities as mja', 'mja.merged_journal_id', 'mj.id')
      .innerJoin('activities as a', 'a.id', 'mja.activity_id')
      .select(['mj.id as merged_journal_id', 'mj.name as journal_name', 'a.id as activity_id', 'a.name as activity_name'])
      .where('mja.activity_id', 'in', actIds)
      .execute()

    console.log('\n4. MERGED JOURNALS CONTAINING CHILD ACTIVITIES:', mergedJournals)
  } else {
    console.log('\n4. MERGED JOURNALS: Child has no enrollments!')
  }

  // 5. All Groups list
  const allGroups = await db.selectFrom('groups').select(['id', 'name']).execute()
  console.log('\n5. ALL GROUPS IN SYSTEM:', allGroups)

  process.exit(0)
}

checkDumchikova().catch(err => {
  console.error(err)
  process.exit(1)
})
