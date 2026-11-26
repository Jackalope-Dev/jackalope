import { Button, InlineNotice, Input, SettingGroup, SettingRow } from '@jackalope/ui';
import { useEffect, useState } from 'react';
import { isTauriEnvironment } from '../../lib/native/env';
import { invokeNative } from '../../lib/native/transport';
import { type ProjectTimeLimits, useProjectStore } from '../../stores/projectStore';

type LimitKey = keyof ProjectTimeLimits;

/** Defaults and accepted ranges in minutes; the native side applies the same bounds in seconds. */
const LIMITS: {
  key: LimitKey;
  title: string;
  description: string;
  fallback: number;
  min: number;
  max: number;
}[] = [
  {
    key: 'prepareSilenceSecs',
    title: 'Setup quiet limit',
    description: 'Stops workspace preparation after this many minutes without output.',
    fallback: 5,
    min: 1,
    max: 60,
  },
  {
    key: 'checkSilenceSecs',
    title: 'Check quiet limit',
    description: 'Stops a check after this many minutes without output.',
    fallback: 10,
    min: 1,
    max: 60,
  },
  {
    key: 'checkCeilingSecs',
    title: 'Longest setup or check',
    description: 'Stops preparation or a check after this many minutes in total.',
    fallback: 30,
    min: 5,
    max: 120,
  },
];

const minutes = (seconds: number | undefined) =>
  seconds === undefined ? '' : String(Math.round(seconds / 60));

/** Quiet and total time limits for this project's setup command and checks. */
export function ProjectTimeLimitsSettings({ projectId }: { projectId: string }) {
  const project = useProjectStore((state) => state.projects.find((item) => item.id === projectId));
  const updateProjectPreferences = useProjectStore((state) => state.updateProjectPreferences);
  const [suggestion, setSuggestion] = useState<ProjectTimeLimits | null>(null);
  const path = project?.path;
  useEffect(() => {
    if (!path || !isTauriEnvironment()) return;
    let current = true;
    setSuggestion(null);
    void invokeNative<ProjectTimeLimits | null>('project_time_limit_suggestion', { path })
      .then((value) => current && setSuggestion(value))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [path]);
  if (!project) return null;
  const saved = project.preferences?.timeLimits ?? {};
  const save = (key: LimitKey, seconds: number | undefined) => {
    const next = { ...saved };
    if (seconds === undefined) delete next[key];
    else next[key] = seconds;
    updateProjectPreferences(project.id, {
      timeLimits: Object.keys(next).length ? next : undefined,
    });
  };
  const unset = LIMITS.every(({ key }) => saved[key] === undefined);
  return (
    <SettingGroup
      title="Time limits"
      description="Leave a field blank to use its default. Commands that keep printing still stop at the total limit."
    >
      {suggestion && unset ? (
        <InlineNotice
          action={
            <Button
              variant="outline"
              onClick={() => updateProjectPreferences(project.id, { timeLimits: suggestion })}
            >
              Use these
            </Button>
          }
        >
          Xcode builds and tests can go quiet for long stretches. Suggested:{' '}
          {minutes(suggestion.prepareSilenceSecs)} and {minutes(suggestion.checkSilenceSecs)}{' '}
          minutes quiet, {minutes(suggestion.checkCeilingSecs)} minutes in total.
        </InlineNotice>
      ) : null}
      {LIMITS.map((limit) => (
        <LimitField
          key={limit.key}
          limit={limit}
          seconds={saved[limit.key]}
          onSave={(seconds) => save(limit.key, seconds)}
        />
      ))}
    </SettingGroup>
  );
}

/** Saves whole minutes within range as they are typed, and settles anything else on blur. */
function LimitField({
  limit,
  seconds,
  onSave,
}: {
  limit: (typeof LIMITS)[number];
  seconds: number | undefined;
  onSave: (seconds: number | undefined) => void;
}) {
  const [text, setText] = useState(minutes(seconds));
  useEffect(() => setText(minutes(seconds)), [seconds]);
  const inRange = (value: number) =>
    Number.isInteger(value) && value >= limit.min && value <= limit.max;
  const id = `time-limit-${limit.key}`;
  return (
    <SettingRow
      title={limit.title}
      description={`${limit.description} Default ${limit.fallback}; ${limit.min}–${limit.max} minutes.`}
      controlId={id}
      descriptionId={`${id}-description`}
    >
      <Input
        id={id}
        aria-describedby={`${id}-description`}
        className="project-setting-input"
        type="number"
        inputMode="numeric"
        min={limit.min}
        max={limit.max}
        step={1}
        placeholder={String(limit.fallback)}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (next.trim() === '') onSave(undefined);
          else if (inRange(Number(next))) onSave(Number(next) * 60);
        }}
        onBlur={() => {
          const value = Number(text);
          if (text.trim() === '' || !Number.isFinite(value)) {
            onSave(undefined);
            setText('');
            return;
          }
          const settled = Math.min(limit.max, Math.max(limit.min, Math.round(value)));
          onSave(settled * 60);
          setText(String(settled));
        }}
      />
    </SettingRow>
  );
}
