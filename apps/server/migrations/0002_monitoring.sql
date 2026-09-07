CREATE TABLE telemetry_receipts (
  id TEXT PRIMARY KEY, hash TEXT NOT NULL, expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX telemetry_receipts_expiry ON telemetry_receipts(expires_at);
INSERT INTO quotas(name,max_rows) VALUES ('telemetry_receipts',1000000),('metrics',100000);
CREATE TRIGGER telemetry_capacity BEFORE INSERT ON telemetry_receipts
WHEN NOT EXISTS(SELECT 1 FROM telemetry_receipts WHERE id=NEW.id)
AND (SELECT retained>=max_rows FROM quotas WHERE name='telemetry_receipts')
BEGIN SELECT RAISE(ABORT,'storage_capacity'); END;
CREATE TRIGGER telemetry_identity BEFORE UPDATE OF hash ON telemetry_receipts
BEGIN SELECT RAISE(ABORT,'id_conflict'); END;
CREATE TRIGGER telemetry_insert AFTER INSERT ON telemetry_receipts
BEGIN UPDATE quotas SET retained=retained+1 WHERE name='telemetry_receipts'; END;
CREATE TRIGGER telemetry_delete AFTER DELETE ON telemetry_receipts
BEGIN UPDATE quotas SET retained=retained-1 WHERE name='telemetry_receipts'; END;
CREATE TABLE metrics (
  day TEXT NOT NULL, version TEXT NOT NULL, channel TEXT NOT NULL, os TEXT NOT NULL,
  name TEXT NOT NULL, dimension TEXT NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY(day,version,channel,os,name,dimension)
) STRICT;
CREATE TRIGGER metrics_capacity BEFORE INSERT ON metrics
WHEN NOT EXISTS(SELECT 1 FROM metrics WHERE day=NEW.day AND version=NEW.version AND channel=NEW.channel AND os=NEW.os AND name=NEW.name AND dimension=NEW.dimension)
AND (SELECT retained>=max_rows FROM quotas WHERE name='metrics')
BEGIN SELECT RAISE(ABORT,'storage_capacity'); END;
CREATE TRIGGER metrics_insert AFTER INSERT ON metrics
BEGIN UPDATE quotas SET retained=retained+1 WHERE name='metrics'; END;
CREATE TRIGGER metrics_delete AFTER DELETE ON metrics
BEGIN UPDATE quotas SET retained=retained-1 WHERE name='metrics'; END;
ALTER TABLE feedback ADD COLUMN status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE feedback ADD COLUMN email_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE feedback ADD COLUMN email_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feedback ADD COLUMN email_next INTEGER NOT NULL DEFAULT 0;
CREATE INDEX feedback_delivery ON feedback(email_next) WHERE email_state != 'sent' AND email_attempts < 5;
