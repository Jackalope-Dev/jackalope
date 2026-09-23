ALTER TABLE access_members ADD COLUMN newsletter_confirmed_at INTEGER;
ALTER TABLE access_waitlist_tokens ADD COLUMN newsletter_requested INTEGER NOT NULL DEFAULT 0 CHECK(newsletter_requested IN (0,1));
UPDATE access_members SET newsletter_next_at=0,newsletter_attempts=0 WHERE newsletter=1 OR sequenzy_state IS NOT NULL;
