# Jackalope website

The product site is a React/Vite application prerendered to static HTML.
It imports shared branding from `packages/brand`; native task execution and
private service credentials are not part of the website bundle.

Run from the repository root:

~~~powershell
pnpm install --frozen-lockfile
pnpm dev:website
pnpm build:website
pnpm --filter @jackalope/website preview
~~~

Development and preview use `http://localhost:5180`. Root `pnpm build` and
`pnpm typecheck` include both frontends. See [Contributing](../../CONTRIBUTING.md)
for toolchain versions and the combined verification gate.

## Content and media

`src/content.ts` owns the current tour's video, poster, captions, duration and
transcript. It combines articles, marketing pages and knowledge guides with the
dated milestones in `src/changelog.json`. Update the shared source when content
changes; route metadata, structured data, sitemap, RSS and LLM-readable discovery
files are generated from it.

`public/media` contains runtime screenshots and the current 64-second tour.
The recording uses fictional sample projects, accounts, activity and check results,
with an instrumental soundtrack and English captions. It demonstrates the frontend,
not native task execution or desktop-control acceptance. The player has native
controls and error recovery; a text transcript is available on the tour page.
The soundtrack was synthesized for this project without third-party recordings or
samples. Retain the files in `public/licenses` when redistributing the website:
they include Jackalope's Apache-2.0 license, the bundled font licenses and the
website's production dependency notices. Refresh them with `pnpm licenses:generate`.

Keep only media used by the current site here. Campaign exports, editable film
masters, submission kits and generation scratch belong outside the public source
tree. Inspect images, video frames, captions, audio and embedded metadata before
replacing an asset, and retain applicable license notices.

For fresh screenshots, start the desktop browser frontend and use a new disposable
Playwright session. The setup callback replaces that session's sample local storage
and intercepts native calls; never run it against an everyday desktop/account session.

~~~powershell
pnpm --filter @jackalope/desktop dev --port 5175
npx --yes --package @playwright/cli playwright-cli -s=website-capture open http://localhost:5175
npx --yes --package @playwright/cli playwright-cli -s=website-capture run-code --filename apps/website/scripts/capture-setup.js
npx --yes --package @playwright/cli playwright-cli -s=website-capture run-code --filename apps/website/scripts/capture-tour.js
~~~

Choose the desired appearance before capturing. The script writes `*-light.png`
for light mode and the corresponding unsuffixed files for dark mode.
`record-tour.js` can capture raw frontend interactions into ignored output;
it does not reproduce the edited film. Select reviewed runtime exports and update
all fields in `tour` together when replacing the film.

## Verification

Against the website preview, the browser callback checks responsive layout,
keyboard controls, dialog focus, appearance, playback/failure and reduced motion:

~~~powershell
npx --yes --package @playwright/cli playwright-cli -s=website-check open http://localhost:5180
npx --yes --package @playwright/cli playwright-cli -s=website-check run-code --filename apps/website/scripts/verify-page.js
~~~

`verify-page.js` expects the default waitlist configuration and intentionally aborts
the active tour request for its media recovery check. `verify-launch.js` exercises
routes, discovery output and mocked signup validation, rate limits, retry and focus.
Those signup requests are intercepted; fixtures do not prove email delivery.
Run callbacks from the checkout being verified.

## Signup and public configuration

With `VITE_ACCESS_API` configured, signup uses the optional Jackalope service.
Without it, forms use the legacy saved-form endpoints in `src/signup-config.ts`;
the no-JavaScript form action also uses that route. Public form IDs are not API
credentials. Forks must configure their own endpoints and consent settings before
accepting signups. See the [service README](../server/README.md).

Service-backed signup queues a transactional email confirmation; approval and
access links arrive separately. Optional newsletter consent syncs independently to
Sequenzy, whose private API credential stays on the server. Legacy saved-form
submissions use Sequenzy's confirmation settings and bypass that queue. The popup
uses the site's shared dialog; it does not inject a hosted provider widget.

Before enabling signup, verify the sending domain, reply-to and mailing addresses,
audience, consent settings and email sequences in the provider account. Keep account
records and subscriber exports private. Live checks require an operator-controlled
address and may send email; remove temporary subscribers afterwards.

Provider reference: [Sequenzy saved forms](https://docs.sequenzy.com/widgets/signup-form).

Copy `.env.example` to `.env.local`, or configure these public build variables.
They are embedded in static output and must never contain secrets.

| Variable | Purpose |
| --- | --- |
| `VITE_ACCESS_API` | Optional early-access service URL. |
| `VITE_WINDOWS_DOWNLOAD_URL` | Verified, published HTTPS Windows x64 installer URL. |
| `VITE_WINDOWS_STORE_URL` | Usable Microsoft Store product URL; takes precedence over the Windows installer. |
| `VITE_MACOS_DOWNLOAD_URL` | Verified, published HTTPS macOS download URL. |
| `VITE_LINUX_DOWNLOAD_URL` | Verified, published HTTPS Linux download URL. |
| `VITE_RELEASE_VERSION` | Matching version, required with an installer URL; not required for the Store. |
| `VITE_SITE_URL` | Optional HTTPS origin for canonical, social and discovery URLs. |

The public `/download/` page lists all three desktop platforms. A platform without
a configured URL shows Coming soon. Browser platform hints only reorder the options;
mobile devices and unknown platforms keep the neutral ordering. Visiting the page
never starts a download or opens a Store link automatically.

Approval and direct-invitation emails link to `/download/#token=...`. The page removes
the token from the address bar and requires an explicit confirmation before exchanging
it for the existing account session. Expired links offer the account sign-in route.
The ordinary account and waitlist email links keep their existing destinations.
Approved members use the authenticated Store download endpoint when configured,
preserving download milestones; public visitors use the configured listing link.

Without a configured download the site offers the waitlist. Enable a download only
after the relevant [release gates](../../docs/RELEASE.md). The build rejects insecure
or incomplete download configuration. Update the privacy notice whenever hosting,
tracking, storage or email behavior changes.

Run `node apps/website/scripts/verify-download.mjs` from the repository root against
a website preview with `VITE_ACCESS_API=https://download-fixture.example.test`.
Set `JACKALOPE_TEST_URL` to the preview origin. The browser check intercepts account
requests with fixtures and covers platform ordering, themes, narrow layouts, signup
focus and email confirmation; it does not send emails or establish live delivery.

## Hosting

Serve `apps/website/dist` at the domain root on a static host. Review the checked-in
Cloudflare configuration and replace its Worker name and domain for your deployment;
do not deploy a fork with the upstream identifiers.

Serve each generated directory's `index.html`, normalize trailing slashes and return
`404.html` with HTTP 404 for unknown routes. Avoid a catch-all 200 SPA rewrite.
Subdirectory hosting is not configured. Serve MP4 as `video/mp4`, WebM as
`video/webm` and VTT as `text/vtt`; preserve byte-range requests for video seeking.
Use immutable caching for hashed assets and revalidate HTML and named public media.
Fonts are bundled locally with their OFL notices.

Configure CSP for the service/form origins you actually use, including any
no-JavaScript form action, structured data and initial theme styles. Private email
and deployment credentials belong in server/hosting configuration.
See [deployment boundaries](../../docs/DEPLOYMENT-AND-SOURCE.md).
