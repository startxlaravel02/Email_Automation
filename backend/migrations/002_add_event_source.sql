-- Per-event source flag: separates real human engagement from image-proxy
-- prefetches and link scanners. Raw events are always kept; this only classifies.
ALTER TABLE email_events
  ADD COLUMN source ENUM('human','proxy','bot') NOT NULL DEFAULT 'human' AFTER event_type;

CREATE INDEX idx_events_type_source_created
  ON email_events (event_type, source, created_at);
