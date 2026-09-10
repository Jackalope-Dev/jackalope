ALTER TABLE access_members ADD COLUMN settings_sync_deleted INTEGER NOT NULL DEFAULT 0 CHECK(settings_sync_deleted IN (0,1));
