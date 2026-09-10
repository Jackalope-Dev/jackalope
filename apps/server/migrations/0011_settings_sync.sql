CREATE TABLE access_settings (
  member_id TEXT PRIMARY KEY REFERENCES access_members(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK(revision > 0),
  settings TEXT NOT NULL CHECK(json_valid(settings)),
  updated_at INTEGER NOT NULL
) STRICT;
ALTER TABLE access_devices ADD COLUMN settings_sync INTEGER NOT NULL DEFAULT 0 CHECK(settings_sync IN (0,1));
