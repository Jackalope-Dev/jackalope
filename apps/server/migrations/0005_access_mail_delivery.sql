ALTER TABLE access_mail ADD COLUMN provider_send_id TEXT;
ALTER TABLE access_mail ADD COLUMN delivery_status TEXT;
ALTER TABLE access_mail ADD COLUMN delivery_checked_at INTEGER;
