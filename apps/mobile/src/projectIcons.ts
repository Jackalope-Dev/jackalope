import type { Snapshot } from '@jackalope/contracts/remote';
import { useEffect, useRef, useState } from 'react';
import { request } from './native';

/** The image fetched for each `host:project`, with the version it was fetched for. */
type Images = Record<string, { version: string; url?: string }>;

const key = (host: string, project: string) => `${host}:${project}`;

/**
 * Project icon images, fetched once per computer and again only when a project's
 * `iconVersion` changes, so the polled snapshot stays small. Hosts that predate icons send
 * no versions and are never asked. Images are `data:image/` URLs shown through `<img>`.
 */
export function useProjectIcons(snapshots: Record<string, Snapshot | null | undefined>) {
  const [images, setImages] = useState<Images>({});
  const pending = useRef(new Set<string>());
  useEffect(() => {
    for (const [host, snapshot] of Object.entries(snapshots)) {
      const projects = snapshot?.projects ?? [];
      const stale = projects.some(
        (project) =>
          project.iconVersion && images[key(host, project.id)]?.version !== project.iconVersion,
      );
      if (!stale || pending.current.has(host)) continue;
      pending.current.add(host);
      request<{ icons?: Record<string, unknown> }>(host, { action: 'projectIcons' })
        .then(({ icons }) =>
          setImages((current) => {
            const next = { ...current };
            for (const project of projects) {
              if (!project.iconVersion) continue;
              const url = icons?.[project.id];
              // A version with no usable image is remembered too, so it isn't asked again.
              next[key(host, project.id)] = {
                version: project.iconVersion,
                url: typeof url === 'string' && url.startsWith('data:image/') ? url : undefined,
              };
            }
            return next;
          }),
        )
        .catch(() => {
          // Offline or refused: rows keep the project's initial until the next change.
        })
        .finally(() => pending.current.delete(host));
    }
  }, [snapshots, images]);
  return (host: string, project: string) => images[key(host, project)]?.url;
}
