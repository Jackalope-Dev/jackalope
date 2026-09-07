import type { ReactNode } from 'react';

const contact = <a href="mailto:contact@jackalope.dev">contact@jackalope.dev</a>;
type Section = { id: string; title: string; content: ReactNode };

const privacy: Section[] = [
  {
    id: 'scope',
    title: 'Who we are',
    content: <>
      <p>Jackalope Digital LLC operates Jackalope. This policy covers our website, waitlist,
        early-access service, and the information our desktop app sends to us. Contact {contact}
        {' '}with privacy questions or requests.</p>
      <p>Coding agents and other services you connect have their own privacy policies. This policy
        does not replace those policies or the choices you make with those providers.</p>
    </>,
  },
  {
    id: 'website',
    title: 'Website visits and essential cookies',
    content: <>
      <p>Cloudflare hosts our website and service. Requests expose technical information such as
        your IP address, browser information, requested resource, and request time to the hosting
        provider. This information helps deliver pages and downloads, maintain security, and
        prevent abuse. Our service uses a daily changing, keyed representation of your IP address
        for rate limiting; it does not add your IP address to desktop usage reports.</p>
      <p>The website does not use advertising trackers, session replay, or third-party analytics.
        Fonts are served with the site. Website appearance choices reset when you reload.</p>
      <p>Signing in creates an essential, secure session cookie lasting up to 30 days. It is
        inaccessible to page scripts. Signing out removes the session. Blocking this cookie
        prevents the member area from working. We do not use cookies for targeted advertising;
        there is no advertising tracking for a Do Not Track or Global Privacy Control signal to
        disable.</p>
    </>,
  },
  {
    id: 'access',
    title: 'Waitlist, sign-in, and invitations',
    content: <>
      <p>When you join, we record your email address, signup source and time, access status, and
        optional newsletter choice. We also keep verification, session, invitation, and delivery
        records to provide access, prevent repeated emails, and enforce invitation limits. We do
        not collect payment details for the waitlist.</p>
      <p>We send signup confirmations and the access or invitation messages needed to handle your
        request. Product newsletters are a separate choice in the access-service signup form.
        A legacy email-only form, including the fallback used without JavaScript, subscribes you
        to launch news and product notes as disclosed next to that form; it does not create an
        approved access account.</p>
      <p>Someone may give us your email address to invite you. The inviting member can see the
        invited email address and invitation status, including acceptance. A shared invitation
        link reveals your email address to its owner when you accept. You can ignore an invitation
        or contact us to request removal.</p>
      <p>Sequenzy processes recipient addresses, email contents, and delivery information to send
        our messages. Newsletter subscribers also have a record with Sequenzy. Depending on the
        message and email-service settings, delivery, open, and link activity may be recorded.
        Unsubscribe using a newsletter’s link or contact us. Unsubscribing from newsletters does
        not cancel access or prevent sign-in messages you request.</p>
    </>,
  },
  {
    id: 'desktop',
    title: 'Desktop projects and connected providers',
    content: <>
      <p>The desktop app stores project settings, tasks, history, and related workspace data on
        your computer. Using local projects and installed agents does not require a Jackalope
        cloud account. We do not receive your repository contents, prompts, agent transcripts,
        local paths, or provider credentials through our usage-reporting system.</p>
      <p>Agents can read files, run commands, and send prompts, code, and other context to their
        providers. Connected tools, MCP servers, sign-in flows, and websites opened in the app
        may receive information directly. Their access depends on your configuration and their
        capabilities. Account profiles and worktrees are organizational tools, not security
        sandboxes. Review the permissions and policies of each service you use.</p>
      <p>Update checks and downloads contact the configured release service and expose the
        network information needed to deliver those requests. Local data, backups, and exported
        reports remain under your control; uninstalling the app may leave saved data behind.</p>
    </>,
  },
  {
    id: 'reports',
    title: 'Optional usage reports and feedback',
    content: <>
      <p>In builds with reporting enabled, Jackalope presents a privacy choice before sending
        usage reports. You can continue without sharing, or change your choice in Settings →
        Privacy. Reports contain app version, operating system, release channel, and allowlisted
        app-open, task-outcome, feature-use, and optional error-category events. They include a
        random event ID to avoid counting retries twice, not an installation or account ID.</p>
      <p>These reports do not include prompts, code, file paths, command output, error messages,
        or stack traces. The service stores aggregate daily counts and short-lived deduplication
        records. Turning sharing off stops future reporting and clears pending local reports;
        it cannot recall information already sent.</p>
      <p>Feedback is separate and sent only after you review and submit it. It includes your
        message, report ID, app version, operating system, release channel, and any task-outcome
        counts you choose to include. It goes to our private dashboard and may be copied to our
        support email. Contact details are optional; we cannot reply unless you include them.
        Do not include passwords, access tokens, confidential code, or other people’s personal
        information. Copying a local support report does not itself send it to us.</p>
    </>,
  },
  {
    id: 'purposes',
    title: 'Why we use information',
    content: <>
      <p>We use information to operate the site and access service, deliver requested emails and
        downloads, manage invitations, respond to support requests, understand aggregate product
        reliability, prevent abuse, and meet legal obligations. We do not sell personal information
        or share it for cross-context behavioral advertising.</p>
      <p>Where applicable data-protection law requires a legal basis, we rely on providing the
        service you request, our legitimate interests in security and service operation, your
        consent for optional newsletters and usage sharing, and compliance with legal obligations.
        You can withdraw optional consent without affecting earlier lawful processing.</p>
    </>,
  },
  {
    id: 'sharing',
    title: 'Service providers and other disclosures',
    content: <>
      <p>We use Cloudflare for hosting, database storage, downloads, security, and service
        infrastructure; Sequenzy for customer email; and our mailbox provider to handle support
        correspondence. These providers process information needed for those functions. See
        {' '}<a href="https://www.cloudflare.com/privacypolicy/">Cloudflare’s privacy policy</a>
        {' '}and <a href="https://www.sequenzy.com/privacy">Sequenzy’s privacy policy</a>.</p>
      <p>Access is limited to people and providers who need it to operate or support Jackalope.
        We may disclose information when required by law, to protect rights and security, or as
        part of a merger or transfer of the service, subject to applicable law and notice
        requirements. We do not publish private feedback as a public issue without permission.</p>
      <p>Our providers operate internationally, including in the United States. Information may
        be processed outside your home country, where laws differ. Contact us for information
        about the providers and transfer protections relevant to your information.</p>
    </>,
  },
  {
    id: 'retention',
    title: 'How long we keep information',
    content: <>
      <ul>
        <li>Waitlist, access, consent, and referral records are kept while needed to manage your
          request, membership, and invitation limits, unless removed following a deletion request.</li>
        <li>Sign-in links expire after 30 minutes; welcome and invitation links after seven days.
          Sessions last up to 30 days. Scheduled cleanup removes expired sessions and tokens.</li>
        <li>Email queue records are scheduled for removal after 30 days. Encrypted email payloads
          are cleared when delivery is queued with the provider, or after seven days.</li>
        <li>Desktop usage counts and deduplication records are scheduled for removal after 30 days;
          feedback in the service database after 90 days.</li>
        <li>Support correspondence, email-provider records, security logs, and recovery backups have
          separate lifecycles. We retain them as needed to resolve requests, maintain security,
          recover the service, or meet legal obligations.</li>
      </ul>
      <p>Scheduled deletion can be delayed by an outage or cleanup backlog. Deleting live records
        does not immediately erase backup recovery points or previously delivered emails.
        Recovery copies expire under the provider’s backup schedule. If a backup is restored,
        applicable deletion requests must be reapplied.</p>
    </>,
  },
  {
    id: 'rights',
    title: 'Your choices and requests',
    content: <>
      <p>Contact {contact} to request access, correction, or deletion of information held by
        Jackalope, to leave the waitlist, or to close your early-access membership. Depending on
        your location, you may also have rights to a portable copy, restriction of processing,
        objection, withdrawal of consent, or a complaint to your data-protection authority.</p>
      <p>We may need to verify your request using information proportionate to its sensitivity.
        Do not send identity documents, passwords, or sign-in links unless we have specifically
        agreed on a secure process. We respond within applicable legal time limits and explain
        any lawful exception. We will not penalize you for exercising an applicable privacy right.</p>
      <p>Include your signup email or feedback reference when relevant. Aggregate usage counts
        cannot normally be traced back to you. We cannot delete information held independently
        by an agent provider or on your computer; contact that provider or use the app’s local
        data controls. Closing access does not delete your local projects.</p>
    </>,
  },
  {
    id: 'children-security-changes',
    title: 'Children, security, and policy changes',
    content: <>
      <p>Our hosted early-access service is intended for adults, not people under 18. We do not
        knowingly collect children’s personal information. Contact us if a child has provided
        information so we can investigate and remove it where appropriate.</p>
      <p>We use safeguards including encrypted connections, restricted administrative access,
        and expiring sign-in credentials. No system is completely secure. Report a suspected
        security issue privately through {contact}.</p>
      <p>We update the date on this page when the policy changes. For material changes, we will
        provide additional notice where required and obtain consent when required before using
        information for a new purpose.</p>
    </>,
  },
];

const terms: Section[] = [
  {
    id: 'service', title: 'These terms and the service', content: <>
      <p>These terms are between you and Jackalope Digital LLC and cover jackalope.dev, our
        waitlist, hosted early-access member area, invitations, and download service. Please read
        them before requesting or using access. If you use the service for an organization, you
        must have authority to act on its behalf.</p>
      <p>Our hosted early-access service is for people aged 18 or older who can enter a binding
        agreement. The <a href="/privacy/">Privacy Policy</a> explains how we handle information;
        agreeing to these terms does not opt you into newsletters or optional usage sharing.</p>
    </>,
  },
  {
    id: 'early-access', title: 'Early access and availability', content: <>
      <p>Joining the waitlist is free. It does not guarantee admission, an invitation date, a
        finished product, a particular feature, or a future price. Approval does not mean an
        installer is available yet. Windows x64 is the first release target; other platforms
        are planned, not promised.</p>
      <p>Early-access software may contain errors, change substantially, or become unavailable.
        Back up important work and review changes before using them. We may change, limit, or
        discontinue the hosted service, with notice where practical and as required by law.
        These terms do not authorize a charge; any future paid offering needs separately
        disclosed pricing and purchase terms.</p>
    </>,
  },
  {
    id: 'account', title: 'Your access and invitations', content: <>
      <p>Use an email address you control and keep sign-in links private. Do not share a signed-in
        session, impersonate someone, or bypass admission and invitation limits. Contact us if
        you suspect unauthorized access.</p>
      <p>Invite only people you have a legitimate reason to contact; do not send unsolicited bulk
        invitations or sell access. Email invitations reserve a place for seven days. Shared-link
        invitations depend on available places at verification. Limits and eligibility may change.</p>
      <p>We may suspend or revoke hosted access to address abuse, security risks, legal obligations,
        or a material violation of these terms. You can stop using the service and request account
        deletion at {contact}. Suspension does not remove rights already granted under an
        applicable open-source license.</p>
    </>,
  },
  {
    id: 'software', title: 'Software license and your work', content: <>
      <p>The Jackalope desktop software is licensed under the
        {' '}<a href="https://www.apache.org/licenses/LICENSE-2.0">Apache License 2.0</a>.
        Bundled components may have separate licenses and notices. Those licenses govern use,
        modification, and distribution of the software; these hosted-service terms do not
        restrict the rights they grant. Our name and logo are not licensed for implying our
        endorsement.</p>
      <p>You retain your rights in your projects and content. We do not claim ownership of code
        simply because you use Jackalope. You must have permission to use the repositories,
        data, accounts, and tools you connect. Ownership and permitted use of agent-generated
        output may also depend on the provider’s terms and applicable law.</p>
    </>,
  },
  {
    id: 'agents', title: 'Agents, tools, and generated output', content: <>
      <p>Jackalope connects to separately installed coding agents and tools. You are responsible
        for their accounts, subscriptions, usage charges, configuration, and permissions.
        Jackalope does not include model access or guarantee a third-party service’s availability.</p>
      <p>Agents and tools may modify or delete files, execute commands, contact external services,
        and incur provider charges. Worktrees and account profiles are not security sandboxes.
        Review permissions, proposed actions, generated code, licenses, and test results before
        relying on them. Generated output may be inaccurate, insecure, or infringe others’ rights;
        a successful check does not guarantee correctness or safety.</p>
    </>,
  },
  {
    id: 'acceptable-use', title: 'Responsible use of the hosted service', content: <>
      <p>Do not use our hosted service for unlawful activity, fraud, harassment, malicious code,
        unauthorized access, or infringement of others’ rights. Do not interfere with service
        operation, evade security or rate limits, or access other people’s private information.
        Report vulnerabilities privately rather than testing against other users’ data.</p>
      <p>These hosted-service restrictions do not change the permissions granted by the desktop
        software’s open-source license.</p>
    </>,
  },
  {
    id: 'feedback', title: 'Feedback', content: <>
      <p>If you send suggestions, you allow us to use them to develop and improve Jackalope
        without an obligation to compensate you. This does not transfer ownership of your
        existing code or other content. Do not send confidential material or information you
        lack permission to share. Private support submissions are handled under our Privacy Policy.</p>
    </>,
  },
  {
    id: 'warranties', title: 'Warranties and liability', content: <>
      <p>To the extent permitted by law, the hosted early-access service is provided “as is” and
        “as available,” without warranties of uninterrupted service, fitness for a particular
        purpose, merchantability, or non-infringement. The software’s license contains its own
        warranty and liability provisions.</p>
      <p>To the extent permitted by law, Jackalope Digital LLC is not liable for indirect,
        incidental, special, or consequential losses from the hosted service, including lost
        profits or lost data. Nothing in these terms excludes liability or consumer rights that
        cannot lawfully be excluded, including liability for fraud or other misconduct where
        exclusion is prohibited. Mandatory protections in your jurisdiction still apply.</p>
    </>,
  },
  {
    id: 'changes-contact', title: 'Changes and questions', content: <>
      <p>We will update the date when these terms change and provide notice of material changes
        where required. Changes apply prospectively. We will request renewed agreement where
        required; if you disagree, you can stop using the hosted service and request deletion.
        Changes do not revoke existing open-source license grants.</p>
      <p>Contact {contact} with questions, complaints, or a request to resolve a dispute. These
        terms do not require arbitration or waive any right to bring a claim in a court that
        has jurisdiction. If a provision is unenforceable, the remaining provisions continue
        to apply to the extent permitted by law.</p>
    </>,
  },
];

export function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const sections = kind === 'privacy' ? privacy : terms;
  return (
    <main id="main" className="article page-width">
      <header className="article-heading">
        <h1>{kind === 'privacy' ? 'Privacy policy' : 'Terms of service'}</h1>
        <p className="article-deck">{kind === 'privacy'
          ? 'How we handle information across the website, early access, and desktop app.'
          : 'Using Jackalope’s website and hosted early-access service.'}</p>
        <p className="article-byline">Updated September 7, 2026 · Jackalope Digital LLC</p>
      </header>
      <div className="article-body">
        <nav aria-label="On this page">
          <ul>{sections.map(section => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ul>
        </nav>
        {sections.map(section => <section id={section.id} key={section.id}>
          <h2>{section.title}</h2>
          {section.content}
        </section>)}
      </div>
    </main>
  );
}
