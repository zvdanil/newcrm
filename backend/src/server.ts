import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import staticPlugin from '@fastify/static'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isProd = process.env.NODE_ENV === 'production'

import { authRoutes } from './routes/auth.js'
import { childrenRoutes } from './routes/children.js'
import { familiesRoutes } from './routes/families.js'
import { groupsRoutes } from './routes/groups.js'
import { parentsRoutes } from './routes/parents.js'
import { accountsRoutes } from './routes/accounts.js'
import { activitiesRoutes } from './routes/activities.js'
import { enrollmentsRoutes } from './routes/enrollments.js'
import { journalsRoutes } from './routes/journals.js'
import { billingRoutes } from './routes/billing.js'
import { transactionsRoutes } from './routes/transactions.js'
import { expensesRoutes } from './routes/expenses.js'
import { staffRoutes } from './routes/staff.js'
import { salaryRoutes } from './routes/salary.js'
import { mergedJournalsRoutes } from './routes/mergedJournals.js'
import { importRoutes } from './routes/import.js'
import { importTemplatesRoutes } from './routes/import_templates.js'
import { calendarRoutes } from './routes/calendar.js'
import { dividendsRoutes } from './routes/dividends.js'
import { reportsRoutes } from './routes/reports.js'
import { usersRoutes } from './routes/users.js'
import { inviteRoutes } from './routes/invites.js'
import cron from 'node-cron'
import { runBilling, currentBillingMonth } from './services/billingRunService.js'
import { runSmartAccruals } from './services/smartTariffService.js'
import { runFixedMonthlyAccruals, runSmartStaffAccruals } from './services/salaryService.js'

const app = Fastify({
  trustProxy: true,
  logger: isProd
    ? true
    : { transport: { target: 'pino-pretty', options: { colorize: true } } },
})

// Plugins
await app.register(cors, {
  origin: isProd ? true : (process.env.FRONTEND_URL ?? 'http://localhost:5173'),
  credentials: true,
})

await app.register(jwt, {
  secret: process.env.JWT_SECRET ?? 'dev_secret_change_in_production',
})

// Health check
app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

// Routes
await app.register(authRoutes,       { prefix: '/api/auth' })
await app.register(childrenRoutes,   { prefix: '/api/children' })
await app.register(familiesRoutes,   { prefix: '/api/families' })
await app.register(groupsRoutes,     { prefix: '/api/groups' })
await app.register(parentsRoutes,    { prefix: '/api/parents' })
await app.register(accountsRoutes,   { prefix: '/api/accounts' })
await app.register(activitiesRoutes, { prefix: '/api/activities' })
await app.register(enrollmentsRoutes, { prefix: '/api' })
await app.register(journalsRoutes,    { prefix: '/api/journals' })
await app.register(billingRoutes,        { prefix: '/api/billing' })
await app.register(transactionsRoutes,   { prefix: '/api/transactions' })
await app.register(expensesRoutes,       { prefix: '/api/expenses' })
await app.register(staffRoutes,          { prefix: '/api/staff' })
await app.register(salaryRoutes,         { prefix: '/api' })
await app.register(mergedJournalsRoutes, { prefix: '/api/merged-journals' })
await app.register(importRoutes,          { prefix: '/api/import' })
await app.register(importTemplatesRoutes, { prefix: '/api/import-templates' })
await app.register(calendarRoutes,       { prefix: '/api/calendar' })
await app.register(dividendsRoutes,      { prefix: '/api/dividends' })
await app.register(reportsRoutes,        { prefix: '/api/reports' })
await app.register(usersRoutes,          { prefix: '/api/users' })
await app.register(inviteRoutes,         { prefix: '/api/invite' })

// Serve frontend in production (single-service mode)
if (isProd) {
  const frontendDist = join(__dirname, '../../frontend/dist')
  await app.register(staticPlugin, { root: frontendDist, prefix: '/' })
  // SPA fallback — all non-API routes return index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      reply.status(404).send({ error: 'NotFound' })
    } else {
      reply.sendFile('index.html')
    }
  })
}

// Billing Run cron — runs at 06:00 on the 1st of every month
cron.schedule('0 6 1 * *', async () => {
  const month = currentBillingMonth()
  console.log(`[Billing Cron] Starting billing run for ${month}`)
  const result = await runBilling(month, null)
  console.log(`[Billing Cron] Monthly done: created=${result.created_count} adjusted=${result.adjusted_count} skipped=${result.skipped_count}`)

  const smartResult = await runSmartAccruals(month, null)
  console.log(`[Billing Cron] Smart accruals done: created=${smartResult.created} skipped=${smartResult.skipped}`)

  await runFixedMonthlyAccruals(month)
  console.log('[Billing Cron] Fixed monthly salary accruals done')

  await runSmartStaffAccruals(month)
  console.log('[Billing Cron] Smart staff accruals done')
})

// Start
const port = Number(process.env.PORT ?? 3000)
try {
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`\n🚀 IRIS Backend running on http://localhost:${port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

