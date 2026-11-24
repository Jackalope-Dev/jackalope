import { useEffect, useState } from 'react';
import { isTauriEnvironment } from '../lib/native/env';
import { skillSync } from '../lib/skill-sync';

const cache = new Map<string, { skills: { name: string; description: string }[]; at: number }>();

/**
 * Skills Claude Code can run as `/name` in this project: personal and this project's
 * `.claude/skills` on this computer. Other agents invoke skills differently or keep
 * none Jackalope can list, so they get none.
 */
export function useProviderSkills(adapter: string | undefined, projectId: string | undefined) {
  const key = `${adapter}:${projectId ?? ''}`;
  const [skills, setSkills] = useState(() => cache.get(key)?.skills ?? []);
  useEffect(() => {
    if (adapter !== 'claude' || !isTauriEnvironment()) {
      setSkills([]);
      return;
    }
    const cached = cache.get(key);
    if (cached) setSkills(cached.skills);
    if (cached && Date.now() - cached.at < 60_000) return;
    let canceled = false;
    skillSync({ action: 'status' })
      .then((page) => {
        const found = page.skills
          .filter(
            (skill) =>
              skill.root === 'claude' &&
              !!skill.path &&
              (skill.scope === 'personal' || skill.project?.id === projectId),
          )
          .map((skill) => ({ name: skill.name, description: skill.description }));
        cache.set(key, { skills: found, at: Date.now() });
        if (!canceled) setSkills(found);
      })
      .catch(() => {
        // Skills are an optional addition to the menu; the built-in commands still work.
        if (!canceled) setSkills([]);
      });
    return () => {
      canceled = true;
    };
  }, [adapter, projectId, key]);
  return skills;
}
