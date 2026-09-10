CREATE TABLE quotas (
  name TEXT PRIMARY KEY,
  retained INTEGER NOT NULL DEFAULT 0 CHECK(retained >= 0),
  max_rows INTEGER NOT NULL CHECK(max_rows > 0)
) STRICT;
INSERT INTO quotas(name, max_rows) VALUES ('events', 1000000), ('feedback', 10000);

CREATE TABLE events (
  install_id TEXT NOT NULL, id TEXT NOT NULL, received_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(install_id, id)
) STRICT;
CREATE INDEX events_expiry ON events(expires_at);
CREATE INDEX events_received ON events(received_at);
CREATE TABLE feedback (
  id TEXT PRIMARY KEY, received_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  hash TEXT NOT NULL, payload TEXT NOT NULL
) STRICT;
CREATE INDEX feedback_expiry ON feedback(expires_at);
CREATE INDEX feedback_inbox ON feedback(received_at DESC, id DESC);

CREATE TRIGGER events_capacity BEFORE INSERT ON events
WHEN NOT EXISTS (SELECT 1 FROM events WHERE install_id=NEW.install_id AND id=NEW.id)
AND (SELECT retained >= max_rows FROM quotas WHERE name='events')
BEGIN SELECT RAISE(ABORT, 'storage_capacity'); END;
CREATE TRIGGER feedback_capacity BEFORE INSERT ON feedback
WHEN NOT EXISTS (SELECT 1 FROM feedback WHERE id=NEW.id)
AND (SELECT retained >= max_rows FROM quotas WHERE name='feedback')
BEGIN SELECT RAISE(ABORT, 'storage_capacity'); END;
CREATE TRIGGER events_identity BEFORE UPDATE OF install_id, id, received_at, hash, payload ON events
BEGIN SELECT RAISE(ABORT, 'id_conflict'); END;
CREATE TRIGGER feedback_identity BEFORE UPDATE OF id, received_at, hash, payload ON feedback
BEGIN SELECT RAISE(ABORT, 'id_conflict'); END;
CREATE TRIGGER events_insert AFTER INSERT ON events
BEGIN UPDATE quotas SET retained=retained+1 WHERE name='events'; END;
CREATE TRIGGER events_delete AFTER DELETE ON events
BEGIN UPDATE quotas SET retained=retained-1 WHERE name='events'; END;
CREATE TRIGGER feedback_insert AFTER INSERT ON feedback
BEGIN UPDATE quotas SET retained=retained+1 WHERE name='feedback'; END;
CREATE TRIGGER feedback_delete AFTER DELETE ON feedback
BEGIN UPDATE quotas SET retained=retained-1 WHERE name='feedback'; END;
