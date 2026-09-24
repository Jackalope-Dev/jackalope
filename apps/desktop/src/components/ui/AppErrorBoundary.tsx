import { ErrorState } from '@jackalope/ui';
import { Component, type ReactNode } from 'react';
import { telemetry } from '../../lib/telemetry-client';
import { Button } from './button';
import { errorMessage } from './PageErrorBoundary';

/**
 * The last line of defence for the whole window. Pages have their own
 * boundary; this catches the shell around them, so a crash there shows what
 * failed instead of leaving the window blank.
 */
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; message: string }
> {
  state = { failed: false, message: '' };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: errorMessage(error) };
  }

  componentDidCatch() {
    telemetry.track({ name: 'app_error', code: 'ui_render_error' });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <ErrorState
          level={1}
          title="Jackalope ran into a problem."
          description={`Reload to continue; your work and tasks are saved. ${this.state.message}`}
          action={
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload Jackalope
            </Button>
          }
        />
      </main>
    );
  }
}
