import { hslToHex } from '@jackalope/brand/theme';
import { isTauriEnvironment } from './native/env';
import { invokeNative } from './native/transport';

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
    if (accent === previous) return;
    void invokeNative('desktop_control_theme', { accent })
      .then(() => {
        previous = accent;
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
