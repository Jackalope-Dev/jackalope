-- Opt-in sync of learned lessons, layered on settings sync consent. Rows hold
-- only allowlisted lesson fields; evidence, usage counts and paths never reach
-- the service. `lesson_seq` orders changes for incremental pulls and
-- `lesson_epoch` changes when the member deletes synced lessons, so devices
-- holding an older epoch stop instead of uploading them again.
ALTER TABLE access_members ADD COLUMN lesson_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE access_members ADD COLUMN lesson_epoch INTEGER NOT NULL DEFAULT 1;
CREATE TABLE access_lessons (
  member_id TEXT NOT NULL REFERENCES access_members(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  project TEXT NOT NULL CHECK(length(project) = 64),
  revision INTEGER NOT NULL CHECK(revision > 0),
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL CHECK(deleted IN (0,1)),
  body TEXT CHECK(body IS NULL OR (json_valid(body) AND length(body) <= 4096)),
  seq INTEGER NOT NULL,
  PRIMARY KEY(member_id, id)
) STRICT;
CREATE INDEX access_lessons_seq ON access_lessons(member_id, seq);
CREATE TABLE access_lesson_records (
  member_id TEXT NOT NULL REFERENCES access_members(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  project TEXT NOT NULL CHECK(length(project) = 64),
  record TEXT NOT NULL CHECK(json_valid(record) AND length(record) <= 2048),
  seq INTEGER NOT NULL,
  PRIMARY KEY(member_id, id)
) STRICT;
CREATE INDEX access_lesson_records_seq ON access_lesson_records(member_id, seq);
