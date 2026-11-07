import { Button, ErrorState } from '@jackalope/ui';
import { Component, type ReactNode } from 'react';
import { describeError } from '../../lib/errors';
import type { Feature } from '../../lib/telemetry';
import { telemetry } from '../../lib/telemetry-client';
import { WorkspacePage } from './WorkspacePage';

/** The thrown error in words, so a crash can be reported and diagnosed. */
export function crashMessage(error: unknown) {
  const text = describeError(error);
  return text ? `Error: ${text.slice(0, 300)}` : '';
}

export class PageErrorBoundary extends Component<
  { children: ReactNode; onBack?: () => void; feature?: Feature },
  { failed: boolean; message: string }
> {
  state = { failed: false, message: '' };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: crashMessage(error) };
  }

  componentDidCatch() {
    telemetry.track({ name: 'app_error', code: 'ui_render_error', feature: this.props.feature });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <WorkspacePage>
        <ErrorState
          level={1}
          title="This page couldn’t open."
          description={`Try another page or reload Jackalope to try again. ${this.state.message}`}
          action={
            <div className="flex flex-wrap gap-3">
              {this.props.onBack && <Button onClick={this.props.onBack}>Back to tasks</Button>}
              <Button variant="outline" onClick={() => window.location.reload()}>
                Reload Jackalope
              </Button>
            </div>
          }
        />
      </WorkspacePage>
    );
  }
}
