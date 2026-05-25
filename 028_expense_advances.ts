import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE expenses
      ADD COLUMN staff_id UUID REFERENCES staff(id) ON DELETE SET NULL,
      ADD COLUMN is_advance BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN is_advance_return BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN utilized_advance_id UUID REFERENCES expenses(id) ON DELETE RESTRICT,
      ADD COLUMN utilized_advance_amount NUMERIC(15,2);

    CREATE INDEX idx_expenses_staff_id ON expenses(staff_id);
    CREATE INDEX idx_expenses_utilized_advance ON expenses(utilized_advance_id);
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    DROP INDEX IF EXISTS idx_expenses_utilized_advance;
    DROP INDEX IF EXISTS idx_expenses_staff_id;

    ALTER TABLE expenses
      DROP COLUMN IF EXISTS utilized_advance_amount,
      DROP COLUMN IF EXISTS utilized_advance_id,
      DROP COLUMN IF EXISTS is_advance_return,
      DROP COLUMN IF EXISTS is_advance,
      DROP COLUMN IF EXISTS staff_id;
  `.execute(db)
}