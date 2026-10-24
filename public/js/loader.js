// Ladebildschirm: pulsierendes Logo, der Inhalt dahinter verschwimmt.
const MIN_VISIBLE_MS = 450;

const CSS = `
.fw-loader { position: absolute; inset: 0; z-index: 50; display: grid; place-items: center;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); background: rgba(12, 12, 12, .25);
  opacity: 0; visibility: hidden; transition: opacity .2s, visibility 0s .2s; pointer-events: none; }
.fw-loader.on { opacity: 1; visibility: visible; transition: opacity .2s; pointer-events: auto; }
.fw-loader.fixed { position: fixed; background: rgba(12, 12, 12, .6); }
.fw-loader.clear { background: transparent; }
.fw-loader img { width: clamp(28px, 30%, 72px); animation: fw-pulse 1.1s ease-in-out infinite;
  filter: drop-shadow(0 0 12px rgba(255, 85, 0, .55)); }
@keyframes fw-pulse { 0%, 100% { transform: scale(.88); opacity: .7; } 50% { transform: scale(1.06); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .fw-loader img { animation: none; } }
`;

let styleAdded = false;

/**
 * Legt einen Ladebildschirm über `host`.
 * Optionen: fixed (ganze Seite), clear (ohne Abdunkeln, z. B. für OBS).
 */
export function createLoader(host, { fixed = false, clear = false } = {}) {
  if (!styleAdded) {
    document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
    styleAdded = true;
  }
  if (!fixed && getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const el = document.createElement('div');
  el.className = `fw-loader${fixed ? ' fixed' : ''}${clear ? ' clear' : ''}`;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', 'Lädt…');
  el.innerHTML = '<img src="/logo.svg" alt="" />';
  host.append(el);

  let pending = 0;
  let shownAt = 0;
  let hideTimer = null;

  const show = () => {
    clearTimeout(hideTimer);
    if (pending++ === 0 && !el.classList.contains('on')) {
      shownAt = performance.now();
      el.classList.add('on');
    }
  };
  const hide = () => {
    pending = Math.max(0, pending - 1);
    if (pending > 0) return;
    const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt));
    hideTimer = setTimeout(() => el.classList.remove('on'), wait);
  };

  return {
    show,
    hide,
    /** Zeigt den Loader, solange `task` läuft. */
    async wrap(task) {
      show();
      try {
        return await (typeof task === 'function' ? task() : task);
      } finally {
        hide();
      }
    },
  };
}
