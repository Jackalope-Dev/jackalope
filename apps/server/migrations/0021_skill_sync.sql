-- Opt-in sync of agent skills the person chose, layered on settings sync
-- consent. A row holds one skill's text files and where it belongs (personal or
-- a project matched by its root-commit key), never a folder path. Writes compare
-- the revision the device last saw, so a stale writer gets a conflict instead of
-- overwriting. `skill_seq` orders changes for incremental pulls and
-- `skill_epoch` changes when the member deletes synced skills.
ALTER TABLE access_members ADD COLUMN skill_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE access_members ADD COLUMN skill_epoch INTEGER NOT NULL DEFAULT 1;
CREATE TABLE access_skills (
  member_id TEXT NOT NULL REFERENCES access_members(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
  body TEXT CHECK(body IS NULL OR (json_valid(body) AND length(body) <= 40000)),
  seq INTEGER NOT NULL,
  PRIMARY KEY(member_id, id)
) STRICT;
CREATE INDEX access_skills_seq ON access_skills(member_id, seq);
-- Which revision of each skill a device last held, for the account's device view.
CREATE TABLE access_skill_devices (
  member_id TEXT NOT NULL REFERENCES access_members(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  device_id TEXT NOT NULL REFERENCES access_devices(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  PRIMARY KEY(member_id, skill_id, device_id)
) STRICT;
CREATE INDEX access_skill_devices_device ON access_skill_devices(device_id);
