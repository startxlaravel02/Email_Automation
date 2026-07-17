-- migrations/004_open_intelligence.sql
-- Open Intelligence Engine — Phase 1, v2 refinements (docs §16).
-- Adds: dominant trust level on the per-email verdict, the append-only engagement
-- timeline, and the campaign-grain engagement profile. Raw tables untouched.
-- Note: tracked_emails.campaign_id already exists and is indexed (migration 001) — no change.

USE ai_email_assistant;

-- v2.1 — surface the symbolic Trust Level on the per-email verdict.
--        (The numeric confidence_score stays internal; this is what the UI reasons about.)
ALTER TABLE email_engagement
  ADD COLUMN dominant_trust_level ENUM('very_low','low','medium','high','verified') NULL AFTER engagement_level;

-- v2.5 — append-only stage-transition timeline (monotonic; one row per ratchet-up).
CREATE TABLE IF NOT EXISTS engagement_timeline (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tracked_email_id  BIGINT UNSIGNED NOT NULL,
  stage             ENUM('delivered','open_signal','likely_engaged','verified_human') NOT NULL,
  level             ENUM('none','low','medium','high','verified') NOT NULL,
  evidence          JSON NULL,                              -- the evidence list that triggered this transition
  ruleset_version   INT UNSIGNED NULL,
  occurred_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_timeline_email (tracked_email_id, occurred_at),
  CONSTRAINT fk_timeline_email FOREIGN KEY (tracked_email_id)
    REFERENCES tracked_emails (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v2.3 — campaign-grain engagement aggregate, computed by the decoupled campaignAnalyzer.
--        machine_likelihood is the symbolic verdict; the numeric metrics are internal.
CREATE TABLE IF NOT EXISTS campaign_engagement_profile (
  campaign_id          BIGINT UNSIGNED NOT NULL,
  emails_sent          INT UNSIGNED NOT NULL DEFAULT 0,
  opens_total          INT UNSIGNED NOT NULL DEFAULT 0,
  opens_within_window  INT UNSIGNED NOT NULL DEFAULT 0,     -- opens within window_seconds of send
  window_seconds       INT UNSIGNED NOT NULL DEFAULT 3,
  pct_within_window    DECIMAL(5,2) NOT NULL DEFAULT 0.00,  -- INTERNAL metric
  open_time_entropy    DECIMAL(6,4) NULL,                   -- INTERNAL dispersion metric
  machine_likelihood   ENUM('human_distributed','mixed','machine_dominated','unknown') NOT NULL DEFAULT 'unknown',
  evidence             JSON NULL,
  computed_at          DATETIME NULL,
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (campaign_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
