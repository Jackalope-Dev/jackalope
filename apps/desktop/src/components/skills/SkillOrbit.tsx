import { Tooltip } from '@jackalope/ui';
import { Cloud, Laptop, Monitor, MonitorSmartphone } from 'lucide-react';
import { deviceName, orbit, reach, type SkillDevice, type SkillHolder } from '../../lib/skill-sync';

const BOX = 176;

function DeviceIcon({ platform }: { platform: string | null }) {
  const Icon = platform === 'macos' ? Laptop : platform === 'windows' ? Monitor : MonitorSmartphone;
  return <Icon size={16} aria-hidden="true" />;
}

/**
 * The account in the middle with each of the person's computers around it.
 * Links are solid where the computer holds the newest synced skills; a dot
 * crosses each link only while a sync is running.
 */
export function SkillConstellation({
  devices,
  holders,
  busy,
  enabled,
}: {
  devices: SkillDevice[];
  /** Per device, whether it holds every synced skill's newest copy. */
  holders: SkillHolder[];
  busy: boolean;
  enabled: boolean;
}) {
  const shown: SkillDevice[] = devices.length
    ? devices
    : [{ id: 'here', name: null, platform: null, here: true }];
  const nodes = orbit(shown, holders, 36);
  return (
    <figure
      className="skill-orbit"
      data-busy={busy || undefined}
      data-enabled={enabled || undefined}
      style={{ width: BOX, height: BOX }}
    >
      <span className="skill-orbit-ring" aria-hidden="true" />
      {nodes.map((node) => {
        const dx = ((node.x - 50) / 100) * BOX;
        const dy = ((node.y - 50) / 100) * BOX;
        const length = Math.hypot(dx, dy) - 22;
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        return (
          <span
            key={`link-${node.device.id}`}
            className="skill-orbit-link"
            data-state={
              !enabled ? 'off' : node.current ? 'current' : node.holds ? 'behind' : 'none'
            }
            style={{ width: Math.max(length - 18, 0), rotate: `${angle}deg` }}
            aria-hidden="true"
          >
            {busy && enabled && (node.device.here || node.holds) && (
              <span className="ui-flow-pulse" />
            )}
          </span>
        );
      })}
      <span className="skill-orbit-hub" aria-hidden="true">
        <Cloud size={20} />
      </span>
      <ul className="skill-orbit-devices">
        {nodes.map((node) => {
          const state = !enabled
            ? 'not syncing'
            : node.current
              ? 'up to date'
              : node.holds
                ? 'catching up'
                : 'not synced yet';
          return (
            <li
              key={node.device.id}
              className="skill-orbit-device"
              data-here={node.device.here || undefined}
              data-state={node.current ? 'current' : node.holds ? 'behind' : 'none'}
              style={{ left: (node.x / 100) * BOX, top: (node.y / 100) * BOX }}
            >
              <Tooltip content={`${deviceName(node.device)}: ${state}`}>
                <span
                  className="skill-orbit-node"
                  role="img"
                  aria-label={`${deviceName(node.device)}: ${state}`}
                >
                  <DeviceIcon platform={node.device.platform} />
                </span>
              </Tooltip>
            </li>
          );
        })}
      </ul>
      <figcaption className="ui-sr-only">
        {enabled
          ? `${devices.length} computers syncing skills.`
          : 'Skill sync is off on this computer.'}
      </figcaption>
    </figure>
  );
}

/**
 * A small ring split into one arc per computer: filled arcs hold this skill's
 * newest copy, tinted arcs an older one.
 */
export function SkillRing({
  devices,
  holders,
  synced,
}: {
  devices: SkillDevice[];
  holders: SkillHolder[];
  synced: boolean;
}) {
  const size = 34;
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const total = Math.max(devices.length, 1);
  const gap = total > 1 ? 3 : 0;
  const arc = circumference / total - gap;
  const { current } = reach(devices, holders);
  const nodes = orbit(devices, holders);
  const label = synced
    ? `On ${current} of ${devices.length || 1} computers`
    : 'Only on this computer';
  return (
    <Tooltip
      content={
        synced && nodes.length ? (
          <span className="skill-ring-tip">
            {nodes.map((node) => (
              <span key={node.device.id}>
                {deviceName(node.device)}:{' '}
                {node.current ? 'up to date' : node.holds ? 'older copy' : 'not yet'}
              </span>
            ))}
          </span>
        ) : (
          label
        )
      }
    >
      <span className="skill-ring" role="img" aria-label={label} data-synced={synced || undefined}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle className="skill-ring-track" cx={size / 2} cy={size / 2} r={radius} />
          {synced &&
            nodes.map((node, index) => (
              <circle
                key={node.device.id}
                className="skill-ring-arc"
                data-state={node.current ? 'current' : node.holds ? 'behind' : 'none'}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                strokeDasharray={`${arc} ${circumference - arc}`}
                strokeDashoffset={-index * (arc + gap)}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            ))}
        </svg>
        <span className="skill-ring-count" aria-hidden="true">
          {synced ? current : 1}
        </span>
      </span>
    </Tooltip>
  );
}
