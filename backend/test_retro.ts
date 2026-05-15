import { db } from './src/db/index.js'
import { triggerRetroAccruals } from './src/services/salaryService.js'

async function runTest() {
  try {
    console.log('--- Starting Retro Recalculation Test ---')
    
    // 1. Find a staff member and an activity
    const staff = await db.selectFrom('staff').select('id').where('is_active', '=', true).executeTakeFirst()
    const activity = await db.selectFrom('activities').select('id').where('is_active', '=', true).executeTakeFirst()
    
    if (!staff || !activity) {
      console.log('Error: Need at least one active staff and one active activity in DB.')
      return
    }
    
    console.log(`Testing with Staff ID: ${staff.id}, Activity ID: ${activity.id}`)
    
    // 2. Define a period (e.g., current month)
    const today = new Date()
    const fromDate = new Date(today.getFullYear(), today.getMonth(), 1)
    const toDate = today
    
    console.log(`Period: ${fromDate.toISOString().slice(0, 10)} to ${toDate.toISOString().slice(0, 10)}`)
    
    // 3. Check for existing logs in this period
    const logsCount = await db.selectFrom('attendance_logs')
      .select(eb => eb.fn.count('id').as('cnt'))
      .where('activity_id', '=', activity.id)
      .where('date', '>=', fromDate)
      .where('date', '<=', toDate)
      .executeTakeFirst()
      
    console.log(`Found ${logsCount?.cnt || 0} attendance logs in period.`)
    
    // 4. Trigger retro recalculation
    // This should create accruals for the staff member if they have an active rate
    console.log('Triggering triggerRetroAccruals...')
    await triggerRetroAccruals(staff.id, activity.id, fromDate, toDate)
    
    // 5. Verify results
    const accruals = await db.selectFrom('salary_transactions')
      .selectAll()
      .where('staff_id', '=', staff.id)
      .where('activity_id', '=', activity.id)
      .where('transaction_date', '>=', fromDate)
      .where('transaction_date', '<=', toDate)
      .where('is_deleted', '=', false)
      .execute()
      
    console.log(`Result: Found ${accruals.length} accruals for the period.`)
    accruals.forEach(a => {
      console.log(`  Date: ${new Date(a.transaction_date).toISOString().slice(0, 10)}, Amount: ${a.gross_amount}, Type: ${a.type}`)
    })
    
    console.log('--- Test Finished ---')
  } catch (err) {
    console.error('Test failed with error:', err)
  } finally {
    process.exit(0)
  }
}

runTest()
