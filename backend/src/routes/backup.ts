import type { FastifyInstance } from 'fastify'
import { requireRole } from '../plugins/authenticate.js'
import { generateBackupData, exportBackup } from '../scripts/export_backup.js'

export async function backupRoutes(app: FastifyInstance) {
  // POST /api/backup/run - Run backup on server
  app.post(
    '/run',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      try {
        const result = await exportBackup({ keepDays: 30 })
        return { ok: true, message: 'Бэкап успешно создан на сервере', ...result }
      } catch (err: any) {
        app.log.error(err)
        return reply.status(500).send({ error: 'BackupFailed', message: err.message || 'Ошибка создания бэкапа' })
      }
    }
  )

  // GET /api/backup/download-sql - Download SQL dump directly to user's computer
  app.get(
    '/download-sql',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      try {
        const { sqlContent } = await generateBackupData()
        const dateStr = new Date().toISOString().slice(0, 10)
        const filename = `iris_db_backup_${dateStr}.sql`

        reply
          .header('Content-Type', 'application/sql; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(sqlContent)
      } catch (err: any) {
        app.log.error(err)
        return reply.status(500).send({ error: 'BackupDownloadFailed', message: err.message || 'Ошибка генерации бэкапа' })
      }
    }
  )

  // GET /api/backup/download-json - Download JSON dump directly to user's computer
  app.get(
    '/download-json',
    { preHandler: requireRole('owner', 'admin') },
    async (req, reply) => {
      try {
        const { backupData } = await generateBackupData()
        const dateStr = new Date().toISOString().slice(0, 10)
        const filename = `iris_db_backup_${dateStr}.json`

        reply
          .header('Content-Type', 'application/json; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="${filename}"`)
          .send(JSON.stringify(backupData, null, 2))
      } catch (err: any) {
        app.log.error(err)
        return reply.status(500).send({ error: 'BackupDownloadFailed', message: err.message || 'Ошибка генерации бэкапа' })
      }
    }
  )
}
