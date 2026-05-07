import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'
import { recalcBalance } from '../services/balanceService.js'

export async function transactionsRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>(
    '/:id/cancel',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params

      const tx = await db
        .selectFrom('transactions')
        .select(['id', 'child_id', 'account_id', 'type', 'is_deleted'])
        .where('id', '=', id)
        .executeTakeFirst()

      if (!tx) return reply.status(404).send({ error: 'NotFound' })
      if (tx.is_deleted) return reply.status(409).send({ error: 'AlreadyCancelled' })
      if (tx.type !== 'PAYMENT') return reply.status(400).send({ error: 'OnlyPaymentsCancellable' })

      await db
        .updateTable('transactions')
        .set({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: request.user.sub,
        })
        .where('id', '=', id)
        .execute()

      // Resolve linked imbalance if exists (cross-account payment)
      await db
        .updateTable('inter_account_imbalances')
        .set({
          resolved_at: new Date().toISOString(),
          resolved_by: request.user.sub,
        })
        .where('transaction_id', '=', id)
        .where('resolved_at', 'is', null)
        .execute()

      await recalcBalance(tx.child_id, tx.account_id)

      return { ok: true }
    }
  )
}
