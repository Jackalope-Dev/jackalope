import { version } from './catalog.mjs';

export const targets = ['windows-x86_64', 'darwin-aarch64', 'darwin-x86_64', 'linux-x86_64'];

export function cloudAssets(target, v, mode = 'candidate') {
  version(v);
  if (!targets.includes(target)) throw new Error('Unsupported Cloud target');
  const name = mode === 'candidate' ? 'Jackalope' : 'Jackalope Rehearsal';
  const arch = target.split('-')[1];
  if (target === 'windows-x86_64')
    return [
      { name: `${name}_${v}_x64-setup.exe`, publicPlatform: 'nsis-x86_64', updatePlatform: target },
    ];
  if (target === 'linux-x86_64')
    return [
      {
        name: `${name}_${v}_${arch}.AppImage`,
        publicPlatform: `appimage-${arch}`,
        updatePlatform: target,
      },
    ];
  return [
    { name: `${name}_${v}_${arch}.dmg`, publicPlatform: `dmg-${arch}` },
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
