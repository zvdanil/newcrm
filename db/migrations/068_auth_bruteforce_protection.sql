-- Migration 068: Add brute force protection fields to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS users_locked_until_idx ON users (locked_until) WHERE locked_until IS NOT NULL;
