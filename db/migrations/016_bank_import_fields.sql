-- Migration 016: Add EDRPOU and IBAN fields to parents for bank import matching
ALTER TABLE parents
  ADD COLUMN edrpou VARCHAR(20),
  ADD COLUMN iban   VARCHAR(34);

CREATE INDEX idx_parents_edrpou ON parents(edrpou) WHERE edrpou IS NOT NULL;
CREATE INDEX idx_parents_iban   ON parents(iban)   WHERE iban   IS NOT NULL;
