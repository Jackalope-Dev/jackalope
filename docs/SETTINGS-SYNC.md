# Account setup and settings sync

The first-run welcome screen offers an account outside the numbered setup flow. App
appearance and privacy controls live on this screen. Approval shows a brief animated
checkmark (with a reduced-motion alternative), then enters project setup; **Continue
without an account** goes straight to project setup. Settings sync, lesson sync and
skill sync are account features: the native host refuses them before any request
unless an approved account with a current offline lease is connected. Local work
never depends on the account.

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

In waitlist mode, browser pairing can share a verified waitlist membership with the
requesting desktop. That reports waiting, issues no device credential and grants
neither execution nor settings access. Pairing expires after ten minutes. After
admission, the member signs in with their approved email and reconnects if needed.

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
credential, email address, credential URL or the home folder, or holds a secret value
Jackalope gave an agent this session, stays local; the status line counts them.

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

## Skills

The **Skills** page in Agents lists the agent skills on this computer and syncs the
ones the person chooses through their account. A skill is a folder holding a
`SKILL.md`. Jackalope looks in the personal folders `~/.claude/skills` (or
`$CLAUDE_CONFIG_DIR/skills`), `$CODEX_HOME/skills` (by default `~/.codex/skills`) and
`~/.agents/skills`, and in the `.claude/skills` and `.agents/skills` folders of each
registered project. It skips folder names that start with a dot and the lessons skill
Jackalope writes for a project. The page can also create a skill from a template,
import a Markdown file, open or reveal a skill and **Export a copy** to a chosen
folder. The **Browse and submit skills** section is marked Coming later; there is no
skills directory.

A synced skill carries its location: personal or project, the agent folder (Claude,
Codex or the shared `.agents` folder), the skill's folder name and, for a project
skill, the key derived from the repository's root commits, as for learned lessons. It
never carries a folder path or remote URL. Each computer writes it to the same agent
folder: the personal one, or the one in the registered project with the same key. A
project skill waits on a computer where that project is not registered. Codex skills
are personal only. A project without a commit cannot sync.

### Consent

Skill sync is off by default and needs settings sync. It starts only after the person
confirms **Turn on skill sync**, or confirms **Sync skill** for one skill. Turning it on
writes skills already synced from other computers into their folders here. A local
skill uploads only after the person chooses to sync it. The choice is saved on the
desktop for the connected account (a hash of the service and email); connecting a
different account starts with it off. Without settings sync, the desktop refuses every
skill sync action except turning it off and deleting synced skills. When the service
answers `403 settings_sync_disabled`, the desktop turns skill sync and settings sync off.

### What can sync

Only text files inside the skill folder sync. Files and folders whose names start
with a dot, symbolic links inside the skill, and `node_modules`, `__pycache__` and
`target` folders are never read. The skill folder itself may be a link. A skill stays on this computer, and its card says why, when it:

- is committed to its repository, fully or partly;
- has more than 20 files, a file over 96 KB, or more than 24,000 characters in total
  (counted in UTF-16 units, as the service counts them);
- would not fit in one request: its files must encode to at most 30,000 bytes of JSON
  so the request stays under the service's 32 KB limit;
- holds a file that is not UTF-8 text, a file nested more than two folders deep, or a
  file name outside letters, digits, `.`, `_` and `-`;
- has a folder name that is not 1 to 64 lowercase letters, digits, `.`, `_` and `-`;
- matches a credential pattern: a private key, AWS access key ID, GitHub token,
  `sk-` key or Slack token, in any file or the description;
- belongs to a project without a commit.

An untracked skill inside a repository can sync; its card warns that a commit could
include it.

A synced skill sends its location, the `description` from its `SKILL.md` front matter
(up to 1,024 characters), each file's relative path and text, and a content hash. The
service's strict schema refuses any other field, absolute paths, `..`, names that start
with a dot, paths of more than three parts or 120 characters, a missing `SKILL.md`,
NUL characters and the same credential patterns. An account holds at most 200 synced
skills, including removed ones (`413 skills_full`).

### Transfers and conflicts

The native host does all transfers through the existing device credential, rate limits
and 32 KB request limit. A sync downloads changes since its saved cursor, settles each
synced skill against this computer's copy, uploads local changes and reports which
revision this computer holds. It runs when the app starts, every two minutes while skill
sync is on, on window focus at most once a minute, when the network returns, when
settings sync or the connected account changes, when the Skills page opens and from
**Sync now**. Offline or failed syncs keep the saved state and resume. That state lives
in `task-runs-v1/skills/skill-sync.json`: per account, the epoch, cursor, the last
exchanged revision and content hash of each synced skill, any account copy not yet
written, and the devices view.

Every upload names the revision it replaces. The service stores it only when that
revision is still current; otherwise it answers `conflict` with the current revision.
Creating a skill that already exists is also a conflict. The desktop writes the account
copy only when the local copy is missing or unchanged since the last exchange, and
uploads a local edit only when the account copy has not changed. When both changed, or
a local skill at the same location differs from the first account copy, the card shows
**Changed in two places** and nothing is written or uploaded until the person compares
the copies and picks **Use the account copy** or **Keep this computer's copy**.

Synced content is written only into the skill's folder, and files the account copy no
longer has are removed. Before writing, Jackalope asks Git whether any file it would
write or remove is tracked; if one is, it writes nothing and shows the error on the
card. It never writes through a link. When a sync writes a project skill that was not on
this computer, Jackalope adds its folder to the repository's `.git/info/exclude`, which
Git never commits, unless Git already ignores it. New project skills from a template or
import offer the same **Keep out of commits** choice, on by default, and an untracked
project skill offers it from its menu.

The page shows which of the account's computers hold each synced skill and whether they
have the newest revision.

### Stopping and deleting

- **Stop syncing** on one skill removes it from the account at its latest revision.
  Every computer keeps its current files and stops syncing it. If another computer
  changed it first, the desktop asks for a sync before trying again.
- **Turn off on this computer** stops transfers here and keeps the account copies.
- **Delete synced skills** removes every synced skill and device record from the
  account and starts a new deletion epoch. Every other desktop's next sync receives
  `409 skills_reset`, turns skill sync off there and forgets its sync state. Skill files
  stay on every computer. **Delete synced settings** also deletes synced skills.

Synced skills, like synced settings and learned lessons, are not end-to-end encrypted:
the service stores their text as JSON in D1, keyed by member ID and deleted with the
membership. A device's records are deleted with the device.

The service accepts skill sync only from an approved device with settings sync consent,
except deletion:

- `POST /v1/desktop/skills/pull` with `{epoch, cursor}` returns up to 8 skills changed
  after the cursor, with the epoch, next cursor and `more`. A first pull sends epoch 0.
- `POST /v1/desktop/skills/push` with `{epoch, id, baseRevision, deleted, skill}`
  returns `stored` with the new revision and update time, or `conflict` with the
  current revision. `baseRevision` is 0 for a new skill; a removal omits `skill`.
- `POST /v1/desktop/skills/have` with `{epoch, have}` records the revision this device
  holds of each skill and returns up to 10 of the account's devices and which revision
  each holds.
- `DELETE /v1/desktop/skills` deletes every synced skill and advances the epoch.

A stale epoch receives `409 skills_reset`; missing consent receives
`403 settings_sync_disabled`.

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
- Skill sync: `apps/server/src/access/skills.ts` owns the strict schema, limits,
  revision-checked writes, the devices view and deletion; `commands/skills.rs` owns the
  page's cards and local skill commands; `commands/skills/detect.rs` owns the skill
  folders, bounded reading and what blocks a skill; `commands/skills/store.rs` owns the
  saved sync state, the sync and conflict decisions and every write to disk;
  `commands/account/skill_sync.rs` owns account binding, the per-account choice and
  transfers; `src/lib/skill-sync.ts` and `src/stores/skillSyncStore.ts` own the page
  view and schedule.

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

Migration `0021_skill_sync.sql` adds the synced skill and skill-device tables and the
member's skill sequence and deletion epoch. Apply it to staging and production before
deploying the Worker that serves the skill routes. Older desktops never call the skill
endpoints, and newer desktops report that skill sync is not available when a service
answers 404.

Server tests cover consent, account isolation, forbidden fields, unknown versions,
concurrent writes, delete/opt-out behavior and waitlist pairing without admission.
Skill sync server tests cover consent, account isolation, refused fields and paths,
revision conflicts, the devices view, deletion epochs and the account limit. Native
skill tests cover Git classification, blocked skills, credential patterns, merge and
conflict decisions, refusing tracked writes and the local exclude file.
Native tests validate the allowlist and old saved accounts. Browser fixtures and
installed-app acceptance are separate from these tests.
