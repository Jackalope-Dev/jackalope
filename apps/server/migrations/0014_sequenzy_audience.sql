-- Records the tag and attribute payload last accepted by Sequenzy so the sweep
-- can reconcile a member instead of syncing their address once and never again.
ALTER TABLE access_members ADD COLUMN sequenzy_state TEXT;
CREATE INDEX access_sequenzy_sync ON access_members(newsletter_next_at, sequenzy_state);
