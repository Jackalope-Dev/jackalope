import evidence from './benchmark-summary.json';
import { type Experiment, ExperimentResults } from './ExperimentResults';
import './benchmarks.css';

type Totals = {
  trials: number;
  oraclePassed: number;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  elapsedMs: number | null;
  mcpReceivedBytes: number | null;
  mcpDeliveredBytes: number | null;
};
type Report = {
  model: string;
  cliVersion: string;
  baseline: string;
  candidate: string;
  totals: Record<string, Totals | undefined>;
  cases: string[];
  metrics: Record<string, { reductionPercent: number | null; eligibleForScopedClaim: boolean }>;
  blockers: string[];
  toolPayload: { reductionPercent: number | null; eligibleForScopedClaim: boolean; scope: string };
};
type DiscoveryTotals = {
  trials: number;
  calls: number;
  localPassed: number;
  jevPassed: number;
  elapsedMs: number;
  inputTokens: number | null;
  estimatedCostUsd: number | null;
  errors: number;
  model: string;
};
type Evidence = {
  agentTrials: number;
  date: string;
  environment: Record<string, string>;
  comparisons: { id: string; title: string; detail: string; report: Report }[];
  discovery:
    | (DiscoveryTotals & { baselineAllCalls?: DiscoveryTotals | null; regressions: number | null })
    | null;
  experiments?: Experiment[];
  screeningStatus?: { interruptedAttempts: number; canceledExperiments: string[] } | null;
  routingAssessment?: {
    calls: number;
    selections: number;
    errors: number;
    elapsedMs: number;
    inputTokens: number;
    estimatedCostUsd: number;
    model: string;
  } | null;
};
const data: Evidence = evidence;
const number = (value: number | null) =>
  value === null
    ? 'Unavailable'
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
const labels: Record<string, string> = {
  direct: 'Native CLI directly',
  control: 'Jackalope baseline',
  after: 'Jackalope candidate',
};

export function BenchmarksPage() {
  const trials = data.agentTrials;
  return (
    <main id="main" className="benchmark-page page-width">
      <header className="benchmark-intro">
        <p className="benchmark-eyebrow">Jackalope research · {data.date}</p>
        <h1>Measure the whole task.</h1>
        <p className="benchmark-lede">
          A coordinator adds context, tools, and checks. Does that help enough to justify its
          overhead? We compare the same tasks through Jackalope and the native agent CLI, and
          publish the improvements alongside the regressions.
        </p>
        <a className="text-link" href="/research/benchmarks.json" download>
          Download measurements and provenance (JSON)
        </a>
      </header>
      <section className="benchmark-highlights" aria-label="Measured scope">
        <div>
          <strong>{number(trials)}</strong>
          <span>recorded agent trials; shared baseline trials count once</span>
        </div>
        <div>
          <strong>Evidence first</strong>
          <span>No general speed or cost saving established by these screening experiments.</span>
        </div>
        <div>
          <strong>Failures included</strong>
          <span>
            Completed and failed trial receipts are retained; missing usage stays unknown.
          </span>
        </div>
      </section>
      {data.screeningStatus && (
        <p className="benchmark-caption">
          This was adaptive screening. We stopped the broad sweep after observing overhead, retained
          completed results, and selected smaller follow-up experiments. Interrupted attempts with
          unknown usage: {data.screeningStatus.interruptedAttempts}, excluded from the recorded
          trial count. Canceled work: {data.screeningStatus.canceledExperiments.join('; ')}. The
          totals do not establish the full cost of the interrupted experiment. These results are not
          held-out confirmation or evidence of statistical significance after early stopping.
        </p>
      )}
      <ExperimentResults experiments={data.experiments ?? []} />
      <section className="benchmark-section" aria-labelledby="results-title">
        <h2 id="results-title">Results, including the overhead</h2>
        <p>
          These are authored, disposable fixtures on one Windows machine. They are a reproducible
          starting point, not a representative sample of software engineering or proof of equivalent
          quality on real projects. Passing means satisfying the prewritten task check; human
          acceptance and correction time are not measured.
        </p>
        <p className="benchmark-caption">
          Prewritten fixture checks score outputs outside the agent’s workspace. These are self-run
          experiments, not an external audit.
        </p>
        {data.comparisons.map(({ id, title, detail, report }) => {
          const candidate = report.totals[report.candidate];
          return (
            <article key={id} className="benchmark-result" id={id}>
              <h3>{title}</h3>
              <p>{detail}</p>
              <p className="benchmark-caption">
                {report.model} · {report.cliVersion} · {report.cases.join(', ')}
              </p>
              <section
                className="benchmark-table"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users need to scroll wide measurement tables.
                tabIndex={0}
                aria-label={`${title} measurements`}
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Variant</th>
                      <th scope="col">Successful trials</th>
                      <th scope="col">Total tokens</th>
                      <th scope="col">Cached input</th>
                      <th scope="col">Total seconds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[report.baseline, report.candidate].map((variant) => {
                      const total = report.totals[variant];
                      if (!total) return null;
                      return (
                        <tr key={variant}>
                          <th scope="row">{labels[variant] ?? variant}</th>
                          <td>
                            {total.oraclePassed}/{total.trials}
                          </td>
                          <td>{number(total.totalTokens)}</td>
                          <td>{number(total.cachedInputTokens)}</td>
                          <td>
                            {number(total.elapsedMs === null ? null : total.elapsedMs / 1000)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
              <p>
                {Object.entries(report.metrics)
                  .map(
                    ([key, metric]) =>
                      `${key === 'totalTokens' ? 'Token' : 'Elapsed-time'} change: ${metric.reductionPercent === null ? 'unavailable' : `${number(Math.abs(metric.reductionPercent))}% ${metric.reductionPercent > 0 ? 'lower' : 'higher'}`}`,
                  )
                  .join('. ')}
                .
              </p>
              {candidate &&
                candidate.mcpReceivedBytes !== null &&
                candidate.mcpReceivedBytes > 0 && (
                  <p className="benchmark-caption">
                    Jackalope received {number(candidate.mcpReceivedBytes)} result bytes and
                    returned {number(candidate.mcpDeliveredBytes)} bytes, including any expansion
                    reads. {report.toolPayload.scope}
                  </p>
                )}
              {!!report.blockers.length && (
                <p className="benchmark-caption">Claim limitations: {report.blockers.join(' ')}</p>
              )}
            </article>
          );
        })}
      </section>
      <section className="benchmark-section" aria-labelledby="jev-title">
        <h2 id="jev-title">Jev: test the decision before adding the call</h2>
        <p>
          Jev can rank tool descriptions before an agent receives their schemas. This experiment
          sends a bounded task brief, search query, and at most 32 candidate descriptions. Strong
          relevance scores (at least 0.9) can promote candidates; uncertain answers keep local
          search behavior. Exact tool names and nonempty local results that already fit on one page
          bypass this step. Empty-query browsing remains available, and Jev does not execute tools
          or change permissions. The option is off by default.
        </p>
        {data.discovery && (
          <>
            <p>
              Across eight authored queries repeated three times ({data.discovery.trials} ranking
              trials), local search met the expected top-five or absent-result check{' '}
              {data.discovery.localPassed} times; Jev-assisted ranking met it{' '}
              {data.discovery.jevPassed} times, using {data.discovery.calls} API calls to{' '}
              {data.discovery.model}. Jev added {number(data.discovery.elapsedMs / 1000)} seconds in
              total and reported {number(data.discovery.inputTokens)} input tokens.{' '}
              {data.discovery.errors} calls failed.{' '}
              {data.discovery.estimatedCostUsd === null
                ? 'Dollar cost was unavailable.'
                : `Estimated Jev API input cost: $${data.discovery.estimatedCostUsd.toFixed(6)}.`}{' '}
              Estimates use{' '}
              <a href="https://docs.typesafe.ai/models">TypeSafe’s published input rate</a> of
              $0.042 per million tokens on the measurement date; these are not invoices.
            </p>
            {data.discovery.baselineAllCalls && (
              <p>
                The earlier version called Jev for all {data.discovery.baselineAllCalls.calls}{' '}
                trials and passed {data.discovery.baselineAllCalls.jevPassed} checks. Its total was{' '}
                {number(data.discovery.baselineAllCalls.inputTokens)} input tokens,{' '}
                {number(data.discovery.baselineAllCalls.elapsedMs / 1000)} seconds, and $
                {data.discovery.baselineAllCalls.estimatedCostUsd?.toFixed(6) ?? 'unavailable'} in
                estimated API input cost. The local-page bypass avoided{' '}
                {data.discovery.baselineAllCalls.calls - data.discovery.calls} requests. Both runs
                used the same queries and promotion threshold; they ran sequentially, so service
                latency is not controlled. Skipped requests consume zero Jev input tokens.{' '}
                {data.discovery.regressions} previously passing trials failed in the later run.
              </p>
            )}
          </>
        )}
        <p>
          This isolates retrieval behavior. It does not measure downstream agent savings, end-to-end
          speed, or general search accuracy. Jev is a remote service; the field-selection experiment
          above uses local code and requires no Jev call.
        </p>
        {data.routingAssessment && (
          <p>
            A separate routing assessment sent repository-derived repair tasks through the
            production suitability rules, using sourced model facts and no accepted-task cost
            history. Across {data.routingAssessment.calls} calls to {data.routingAssessment.model},{' '}
            {data.routingAssessment.selections} tasks produced an eligible selection and{' '}
            {data.routingAssessment.errors} API calls failed. Assessment time totaled{' '}
            {number(data.routingAssessment.elapsedMs / 1000)} seconds, with{' '}
            {number(data.routingAssessment.inputTokens)} input tokens and an estimated input cost of
            ${data.routingAssessment.estimatedCostUsd.toFixed(6)}. An assessment without an eligible
            selection leaves the configured fallback in place. This measures routing overhead; it
            does not establish downstream quality or savings.
          </p>
        )}
      </section>
      <section className="benchmark-section" aria-labelledby="method-title">
        <h2 id="method-title">Methodology</h2>
        <ol>
          <li>
            <strong>Freeze the comparison.</strong> Record the fixture suite, full case/repetition
            matrix, native executable hashes, CLI version, model, effort, requested service tier,
            account binding, time budget, and token budget. Each trial begins in a new disposable
            Git repository.
          </li>
          <li>
            <strong>Keep the work equivalent.</strong> Direct trials use the installed CLI with the
            raw task and matching permissions. Jackalope uses its actual native coordinator,
            workspace isolation, context assembly, tools, and automatic checks. This measures the
            harness package as a whole; tool inventories intentionally differ. It is not a direct
            model API or GUI comparison.
          </li>
          <li>
            <strong>Separate the experiments.</strong> Coding fixtures cover design tokens,
            scheduler behavior, and CSV escaping. The tool-result fixtures supply roughly 1,200
            irrelevant records alongside one requested record. Both variants see the same source
            data and must write the same exact JSON. The requested record appears first so ordinary
            provider truncation does not hide it from the baseline.
          </li>
          <li>
            <strong>Count all observed work.</strong> Keep failed, interrupted, and budget-stopped
            trials. Sum input and output tokens; cached input is already included in input. Record
            elapsed time through task completion and harness checks, with the independent oracle
            outside the timer. Retry usage stays in the provider total. Missing usage is unknown,
            not zero.
          </li>
          <li>
            <strong>Counterbalance and repeat.</strong> Freeze repetition counts and seeded variant
            order before each experiment. Provider-side cache state is inherited, not controlled.
            Wall-clock results include network and service variability; builds and full verification
            run outside the timed experiment.
          </li>
          <li>
            <strong>Separate screening from claims.</strong> A small suite can identify promising
            changes, but it cannot establish unchanged quality. Our product claim gate requires a
            frozen confirmation run on at least 50 held-out tasks from 20 independent source
            families, independent quality acceptance of original patches, complete agent cost
            accounting, replication, and recorded resource and cache conditions. The lower
            confidence bound must show at least a 10% time or cost improvement and rule out a
            quality regression exceeding two percentage points. Those are reporting thresholds, not
            guarantees; satisfying the minimum sample alone does not pass the gate. With the current
            Wilson-bound quality method, even perfect results in both arms require at least 189
            independent families to meet the two-point tolerance. Study size and power assumptions
            must be established before confirmation. Related seeded defects share a source-family
            cluster in the 2,000-resample bootstrap. These claims concern agent execution; human
            review time is a separate, optional measurement.
          </li>
        </ol>
        <p>
          Token reduction is not a dollar or subscription-quota reduction. We do not infer billing
          from token totals: cached and uncached input have different rates, and subscriptions have
          separate limits. Shorter prompt bytes or tool responses alone do not establish savings.
          These trials do not establish installed-app release acceptance.
        </p>
        <dl className="benchmark-environment">
          {Object.entries(data.environment).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="benchmark-section" aria-labelledby="reproduce-title">
        <h2 id="reproduce-title">Run your own baseline</h2>
        <p>
          The repository contains the fixture generators, independent oracles, native trial runner,
          and public report generator. Use your installed agent account and pin your model; live
          trials consume provider usage. Keep raw receipts private because they contain local paths
          and account bindings.
        </p>
        <pre>
          <code>
            {
              'pnpm evaluate:quality --execute --model=<model> --agent=codex \\\n  --variants=direct,after --effort=balanced --codex-speed=standard \\\n  --after=<absolute-native-test-executable> --repeat=3 --output=<directory>\npnpm evaluate:context <directory>/comparison.json <public-report.json>'
            }
          </code>
        </pre>
        <p>
          <a href="https://github.com/Jackalope-Dev/jackalope/blob/master/docs/AGENT-QUALITY.md">
            Contributor instructions and fixture commands
          </a>{' '}
          ·{' '}
          <a href="https://github.com/Jackalope-Dev/jackalope/tree/master/scripts/evaluation">
            Evaluation source
          </a>
        </p>
      </section>
      <section className="benchmark-section" aria-labelledby="references-title">
        <h2 id="references-title">What informed the experiments</h2>
        <p>
          <a href="https://www.anthropic.com/engineering/writing-tools-for-agents">
            Anthropic’s tool-design guidance
          </a>{' '}
          motivates bounded responses and evaluations.{' '}
          <a href="https://aider.chat/docs/repomap.html">Aider’s repository maps</a> demonstrate
          bounded code context.{' '}
          <a href="https://developers.openai.com/api/docs/guides/prompt-caching">
            OpenAI’s prompt-caching documentation
          </a>{' '}
          explains why deleting text alone is not a cost model.{' '}
          <a href="https://arxiv.org/abs/2508.21433">The Complexity Trap</a> studies local
          observation masking as an alternative to model summarization.{' '}
          <a href="https://docs.typesafe.ai/concepts/system-one">
            TypeSafe’s System One documentation
          </a>{' '}
          defines Jev’s typed decisions and uncertainty. These sources motivate tests; their
          performance numbers are not Jackalope results.
        </p>
      </section>
    </main>
  );
}
