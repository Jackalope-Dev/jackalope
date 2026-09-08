ALTER TABLE access_members ADD COLUMN waitlist_referrer_id TEXT REFERENCES access_members(id) ON DELETE SET NULL;
ALTER TABLE access_members ADD COLUMN waitlist_verified_at INTEGER;
ALTER TABLE access_members ADD COLUMN referral_count INTEGER NOT NULL DEFAULT 0 CHECK(referral_count>=0);
UPDATE access_members SET waitlist_verified_at=verified_at WHERE verified_at IS NOT NULL;
CREATE INDEX access_waitlist_referrer ON access_members(waitlist_referrer_id,waitlist_verified_at,status);
CREATE INDEX access_waitlist_priority ON access_members(status,(created_at-referral_count*86400000),created_at,id);

CREATE TABLE access_waitlist_tokens (
  hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES access_members(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
) STRICT;
CREATE TABLE access_waitlist_sessions (
  hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES access_members(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE access_growth_events (
  id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES access_members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('referral','passes_ready','pass_claimed','pass_expired')),
  total INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, queued_at INTEGER
) STRICT;
CREATE INDEX access_growth_pending ON access_growth_events(queued_at,created_at);

CREATE TRIGGER access_referral_verified AFTER UPDATE OF waitlist_verified_at ON access_members
WHEN OLD.waitlist_verified_at IS NULL AND NEW.waitlist_verified_at IS NOT NULL AND NEW.status!='revoked'
BEGIN
  UPDATE access_members SET referral_count=referral_count+1 WHERE id=NEW.waitlist_referrer_id;
END;
CREATE TRIGGER access_referral_status AFTER UPDATE OF status ON access_members
WHEN NEW.waitlist_verified_at IS NOT NULL AND (OLD.status='revoked')!=(NEW.status='revoked')
BEGIN
  UPDATE access_members SET referral_count=max(0,referral_count+CASE WHEN NEW.status='revoked' THEN -1 ELSE 1 END) WHERE id=NEW.waitlist_referrer_id;
END;
CREATE TRIGGER access_referral_deleted BEFORE DELETE ON access_members
WHEN OLD.waitlist_verified_at IS NOT NULL AND OLD.status!='revoked'
BEGIN
  UPDATE access_members SET referral_count=max(0,referral_count-1) WHERE id=OLD.waitlist_referrer_id;
END;
CREATE TRIGGER access_referral_milestone AFTER UPDATE OF referral_count ON access_members
WHEN NEW.referral_count>OLD.referral_count AND NEW.status!='revoked' AND
 (NEW.referral_count IN (1,5,10,25,50) OR (NEW.referral_count>0 AND NEW.referral_count%100=0))
BEGIN
  INSERT OR IGNORE INTO access_growth_events(id,member_id,kind,total,created_at)
  VALUES('referral:'||NEW.id||':'||NEW.referral_count,NEW.id,'referral',NEW.referral_count,unixepoch()*1000);
END;
CREATE TRIGGER access_pass_claimed_insert AFTER INSERT ON access_invites WHEN NEW.status='accepted'
BEGIN
  INSERT OR IGNORE INTO access_growth_events(id,member_id,kind,created_at)
  VALUES('claimed:'||NEW.id,NEW.owner_id,'pass_claimed',NEW.accepted_at);
END;
CREATE TRIGGER access_pass_claimed_update AFTER UPDATE OF status ON access_invites
WHEN OLD.status!='accepted' AND NEW.status='accepted'
BEGIN
  INSERT OR IGNORE INTO access_growth_events(id,member_id,kind,created_at)
  VALUES('claimed:'||NEW.id,NEW.owner_id,'pass_claimed',NEW.accepted_at);
END;
CREATE TRIGGER access_passes_ready AFTER UPDATE OF status ON access_members
WHEN OLD.status='waiting' AND NEW.status='approved' AND NEW.invited_by IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO access_growth_events(id,member_id,kind,total,created_at)
  VALUES('ready:'||NEW.id,NEW.id,'passes_ready',NEW.invite_limit,NEW.approved_at);
END;
