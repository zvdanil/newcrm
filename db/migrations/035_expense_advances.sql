-- Категорійні аванси у витратах
-- staff_id nullable: аванс може бути без прив'язки до конкретного співробітника

ALTER TABLE expenses
  ADD COLUMN is_advance              BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN is_advance_return       BOOLEAN      NOT NULL DEFAULT FALSE,
  ADD COLUMN staff_id                UUID         REFERENCES staff(id),
  ADD COLUMN utilized_advance_id     UUID         REFERENCES expenses(id),
  ADD COLUMN utilized_advance_amount NUMERIC(15,2);
