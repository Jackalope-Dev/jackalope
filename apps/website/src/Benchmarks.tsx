import evidence from '../public/research/benchmarks.json';
import './benchmarks.css';

type Totals = {
  trials: number;
  oraclePassed: number;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  elapsedMs: number | null;
};
type Report = {
  model: string;
  cliVersion: string;
  baseline: string;
  candidate: string;
  totals: Record<string, Totals>;
  cases: string[];
  metrics: Record<string, { reductionPercent: number | null; eligibleForScopedClaim: boolean }>;
  blockers: string[];
  sourceSha256: string;
  trialMeasurements: { case: string; variant: string; repetition: number }[];
};
type Evidence = {
  date: string;
  environment: Record<string, string>;
  comparisons: { id: string; title: string; detail: string; report: Report }[];
  discovery: {
    trials: number;
    localPassed: number;
    jevPassed: number;
    elapsedMs: number;
    inputTokens: number | null;
    estimatedCostUsd: number | null;
    errors: number;
    model: string;
  } | null;
};
const data = evidence as Evidence;
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
  const trials = new Set(
    data.comparisons.flatMap(({ report }) =>
      report.trialMeasurements.map(
        (row) => `${report.sourceSha256}:${row.case}:${row.variant}:${row.repetition}`,
      ),
    ),
  ).size;
  const wins = data.comparisons.flatMap(({ id, title, report }) =>
    Object.entries(report.metrics)
      .filter(([, metric]) => metric.eligibleForScopedClaim)
      .map(([key, metric]) => ({
        id: `${id}-${key}`,
        title,
        value: `${number(metric.reductionPercent)}%`,
        label: key === 'totalTokens' ? 'fewer reported tokens' : 'less elapsed time',
      })),
  );
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
          <span>live agent trials; some comparisons share the same baseline trials</span>
        </div>
        {wins.length ? (
          wins.map((win) => (
            <div key={win.id}>
              <strong>{win.value}</strong>
              <span>
                {win.label} · {win.title} only
              </span>
            </div>
          ))
        ) : (
          <div>
            <strong>Evidence first</strong>
            <span>No general speed or cost saving established by this pilot.</span>
          </div>
        )}
        <div>
          <strong>Same task</strong>
          <span>
            Matched model, reasoning effort, requested speed, account, and behavioral checks.
          </span>
        </div>
      </section>
      <section className="benchmark-section" aria-labelledby="results-title">
        <h2 id="results-title">Results, including the overhead</h2>
        <p>
          These are authored, disposable fixtures on one Windows machine. They are a reproducible
          starting point, not a representative sample of software engineering or proof of equivalent
          quality on real projects. Passing means passing the stated fixture oracle; human
          acceptance and correction time are not measured.
        </p>
        {data.comparisons.map(({ id, title, detail, report }) => (
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
                    <th scope="col">Oracle passes</th>
                    <th scope="col">Total tokens</th>
                    <th scope="col">Cached input</th>
                    <th scope="col">Total seconds</th>
                  </tr>
                </thead>
                <tbody>
                  {[report.baseline, report.candidate].map((variant) => {
                    const total = report.totals[variant];
                    return (
                      <tr key={variant}>
                        <th scope="row">{labels[variant] ?? variant}</th>
                        <td>
                          {total.oraclePassed}/{total.trials}
                        </td>
                        <td>{number(total.totalTokens)}</td>
                        <td>{number(total.cachedInputTokens)}</td>
                        <td>{number(total.elapsedMs === null ? null : total.elapsedMs / 1000)}</td>
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
            {!!report.blockers.length && (
              <p className="benchmark-caption">Claim limitations: {report.blockers.join(' ')}</p>
            )}
          </article>
        ))}
      </section>
      <section className="benchmark-section" aria-labelledby="jev-title">
        <h2 id="jev-title">Jev: test the decision before adding the call</h2>
        <p>
          Jev can rank tool descriptions before an agent receives their schemas. This experiment
          sends a bounded task brief, search query, and at most 32 candidate descriptions. Strong
          relevance scores can promote candidates; uncertain answers keep local search behavior.
          Exact tool names bypass this step. Empty-query browsing remains available, and Jev does
          not execute tools or change permissions. The option is off by default.
        </p>
        {data.discovery && (
          <p>
            On {data.discovery.trials} authored ranking trials, local search met the expected
            top-five or absent-result check {data.discovery.localPassed} times; Jev-assisted ranking
            met it {data.discovery.jevPassed} times. Jev added{' '}
            {number(data.discovery.elapsedMs / 1000)} seconds in total and reported{' '}
            {number(data.discovery.inputTokens)} input tokens. {data.discovery.errors} calls failed.{' '}
            {data.discovery.estimatedCostUsd === null
              ? 'Dollar cost was unavailable.'
              : `Estimated Jev API input cost: $${data.discovery.estimatedCostUsd.toFixed(6)}, using $0.042 per million input tokens; this is not an invoice.`}
          </p>
        )}
        <p>
          This isolates retrieval behavior. It does not measure downstream agent savings, end-to-end
          speed, or general search accuracy. Jev is a remote service; the field-selection experiment
          below uses local code and requires no Jev call.
        </p>
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
            <strong>Counterbalance and repeat.</strong> Rotate variant order over three repetitions
            per case. Provider-side cache state is inherited, not controlled. Wall-clock results
            include network and service variability; builds and full verification run outside the
            timed experiment.
          </li>
          <li>
            <strong>Limit the claim.</strong> A scoped improvement requires the planned matrix to
            finish, matched configurations, complete usage, every oracle passing, and a positive
            lower bound in a descriptive case-cluster bootstrap (2,000 resamples). Three authored
            cases are a pilot, not a population-level confidence estimate. The JSON includes
            individual measurements and build provenance.
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
