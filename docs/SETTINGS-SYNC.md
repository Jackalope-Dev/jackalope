# Account setup and settings sync

Launch checks account access outside the numbered setup flow. App appearance and
privacy controls live on this screen. Approval shows a brief animated checkmark
(with a reduced-motion alternative), then enters the workspace or project setup.
Every desktop build requires a native verified account access lease, including
local development builds. Native execution checks remain authoritative
including after revocation and offline expiry. Saved work remains reviewable.

Project setup has six steps: Project, Agents, Decisions, Behavior, Appearance and
First task. Adding another project reuses this flow without replaying the launch
gate or app privacy. The Agents step
stages a project default and an optional allowed-agent list for the existing
native policy path. It requires at least one available enabled agent, moves the
default when it is switched off, and preserves global agent preferences. Existing
project drafts and saved completion state remain compatible. The selected project,
agent preferences, detected command defaults, appearance and first task stay in the
onboarding draft until workspace entry. Back does not register the project or change its saved
preferences. Legacy account/theme steps without a provisional project resume at
Project; new Appearance steps resume with their saved draft. No database migration
is required; the existing persisted-state merge supplies the new optional fields.

Browser pairing can share a verified waitlist membership with the requesting
desktop. That reports waiting, issues no device credential and grants neither
execution nor settings access. Pairing expires after ten minutes. After admission,
the member signs in with their approved email and reconnects if needed.

## Preferences and privacy

Agent account names, groups and tags remain in the local native profile manifest,
including optional metadata for the existing CLI login. Older manifests default
those fields without migration. Identity/status observations are cached only in
renderer memory and are not part of settings sync.

Settings sync defaults on for new connections, disclosed on the launch screen with a
control in its app privacy disclosure and Settings → Privacy. Users can
opt out before connecting. Existing saved opt-outs remain off. The local choice
survives disconnect/reconnect; transfers always require an approved connection.
Enabling a new connection restores the
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
Membership deletion also cascades to the settings row. Provider backup retention
remains separate.
An account-level deletion marker prevents future default-on connections from
recreating deleted settings. Only explicitly enabling sync overrides that marker
for the chosen desktop; the marker contains no settings or identifying text.

## Learned lessons

**Include learned lessons**, under the settings sync switch in Settings → Privacy, is
off by default and needs settings sync. The choice is saved on the desktop for the
connected account; connecting a different account starts with it off. While it is
on, every project's [learned lessons](PROJECT-KNOWLEDGE.md#learned-lessons) take part
unless the project's **Sync learned lessons** setting (Project settings or the
terminal's `/settings`) is off.

Only learned lessons sync: entries with a learning lifecycle, never hand-written
lessons, workflows or older automatic lessons. A lesson carries its learned id, a
project key, revision, update time, title, content, matching phrases, on/off state,
kind, status, statement, origin, learned date, archive reason, whether Jackalope may
still change it and whether it was kept apart from the curator. Removed lessons sync
as tombstones. History records carry their id, lesson id, time, action, reason,
revision, origin and title. Evidence references and excerpts, use counts,
opportunities, recent runs, last use, source tasks and commits, project IDs, names and
folder paths never leave the desktop. A lesson whose text looks like it holds a
credential, email address, credential URL or the home folder stays local; the status
line counts them.

Projects match by a key derived from the repository's root commits, so a clone of the
same repository matches on every computer without sending a path or remote URL. A
folder without a commit cannot sync. When two registered projects share a repository,
the first receives its lessons. Project IDs differ between installations, so a lesson
learned separately on two computers can arrive as two entries; the curator folds such
duplicates.

A newer copy wins: the higher revision, then the later update time; when both match,
the service copy stands. Applying a copy changes only the synced fields, keeping
local use counts and evidence; a lesson restored elsewhere restarts its local counts
as a local restore does. Tombstones remove the lesson and keep its suppression so it
is not learned again. History records are appended once by id. An active lesson that
arrives without local use is archived only after 100 opportunities without delivery.

The native host does all transfers; lesson text never passes through the renderer,
whose status parser accepts only status fields. A sync downloads changes since its
saved cursor, then uploads local changes in batches of at most 25 lessons and 100
history records under 24 KB. It runs when the app starts, every five minutes, on
window focus at most once a minute, when the network returns, when settings sync
changes and from **Sync lessons now**. Offline or failed syncs change nothing remote
and resume from the saved state. That state lives in
`task-runs-v1/knowledge/lesson-sync.json`: per account (a hash of the service and
email), the cursor, deletion epoch, last exchanged revision of each lesson and which
account each lesson was exchanged with. A lesson exchanged with one account is never
uploaded to another; lessons downloaded from an account remain on the desktop after
switching accounts.

**Delete synced lessons** removes the account's lessons and their history and starts
a new deletion epoch. Every other desktop's next sync receives `lessons_reset`, turns
lesson sync off there and keeps its local lessons; turning it back on uploads that
desktop's lessons again. **Delete synced settings** also deletes synced lessons.

The service accepts lesson sync only from an approved device with settings sync
consent, through the existing device credential, rate limits and 32 KB request limit:

- `POST /v1/desktop/lessons/pull` with `{epoch, cursor}` returns up to 40 lessons and
  100 history records changed after the cursor, with the next cursor and `more`.
- `POST /v1/desktop/lessons/push` with `{epoch, lessons, records}` applies the newer
  copies and returns the stored revision and update time of each lesson.
- `DELETE /v1/desktop/lessons` deletes everything and advances the epoch.

Strict schemas allow only the fields above: a title up to 120 characters, content up
to 800, a statement up to 500, ten phrases of 2–60 characters, known statuses and
history actions, and no recognizable credentials. An account holds at most 2,000
lessons including tombstones (`413 lessons_full`) and its newest 4,000 history
records. A stale epoch receives `409 lessons_reset`; missing consent receives
`403 settings_sync_disabled`. Rows are keyed by member ID in D1 and deleted with the
membership.

## Ownership and extension

- `apps/server/src/access/settings.ts` owns the versioned strict schema and
  account-keyed D1 reads, conditional writes and deletion.
- `commands/account/settings_sync.rs` owns account binding, native consent,
  bounded authenticated HTTP and validation before returning settings to React.
- `src/lib/settings-sync.ts` owns the portable projection and reconciliation.
- `src/stores/settingsSyncStore.ts` owns retry, checkpoints, transfer state and
  applying saved preferences. Checkpoints contain only portable preferences and
  an opaque connection identity. No credential reaches the renderer.
- Lesson sync: `apps/server/src/access/lessons.ts` owns the strict schemas, limits,
  conditional writes and deletion; `commands/account/lesson_sync.rs` owns account
  binding, the per-account choice and transfers; `commands/knowledge/learning/sync.rs`
  owns the wire allowlist, merging and exchange state; `src/lib/lesson-sync.ts` and
  `src/stores/lessonSyncStore.ts` own the status view and schedule.

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

Migration `0013_desktop_names.sql` adds an optional name to connected devices.
New desktop clients fill in or refresh their computer name through the authenticated
device-name endpoint. The native response advertises support through `deviceName`;
older services omit that field and are left untouched. Names are bounded to 120
characters, reject control/format characters and are returned only to the owning
account. They are device metadata, outside the portable-settings allowlist.
Apply the migration before deploying the matching Worker and website.

Migration `0011_settings_sync.sql` adds the settings table and per-device consent,
defaulting every existing device to off. Apply before deploying the matching
Worker; older service and desktop builds remain compatible with this additive
schema. The updated desktop and website must also be shipped for the new flows.
Migration `0012_settings_sync_defaults.sql` adds the account deletion marker used
by the new default-on connection flow. Both migrations precede the Worker rollout.

Migration `0019_lesson_sync.sql` adds the lesson and lesson-history tables and the
member's lesson sequence and deletion epoch. Apply it before deploying the matching
Worker; older desktops never call the lesson endpoints.

Server tests cover consent, account isolation, forbidden fields, unknown versions,
concurrent writes, delete/opt-out behavior and waitlist pairing without admission.
Native tests validate the allowlist and old saved accounts. Browser fixtures and
installed-app acceptance are separate from these tests.
