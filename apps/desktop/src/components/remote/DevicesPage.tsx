import { useRef } from 'react';
import { type DevicesIntent, useDevicesStore } from '../../stores/devicesStore';
import { type DevicesTab, useViewTabStore } from '../../stores/viewTabStore';
import { CloudMachines } from '../computers/CloudMachines';
import { RemoteAccess } from '../settings/RemoteAccess';
import { WorkspaceHeading } from '../ui/WorkspaceHeading';
import { WorkspacePage } from '../ui/WorkspacePage';
import { WorkspaceTabs } from '../ui/WorkspaceTabs';
import { DeviceMap } from './DeviceMap';
import { RemoteHosts } from './RemoteHosts';
import './devices.css';

const TABS: DevicesTab[] = ['share', 'use', 'cloud'];

/**
 * Every device in one place: a map of this computer and what it is paired with, then the
 * three ways to pair: letting a phone or another computer use this one, using other
 * computers from here, and cloud machines for bots and tasks.
 */
export function DevicesPage() {
  const tab = useViewTabStore((state) => state.devices);
  const setTab = useViewTabStore((state) => state.setDevices);
  const panels = useRef<HTMLDivElement>(null);
  const open = (next: DevicesTab, intent?: DevicesIntent) => {
    if (intent) useDevicesStore.getState().request(intent);
    setTab(next);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() =>
      panels.current?.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' }),
    );
  };
  return (
    <WorkspacePage className="devices-page">
      <WorkspaceHeading title="Devices" />
      <DeviceMap onOpen={open} />
      <div ref={panels} className="workspace-section devices-panels">
        <WorkspaceTabs.Root
          value={tab}
          onValueChange={(next) => setTab(TABS.find((item) => item === next) ?? 'share')}
        >
          <WorkspaceTabs.List aria-label="Devices">
            <WorkspaceTabs.Trigger value="share">Let devices use this one</WorkspaceTabs.Trigger>
            <WorkspaceTabs.Trigger value="use">Use other computers</WorkspaceTabs.Trigger>
            <WorkspaceTabs.Trigger value="cloud">Cloud machines</WorkspaceTabs.Trigger>
          </WorkspaceTabs.List>
          <WorkspaceTabs.Content value="share" className="devices-panel">
            <RemoteAccess />
          </WorkspaceTabs.Content>
          <WorkspaceTabs.Content value="use" className="devices-panel">
            <RemoteHosts />
          </WorkspaceTabs.Content>
          <WorkspaceTabs.Content value="cloud" className="devices-panel">
            <CloudMachines />
          </WorkspaceTabs.Content>
        </WorkspaceTabs.Root>
      </div>
    </WorkspacePage>
  );
}
