CREATE TABLE access_beta_requests (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES access_members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('join','leave')),
  store_email TEXT NOT NULL CHECK(length(store_email) BETWEEN 3 AND 254),
  app_version TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','declined','withdrawn')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
) STRICT;
CREATE UNIQUE INDEX access_beta_requests_open ON access_beta_requests(member_id) WHERE status='pending';
CREATE INDEX access_beta_requests_status ON access_beta_requests(status,created_at);
