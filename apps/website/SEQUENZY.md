# Website signup forms

With VITE_ACCESS_API configured, the inline waitlist and manually opened popup
submit to the Jackalope early-access service. New registrations queue a branded
transactional confirmation; approval and access links arrive separately. Optional
newsletter consent syncs independently to Sequenzy. The service holds the private
API credential, never the website bundle.

Without VITE_ACCESS_API, forms use the legacy Sequenzy saved-form endpoints in
`src/signup-config.ts`. This fallback uses the provider's own confirmation settings
and does not run the Jackalope confirmation queue. The non-JavaScript form action
also uses this legacy route. Public form IDs are safe to embed. A fork should
configure its own forms, service and audience before enabling signups.

The website renders its own accessible Radix dialog rather than injecting a
hosted popup. The configured forms handle duplicate subscribers and record the
signup source. Audience membership, sender identity, consent settings and email
sequences are managed in Sequenzy, outside this repository.

Before enabling a campaign or welcome sequence, verify the sending domain,
reply-to address, mailing address, audience, consent settings and message content.
Account setup records and subscriber exports belong in private operator storage.

## Local verification

`scripts/verify-launch.js` intercepts form requests to exercise invalid addresses,
rate limits, offline failure, retry/success and popup focus restoration without
creating subscribers or sending email. Run it through Playwright against the
prerendered website preview; see [README.md](README.md).

For a live trial, use an operator-controlled address and account for confirmation
emails or automations enabled in the provider. Remove temporary test subscribers
after verifying the intended audience and duplicate handling.

Reference: [saved forms](https://docs.sequenzy.com/widgets/signup-form) and
[popup API](https://docs.sequenzy.com/api-reference/widgets/create-popup).
