-- migrations/003_open_intelligence.sql
-- Open Intelligence Engine — Phase 1, v1 DERIVED + CONFIG tables.
-- Raw tracking tables (tracked_emails, tracked_links, email_events, suppressed_recipients)
-- are NOT touched. Everything here is a derived read-model or config, always
-- reconstructable from the immutable email_events log.

USE ai_email_assistant;

-- 1) Per-tracked-email derived verdict (overwriteable; recomputed from events).
--    confidence_score is INTERNAL ONLY — never exposed via API/UI (see docs §16.1).
CREATE TABLE IF NOT EXISTS email_engagement (
  tracked_email_id   BIGINT UNSIGNED NOT NULL,
  engagement_stage   ENUM('delivered','open_signal','likely_engaged','verified_human') NOT NULL DEFAULT 'delivered',
  engagement_level   ENUM('none','low','medium','high','verified') NOT NULL DEFAULT 'none',
  confidence_score   DECIMAL(4,3) NOT NULL DEFAULT 0.000,   -- INTERNAL: tuning/ML only
  signals            JSON NULL,                              -- explainable evidence list
  ruleset_version    INT UNSIGNED NULL,                      -- which ruleset produced this verdict
  first_signal_at    DATETIME NULL,
  verified_at        DATETIME NULL,
  last_evaluated_at  DATETIME NULL,
  last_event_id      BIGINT UNSIGNED NOT NULL DEFAULT 0,     -- high-water mark for idempotency
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tracked_email_id),
  KEY idx_eng_stage (engagement_stage, last_evaluated_at),
  KEY idx_eng_level (engagement_level),
  CONSTRAINT fk_eng_tracked_email FOREIGN KEY (tracked_email_id)
    REFERENCES tracked_emails (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Per-recipient behavioural prior — built from HARD actions only (no feedback loop).
--    historical_engagement_score is INTERNAL ONLY.
CREATE TABLE IF NOT EXISTS recipient_engagement_profile (
  recipient_email             VARCHAR(320) NOT NULL,
  emails_sent                 INT UNSIGNED NOT NULL DEFAULT 0,
  verified_count              INT UNSIGNED NOT NULL DEFAULT 0,
  click_count                 INT UNSIGNED NOT NULL DEFAULT 0,
  reply_count                 INT UNSIGNED NOT NULL DEFAULT 0,
  unsubscribed                TINYINT(1) NOT NULL DEFAULT 0,
  avg_seconds_to_action       INT UNSIGNED NULL,
  historical_engagement_score DECIMAL(4,3) NOT NULL DEFAULT 0.000,  -- INTERNAL bounded prior
  last_verified_at            DATETIME NULL,
  created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (recipient_email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Versioned, declarative scoring config (the "rule engine"). Exactly one is_active row.
--    Seeded from src/engagement/rulesets/default.v1.json (app-side, idempotent).
CREATE TABLE IF NOT EXISTS engagement_rulesets (
  version      INT UNSIGNED NOT NULL,
  is_active    TINYINT(1) NOT NULL DEFAULT 0,
  config       JSON NOT NULL,
  notes        VARCHAR(500) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at DATETIME NULL,
  PRIMARY KEY (version),
  KEY idx_ruleset_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) DB-backed async evaluation queue (Phase 1 transport — no Redis/BullMQ).
--    Debounced per tracked_email in app logic (one queued row coalesces a burst).
CREATE TABLE IF NOT EXISTS engagement_jobs (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tracked_email_id  BIGINT UNSIGNED NOT NULL,
  status            ENUM('queued','running','done','failed') NOT NULL DEFAULT 'queued',
  run_after         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,   -- debounce: don't run before this
  attempts          INT UNSIGNED NOT NULL DEFAULT 0,
  last_error        VARCHAR(500) NULL,
  enqueued_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_jobs_claim (status, run_after),
  KEY idx_jobs_email (tracked_email_id, status),
  CONSTRAINT fk_job_tracked_email FOREIGN KEY (tracked_email_id)
    REFERENCES tracked_emails (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
