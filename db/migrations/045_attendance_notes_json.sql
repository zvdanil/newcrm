-- Migration 045: Per-user attributed notes for attendance logs
-- Replaces the single `note` field with a JSONB array of per-user notes.
-- Legacy `note` field is kept as-is (owner-only historical data, read-only).

ALTER TABLE attendance_logs
  ADD COLUMN IF NOT EXISTS notes_json JSONB NOT NULL DEFAULT '[]'::jsonb;
