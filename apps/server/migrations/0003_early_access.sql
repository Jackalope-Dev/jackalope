CREATE TABLE access_members (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'waiting'
    CHECK(status IN ('waiting','approved','revoked')),
  created_at INTEGER NOT NULL, approved_at INTEGER, verified_at INTEGER,
  source TEXT NOT NULL, invited_by TEXT REFERENCES access_members(id),
  newsletter INTEGER NOT NULL DEFAULT 0 CHECK(newsletter IN (0,1)),
  newsletter_synced_at INTEGER,
  newsletter_attempts INTEGER NOT NULL DEFAULT 0, newsletter_next_at INTEGER NOT NULL DEFAULT 0,
  share_code TEXT NOT NULL UNIQUE, invite_limit INTEGER NOT NULL DEFAULT 5 CHECK(invite_limit BETWEEN 0 AND 100)
) STRICT;
CREATE INDEX access_waitlist ON access_members(status,created_at);
CREATE INDEX access_newsletter_delivery ON access_members(newsletter,newsletter_synced_at,newsletter_next_at);
CREATE TABLE access_invites (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES access_members(id), email TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','revoked')),
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, accepted_at INTEGER, last_sent INTEGER NOT NULL
) STRICT;
CREATE INDEX access_invite_owner ON access_invites(owner_id,status,expires_at);
CREATE UNIQUE INDEX access_invite_pending ON access_invites(owner_id,email) WHERE status='pending';
CREATE UNIQUE INDEX access_invite_accepted ON access_invites(email) WHERE status='accepted';
CREATE TRIGGER access_invite_capacity BEFORE INSERT ON access_invites
WHEN NEW.status IN ('pending','accepted') AND
  (SELECT count(*) FROM access_invites WHERE owner_id=NEW.owner_id AND
    (status='accepted' OR (status='pending' AND expires_at>unixepoch()*1000))) >=
  (SELECT invite_limit FROM access_members WHERE id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'invite_capacity'); END;
CREATE TRIGGER access_invite_rate BEFORE INSERT ON access_invites
WHEN (SELECT count(*) FROM access_invites WHERE owner_id=NEW.owner_id AND created_at>unixepoch()*1000-86400000)>=25
BEGIN SELECT RAISE(ABORT,'invite_rate'); END;
CREATE TABLE access_tokens (
  hash TEXT PRIMARY KEY, email TEXT NOT NULL, invite_id TEXT, share_code TEXT,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
) STRICT;
CREATE INDEX access_token_email ON access_tokens(email,created_at);
CREATE TABLE access_sessions (
  hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES access_members(id), expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE access_mail (
  id TEXT PRIMARY KEY, email TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','queued','failed')),
  created_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0,
  lease TEXT, provider_id TEXT
) STRICT;
CREATE INDEX access_mail_delivery ON access_mail(state,next_at);
CREATE INDEX access_mail_email ON access_mail(email,created_at);
CREATE TRIGGER access_member_capacity BEFORE INSERT ON access_members
WHEN NOT EXISTS(SELECT 1 FROM access_members WHERE email=NEW.email)
AND (SELECT count(*) FROM access_members)>=200000
BEGIN SELECT RAISE(ABORT,'access_storage_capacity'); END;
