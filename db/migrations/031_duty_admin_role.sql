-- Migration 031: Add duty_admin role (shift administrator)
-- Limited access: journals and calendar only
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'duty_admin';
