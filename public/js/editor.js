import { FONTS, renderOverlay } from './render.js';
import { createIntro, createLoader } from './loader.js';
import { initLangSelect, locale, t, widgetName } from './i18n.js';
import { loadStats, renderStats } from './stats.js';

const $ = (id) => document.getElementById(id);

const api = async (method, url, body) => {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  // Sitzung abgelaufen
  if (res.status === 401) location.href = `/login.html?next=${encodeURIComponent(location.pathname)}`;
  if (!res.ok && res.status !== 204) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.status === 204 ? null : res.json();
};

let overlays = [];
let overlay = null;
let state = null;
let selectedId = null;
let scale = 1;

// ---------- Speichern ----------

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const saved = await api('PUT', `/api/overlays/${overlay.id}`, overlay);
    overlays = overlays.map((o) => (o.id === saved.id ? saved : o));
    renderOverlaySelect();
  }, 300);
}

function changed() {
  drawPreview();
  scheduleSave();
}

// ---------- Vorschau ----------

function drawPreview() {
  const preview = $('preview');
  const area = document.querySelector('.preview-area');
  const { width, height } = overlay.style;
  scale = Math.min(2, (area.clientWidth - 100) / width, (area.clientHeight - 168) / height);
  scale = Math.max(0.2, scale);
  preview.style.transform = `scale(${scale})`;
  preview.style.marginRight = `${width * (scale - 1)}px`;
  preview.style.marginBottom = `${height * (scale - 1)}px`;
  renderOverlay(preview, overlay, state, { editable: true, selectedId });
}

function setupDragging() {
  const preview = $('preview');
  let drag = null;

  preview.addEventListener('pointerdown', (e) => {
    const node = e.target.closest('[data-widget-id]');
    if (!node) return;
    const widget = overlay.widgets.find((w) => w.id === node.dataset.widgetId);
    drag = { widget, startX: e.clientX, startY: e.clientY, x: widget.x, y: widget.y };
    preview.setPointerCapture(e.pointerId);
    select(widget.id);
    e.preventDefault();
  });

  preview.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const { style } = overlay;
    const x = drag.x + (e.clientX - drag.startX) / scale;
    const y = drag.y + (e.clientY - drag.startY) / scale;
    // Alt gedrückt halten = frei verschieben ohne Einrasten
    const snapped = e.altKey ? { x, y, guides: [] } : snap(drag.widget, x, y);
    drag.widget.x = Math.round(Math.max(0, Math.min(style.width - 4, snapped.x)));
    drag.widget.y = Math.round(Math.max(0, Math.min(style.height - 4, snapped.y)));
    drawPreview();
    drawGuides(snapped.guides);
  });

  const end = () => {
    if (!drag) return;
    drag = null;
    drawPreview();
    renderWidgetList();
    scheduleSave();
  };
  preview.addEventListener('pointerup', end);
  preview.addEventListener('pointercancel', end);

  // Feinjustierung mit Pfeiltasten (Shift = 10px)
  document.addEventListener('keydown', (e) => {
    if (!selectedId || e.target.matches('input, select, textarea')) return;
    const widget = overlay.widgets.find((w) => w.id === selectedId);
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!moves[e.key]) return;
    e.preventDefault();
    widget.x = Math.max(0, widget.x + moves[e.key][0]);
    widget.y = Math.max(0, widget.y + moves[e.key][1]);
    renderWidgetList();
    changed();
  });
}

// ---------- Einrasten ----------

const SNAP_DISTANCE = 6; // Bildschirm-Pixel

/** Linien, an denen ein Widget einrasten kann: Kanten und Mitten der anderen Widgets und des Overlays. */
function snapLines(exceptId) {
  const { width, height } = overlay.style;
  const xs = [0, width / 2, width];
  const ys = [0, height / 2, height];
  for (const node of $('preview').querySelectorAll('[data-widget-id]')) {
    if (node.dataset.widgetId === exceptId) continue;
    const w = overlay.widgets.find((v) => v.id === node.dataset.widgetId);
    xs.push(w.x, w.x + node.offsetWidth / 2, w.x + node.offsetWidth);
    ys.push(w.y, w.y + node.offsetHeight / 2, w.y + node.offsetHeight);
  }
  return { xs, ys };
}

/** Rastet Oberkante, Mitte oder Unterkante (bzw. links, Mitte, rechts) an der nächsten Linie ein. */
function snap(widget, x, y) {
  const node = $('preview').querySelector(`[data-widget-id="${widget.id}"]`);
  if (!node) return { x, y, guides: [] };
  const { xs, ys } = snapLines(widget.id);
  const limit = SNAP_DISTANCE / scale;
  const nearest = (pos, size, lines) => {
    let best = null;
    for (const offset of [0, size / 2, size]) {
      for (const line of lines) {
        const d = line - (pos + offset);
        if (Math.abs(d) <= limit && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line };
      }
    }
    return best;
  };
  const bx = nearest(x, node.offsetWidth, xs);
  const by = nearest(y, node.offsetHeight, ys);
  const guides = [];
  if (bx) guides.push({ axis: 'x', at: bx.line });
  if (by) guides.push({ axis: 'y', at: by.line });
  return { x: bx ? x + bx.d : x, y: by ? y + by.d : y, guides };
}

function drawGuides(guides) {
  const root = $('preview').firstElementChild;
  if (!root) return;
  for (const g of guides) {
    const line = document.createElement('div');
    line.className = 'snap-guide';
    Object.assign(line.style, g.axis === 'x'
      ? { left: `${g.at}px`, top: 0, bottom: 0, width: `${1 / scale}px` }
      : { top: `${g.at}px`, left: 0, right: 0, height: `${1 / scale}px` });
    root.appendChild(line);
  }
}

// Ein frisch eingeblendetes Widget, das über einem anderen liegt, bekommt einen freien Platz.
// Gibt es keinen, wird das Overlay nach unten vergrößert.
function placeWithoutOverlap(widget) {
  const preview = $('preview');
  const rectOf = (node) => {
    const r = node.getBoundingClientRect();
    const base = preview.firstElementChild.getBoundingClientRect();
    return { x: (r.left - base.left) / scale, y: (r.top - base.top) / scale, w: r.width / scale, h: r.height / scale };
  };
  const nodes = [...preview.querySelectorAll('[data-widget-id]')];
  const own = nodes.find((n) => n.dataset.widgetId === widget.id);
  if (!own) return;
  const { w, h } = rectOf(own);
  const others = nodes.filter((n) => n !== own).map(rectOf);
  const gap = 6;
  const free = (x, y) => others.every((o) => x + w + gap <= o.x || o.x + o.w + gap <= x || y + h + gap <= o.y || o.y + o.h + gap <= y);
  if (free(widget.x, widget.y)) return;

  const { width, height } = overlay.style;
  for (let y = 8; y + h <= height - 8; y += 4) {
    for (let x = 16; x + w <= width - 8; x += 4) {
      if (free(x, y)) {
        widget.x = x;
        widget.y = y;
        renderWidgetList();
        return;
      }
    }
  }
  const bottom = Math.max(0, ...others.map((o) => o.y + o.h));
  widget.x = 16;
  widget.y = Math.round(bottom + gap * 2);
  overlay.style.height = Math.ceil(widget.y + h + 12);
  renderWidgetList();
  renderStyleForm();
}

function select(id) {
  selectedId = id;
  renderWidgetList();
  drawPreview();
}

// ---------- Stat-Liste ----------

function field(label, input, cls = '') {
  const wrap = document.createElement('label');
  if (cls) wrap.className = cls;
  if (input.type === 'checkbox') {
    wrap.classList.add('inline');
    wrap.append(input, label);
  } else {
    wrap.append(label, input);
  }
  return wrap;
}

function input(type, value, onInput, attrs = {}) {
  const node = document.createElement('input');
  node.type = type;
  Object.assign(node, attrs);
  if (type === 'checkbox') node.checked = value;
  else node.value = value;
  node.addEventListener('input', () => onInput(type === 'checkbox' ? node.checked : type === 'number' || type === 'range' ? Number(node.value) : node.value, node));
  return node;
}

function renderWidgetList() {
  const list = $('widgetList');
  list.replaceChildren();

  overlay.widgets.forEach((w, index) => {
    const li = document.createElement('li');
    if (w.id === selectedId) li.classList.add('selected', 'open');

    const head = document.createElement('div');
    head.className = 'head';
    const toggle = input('checkbox', w.enabled, (v) => {
      w.enabled = v;
      drawPreview();
      if (v) placeWithoutOverlap(w);
      changed();
    });
    toggle.setAttribute('aria-label', t('show', { n: widgetName(w.label) }));
    const name = document.createElement('span');
    name.textContent = widgetName(w.label) || w.type;
    name.addEventListener('click', () => select(selectedId === w.id ? null : w.id));

    const up = document.createElement('button');
    up.textContent = '↑';
    up.title = t('moveUp');
    up.disabled = index === 0;
    up.addEventListener('click', () => {
      [overlay.widgets[index - 1], overlay.widgets[index]] = [overlay.widgets[index], overlay.widgets[index - 1]];
      renderWidgetList();
      changed();
    });

    head.append(toggle, name, up);

    const details = document.createElement('div');
    details.className = 'details grid';
    const customColor = input('checkbox', !!w.color, (v) => {
      w.color = v ? colorInput.value : '';
      changed();
    });
    const colorInput = input('color', w.color || overlay.style.textColor, (v) => {
      w.color = v;
      customColor.checked = true;
      changed();
    });
    details.append(
      field(t('label'), input('text', w.label, (v) => {
        w.label = v;
        name.textContent = widgetName(v) || w.type;
        changed();
      }), 'full'),
      ...(w.type === 'seasonWinRate'
        ? [field(t('altLabel'), input('text', w.altLabel ?? '', (v) => {
            w.altLabel = v;
            changed();
          }), 'full')]
        : []),
      field(t('showLabel'), input('checkbox', w.showLabel, (v) => {
        w.showLabel = v;
        changed();
      })),
      field(t('customColor'), customColor),
      field(t('size'), input('number', w.fontSize, (v) => {
        w.fontSize = Math.max(6, v);
        changed();
      }, { min: 6, max: 200 })),
      field(t('color'), colorInput),
      field('X', input('number', w.x, (v) => {
        w.x = v;
        changed();
      })),
      field('Y', input('number', w.y, (v) => {
        w.y = v;
        changed();
      })),
    );

    li.append(head, details);
    list.appendChild(li);
  });
}

// ---------- Design ----------

const STYLE_FIELDS = [
  ['width', 'width', 'number'],
  ['height', 'height', 'number'],
  ['background', 'background', 'color'],
  ['backgroundOpacity', 'opacity', 'range', { min: 0, max: 1, step: 0.05 }],
  ['borderRadius', 'radius', 'number'],
  ['borderWidth', 'border', 'number'],
  ['borderColor', 'borderColor', 'color'],
  ['fontFamily', 'font', 'font'],
  ['textColor', 'textColor', 'color'],
  ['labelColor', 'labelColor', 'color'],
  ['accentColor', 'accentColor', 'color'],
  ['positiveColor', 'positiveColor', 'color'],
  ['negativeColor', 'negativeColor', 'color'],
  ['levelIcon', 'levelIcon', 'select', { options: [['badge', 'levelBadge'], ['official', 'levelOfficial']] }],
  ['showAvatarFrame', 'showFrame', 'checkbox'],
  ['statsPeriod', 'statsPeriod', 'select', { options: [['cycle', 'statsCycle'], ['season', 'statsSeason'], ['alltime', 'statsAllTime']] }],
  ['statsCycleSeconds', 'statsCycleSeconds', 'number', { min: 3, max: 600 }],
];

function renderStyleForm() {
  const form = $('styleForm');
  form.replaceChildren();
  for (const [key, labelKey, type, attrs] of STYLE_FIELDS) {
    const label = t(labelKey);
    const set = (v) => {
      overlay.style[key] = key === 'statsCycleSeconds' ? Math.max(3, v || 10) : v;
      changed();
      // Die Sekunden gelten nur beim Wechseln
      if (key === 'statsPeriod') renderStyleForm();
    };
    if (type === 'font' || type === 'select') {
      const options = type === 'font' ? FONTS.map((f) => [f, f]) : attrs.options.map(([value, key]) => [value, t(key)]);
      const select = document.createElement('select');
      for (const [value, text] of options) select.add(new Option(text, value, false, value === overlay.style[key]));
      select.addEventListener('change', () => set(select.value));
      form.appendChild(field(label, select));
    } else if (type === 'checkbox') {
      form.appendChild(field(label, input('checkbox', !!overlay.style[key], set)));
    } else {
      const node = input(type, overlay.style[key], set, attrs);
      if (key === 'statsCycleSeconds') node.disabled = (overlay.style.statsPeriod ?? 'cycle') !== 'cycle';
      form.appendChild(field(label, node));
    }
  }
}

// ---------- Overlays verwalten ----------

function renderOverlaySelect() {
  const select = $('overlaySelect');
  select.replaceChildren(...overlays.map((o) => new Option(o.name, o.id, false, o.id === overlay?.id)));
}

async function openOverlay(id) {
  overlay = await api('GET', `/api/overlays/${id}`);
  selectedId = null;
  localStorage.setItem('fw-overlay', id);
  $('overlayName').value = overlay.name;
  $('obsUrl').value = `${location.origin}/overlay/${overlay.id}`;
  renderOverlaySelect();
  renderWidgetList();
  renderStyleForm();
  drawPreview();
  const toPlace = overlay.widgets.filter((w) => w.autoPlace);
  for (const w of toPlace) {
    delete w.autoPlace;
    if (w.enabled) placeWithoutOverlap(w);
    drawPreview();
  }
  if (toPlace.length) scheduleSave();
}

// ---------- Live-Status ----------

function renderStatus() {
  const status = $('status');
  if (state?.error) {
    status.className = 'status error';
    status.textContent = state.error;
  } else if (state?.demo) {
    status.className = 'status demo';
    status.textContent = t('demo');
  } else {
    status.className = 'status live';
    status.textContent = state?.player ? t('live', { n: state.player.nickname }) : t('connecting');
  }
  status.title = status.textContent;
  if (document.activeElement !== $('nickname')) $('nickname').value = state?.nickname ?? '';
  if (document.activeElement !== $('frameUrl')) $('frameUrl').value = state?.avatarFrameOverride ?? '';
  $('frameInfo').textContent = state?.avatarFrameOverride
    ? t('frameCustom')
    : state?.player?.avatarFrame
      ? t('frameFound')
      : t('frameNone');
  if (document.activeElement !== $('seasonStart')) $('seasonStart').value = state?.seasonStart ?? '';
  const season = state?.season;
  $('seasonInfo').textContent = season
    ? t('season', { w: season.wins, l: season.losses, m: season.matches, r: season.winRate })
    : state?.seasonStart ? '' : t('seasonNone');
  const s = state?.session;
  $('sessionInfo').textContent = s
    ? t('session', { t: new Date(s.startedAt).toLocaleString(locale()), w: s.wins, l: s.losses, e: `${s.eloChange >= 0 ? '+' : ''}${s.eloChange}` })
    : '';
  renderRecentElo();
}

// ---------- Elo der letzten Matches ----------

function renderRecentElo() {
  const list = $('recentEloList');
  // Nicht neu zeichnen, während eine Zahl eingetippt wird
  if (list.contains(document.activeElement)) return;
  list.replaceChildren();
  for (const m of state?.recentMatches ?? []) {
    if (!m.matchId) continue;
    const li = document.createElement('li');
    const res = Object.assign(document.createElement('span'), { className: `res ${m.result}`, textContent: m.result });
    const date = m.finishedAt ? new Date(m.finishedAt).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const info = Object.assign(document.createElement('span'), { className: 'info', textContent: [m.map.replace(/^de_/, ''), date].join(' · ') + (m.mvp ? ' 👑' : '') });
    const amount = m.eloChange == null ? '' : String(Math.abs(m.eloChange));
    const field = Object.assign(document.createElement('input'), { type: 'number', min: 0, max: 100, step: 1 });
    // Geschätzt: nur als Platzhalter zeigen, damit klar ist, dass noch nichts eingetragen wurde
    if (m.estimated) {
      field.placeholder = amount;
      field.classList.add('estimated');
    } else field.value = amount;
    field.addEventListener('change', async () => {
      state = await api('PUT', `/api/matches/${encodeURIComponent(m.matchId)}/elo`, { elo: field.value === '' ? null : Number(field.value) });
      field.blur();
      renderStatus();
      drawPreview();
    });
    li.append(res, info, field);
    list.appendChild(li);
  }
}

// ---------- Tabs ----------

let tab = 'overlay';

function setTab(next) {
  tab = next === 'stats' ? 'stats' : 'overlay';
  for (const button of document.querySelectorAll('.tabs [data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  $('overlayView').hidden = tab !== 'overlay';
  $('statsView').hidden = tab !== 'stats';
  document.body.classList.toggle('tab-stats', tab === 'stats');
  history.replaceState(null, '', tab === 'stats' ? '#stats' : location.pathname + location.search);
  if (tab === 'stats') loadStats();
  else if (overlay) drawPreview();
}

for (const button of document.querySelectorAll('.tabs [data-tab]')) button.addEventListener('click', () => setTab(button.dataset.tab));
setTab(location.hash === '#stats' ? 'stats' : 'overlay');

// ---------- Start ----------

async function init() {
  const intro = createIntro($('intro'));
  const previewLoader = createLoader(document.querySelector('.preview-area'));
  // Änderungen, die vom Server geladen werden, zeigen den Ladebildschirm über der Vorschau
  const busy = (task) => previewLoader.wrap(task);

  await intro.wrap(async () => {
    state = await api('GET', '/api/state');
    intro.progress(0.7);
    overlays = await api('GET', '/api/overlays');
    intro.progress(0.85);
    renderStatus();

    const remembered = localStorage.getItem('fw-overlay');
    await openOverlay(overlays.some((o) => o.id === remembered) ? remembered : overlays[0].id);
  });
  setupDragging();

  $('overlaySelect').addEventListener('change', (e) => busy(openOverlay(e.target.value)));
  $('overlayName').addEventListener('input', (e) => {
    overlay.name = e.target.value || 'Overlay';
    scheduleSave();
  });
  $('newOverlay').addEventListener('click', async () => {
    await busy(async () => {
      const created = await api('POST', '/api/overlays', { name: t('newOverlay') });
      overlays.push(created);
      await openOverlay(created.id);
    });
  });
  $('copyOverlay').addEventListener('click', async () => {
    await busy(async () => {
      const created = await api('POST', '/api/overlays', { name: t('copyName', { n: overlay.name }), copyFrom: overlay.id });
      overlays.push(created);
      await openOverlay(created.id);
    });
  });
  $('resetOverlay').addEventListener('click', async () => {
    if (!confirm(t('confirmReset', { n: overlay.name }))) return;
    clearTimeout(saveTimer);
    await busy(async () => {
      await api('POST', `/api/overlays/${overlay.id}/reset`);
      await openOverlay(overlay.id);
    });
  });
  $('deleteOverlay').addEventListener('click', async () => {
    if (!confirm(t('confirmDelete', { n: overlay.name }))) return;
    try {
      await busy(async () => {
        await api('DELETE', `/api/overlays/${overlay.id}`);
        overlays = overlays.filter((o) => o.id !== overlay.id);
        await openOverlay(overlays[0].id);
      });
    } catch (err) {
      alert(err.message);
    }
  });

  $('nicknameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    state = await busy(api('PUT', '/api/nickname', { nickname: $('nickname').value }));
    renderStatus();
    drawPreview();
  });
  $('frameForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      state = await busy(api('PUT', '/api/avatar-frame', { url: $('frameUrl').value }));
      renderStatus();
      drawPreview();
    } catch (err) {
      alert(err.message);
    }
  });
  $('seasonStart').addEventListener('change', async (e) => {
    state = await busy(api('PUT', '/api/season', { start: e.target.value }));
    renderStatus();
    drawPreview();
  });
  $('refresh').addEventListener('click', async () => {
    state = await busy(api('POST', '/api/refresh'));
    renderStatus();
    drawPreview();
  });
  $('resetSession').addEventListener('click', async () => {
    state = await busy(api('POST', '/api/session/reset'));
    renderStatus();
    drawPreview();
  });
  $('copyUrl').addEventListener('click', async () => {
    await navigator.clipboard?.writeText($('obsUrl').value);
    $('copyUrl').textContent = t('copied');
    setTimeout(() => ($('copyUrl').textContent = t('copy')), 1500);
  });

  window.addEventListener('resize', drawPreview);

  const events = new EventSource('/api/events');
  events.addEventListener('state', (e) => {
    state = JSON.parse(e.data);
    renderStatus();
    drawPreview();
    if (tab === 'stats') loadStats();
  });
}

// Angemeldeten Nutzer zeigen und Abmelden anbieten
async function initAccount() {
  $('logout').addEventListener('click', async () => {
    await fetch('/api/logout', { method: 'POST' });
    location.href = '/login.html';
  });
  const me = await fetch('/api/me').then((r) => r.json()).catch(() => null);
  if (me?.user) $('accountName').textContent = me.user;
  $('startPage').hidden = !me?.startPage;
}

// Sprache: feste Texte übersetzt i18n.js, die selbst gebauten Teile werden neu gezeichnet
initLangSelect($('langSel'));
document.addEventListener('fw:lang', () => {
  if (tab === 'stats') renderStats();
  if (!overlay) return;
  renderStatus();
  renderWidgetList();
  renderStyleForm();
});

init();
initAccount();
