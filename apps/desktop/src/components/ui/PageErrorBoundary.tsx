import { Component, type ReactNode } from 'react';
import { Button } from './button';
import { WorkspaceHeading } from './WorkspaceHeading';
import { WorkspacePage } from './WorkspacePage';

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
      <WorkspacePage role="alert">
        <WorkspaceHeading
          title="This page couldn’t open."
          description="Try another page or reload Jackalope to try again."
        />
        <div className="flex flex-wrap gap-3">
          {this.props.onBack && <Button onClick={this.props.onBack}>Back to tasks</Button>}
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload Jackalope
          </Button>
        </div>
      </WorkspacePage>
    );
  }
}
