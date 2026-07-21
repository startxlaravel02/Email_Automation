-- migrations/006_trademark_leads_full_capture.sql
--
-- Approach change: store EVERY case-file (pending, expired, dead — all of it)
-- and filter later at query time, because we don't yet know exactly what the
-- sales team will want to slice on.
--
-- WHY new columns: seeding deletes each source XML right after it is processed
-- (a one-shot pass over ~52GB we can't re-read), so every filter-relevant raw
-- field must be captured NOW or it is lost forever. These are additive,
-- nullable columns — safe to add to the existing (truncated) table.

ALTER TABLE trademark_leads
  ADD COLUMN registration_expiration_date DATE DEFAULT NULL AFTER registration_date,
  ADD COLUMN abandonment_date DATE DEFAULT NULL AFTER registration_expiration_date,
  ADD COLUMN cancellation_date DATE DEFAULT NULL AFTER abandonment_date,
  ADD COLUMN renewal_date DATE DEFAULT NULL AFTER cancellation_date,
  ADD COLUMN is_dead TINYINT(1) NOT NULL DEFAULT 0 AFTER renewal_date;

-- Fast "alive marks by upcoming deadline" filter for the eventual lead query.
CREATE INDEX idx_lead_alive_deadline ON trademark_leads (is_dead, computed_deadline_date);
