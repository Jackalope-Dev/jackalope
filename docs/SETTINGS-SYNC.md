# Account setup and settings sync

Guided setup starts with Account, then Theme, Project, Agent and First task.
Official beta builds require a native verified access lease before continuing.
Development builds can continue without a hosted account. Existing completed
profiles remain completed; replaying setup begins with Account. Native execution
checks remain authoritative, including after revocation and offline expiry.

Browser pairing can share a verified waitlist membership with the requesting
desktop. That reports waiting, issues no device credential and grants neither
execution nor settings access. Pairing expires after ten minutes. After admission,
the member signs in with their approved email and reconnects if needed.

## Preferences and privacy

Settings sync is off by default, with one control in onboarding's privacy
disclosure and Settings → Privacy. Consent belongs to each connected desktop;
disconnecting clears its local consent. Enabling a new connection restores the
existing account copy, or uploads the current portable preferences if none exists.
Subsequent changes sync after a short debounce, on focus/online events and once
per minute while the app is open. Work continues during network failures.

Version 1 allows only app accent color, dark/manual/automatic appearance,
atmosphere, color harmony, companion reactions and notification choices. Theme
previews and project-specific themes are excluded. Credentials, paths, arbitrary
names, repository content, task history, provider accounts and telemetry consent
are never included. Three independent boundaries select/validate this allowlist:
the renderer projection, the native DTO and the Worker strict schema.

The settings row references the existing internal membership ID; account-linked
sync is not anonymous. The existing account system stores email for sign-in.
The new record contains no email, name, free text or secrets. It retains one
current JSON snapshot, a revision and server update time, not a settings history.

Turning sync off saves the native opt-out before attempting remote consent
revocation, so an offline opt-out still blocks later transfers from this desktop.
An already-sent request may finish. Existing local settings and the saved account
copy remain. Account checks continue independently.

**Delete synced settings** removes the account copy and disables every current
device's server consent in one D1 transaction. Upload SQL rechecks that consent,
so stale requests cannot recreate the copy after deletion. Devices require a
fresh explicit opt-in to upload again. Local preferences remain. A failed delete
shows an error and must be retried online; it never claims remote deletion.
Deleting a membership also cascades to its settings row as part of the existing
account-deletion workflow. Provider backup retention remains separate.

## Ownership and extension

- `apps/server/src/access/settings.ts` owns the versioned strict schema and
  account-keyed D1 reads, conditional writes and deletion.
- `commands/account/settings_sync.rs` owns account binding, native consent,
  bounded authenticated HTTP and validation before returning settings to React.
- `src/lib/settings-sync.ts` owns the portable projection and reconciliation.
- `src/stores/settingsSyncStore.ts` owns retry, checkpoints, transfer state and
  applying saved preferences. Checkpoints contain only portable preferences and
  an opaque connection identity. No credential reaches the renderer.

Writes use a server revision comparison. A stale writer receives 409. Local and
remote changes since the saved baseline require an explicit choice; neither
silently overwrites the other. Theme previews defer remote application.

For a future setting, first decide whether it is portable and safe to upload.
Add it explicitly to all three allowlists and to projection/restore tests; new
local store fields are excluded by default. Breaking payload changes use a new
version and explicit migration functions, with retained readers for supported
older versions. Older clients reject unknown versions/fields before writing,
preserving newer snapshots. The JSON record avoids a database-column migration
for each preference, and one indexed row per member bounds storage and lookup
cost. Do not add free text, paths or credentials to this protocol.

## Rollout and checks

Migration `0011_settings_sync.sql` adds the settings table and per-device consent,
defaulting every existing device to off. Apply before deploying the matching
Worker; older service and desktop builds remain compatible with this additive
schema. The updated desktop and website must also be shipped for the new flows.

Server tests cover consent, account isolation, forbidden fields, unknown versions,
concurrent writes, delete/opt-out behavior and waitlist pairing without admission.
Native tests validate the allowlist and old saved accounts. Browser fixtures and
installed-app acceptance are separate from these tests.
