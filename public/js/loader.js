// Ladebildschirm: pulsierendes Logo, der Inhalt dahinter verschwimmt.
const MIN_VISIBLE_MS = 450;
// Start-Ladebildschirm (#intro) bleibt so lange, bis sich das Logo komplett aufgebaut hat, wie auf der Website
const INTRO_MIN_MS = 1300;

const CSS = `
.fw-loader { position: absolute; inset: 0; z-index: 50; display: grid; place-items: center;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); background: rgba(12, 12, 12, .25);
  opacity: 0; visibility: hidden; transition: opacity .2s, visibility 0s .2s; pointer-events: none; }
.fw-loader.on { opacity: 1; visibility: visible; transition: opacity .2s; pointer-events: auto; }
.fw-loader.fixed { position: fixed; background: rgba(12, 12, 12, .6); }
.fw-loader.clear { background: transparent; }
.fw-loader img { width: clamp(28px, 30%, 72px); animation: fw-pulse 1.1s ease-in-out infinite;
  filter: drop-shadow(0 0 12px rgba(255, 85, 0, .55)); }
@keyframes fw-pulse { 0%, 100% { transform: scale(.94); } 50% { transform: scale(1.04); } }
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

/**
 * Start-Ladebildschirm wie auf der Website: Logo baut sich auf, der Balken folgt dem Laden,
 * danach verschwimmt alles in die Seite. `el` ist das #intro-Element aus dem HTML.
 */
export function createIntro(el) {
  const bar = el.querySelector('.intro-bar i');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const started = performance.now();
  let finished = false;

  const progress = (p) => {
    if (!finished) bar.style.setProperty('--p', p);
  };
  const finish = () => {
    if (finished) return;
    bar.style.setProperty('--p', 1);
    finished = true;
    const wait = reduced ? 0 : Math.max(0, INTRO_MIN_MS - (performance.now() - started));
    setTimeout(() => el.classList.add('done'), wait);
  };
  setTimeout(() => progress(0.45), 200);

  return {
    progress,
    /** Zeigt den Ladebildschirm, bis `task` fertig ist. */
    async wrap(task) {
      try {
        return await (typeof task === 'function' ? task() : task);
      } finally {
        finish();
      }
    },
  };
}
