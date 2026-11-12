import { useViewTabStore } from '../../stores/viewTabStore';
import { RemoteAccess } from '../settings/RemoteAccess';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceTabs } from '../ui/WorkspaceTabs';
import { RemoteHosts } from './RemoteHosts';

/**
 * Both directions of remote work in one place: using other computers from here (Hosts), and
 * letting a phone or another computer use this one (Remote access and paired devices).
 */
export function DevicesPage() {
  const tab = useViewTabStore((state) => state.devices);
  const setTab = useViewTabStore((state) => state.setDevices);
  return (
    <WorkspacePage className="devices-page">
      <WorkspaceHeading title="Devices" />
      <WorkspaceTabs.Root
        value={tab}
        onValueChange={(next) => setTab(next === 'share' ? 'share' : 'use')}
      >
        <WorkspaceTabs.List aria-label="Devices">
          <WorkspaceTabs.Trigger value="use">Use other computers</WorkspaceTabs.Trigger>
          <WorkspaceTabs.Trigger value="share">Let devices use this one</WorkspaceTabs.Trigger>
        </WorkspaceTabs.List>
        <WorkspaceTabs.Content value="use" className="devices-panel">
          <RemoteHosts onShare={() => setTab('share')} />
        </WorkspaceTabs.Content>
        <WorkspaceTabs.Content value="share" className="devices-panel">
          <RemoteAccess />
        </WorkspaceTabs.Content>
      </WorkspaceTabs.Root>
    </WorkspacePage>
  );
}
