import pg from 'pg'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

dotenv.config({ path: path.join(process.cwd(), '../.env') })
dotenv.config()

const { Client } = pg

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:MMRvlehWdQpXtMDsoJpUeQDyckkVcyJz@turntable.proxy.rlwy.net:59629/railway'

async function exportBackup() {
  console.log('Connecting to Railway PostgreSQL database...')
  const client = new Client({ connectionString })
  await client.connect()

  try {
    // 1. Get all tables in public schema
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `)
    const tables = tablesRes.rows.map(r => r.table_name)
    console.log(`Found ${tables.length} tables:`, tables.join(', '))

    const backupData: Record<string, any[]> = {}
    let sqlContent = `-- CRM Database Backup\n-- Date: ${new Date().toISOString()}\n\n`

    for (const table of tables) {
      const res = await client.query(`SELECT * FROM "${table}";`)
      backupData[table] = res.rows
      console.log(`Exported ${table}: ${res.rows.length} rows`)

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

    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const backupDir = path.join(process.cwd(), '../backups')
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true })
    }

    const jsonPath = path.join(backupDir, `backup_${dateStr}.json`)
    const sqlPath = path.join(backupDir, `backup_${dateStr}.sql`)

    fs.writeFileSync(jsonPath, JSON.stringify(backupData, null, 2), 'utf-8')
    fs.writeFileSync(sqlPath, sqlContent, 'utf-8')

    console.log('\n✅ Backup created successfully!')
    console.log(`📄 JSON backup: ${jsonPath}`)
    console.log(`📄 SQL backup:  ${sqlPath}`)
  } catch (err) {
    console.error('❌ Error exporting backup:', err)
  } finally {
    await client.end()
  }
}

exportBackup()
