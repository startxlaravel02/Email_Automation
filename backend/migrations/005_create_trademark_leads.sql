-- migrations/005_create_trademark_leads.sql
-- USPTO trademark lead-gen pipeline: seed table from bulk XML, later
-- enriched/verified per-serial-number via the TSDR API.

CREATE TABLE IF NOT EXISTS trademark_leads (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  serial_number VARCHAR(20) NOT NULL,
  registration_number VARCHAR(20) DEFAULT NULL,
  mark_text TEXT DEFAULT NULL,
  owner_name VARCHAR(500) DEFAULT NULL,
  owner_address TEXT,
  owner_email VARCHAR(500) DEFAULT NULL,      -- only ever filled by TSDR (not in bulk schema)
  status_code VARCHAR(10) DEFAULT NULL,
  status_text TEXT DEFAULT NULL,       -- only ever filled by TSDR (bulk file has no text field)
  filing_date DATE DEFAULT NULL,
  registration_date DATE DEFAULT NULL,
  computed_deadline_date DATE DEFAULT NULL,
  deadline_type ENUM('section_8','section_8_9','section_71','unknown') NOT NULL DEFAULT 'unknown',
  attorney_name VARCHAR(700) DEFAULT NULL,
  attorney_confirmed_at DATETIME DEFAULT NULL, -- last time TSDR verified attorney/email/status
  lead_status ENUM('new','verified','qualified','sent','bounced','opted_out') NOT NULL DEFAULT 'new',
  source ENUM('annual_seed','daily_sync') NOT NULL DEFAULT 'annual_seed',
  email_sent_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_serial_number (serial_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_lead_queue ON trademark_leads (computed_deadline_date, attorney_name, email_sent_at);
CREATE INDEX idx_lead_status ON trademark_leads (lead_status, computed_deadline_date);