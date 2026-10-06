import pg from 'pg'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.join(process.cwd(), '../.env') })
dotenv.config()

const { Client } = pg

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:MMRvlehWdQpXtMDsoJpUeQDyckkVcyJz@turntable.proxy.rlwy.net:59629/railway'

export async function generateBackupData() {
  const client = new Client({ connectionString })
  await client.connect()

  try {
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `)
    const tables = tablesRes.rows.map(r => r.table_name)
    const backupData: Record<string, any[]> = {}
    let sqlContent = `-- IRIS CRM Database Backup\n-- Date: ${new Date().toISOString()}\n\n`

    for (const table of tables) {
      const res = await client.query(`SELECT * FROM "${table}";`)
      backupData[table] = res.rows

      if (res.rows.length > 0) {
        const columns = Object.keys(res.rows[0]).map(c => `"${c}"`).join(', ')
        for (const row of res.rows) {
          const values = Object.values(row).map(val => {
            if (val === null || val === undefined) return 'NULL'
            if (typeof val === 'boolean' || typeof val === 'number') return String(val)
            if (val instanceof Date) return `'${val.toISOString()}'`
            if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`
            return `'${String(val).replace(/'/g, "''")}'`
          }).join(', ')
          sqlContent += `INSERT INTO "${table}" (${columns}) VALUES (${values});\n`
        }
        sqlContent += '\n'
      }
    }
    return { backupData, sqlContent, tableCount: tables.length }
  } finally {
    await client.end()
  }
}

export async function exportBackup(options: { keepDays?: number } = { keepDays: 30 }) {
  const keepDays = options?.keepDays ?? 30
  console.log('[Backup] Starting database backup export...')
  const { backupData, sqlContent, tableCount } = await generateBackupData()

  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupDir = path.join(process.cwd(), '../backups')
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true })
  }

  const jsonPath = path.join(backupDir, `backup_${dateStr}.json`)
  const sqlPath = path.join(backupDir, `backup_${dateStr}.sql`)

  fs.writeFileSync(jsonPath, JSON.stringify(backupData, null, 2), 'utf-8')
  fs.writeFileSync(sqlPath, sqlContent, 'utf-8')

  console.log(`[Backup] ✅ Backup created (${tableCount} tables). Files:\n 📄 ${jsonPath}\n 📄 ${sqlPath}`)

  // Cleanup old backups
  if (keepDays > 0) {
    const cutoffTime = Date.now() - keepDays * 24 * 60 * 60 * 1000
    try {
      const files = fs.readdirSync(backupDir)
      for (const file of files) {
        if (file.startsWith('backup_')) {
          const filePath = path.join(backupDir, file)
          const stat = fs.statSync(filePath)
          if (stat.mtimeMs < cutoffTime) {
            fs.unlinkSync(filePath)
            console.log(`[Backup] 🗑️ Cleaned up old backup file: ${file}`)
          }
        }
      }
    } catch (err) {
      console.error('[Backup] Error during backup cleanup:', err)
    }
  }

  return { jsonPath, sqlPath }
}

// Execute directly if run as a script
if (process.argv[1] && (process.argv[1].endsWith('export_backup.ts') || process.argv[1].endsWith('export_backup.js'))) {
  exportBackup().catch(err => {
    console.error('❌ Error exporting backup:', err)
    process.exit(1)
  })
}

