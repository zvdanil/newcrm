-- Migration 028: User Administration Module
-- Додає name/staff_id/parent_id до users,
-- та таблицю user_invites для запрошень і скидання пароля.

-- ============================================================
-- 2.1 Розширення таблиці users
-- ============================================================
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name      TEXT,
  ADD COLUMN IF NOT EXISTS staff_id  UUID REFERENCES staff(id)   ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES parents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_staff_id_idx  ON users (staff_id)  WHERE staff_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_parent_id_idx ON users (parent_id) WHERE parent_id IS NOT NULL;

-- ============================================================
-- 2.2 Нова таблиця user_invites
-- ============================================================
CREATE TABLE IF NOT EXISTS user_invites (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token       TEXT        NOT NULL UNIQUE,
  email       VARCHAR(255),
  role        user_role,
  staff_id    UUID        REFERENCES staff(id)   ON DELETE SET NULL,
  parent_id   UUID        REFERENCES parents(id) ON DELETE SET NULL,
  invited_by  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(10) NOT NULL CHECK (type IN ('invite', 'reset')),
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_invites_token_idx ON user_invites (token);
CREATE INDEX IF NOT EXISTS user_invites_email_idx ON user_invites (email) WHERE email IS NOT NULL;
