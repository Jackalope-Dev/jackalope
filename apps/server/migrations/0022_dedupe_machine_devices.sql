-- Connections used to pile up per computer: every new profile, reset, reconnect and
-- ninety-day expiry added a row, so an account showed far more computers than it has.
-- Exchange now replaces a computer's stale connections when it connects again; this clears
-- the ones already there. Per member and machine key it keeps every connection seen in the
-- last fourteen days (live profiles) and the most recently seen one, and removes the rest.
-- Connections without a machine key, from clients that predate it, are left alone. Skill
-- holdings of removed connections go with them (ON DELETE CASCADE).
DELETE FROM access_device_links WHERE hash IN (
  SELECT d.hash FROM access_devices d
  WHERE d.machine_key IS NOT NULL
    AND coalesce(d.last_seen_at, d.created_at) < unixepoch() * 1000 - 14 * 86400000
    AND EXISTS (
      SELECT 1 FROM access_devices n
      WHERE n.member_id = d.member_id AND n.machine_key = d.machine_key AND n.id <> d.id
        AND (coalesce(n.last_seen_at, n.created_at), n.id) > (coalesce(d.last_seen_at, d.created_at), d.id)
    )
);
DELETE FROM access_devices WHERE id IN (
  SELECT d.id FROM access_devices d
  WHERE d.machine_key IS NOT NULL
    AND coalesce(d.last_seen_at, d.created_at) < unixepoch() * 1000 - 14 * 86400000
    AND EXISTS (
      SELECT 1 FROM access_devices n
      WHERE n.member_id = d.member_id AND n.machine_key = d.machine_key AND n.id <> d.id
        AND (coalesce(n.last_seen_at, n.created_at), n.id) > (coalesce(d.last_seen_at, d.created_at), d.id)
    )
);
