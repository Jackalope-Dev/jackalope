import { Badge, Checkbox, CopyButton, Select, SelectItem, Table } from '@jackalope/ui';
import { Scale } from 'lucide-react';
import type { Verdict } from '../../lib/compare-judge';
import { isActive, type TaskRun } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

/** An attempt as the verdict refers to it: its judge label and display name. */
export interface LabelledAttempt {
  label: string;
  run: TaskRun;
  name: string;
}

interface JudgeChoice {
  options: { id: string; name: string }[];
  value: string;
  independent: boolean;
  onChange: (id: string) => void;
}

/**
 * Starting, following and reading the comparison's judge. The verdict shows a
 * criteria × attempt table with the recommended base and the parts worth porting.
 */
export function ComparisonJudge({
  judgeRun,
  judgeName,
  verdict,
  loading,
  attempts,
  choice,
  canStart,
  starting,
  selectedPorts,
  onTogglePort,
  onStart,
  onOpen,
}: {
  judgeRun?: TaskRun;
  judgeName: string;
  verdict?: Verdict;
  /** The finished judge's answer is still being read. */
  loading: boolean;
  attempts: LabelledAttempt[];
  choice: JudgeChoice;
  canStart: boolean;
  starting: boolean;
  selectedPorts: Set<number>;
  onTogglePort: (index: number) => void;
  onStart: () => void;
  onOpen: (run: TaskRun) => void;
}) {
  const running = !!judgeRun && isActive(judgeRun);
  const finished = !!judgeRun && ['review', 'reviewed'].includes(judgeRun.status);
  const byLabel = new Map(attempts.map((attempt) => [attempt.label, attempt]));
  const showStart = canStart && !running && !loading && !verdict;
  return (
    <section className="comparison-judge" aria-label="Judge">
      {running && (
        <div className="comparison-judge-row">
          <Scale size={16} aria-hidden="true" />
          <span className="comparison-judge-status">Judging with {judgeName}…</span>
          <Button variant="outline" size="sm" onClick={() => onOpen(judgeRun)}>
            Open judge
          </Button>
        </div>
      )}
      {loading && (
        <div className="comparison-judge-row">
          <Scale size={16} aria-hidden="true" />
          <span className="comparison-judge-status">Reading the verdict…</span>
        </div>
      )}
      {judgeRun && !running && !loading && !verdict && (
        <InlineNotice
          tone="warning"
          action={
            <Button variant="outline" size="sm" onClick={() => onOpen(judgeRun)}>
              Open judge
            </Button>
          }
        >
          {finished
            ? 'The judge did not return a scored table. Open it to read its answer.'
            : 'The judge did not finish.'}
        </InlineNotice>
      )}
      {showStart && (
        <div className="comparison-judge-row">
          <Scale size={16} aria-hidden="true" />
          <p className="comparison-judge-status">
            A read-only task scores each attempt and suggests one to build on.
          </p>
          <Select
            value={choice.value}
            onValueChange={choice.onChange}
            aria-label="Judge agent"
            className="comparison-judge-agent"
            disabled={starting || !choice.options.length}
            placeholder="No agent available"
          >
            {choice.options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </Select>
          <Button
            size="sm"
            onClick={onStart}
            disabled={!choice.value}
            loading={starting}
            loadingLabel="Starting…"
          >
            {judgeRun ? 'Judge again' : 'Judge results'}
          </Button>
          {choice.value && !choice.independent && (
            <p className="comparison-judge-hint">
              Every available agent shares a family with one of the attempts.
            </p>
          )}
        </div>
      )}
      {verdict && (
        <>
          <div className="comparison-judge-row">
            <Scale size={16} aria-hidden="true" />
            <span className="comparison-judge-status">Verdict from {judgeName}</span>
            {judgeRun && (
              <Button variant="outline" size="sm" onClick={() => onOpen(judgeRun)}>
                Open judge
              </Button>
            )}
          </div>
          {verdict.ambiguous && (
            <InlineNotice
              tone="warning"
              action={
                verdict.ambiguous.prompt ? (
                  <CopyButton
                    variant="outline"
                    size="sm"
                    text={verdict.ambiguous.prompt}
                    label="Copy request"
                  />
                ) : undefined
              }
            >
              {verdict.ambiguous.reason}
              {verdict.ambiguous.prompt && (
                <span className="comparison-judge-clarified">{verdict.ambiguous.prompt}</span>
              )}
            </InlineNotice>
          )}
          <Table label="Scores by criterion" className="comparison-judge-table">
            <thead>
              <tr>
                <th scope="col">Criterion</th>
                {attempts.map((attempt) => (
                  <th scope="col" key={attempt.label}>
                    {attempt.label} · {attempt.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {verdict.criteria.map((criterion) => (
                <tr key={criterion.id}>
                  <th scope="row">{criterion.text}</th>
                  {attempts.map((attempt) => {
                    const cell = verdict.scores[attempt.label]?.[criterion.id];
                    return (
                      <td key={attempt.label}>
                        {cell ? (
                          <>
                            <strong>{cell.score}</strong>
                            <span className="comparison-judge-out-of">/5</span>
                            {cell.note && (
                              <span className="comparison-judge-note">{cell.note}</span>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
          {verdict.base && (
            <p className="comparison-judge-base">
              <Badge variant="success">Build on {verdict.base.attempt}</Badge>
              <span>
                {byLabel.get(verdict.base.attempt)?.name}
                {verdict.base.reason && ` · ${verdict.base.reason}`}
              </span>
            </p>
          )}
          {verdict.ports.length > 0 && (
            <fieldset className="comparison-judge-ports">
              <legend>Worth porting</legend>
              {verdict.ports.map((port, index) => (
                <label key={`${port.attempt}-${port.what}`} className="comparison-judge-port">
                  <Checkbox
                    checked={selectedPorts.has(index)}
                    onChange={() => onTogglePort(index)}
                  />
                  <span>
                    <strong>
                      From {port.attempt} · {byLabel.get(port.attempt)?.name}
                    </strong>{' '}
                    {port.what}
                    {port.files.length > 0 && (
                      <small className="comparison-judge-files">{port.files.join(', ')}</small>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}
    </section>
  );
}
