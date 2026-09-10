# Licensing and redistribution

## Project materials

Unless a file or directory includes a separate license or notice, Jackalope's
project-authored source code, documentation, shared branding artwork, screenshots
and runtime media are provided under the [Apache License 2.0](../LICENSE).
Copyright notices identify their respective holders. The screenshot and tour
examples use fictional workspace data.

Apache-2.0 permits use, modification and redistribution, including commercial
use, subject to its conditions. Redistributors must provide the license, retain
applicable notices and identify modified files as the license requires. Read
the license for its patent grant, conditions and warranty provisions.

The license does not grant rights to Jackalope's trade names or trademarks beyond
the uses described in section 6. Do not present a fork as an official Jackalope
release or imply endorsement. This distinction does not remove the copyright
permissions granted for included artwork.

## Third-party materials

Dependencies retain their upstream licenses. The [dependency inventory](DEPENDENCIES.md)
lists declared package licenses; it includes development and optional dependencies
and is not a list of everything shipped in every installer.

- Plus Jakarta Sans and JetBrains Mono use OFL-1.1. Their notices are bundled in
  each application's `public/licenses` directory.
- The desktop's `public/licenses` directory contains dependency license texts and
  notices for maintained integrations, including the modified Streamdown plugin.
- The bundled agent-browser executable has its own Apache-2.0 license and
  embedded axe-core MPL-2.0 source and license notices in
  `apps/desktop/src-tauri/resources/agent-browser`. Preserve those accompanying files.
- Agent CLIs, models and connected services have their own licenses, subscriptions
  and terms. Jackalope does not include provider access or sublicense their services.

The website's `public/licenses/dependencies.txt` contains its production dependency
notices. Both apps include Jackalope's license in `public/licenses/jackalope.txt`.

Run `pnpm licenses:generate` after dependency changes and review the result.
When distributing a packaged application, preserve the notices for its actual
contents; a package's metadata alone does not establish compliance.

## Contributions and hosted services

Contributions intentionally submitted for inclusion follow Apache-2.0 section 5;
see [Contributing](../CONTRIBUTING.md). You retain ownership of your contributions
and must have permission to submit them under the applicable license.

Jackalope's [hosted-service terms](https://jackalope.dev/terms/) and
[privacy policy](https://jackalope.dev/privacy/) govern the official website and
services. They do not impose extra conditions on the open-source license.
Independent operators are responsible for their own service configuration,
notices and provider agreements; see [deployment boundaries](DEPLOYMENT-AND-SOURCE.md).
