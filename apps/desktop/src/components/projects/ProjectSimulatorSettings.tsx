import { describeError } from '@jackalope/contracts/errors';
import {
  InlineNotice,
  Select,
  SelectItem,
  SettingBody,
  SettingGroup,
  SettingRow,
} from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { isTauriEnvironment } from '../../lib/native/env';
import { type SimulatorBase, type SimulatorCatalog, simulatorCatalog } from '../../lib/simulators';
import { type Project, useProjectStore } from '../../stores/projectStore';

const AUTOMATIC = 'automatic';

/** The device type and iOS version each task's own Simulator is created from. */
export function ProjectSimulatorSettings({ project }: { project: Project }) {
  const [catalog, setCatalog] = useState<SimulatorCatalog | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let current = true;
    setCatalog(null);
    setError('');
    void simulatorCatalog(project.path)
      .then((value) => current && setCatalog(value))
      .catch((cause) => current && setError(describeError(cause)));
    return () => {
      current = false;
    };
  }, [project.path]);
  const saved = project.preferences?.simulator;
  if (!catalog || (!catalog.iosProject && !saved)) {
    return error ? (
      <SettingGroup title="iOS Simulator">
        <SettingBody>
          <InlineNotice tone="error">{error}</InlineNotice>
        </SettingBody>
      </SettingGroup>
    ) : null;
  }
  const name = (identifier: string | undefined) =>
    catalog.deviceTypes.find((kind) => kind.identifier === identifier)?.name ??
    catalog.runtimes.find((runtime) => runtime.identifier === identifier)?.name ??
    identifier;
  const runtime = saved?.runtime ?? catalog.default?.runtime;
  const supported = new Set(
    catalog.runtimes.find((item) => item.identifier === runtime)?.deviceTypes ?? [],
  );
  const save = (simulator: SimulatorBase | undefined) =>
    useProjectStore.getState().updateProjectPreferences(project.id, { simulator });
  return (
    <SettingGroup
      title="iOS Simulator"
      description="Each task gets its own Simulator, created from this device and kept with its workspace, so follow-ups find the app as they left it."
    >
      {catalog.issue && (
        <SettingBody>
          <InlineNotice>{catalog.issue}</InlineNotice>
        </SettingBody>
      )}
      {!catalog.issue && (
        <>
          <SettingRow title="iOS version">
            <Select
              aria-label="iOS version"
              value={saved?.runtime ?? AUTOMATIC}
              onValueChange={(value) => {
                if (value === AUTOMATIC) return save(undefined);
                const types =
                  catalog.runtimes.find((item) => item.identifier === value)?.deviceTypes ?? [];
                const deviceType =
                  saved?.deviceType && types.includes(saved.deviceType)
                    ? saved.deviceType
                    : catalog.default?.deviceType && types.includes(catalog.default.deviceType)
                      ? catalog.default.deviceType
                      : types[0];
                if (deviceType) save({ runtime: value, deviceType });
              }}
            >
              <SelectItem value={AUTOMATIC}>
                Newest ({name(catalog.default?.runtime) ?? 'none installed'})
              </SelectItem>
              {catalog.runtimes.map((item) => (
                <SelectItem key={item.identifier} value={item.identifier}>
                  {item.name}
                </SelectItem>
              ))}
            </Select>
          </SettingRow>
          <SettingRow title="Device">
            <Select
              aria-label="Simulator device"
              value={saved?.deviceType ?? AUTOMATIC}
              onValueChange={(value) => {
                if (value === AUTOMATIC) return save(undefined);
                const chosen = runtime ?? catalog.runtimes[0]?.identifier;
                if (chosen) save({ runtime: chosen, deviceType: value });
              }}
            >
              <SelectItem value={AUTOMATIC}>
                Standard iPhone ({name(catalog.default?.deviceType) ?? 'none installed'})
              </SelectItem>
              {catalog.deviceTypes
                .filter((kind) => supported.has(kind.identifier))
                .map((kind) => (
                  <SelectItem key={kind.identifier} value={kind.identifier}>
                    {kind.name}
                  </SelectItem>
                ))}
            </Select>
          </SettingRow>
          {saved &&
            !catalog.runtimes.some(
              (item) =>
                item.identifier === saved.runtime && item.deviceTypes.includes(saved.deviceType),
            ) && (
              <SettingBody>
                <InlineNotice>
                  {name(saved.deviceType)} on {name(saved.runtime)} is no longer installed, so new
                  tasks use the standard iPhone on the newest iOS.
                </InlineNotice>
              </SettingBody>
            )}
        </>
      )}
    </SettingGroup>
  );
}
