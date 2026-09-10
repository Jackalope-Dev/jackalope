ALTER TABLE access_devices ADD COLUMN app_version TEXT;
ALTER TABLE access_devices ADD COLUMN platform TEXT;
ALTER TABLE access_devices ADD COLUMN build_kind TEXT;
ALTER TABLE access_devices ADD COLUMN profile_kind TEXT;
ALTER TABLE access_devices ADD COLUMN last_seen_at INTEGER;
ALTER TABLE access_devices ADD COLUMN settings_checked_at INTEGER;
