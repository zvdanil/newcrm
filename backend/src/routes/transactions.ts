import type { FastifyInstance } from 'fastify'
import { db } from '../db/index.js'
import { requireRole } from '../plugins/authenticate.js'
import { recalcBalance } from '../services/balanceService.js'

export async function transactionsRoutes(app: FastifyInstance) {
  // POST /api/transactions/:id/cancel
  // PAYMENT — owner or admin; all other types — owner only
  app.post<{
    Params: { id: string }
    Body: { reason?: string }
  }>(
    '/:id/cancel',
    { preHandler: requireRole('owner', 'admin') },
    async (request, reply) => {
      const { id } = request.params
      const reason = request.body?.reason?.trim() || null

      const tx = await db
        .selectFrom('transactions')
        .select(['id', 'child_id', 'account_id', 'type', 'is_deleted', 'note'])
        .where('id', '=', id)
        .executeTakeFirst()

      if (!tx) return reply.status(404).send({ error: 'NotFound' })
      if (tx.is_deleted) return reply.status(409).send({ error: 'AlreadyCancelled' })

      // Only owner can cancel non-PAYMENT transactions
      if (tx.type !== 'PAYMENT' && request.user.role !== 'owner') {
        return reply.status(403).send({
          error: 'Forbidden',
          message: 'Скасування нарахувань та повернень доступне тільки Owner',
        })
      }

      // Append cancellation reason to note for the audit trail
      const suffix = reason ? `[Скасовано: ${reason}]` : '[Скасовано]'
      const newNote = tx.note ? `${tx.note} · ${suffix}` : suffix

      await db
        .updateTable('transactions')
        .set({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: request.user.sub,
          note: newNote,
        })
        .where('id', '=', id)
        .execute()

      // Resolve linked imbalance for cross-account payments
      if (tx.type === 'PAYMENT') {
        await db
          .updateTable('inter_account_imbalances')
          .set({
            resolved_at: new Date().toISOString(),
            resolved_by: request.user.sub,
          })
          .where('transaction_id', '=', id)
          .where('resolved_at', 'is', null)
          .execute()
      }

      await recalcBalance(tx.child_id, tx.account_id)

      return { ok: true }
    }
  )
}
