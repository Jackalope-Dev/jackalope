-- Each desktop connection registers its own device, so profiles, reinstalls and
-- data resets on one computer used to consume separate slots. Connections now
-- carry an optional opaque machine key, and the ten-device limit counts distinct
-- machines. Connections without a key, from clients that predate it, each count
-- as their own machine, as before.
ALTER TABLE access_device_links ADD COLUMN machine_key TEXT;
ALTER TABLE access_devices ADD COLUMN machine_key TEXT;
CREATE INDEX access_device_machine ON access_devices(member_id,machine_key);
DROP TRIGGER access_device_capacity;
CREATE TRIGGER access_device_capacity BEFORE INSERT ON access_devices
WHEN (
  NEW.machine_key IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM access_devices
    WHERE member_id=NEW.member_id AND machine_key=NEW.machine_key AND expires_at>unixepoch()*1000
  )
) AND (
  SELECT count(DISTINCT coalesce(machine_key,id)) FROM access_devices
  WHERE member_id=NEW.member_id AND expires_at>unixepoch()*1000
)>=10
BEGIN SELECT RAISE(ABORT,'device_capacity'); END;
