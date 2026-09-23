type Totals = {
  trials: number;
  successes: number;
  totalTokens: number | null;
  tokensPerSuccess: number | null;
  msPerSuccess: number | null;
  totalCostPerSuccessBoundsUsd: { low: number; high: number } | null;
};

export type Experiment = {
  id: string;
  title: string;
  detail: string;
  labels: Record<string, string | undefined>;
  report: {
    baseline: string;
    candidate: string;
    distinctTasks: number;
    independentFamilies: number;
    totals: Record<string, Totals | undefined>;
    reductions: { tokensPerSuccess: number | null; msPerSuccess: number | null };
    intervals: {
      totalTokens: { low: number; high: number } | null;
      elapsedMs: { low: number; high: number } | null;
    };
    publication: { eligible: boolean; blockers: string[] };
  };
};

const format = (value: number | null, digits = 1) =>
  value === null
    ? 'Unavailable'
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);
const change = (value: number | null) =>
  value === null ? 'unavailable' : `${format(Math.abs(value))}% ${value >= 0 ? 'lower' : 'higher'}`;
const interval = (value: { low: number; high: number } | null) =>
  value ? `${format(value.low)}% to ${format(value.high)}%` : 'unavailable';

export function ExperimentResults({ experiments }: { experiments: Experiment[] }) {
  if (!experiments.length) return null;
  return (
    <section className="benchmark-section" aria-labelledby="experiments-title">
      <h2 id="experiments-title">Product experiments</h2>
      <p>
        Each comparison records which factors change. Small seeded repairs and authored tool tasks
        help us screen changes before testing representative work. These results include every
        failed attempt in the work per successful task. A passing automated check is separate from
        human acceptance. Improvements against another Jackalope configuration do not establish an
        advantage over the native CLI.
      </p>
      {experiments.map(({ id, title, detail, labels, report }) => (
        <article className="benchmark-result" id={id} key={id}>
          <h3>{title}</h3>
          <p>{detail}</p>
          <p className="benchmark-caption">
            Tasks: {report.distinctTasks} · Source/template families: {report.independentFamilies} ·
            screening results
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
                  <th scope="col">Tokens per success</th>
                  <th scope="col">Seconds per success</th>
                  <th scope="col">API-equivalent USD per success</th>
                </tr>
              </thead>
              <tbody>
                {[report.baseline, report.candidate].map((variant) => {
                  const total = report.totals[variant];
                  if (!total) return null;
                  const cost = total.totalCostPerSuccessBoundsUsd;
                  return (
                    <tr key={variant}>
                      <th scope="row">{labels[variant] ?? variant}</th>
                      <td>
                        {total.successes}/{total.trials}
                      </td>
                      <td>{format(total.tokensPerSuccess)}</td>
                      <td>
                        {format(total.msPerSuccess === null ? null : total.msPerSuccess / 1000)}
                      </td>
                      <td>
                        {cost
                          ? cost.low === cost.high
                            ? `$${format(cost.low, 4)}`
                            : `$${format(cost.low, 4)}–$${format(cost.high, 4)}`
                          : 'Unavailable'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
          <p>
            Tokens per successful task: {change(report.reductions.tokensPerSuccess)}. Elapsed time
            per successful task: {change(report.reductions.msPerSuccess)}.
          </p>
          <p className="benchmark-caption">
            Exploratory 95% intervals for reductions: tokens{' '}
            {interval(report.intervals.totalTokens)}; elapsed time{' '}
            {interval(report.intervals.elapsedMs)}. Positive values mean less work per success.
            These resample source families and are omitted below three families; small samples and
            inherited caches limit interpretation.
          </p>
          <details>
            <summary>Scope and claim limitations</summary>
            <ul>
              {report.publication.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </details>
        </article>
      ))}
      <p className="benchmark-caption">
        API-equivalent estimates separate cached input and output using published model prices. They
        are not subscription charges, invoices, or quota savings. Ranges bound the possible
        long-context surcharge when cumulative usage does not identify individual request tiers. See
        the downloadable measurements for rates, sources, budgets and individual trials.
      </p>
    </section>
  );
}
