(() => {
  const key = '__jackalopePreviewPicker';
  if (window[key]) return window[key].selection;
  const state = { selection: null, picking: true };
  window[key] = state;
  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  const theme = window.__jackalopePreviewTheme || {};
  for (const name of [
    '--color-surface',
    '--color-text-primary',
    '--color-border',
    '--color-accent',
  ]) {
    if (typeof theme[name] === 'string') host.style.setProperty(name, theme[name]);
  }
  const style = document.createElement('style');
  style.textContent =
    'div{display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--color-surface,#14171d);color:var(--color-text-primary,#f3f4f6);border:1px solid var(--color-border,#262c37);border-radius:8px;font:14px system-ui}button{font:inherit;min-height:44px;border:1px solid var(--color-border,#262c37);border-radius:6px;background:transparent;color:inherit;padding:6px 12px;cursor:pointer}button:focus-visible{outline:2px solid var(--color-accent,#6366f1);outline-offset:2px}';
  const toolbar = document.createElement('div');
  const label = document.createElement('span');
  label.textContent = 'Jackalope';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Cancel selection';
  const outline = document.createElement('div');
  outline.style.cssText =
    'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid;display:none;box-sizing:border-box';
  outline.style.borderColor = theme['--color-accent'] || '#6366f1';
  const stop = () => {
    state.picking = false;
    outline.style.display = 'none';
    button.textContent = 'Select element';
  };
  state.begin = () => {
    state.picking = true;
    button.textContent = 'Cancel selection';
    label.textContent = 'Jackalope';
  };
  button.onclick = () => {
    state.picking = !state.picking;
    button.textContent = state.picking ? 'Cancel selection' : 'Select element';
    if (!state.picking) stop();
  };
  toolbar.append(label, button);
  root.append(style, toolbar);
  document.documentElement.append(host, outline);
  document.addEventListener(
    'pointermove',
    (event) => {
      if (
        !state.picking ||
        event.composedPath().includes(host) ||
        !(event.target instanceof Element)
      )
        return;
      const rect = event.target.getBoundingClientRect();
      Object.assign(outline.style, {
        display: 'block',
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') stop();
    },
    true,
  );
  document.addEventListener(
    'click',
    (event) => {
      if (
        !state.picking ||
        event.composedPath().includes(host) ||
        !(event.target instanceof Element)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const element = event.target;
      const clone = element.cloneNode(true);
      if (clone.matches('input,textarea,[contenteditable]')) clone.textContent = '';
      clone.querySelectorAll('script,style,input,textarea,[contenteditable]').forEach((node) => {
        node.remove();
      });
      for (const node of [clone, ...clone.querySelectorAll('*')]) {
        for (const attribute of [...node.attributes])
          if (
            attribute.name.startsWith('on') ||
            /value|token|password|secret/i.test(attribute.name)
          )
            node.removeAttribute(attribute.name);
      }
      const computed = getComputedStyle(element);
      const properties = [
        'display',
        'position',
        'color',
        'background-color',
        'font-family',
        'font-size',
        'font-weight',
        'line-height',
        'padding',
        'margin',
        'gap',
        'border',
        'border-radius',
        'width',
        'height',
      ];
      const rect = element.getBoundingClientRect();
      state.selection = {
        id: crypto.randomUUID(),
        url: location.href,
        tag: element.tagName.toLowerCase(),
        html: clone.outerHTML.slice(0, 6000),
        styles: Object.fromEntries(
          properties.map((property) => [property, computed.getPropertyValue(property)]),
        ),
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        source:
          element.getAttribute('data-source') || element.getAttribute('data-source-file') || null,
      };
      document.querySelectorAll('[data-jackalope-selection]').forEach((node) => {
        node.removeAttribute('data-jackalope-selection');
      });
      element.setAttribute('data-jackalope-selection', state.selection.id);
      stop();
      label.textContent = 'Selection ready in Jackalope';
    },
    true,
  );
  return null;
})();
