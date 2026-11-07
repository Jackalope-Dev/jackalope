import {
  CLOUD_TARGETS,
  cloudTargets,
  isCloudTarget,
  windowsInstallerName,
} from '../../packages/contracts/src/release.ts';
import { version } from './catalog.mjs';

export const targets = cloudTargets;

export function cloudAssets(target, v, mode = 'candidate') {
  version(v);
  if (!isCloudTarget(target)) throw new Error('Unsupported Cloud target');
  const name = mode === 'candidate' ? 'Jackalope' : 'Jackalope Rehearsal';
  const { arch, cdnPlatform: publicPlatform } = CLOUD_TARGETS[target];
  if (target === 'windows-x86_64')
    return [{ name: windowsInstallerName(v, name), publicPlatform, updatePlatform: target }];
  if (target === 'linux-x86_64')
    return [{ name: `${name}_${v}_${arch}.AppImage`, publicPlatform, updatePlatform: target }];
  return [
    { name: `${name}_${v}_${arch}.dmg`, publicPlatform },
    { name: `${name}_${v}_${arch}.app.tar.gz`, updatePlatform: target },
  ];
}

export function cloudFiles(target, v, mode) {
  return [
    ...cloudAssets(target, v, mode).flatMap((asset) =>
      asset.updatePlatform ? [asset.name, `${asset.name}.sig`] : [asset.name],
    ),
    'tauri.cloud.json',
    'notes.md',
  ];
}
