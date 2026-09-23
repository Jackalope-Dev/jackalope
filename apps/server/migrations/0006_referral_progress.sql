ALTER TABLE access_members ADD COLUMN first_download_at INTEGER;
ALTER TABLE access_members ADD COLUMN first_desktop_at INTEGER;
UPDATE access_members
SET first_desktop_at=(SELECT min(created_at) FROM access_devices WHERE member_id=access_members.id)
WHERE EXISTS(SELECT 1 FROM access_devices WHERE member_id=access_members.id);
