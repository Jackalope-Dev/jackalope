import { CopyButton, DefinitionList, Disclosure, DisclosureSummary } from '@jackalope/ui';
import { useState } from 'react';
import { nativeTask } from '../../lib/task-runtime';
import { Button } from '../ui/button';
import { InlineNotice } from '../ui/InlineNotice';

interface Report {
  generatedAt: string;
  periodDays: number;
  tasksStarted: number;
  daysWithTaskStarts: number;
  usefulResults: number;
  needsMoreWork: number;
  reportedReviewMinutes: number;
  reviewTimeReports: number;
  followUpAttempts: number;
  failedOrInterruptedAttempts: number;
  recoveredUsefulTasks: number;
  firstUsefulResultMinutes: number | null;
  coverage: string;
}
export function WorkflowReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      setReport(await nativeTask<Report>('workflow_report'));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Disclosure className="my-4">
      <DisclosureSummary>Useful work and review effort</DisclosureSummary>
      <div className="space-y-3 py-3">
        <p>
          Review your last seven days of local work. Rate results in Review to track usefulness and
          the time you spend correcting them.
        </p>
        <Button
          variant="outline"
          disabled={busy}
          loading={busy}
          loadingLabel="Reading…"
          onClick={() => void refresh()}
        >
          Read local workflow report
        </Button>
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        {report && (
          <>
            <DefinitionList
              items={[
                { label: 'Useful results', value: report.usefulResults },
                { label: 'Rated needs more work', value: report.needsMoreWork },
                { label: 'Tasks started', value: report.tasksStarted },
                { label: 'Days with task starts (UTC)', value: report.daysWithTaskStarts },
                {
                  label: 'Reported review and correction time',
                  value: report.reviewTimeReports
                    ? `${report.reportedReviewMinutes} minutes across ${report.reviewTimeReports} ratings`
                    : 'Not reported',
                },
                { label: 'Follow-up attempts', value: report.followUpAttempts },
                {
                  label: 'Failed or interrupted attempts',
                  value: report.failedOrInterruptedAttempts,
                },
                { label: 'Useful results after a failure', value: report.recoveredUsefulTasks },
                {
                  label: 'First recorded task to first useful result',
                  value:
                    report.firstUsefulResultMinutes === null
                      ? 'Not yet recorded'
                      : `${report.firstUsefulResultMinutes} minutes`,
                },
              ]}
            />
            <p className="task-muted">{report.coverage}</p>
            <CopyButton
              text={JSON.stringify(report, null, 2)}
              label="Copy report without task contents"
            />
          </>
        )}
      </div>
    </Disclosure>
  );
}
