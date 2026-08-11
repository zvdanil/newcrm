-- Migration 054: Assign staff_id to legacy group_lesson_logs
-- Assigns orphaned legacy group_lesson_logs (staff_id IS NULL) to the primary CURRENT ACTIVE group teacher of each activity.

UPDATE group_lesson_logs g
SET staff_id = (
  SELECT sr.staff_id
  FROM staff_rates sr
  WHERE sr.activity_id = g.activity_id
    AND sr.rate_type = 'group_lesson'
    AND sr.rate_category = 'auto'
    AND (sr.valid_to IS NULL OR sr.valid_to >= CURRENT_DATE)
  ORDER BY sr.created_at ASC
  LIMIT 1
)
WHERE g.staff_id IS NULL;
