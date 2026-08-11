-- 052_activity_is_main.sql
ALTER TABLE activities ADD COLUMN is_main BOOLEAN NOT NULL DEFAULT false;
