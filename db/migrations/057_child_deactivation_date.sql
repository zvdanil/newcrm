-- Migration 057: Add deactivation_date to children table
ALTER TABLE children ADD COLUMN IF NOT EXISTS deactivation_date DATE;
