import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') })

async function findDuplicates() {
  const { db } = await import('../db/index.js')
  const { toDbDateStr } = await import('../services/dateUtils.js')

  const salaries = await db
    .selectFrom('salary_transactions as st')
    .innerJoin('staff as s', 's.id', 'st.staff_id')
    .leftJoin('accounts as ac', 'ac.id', 'st.account_id')
    .select([
      'st.id as salary_id',
      'st.staff_id',
      's.full_name as staff_name',
      'st.account_id',
      'ac.name as account_name',
      'st.gross_amount',
      'st.transaction_date',
      'st.note as salary_note',
      'st.metadata_json',
    ])
    .where('st.type', '=', 'PAYMENT')
    .where('st.is_deleted', '=', false)
    .orderBy('st.transaction_date', 'desc')
    .execute()

  const expenses = await db
    .selectFrom('expenses as e')
    .leftJoin('accounts as ac', 'ac.id', 'e.account_id')
    .leftJoin('expense_categories as c', 'c.id', 'e.category_id')
    .select([
      'e.id as expense_id',
      'e.account_id',
      'ac.name as account_name',
      'e.category_id',
      'c.name as category_name',
      'e.amount',
      'e.accrual_date',
      'e.payment_date',
      'e.note as expense_note',
    ])
    .where('e.is_deleted', '=', false)
    .orderBy('e.accrual_date', 'desc')
    .execute()

  const matches: any[] = []

  for (const s of salaries) {
    const sDate = toDbDateStr(s.transaction_date)
    const sAmt = parseFloat(String(s.gross_amount))
    const sMeta = (s.metadata_json as Record<string, unknown> | null) ?? {}
    const linkedExpId = sMeta.linked_expense_id ? String(sMeta.linked_expense_id) : null
    const bankRef = sMeta.bank_ref ? String(sMeta.bank_ref) : null

    for (const e of expenses) {
      if (s.account_id && e.account_id && s.account_id !== e.account_id) continue

      const eDateStr = e.payment_date ? toDbDateStr(e.payment_date) : toDbDateStr(e.accrual_date)
      const eAmt = parseFloat(String(e.amount))

      const daysDiff = Math.abs((new Date(sDate).getTime() - new Date(eDateStr).getTime()) / (1000 * 3600 * 24))

      if (daysDiff <= 3 && Math.abs(sAmt - eAmt) < 0.01) {
        matches.push({
          salary_id: s.salary_id,
          staff_name: s.staff_name,
          salary_date: sDate,
          salary_amount: sAmt,
          account_name: s.account_name ?? '—',
          salary_note: s.salary_note,
          expense_id: e.expense_id,
          expense_date: eDateStr,
          expense_amount: eAmt,
          expense_category: e.category_name ?? '—',
          expense_note: e.expense_note,
          already_linked: linkedExpId === e.expense_id || (!!bankRef && e.expense_note?.includes(bankRef) === true),
        })
      }
    }
  }

  console.log(JSON.stringify(matches, null, 2))
  process.exit(0)
}

findDuplicates().catch((err) => {
  console.error(err)
  process.exit(1)
})
