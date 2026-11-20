import { hslToHex } from '@jackalope/brand/theme';
import { isTauriEnvironment } from './native/env';
import { invokeNative } from './native/transport';

/** A CSS colour as `#rrggbb`, resolved by the browser; empty when it can't be read. */
function hexOf(color: string) {
  const probe = document.createElement('i');
  probe.style.color = color;
  document.body.append(probe);
  const rgb = getComputedStyle(probe)
    .color.match(/\d+(\.\d+)?/g)
    ?.slice(0, 3)
    .map(Number);
  probe.remove();
  if (!rgb || rgb.length < 3) return '';
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Keeps the native desktop-control bar and frame in the app's theme: its accent, and on
 * macOS whether it's dark or light with matching surface and text colours.
 */
export function observeDesktopControlTheme() {
  if (!isTauriEnvironment()) return;
  const root = document.documentElement;
  let timer: ReturnType<typeof setTimeout>;
  let previous = '';
  const sync = () => {
    const values = ['--accent-h', '--accent-s', '--accent-l'].map((name) =>
      Number.parseFloat(root.style.getPropertyValue(name)),
    );
    if (!values.every(Number.isFinite)) return;
    const accent = hslToHex(values[0], values[1], values[2]);
    const dark = root.style.getPropertyValue('color-scheme').trim() !== 'light';
    const surface = hexOf('var(--color-surface-elevated)');
    const text = hexOf('var(--color-text-primary)');
    const look = surface && text ? `${dark ? 'dark' : 'light'}|${surface}|${text}` : undefined;
    const key = `${accent}|${look ?? ''}`;
    if (key === previous) return;
    void invokeNative('desktop_control_theme', { accent, look })
      .then(() => {
        previous = key;
      })
      .catch(() => {
        previous = '';
      });
  };
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(sync, 100);
  });
  observer.observe(root, { attributes: true, attributeFilter: ['style'] });
  sync();
  return () => {
    observer.disconnect();
    clearTimeout(timer);
  };
}
