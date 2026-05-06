import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import { config } from 'dotenv'

config({ path: '../.env' })

const { Pool } = pg
const __dir = dirname(fileURLToPath(import.meta.url))

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    VARCHAR(100) PRIMARY KEY,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `)

    const { rows } = await pool.query('SELECT version FROM schema_migrations ORDER BY version')
    const applied = new Set(rows.map(r => r.version))

    const migrationsDir = join(__dir, 'migrations')
    const files = readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort()

    let count = 0
    for (const file of files) {
      const version = file.replace('.sql', '')

      if (applied.has(version)) {
        console.log(`  ✓ ${file} (already applied)`)
        continue
      }

      const sql = readFileSync(join(migrationsDir, file), 'utf8')

      await pool.query('BEGIN')
      try {
        await pool.query(sql)
        await pool.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [version]
        )
        await pool.query('COMMIT')
        console.log(`  ✅ ${file}`)
        count++
      } catch (err) {
        await pool.query('ROLLBACK')
        console.error(`  ❌ ${file}:`, err.message)
        process.exit(1)
      }
    }

    if (count === 0) {
      console.log('  — No new migrations to apply.')
    } else {
      console.log(`\n  Applied ${count} migration(s).`)
    }
  } finally {
    await pool.end()
  }
}

console.log('\n🗄️  Running migrations...\n')
migrate()
