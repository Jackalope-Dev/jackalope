ALTER TABLE access_members ADD COLUMN waitlist_joined_at INTEGER;
UPDATE access_members SET waitlist_joined_at=created_at WHERE source!='invitation';
DROP INDEX access_waitlist_priority;
CREATE INDEX access_waitlist_priority ON access_members(status,(waitlist_joined_at-referral_count*86400000),waitlist_joined_at,id);
