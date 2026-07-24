-- migrations/007_leads_pool_index.sql
--
-- Speeds up the Leads list. The leads query filters:
--   lead_status = 'verified' AND attorney is empty AND has email AND not dead
-- ordered by computed_deadline_date. Without a matching index, the COUNT had to
-- read ~53k 'verified' rows and look each one up (≈3s). This composite index lets
-- MySQL filter lead_status + attorney_name INSIDE the index and read in deadline
-- order, cutting the count to ≈1.7s (the rest of the wait is now avoided by
-- fetching the count separately from the rows).
--
-- NOTE: building this on ~14M rows takes ~75s. Already applied to the live DB.

CREATE INDEX idx_leads_pool
  ON trademark_leads (lead_status, attorney_name, computed_deadline_date);
