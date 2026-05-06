-- Add is_active to groups (soft delete / archive)
ALTER TABLE groups ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
