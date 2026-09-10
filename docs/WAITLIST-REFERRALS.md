# Waitlist referrals and Instant Access Passes

Waitlist sharing is unlimited. After verifying an email, a person can open
`/waitlist/` to see their current position, verified and pending referral totals,
and a public `/?ref=…` link. Accepted members separately receive five Instant
Access Passes, using the existing `/access/?invite=…` capacity rules. Old waitlist
links continue to add waiting members and never spend passes.

## Priority and attribution

Each new, email-verified referral earns one day of priority. Order is waitlist
join time minus referral count × 24 hours, then join time and member ID for stable
ties. The admin defaults to that same order and can sort by most referrals or
newest requests. Position can move in either direction; approval remains an
explicit owner action and no access date is promised.

The first registration fixes attribution. Repeat registrations cannot replace
it or award another credit. Self-referrals and unverified referrers earn none.
Revoking or deleting a referred member removes their credit; restoring a verified
member restores it without sending the same milestone again. Email verification
establishes control of an address, not uniqueness of a human; admin review and
removal remain available for abuse. Existing IP and email rate limits still apply
to requests even though the referral allowance has no cap.

Email pass reservations do not join the ranked waitlist. Joining later establishes
their waitlist join time; existing signup times are preserved by migration. Survey
answers and newsletter consent do not affect ranking. Referrers see aggregate
waitlist counts, while admins see per-member counts and pass acceptance totals.
The browser remembers the public referral in first-party session storage while
visiting other pages; referral parameters cannot approve an account.

## Email lifecycle

The existing Sequenzy transactional outbox handles all sends, leases and retries.
The admin provides private previews of all eight templates.

| Trigger | Message and action |
| --- | --- |
| New waitlist signup | Verify email and see your place; single-use link valid for seven days. |
| Requested status link | Same waitlist entry, with a fresh link valid for 30 minutes. |
| 1, 5, 10, 25, 50 and each 100 verified referrals | Referral milestone; open current progress. |
| Owner approval | Welcome; open member space and five passes. |
| Email pass or shared pass claim request | Verify and claim, subject to reservation/capacity. |
| Pass successfully claimed | Recipient receives passes-ready email; inviter receives claim notice. |
| Email reservation expires | Owner receives an available-again notice; recipient is not chased. |
| Member sign-in request | Existing private 30-minute member sign-in link. |

Growth events use durable unique keys and transactional outbox insertion. Their
deduplication receipts survive ordinary mail pruning, so a retry, replay or
restored referral cannot requeue the same milestone. The five-minute scheduled
worker and normal delivery calls drain pending events in bounded batches. Email
delivery remains at least once at the provider boundary. Milestone notices do not
consume the sign-in email cooldown. No bulk migration email is sent.

Waitlist tokens and sessions use separate tables and a separate Secure, HttpOnly
cookie. They cannot authorize downloads, device connections or pass grants.
Tokens are hashed at rest; private links live only in encrypted outbox payloads
and URL fragments cleared before explicit confirmation. Status pages are private,
uncached and excluded from search discovery. Revocation removes both session types
and outstanding tokens. Newsletter enrollment remains optional and independent
of waitlist verification; see [email synchronization](EARLY-ACCESS.md).

## Rollout and verification

Apply `0008_waitlist_referrals.sql` and `0009_waitlist_join_time.sql` after all earlier
migrations, then deploy the matching Worker and website together. Migration 0008
remains unchanged for existing deployments; 0009 adds the explicit join time,
backfills existing signups and rebuilds the priority index. Do not serve these routes
against an unmigrated database. Keep the new tables and columns during rollback;
old approval, session, invitation and encrypted mail data remain readable.

Run `pnpm verify`. The focused service suite covers attribution, verification,
ranking, revocation, access isolation, capacity and durable email events. The UI
fixture command is `node scripts/verification/verify-waitlist.mjs`; it expects a website
Vite server at `127.0.0.1:5198` with `VITE_ACCESS_API=https://api.jackalope.test`.
It intercepts that test API and writes screenshots and email HTML under
`output/waitlist-referrals/`. Fixtures do not establish live delivery or native
acceptance.

Build the website first to generate the email logo used by those previews. Run
`node scripts/verification/verify-passes-desktop.mjs` against a desktop Vite server at
`127.0.0.1:5199` for the pass view. That test creates and removes its own temporary
fixture entry, uses a fake native response, and checks theme persistence and
keyboard copy without connecting an account or executing a task.

Before release, use controlled inboxes to verify signup → referral verification →
admin ordering → approval → pass claim → download → desktop connection. Check
sender authentication, inbox placement, links, expiry and scheduled retries with
the real provider. No deployment or live email send is part of local verification.
