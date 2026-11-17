CREATE TABLE product_note_drafts (
  month TEXT PRIMARY KEY CHECK(month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  state TEXT NOT NULL CHECK(state IN ('drafting','failed','skipped','ready','handed_off','dismissed')),
  draft TEXT,
  candidates TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  notified_at INTEGER,
  notify_attempts INTEGER NOT NULL DEFAULT 0,
  campaign_id TEXT,
  campaign_url TEXT
) STRICT;
