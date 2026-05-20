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
        .select(['id', 'child_id', 'account_id', 'activity_id', 'type', 'is_deleted', 'note', 'enrollment_id', 'billing_month', 'transaction_date'])
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

      // Cascade on ACCRUAL cancellation: remove linked attendance marks and their REFUNDs
      if (tx.type === 'ACCRUAL' && tx.enrollment_id) {
        const softDel = { is_deleted: true as const, deleted_at: new Date().toISOString(), deleted_by: request.user.sub }

        if (tx.billing_month) {
          // Monthly / smart: delete all absent_excused marks in this billing month and their REFUNDs
          const billingDate = new Date(tx.billing_month as unknown as string)
          const nextMonth = new Date(billingDate.getFullYear(), billingDate.getMonth() + 1, 1)
          const monthLastDay = new Date(nextMonth.getTime() - 1).toISOString().slice(0, 10)

          // Soft-delete all REFUNDs for this enrollment in this billing month (except smart_benefit)
          await db.updateTable('transactions')
            .set(softDel)
            .where('enrollment_id', '=', tx.enrollment_id)
            .where('type', '=', 'REFUND')
            .where('is_deleted', '=', false)
            .where('transaction_date', '>=', billingDate)
            .where('transaction_date', '<=', new Date(monthLastDay))
            .execute()

          // Soft-delete ADJUSTMENT transactions for same enrollment+billing_month
          await db.updateTable('transactions')
            .set(softDel)
            .where('enrollment_id', '=', tx.enrollment_id)
            .where('billing_month', '=', billingDate)
            .where('type', '=', 'ADJUSTMENT')
            .where('is_deleted', '=', false)
            .execute()

          // Delete absent_excused attendance marks for this enrollment in this billing month
          await db.deleteFrom('attendance_logs')
            .where('enrollment_id', '=', tx.enrollment_id)
            .where('status', '=', 'absent_excused')
            .where('date', '>=', billingDate)
            .where('date', '<=', new Date(monthLastDay))
            .execute()

          // Cascade to linked activities (e.g. food linked to main activity)
          if (tx.activity_id) {
            const linked = await db
              .selectFrom('linked_activities')
              .select('child_activity_id')
              .where('parent_activity_id', '=', tx.activity_id)
              .execute()

            for (const { child_activity_id } of linked) {
              const le = await db
                .selectFrom('enrollments')
                .select(['id', 'account_id'])
                .where('child_id', '=', tx.child_id)
                .where('activity_id', '=', child_activity_id)
                .where('status', '!=', 'archived')
                .executeTakeFirst()

              if (!le) continue

              await db.updateTable('transactions')
                .set(softDel)
                .where('enrollment_id', '=', le.id)
                .where('type', '=', 'REFUND')
                .where('is_deleted', '=', false)
                .where('transaction_date', '>=', billingDate)
                .where('transaction_date', '<=', new Date(monthLastDay))
                .execute()

              await db.deleteFrom('attendance_logs')
                .where('enrollment_id', '=', le.id)
                .where('status', '=', 'absent_excused')
                .where('date', '>=', billingDate)
                .where('date', '<=', new Date(monthLastDay))
                .execute()
            }
          }
        } else if (tx.transaction_date) {
          // Per-lesson: delete the attendance mark (present/special) that generated this ACCRUAL
          await db.deleteFrom('attendance_logs')
            .where('enrollment_id', '=', tx.enrollment_id)
            .where('date', '=', new Date(tx.transaction_date as unknown as string))
            .where('status', 'in', ['present', 'special'])
            .execute()
        }
      }

      await recalcBalance(tx.child_id, tx.account_id)

      return { ok: true }
    }
  )
}
