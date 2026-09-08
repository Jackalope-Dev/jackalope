CREATE TABLE access_feedback (
  member_id TEXT PRIMARY KEY REFERENCES access_members(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  prompts_enabled INTEGER NOT NULL DEFAULT 1 CHECK(prompts_enabled IN (0,1)),
  consent_at INTEGER,
  first_active_at INTEGER,
  last_active_day TEXT,
  active_days INTEGER NOT NULL DEFAULT 0 CHECK(active_days BETWEEN 0 AND 2),
  results TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(results) AND json_array_length(results)<=2),
  next_prompt_at INTEGER NOT NULL DEFAULT 0,
  prompt_id TEXT,
  prompt_count INTEGER NOT NULL DEFAULT 0 CHECK(prompt_count BETWEEN 0 AND 2),
  completed_at INTEGER,
  email_id TEXT UNIQUE,
  token_hash TEXT UNIQUE,
  token_expires_at INTEGER,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX access_feedback_due ON access_feedback(enabled,completed_at,next_prompt_at);
