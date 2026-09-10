# Feedback after meaningful use

Feedback invitations use the existing [private feedback inbox](BETA-MONITORING.md).
Apply the service migrations and matching service, website and desktop releases
before verifying the complete flow.

## Experience

An accepted member's desktop counts two distinct UTC days of foreground interaction
and two distinct finished tasks whose Result view was open for 15 foreground seconds.
Native history validates that the task finished; repeat views and continuations of
the same task do not increase the task count. Failed and stopped attempts also count:
the invitation seeks useful criticism, not a positive rating. Startup, downloading,
background execution and a successful process exit alone do not qualify a person.

The Result view retains a manual Share feedback on Jackalope action. After the
milestones, a short inline invitation can appear below the result when its slot is
visible, no task is running, no reply is being drafted, no question awaits an answer,
and no dialog is open. It does not take focus, animate the companion, play a sound,
open a modal or send an operating-system notification. Opening the form is explicit;
the message is reviewed before Send.

- At most two in-app invitations in this feedback round.
- At least seven days between requests across connected desktops and email.
- Later snoozes requests for 14 days. Don’t ask again stops both channels.
- A successful feedback submission ends the round. Sending remains available manually.
- Network or preference failures keep automatic invitations quiet. A lost claim
  response consumes its slot instead of risking another prompt.

Settings → Jackalope account exposes both invitation choices, including during account
connection. The optional product-notes checkbox on signup starts unchecked and
includes one feedback email. Email enrollment requires that newsletter choice and
confirmation through the email link issued for that choice;
members can subsequently stop feedback invitations in account settings without
enabling anonymous telemetry. Enabling follow-up permits account-linked active-day milestones
and up to two opaque result receipts. It does not transmit prompts, code, project
paths, task IDs, results, provider accounts or transcripts. First/last activity days,
bounded counts, preferences, cooldowns and response status can be inspected in the
private admin member details. These signals do not prove satisfaction or retention.

Email requires two shared active days, two distinct result receipts, at least three
days since the first shared activity, activity within the preceding seven days,
approved/verified membership, confirmed newsletter consent and no cooldown or completed response. Old local history
is not replayed as usage. In-app invitations remain possible without email enrollment;
only their coordination state is shared with the account.

## Delivery and response

`access/feedback.ts` owns the D1 campaign, atomic claims, enrollment, suppression and
scoped response tokens. `access/mail.ts` uses the existing encrypted outbox and
scheduled handler. A unique email reservation prevents duplicate campaign emails;
the same provider idempotency key is retained across bounded retries. The seven-day
outbox lifetime is shorter than the provider's documented 14-day idempotency window.
The feedback message uses Sequenzy's consent-aware marketing mode, with open/click
tracking disabled. Existing sign-in and invitation delivery is unchanged.

Eligibility is checked at enqueue and suppression/revocation is rechecked before
delivery. Cooldown extends from a delivery attempt, not just the enqueue time.
Opt-out cancels unsent mail; mail already handed to the provider cannot be recalled.
The provider's own unsubscribe/bounce/complaint suppression also applies. Its standard
marketing unsubscribe can have a broader scope than the feedback-specific link.
See the [provider send contract](https://github.com/sequenzy/sequenzy-go/blob/main/transactional/client.go).

The email asks what is useful and what gets in the way, linking to `/feedback/`.
Random 256-bit tokens are hashed in D1 and encrypted in pending mail. They expire
after 90 days, cannot sign in or grant access, and are carried in the URL fragment.
The page removes the fragment from the address bar, uses no-store/no-referrer/noindex,
and is omitted from sitemap/discovery output. Opening a link is read-only. Submission
and feedback-specific unsubscribe require an explicit same-origin POST action.

The page preserves the draft and submission ID on retry and previews text safely.
Email responses enter the existing private inbox with an email-response source;
app version and OS remain unknown rather than being invented. The account records
completion without adding the member email to the feedback message. Include contact
details voluntarily to request a reply. Replies sent directly by email are not
automatically matched to campaign completion; the provided form completes that loop.

Native account preferences preserve local suppression before network I/O and retry
pending changes on the next interaction. Saved accounts default to email disabled.
Native runtime snapshots are released before account locking or network calls;
execution never waits for feedback delivery. Quiet prompts require online account
coordination, including when email follow-up is disabled.

## Retention and rollout

The scheduler expires private response tokens and clears activity milestones after
90 days without activity. Minimal invitation/completion/suppression state remains with
membership to prevent repeat invitations, and cascades on membership deletion.
Written feedback retains the existing configured feedback retention. Local progress
lives with the protected account record; normal app restarts preserve it.

Apply all pending service migrations, including 0010 (invitations) and 0016
(newsletter confirmation), to staging first, then
verify the service/website and installed desktop with a controlled member and inbox.
Contributor builds remain unable to send without the configured services. Do not
backfill first-use from approval, download, or device connection records. Old clients
keep the existing telemetry and feedback contracts.

Focused tests cover consent, distinct milestones, concurrent scheduler and prompt
claims, cooldown, snooze, opt-out, revoked access, scoped tokens, response retries and
provider idempotency. `scripts/verification/verify-feedback.mjs` exercises actual
components with explicit browser fixtures at desktop 1280×840/960×640 and website
1280/960/390 widths, both appearances, reduced motion and keyboard controls. Run
the desktop and website Vite servers on 5297 and 5296 respectively, with the website
`VITE_ACCESS_API=https://feedback-fixture.invalid`. Fixture screenshots are retained
under `output/feedback-invitations/`. Fixtures and local tests do not establish live
inbox placement, production deployment or signed installed-app acceptance.
