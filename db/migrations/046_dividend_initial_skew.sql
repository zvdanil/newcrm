ALTER TABLE dividend_settings ADD COLUMN initial_skew_amount NUMERIC(15, 2) DEFAULT 0;
ALTER TABLE dividend_settings ADD COLUMN initial_skew_participant_id UUID REFERENCES equity_participants(id) ON DELETE SET NULL;
