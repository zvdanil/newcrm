import type { FastifyInstance } from 'fastify'
import { db } from '../db'
import { requireRole } from '../plugins/authenticate'
import { runBilling, currentBillingMonth } from '../services/billingRunService'

export async function billingRoutes(app: FastifyInstance) {
  // GET /api/billing/run-log — last 20 billing runs (Owner/Admin)
  app.get('/run-log', { preHandler: requireRole('owner', 'admin') }, async () => {
    const rows = await db
      .selectFrom('billing_run_log')
      .selectAll()
      .orderBy('started_at', 'desc')
      .limit(20)
      .execute()
    return rows
  })

  // POST /api/billing/run — manual trigger (Owner only)
  app.post<{
    Body: { billing_month?: string }
  }>('/run', { preHandler: requireRole('owner') }, async (request, reply) => {
    const billingMonth = request.body?.billing_month ?? currentBillingMonth()

    // Validate format YYYY-MM-DD and is first of month
    const match = billingMonth.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!match || match[3] !== '01') {
      return reply.status(400).send({
        error: 'BadRequest',
        message: 'billing_month must be in YYYY-MM-01 format (first day of month)',
      })
    }

    const result = await runBilling(billingMonth, request.user.sub)
    return result
  })
}
