/**
 * The webview's own right-click menu (Back, Refresh, Print…) is a browser artifact in a
 * desktop app, so it is turned off. Text fields and selected text keep it for copy and
 * paste, components with their own menus (ContextMenu) handle the event first, and
 * development builds keep it so Inspect stays one click away.
 */
export function suppressNativeContextMenu() {
  if (import.meta.env.DEV) return;
  window.addEventListener('contextmenu', (event) => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])'))
      return;
    if (window.getSelection()?.toString()) return;
    event.preventDefault();
  });
}
