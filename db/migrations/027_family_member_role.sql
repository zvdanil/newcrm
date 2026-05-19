-- Add role field to family_members (мама / тато / null)
ALTER TABLE family_members ADD COLUMN role VARCHAR(50);
