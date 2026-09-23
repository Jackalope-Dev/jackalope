CREATE TABLE access_device_links (
  hash TEXT PRIMARY KEY,
  verification_hash TEXT NOT NULL UNIQUE,
  user_code TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  polled_at INTEGER NOT NULL DEFAULT 0,
  member_id TEXT REFERENCES access_members(id) ON DELETE CASCADE,
  used_at INTEGER
) STRICT;
CREATE INDEX access_device_link_expiry ON access_device_links(expires_at);
CREATE TABLE access_devices (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  member_id TEXT NOT NULL REFERENCES access_members(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX access_device_member ON access_devices(member_id,expires_at);
CREATE TRIGGER access_device_capacity BEFORE INSERT ON access_devices
WHEN (SELECT count(*) FROM access_devices WHERE member_id=NEW.member_id AND expires_at>unixepoch()*1000)>=10
BEGIN SELECT RAISE(ABORT,'device_capacity'); END;
CREATE TRIGGER access_device_link_capacity BEFORE INSERT ON access_device_links
WHEN (SELECT count(*) FROM access_device_links)>=20000
BEGIN SELECT RAISE(ABORT,'device_storage_capacity'); END;
CREATE TRIGGER access_device_member_revoked AFTER UPDATE OF status ON access_members
WHEN NEW.status!='approved'
BEGIN
  DELETE FROM access_devices WHERE member_id=NEW.id;
  DELETE FROM access_device_links WHERE member_id=NEW.id;
END;
