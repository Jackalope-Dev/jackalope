import { Component, type ReactNode } from 'react';
import { Button } from './button';

export class PageErrorBoundary extends Component<
  { children: ReactNode; onBack?: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="mx-auto flex w-full max-w-lg flex-col gap-4 p-8" role="alert">
        <h1 className="text-xl font-semibold">This page couldn’t open.</h1>
        <p className="text-[var(--color-text-secondary)]">
          Try another page or reload Jackalope to try again.
        </p>
        <div className="flex flex-wrap gap-3">
          {this.props.onBack && <Button onClick={this.props.onBack}>Back to tasks</Button>}
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload Jackalope
          </Button>
        </div>
      </section>
    );
  }
}
