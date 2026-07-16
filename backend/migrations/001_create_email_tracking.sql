-- migrations/001_create_email_tracking.sql
-- Email open/click/delivery tracking — Stage 1 foundation.
-- Run against the existing ai_email_assistant database.

USE ai_email_assistant;

-- 1) One row per sent email: the running summary state.
CREATE TABLE IF NOT EXISTS tracked_emails (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reply_id          BIGINT UNSIGNED NULL,        -- FK -> replies.id (the AI reply that produced this send)
  campaign_id       BIGINT UNSIGNED NULL,        -- reserved for later cold-outreach campaigns
  recipient_email   VARCHAR(320) NOT NULL,
  tracking_token    VARCHAR(64)  NOT NULL,
  message_id        VARCHAR(255) NULL,           -- RFC 2822 Message-ID header (for bounce matching later)
  subject           VARCHAR(998) NULL,
  sent_at           DATETIME NULL,
  delivery_status   ENUM('sent','delivered','bounced','failed') NOT NULL DEFAULT 'sent',
  open_count        INT UNSIGNED NOT NULL DEFAULT 0,
  first_opened_at   DATETIME NULL,
  last_opened_at    DATETIME NULL,
  click_count       INT UNSIGNED NOT NULL DEFAULT 0,
  first_clicked_at  DATETIME NULL,
  last_clicked_at   DATETIME NULL,
  bounced_at        DATETIME NULL,
  spam_complaint_at DATETIME NULL,
  unsubscribed_at   DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tracking_token (tracking_token),
  KEY idx_message_id (message_id),
  KEY idx_recipient (recipient_email),
  KEY idx_campaign (campaign_id),
  KEY idx_sent_at (sent_at),
  CONSTRAINT fk_tracked_reply FOREIGN KEY (reply_id)
    REFERENCES replies (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Destination URL for each rewritten link (redirect target comes from HERE, never from the request).
CREATE TABLE IF NOT EXISTS tracked_links (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tracked_email_id  BIGINT UNSIGNED NOT NULL,
  link_id           VARCHAR(32) NOT NULL,        -- short id used in /track/click/:token/:linkId
  url               TEXT NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_email_link (tracked_email_id, link_id),
  CONSTRAINT fk_link_email FOREIGN KEY (tracked_email_id)
    REFERENCES tracked_emails (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) One row per raw hit: the full open/click/... timeline.
CREATE TABLE IF NOT EXISTS email_events (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tracked_email_id  BIGINT UNSIGNED NOT NULL,
  event_type        ENUM('open','click','bounce','spam_complaint','unsubscribe') NOT NULL,
  link_id           VARCHAR(32) NULL,
  link_url          TEXT NULL,
  ip_address        VARCHAR(45) NULL,            -- IPv6-safe
  user_agent        VARCHAR(512) NULL,
  device_type       VARCHAR(32) NULL,            -- filled in Stage 2 (ua-parser-js)
  browser           VARCHAR(64) NULL,
  email_client      VARCHAR(64) NULL,
  country           VARCHAR(64) NULL,            -- filled in Stage 2 (geoip-lite)
  city              VARCHAR(128) NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_event_email (tracked_email_id),
  KEY idx_event_type (event_type),
  KEY idx_event_created (created_at),
  CONSTRAINT fk_event_email FOREIGN KEY (tracked_email_id)
    REFERENCES tracked_emails (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) Global suppression list — an address here is never emailed again.
CREATE TABLE IF NOT EXISTS suppressed_recipients (
  email       VARCHAR(320) NOT NULL,
  reason      ENUM('unsubscribed','bounced','spam_complaint') NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
