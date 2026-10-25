// Gemeinsamer Renderer für das OBS-Overlay und die Editor-Vorschau.

const LEVEL_THRESHOLDS = [0, 501, 751, 901, 1051, 1201, 1351, 1531, 1751, 2001];
const SYSTEM_FONTS = ['Arial', 'Verdana', 'Tahoma', 'Segoe UI', 'Impact'];
export const FONTS = ['Geist', 'Play', 'Rajdhani', 'Inter', 'Roboto', 'Montserrat', 'Oswald', 'Bebas Neue', 'Teko', 'Exo 2', ...SYSTEM_FONTS];

function levelColor(level) {
  if (level >= 10) return '#fe1f00';
  if (level >= 8) return '#ff6309';
  if (level >= 4) return '#ffc800';
  if (level >= 2) return '#1ce400';
  return '#eeeeee';
}

export function hexToRgba(hex, alpha = 1) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const loadedFonts = new Set();
export function loadFont(family) {
  if (SYSTEM_FONTS.includes(family) || loadedFonts.has(family)) return;
  // Schon per @font-face eingebunden (z. B. lokal auf der Landingpage): nichts nachladen
  if ([...document.fonts].some((f) => f.family.replace(/["']/g, '') === family)) return;
  loadedFonts.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

function el(tag, styles = {}, text) {
  const node = document.createElement(tag);
  Object.assign(node.style, styles);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Faceit-Bilder laufen über den lokalen Cache des Servers. */
export function assetUrl(remote) {
  return `/assets/remote?url=${encodeURIComponent(remote)}`;
}

// Level-Symbole, die nicht geladen werden konnten: dann den gezeichneten Kreis verwenden
const missingLevelIcons = new Set();

// Nachbau der Faceit-Level-Symbole: dunkle Scheibe, Bogen über 270° (Lücke unten), Füllung = Level / 10
function arcPath(r, fromDeg, sweepDeg) {
  const point = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return `${(50 + r * Math.sin(rad)).toFixed(2)} ${(50 - r * Math.cos(rad)).toFixed(2)}`;
  };
  return `M ${point(fromDeg)} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${point(fromDeg + sweepDeg)}`;
}

export function levelBadgeSvg(level) {
  const n = Math.min(10, Math.max(1, Math.round(level)));
  const color = levelColor(n);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="48" fill="#1f2125" stroke="#2c2f34" stroke-width="2"/>
    <path d="${arcPath(36, 225, 270)}" fill="none" stroke="#3a3d42" stroke-width="9"/>
    <path d="${arcPath(36, 225, 27 * n)}" fill="none" stroke="${color}" stroke-width="9"/>
    <text x="50" y="51" text-anchor="middle" dominant-baseline="central" font-family="Arial, Helvetica, sans-serif"
      font-weight="700" font-size="${n === 10 ? 32 : 38}" fill="${color}">${n}</text>
  </svg>`;
}

function levelBadge(level, size) {
  const wrap = el('div', { width: `${size * 1.6}px`, height: `${size * 1.6}px` });
  wrap.innerHTML = levelBadgeSvg(level);
  wrap.firstElementChild.style.display = 'block';
  return wrap;
}

function signed(n) {
  return n > 0 ? `+${n}` : String(n);
}

/** Diese Stats wechseln zwischen Season und All-Time. */
const PERIOD_WIDGETS = new Set(['seasonWinRate', 'kd', 'hsPercent', 'adr', 'matches']);

/**
 * Welche Werte gerade zu sehen sind: 'season' oder 'alltime'. Beim Wechseln hängt die Phase nur an der Uhrzeit,
 * so zeigen OBS und Editor-Vorschau immer dasselbe. Ohne Season-Daten (kein Season-Start) immer All-Time.
 */
export function statsPeriod(style, state, now = Date.now()) {
  if (!state?.season) return 'alltime';
  const mode = style.statsPeriod ?? 'cycle';
  if (mode !== 'cycle') return mode;
  return Math.floor(now / cycleMs(style)) % 2 === 0 ? 'season' : 'alltime';
}

function cycleMs(style) {
  return Math.max(3, Number(style.statsCycleSeconds) || 10) * 1000;
}

/** Season- oder All-Time-Werte für die wechselnden Stats. */
function periodValues(state, period) {
  const p = state?.player;
  const season = state?.season;
  if (period === 'season' && season) {
    return { matches: season.matches, winRate: season.winRate, kd: season.kd ?? null, hsPercent: season.hsPercent ?? null, adr: season.adr ?? null };
  }
  return p ? { matches: p.matches, winRate: p.winRate, kd: p.kd, hsPercent: p.hsPercent, adr: p.adr } : null;
}

function widgetLabel(widget, period) {
  return widget.type === 'seasonWinRate' && period === 'alltime' && widget.altLabel ? widget.altLabel : widget.label;
}

/** Baut den Inhalt eines einzelnen Widgets. Gibt null zurück, wenn (noch) keine Daten da sind. */
function widgetContent(widget, style, state, period = 'alltime') {
  const p = state?.player;
  const v = PERIOD_WIDGETS.has(widget.type) ? periodValues(state, period) : null;
  const s = state?.session;
  const size = widget.fontSize;
  const color = widget.color || style.textColor;

  switch (widget.type) {
    case 'avatar': {
      const frame = style.showAvatarFrame && p?.avatarFrame ? p.avatarFrame : '';
      // Das Bild ist immer gleich groß. Der Ring (ohne Rahmen) bzw. der Faceit-Rahmen (136 % wie bei Faceit)
      // liegt außen herum, ohne Platz im Layout zu belegen oder das Bild zu verkleinern.
      const box = { width: `${size}px`, height: `${size}px`, borderRadius: '50%', boxShadow: frame ? 'none' : `0 0 0 2px ${style.accentColor}` };
      let avatar;
      if (p?.avatar) {
        avatar = el('img', { ...box, objectFit: 'cover', display: 'block' });
        avatar.src = assetUrl(p.avatar);
      } else {
        avatar = el(
          'div',
          { ...box, background: style.accentColor, display: 'grid', placeItems: 'center', fontSize: `${size * 0.45}px`, fontWeight: 700, color: '#fff' },
          (p?.nickname ?? '?').charAt(0).toUpperCase(),
        );
      }
      if (!frame) return avatar;
      const wrap = el('div', { position: 'relative', width: `${size}px`, height: `${size}px` });
      const frameImg = el('img', { position: 'absolute', left: '-18%', top: '-18%', width: '136%', height: '136%', pointerEvents: 'none' });
      frameImg.src = assetUrl(frame);
      frameImg.onerror = () => frameImg.remove();
      wrap.append(avatar, frameImg);
      return wrap;
    }
    case 'nickname':
      return p ? el('div', { fontWeight: 700 }, p.nickname) : null;
    case 'level': {
      if (!p) return null;
      if (style.levelIcon === 'badge' || missingLevelIcons.has(p.level)) return levelBadge(p.level, size);
      const icon = el('img', { width: `${size * 1.6}px`, height: `${size * 1.6}px`, display: 'block' });
      icon.src = `/assets/level/${p.level}`;
      icon.alt = `Level ${p.level}`;
      icon.onerror = () => {
        missingLevelIcons.add(p.level);
        icon.replaceWith(levelBadge(p.level, size));
      };
      return icon;
    }
    case 'elo':
      return p ? el('div', { fontWeight: 700 }, `${p.elo} ELO`) : null;
    case 'eloProgress': {
      if (!p) return null;
      const idx = Math.min(p.level, 10) - 1;
      const min = LEVEL_THRESHOLDS[idx];
      const next = LEVEL_THRESHOLDS[idx + 1];
      const pct = next ? Math.max(0, Math.min(1, (p.elo - min) / (next - min))) : 1;
      const wrap = el('div', { width: `${size * 32}px` });
      const bar = el('div', { height: `${Math.max(4, size * 0.5)}px`, borderRadius: '99px', background: 'rgba(255,255,255,0.15)', overflow: 'hidden' });
      bar.appendChild(el('div', { width: `${pct * 100}%`, height: '100%', background: style.accentColor }));
      wrap.appendChild(bar);
      // Links die Elo bis zum Abstieg ins Level darunter (wie bei Faceit), rechts die Elo bis zum nächsten Level
      const down = idx > 0 ? String(p.elo - min + 1) : '';
      const up = next ? String(next - p.elo) : '';
      const labels = el('div', { marginTop: '3px', color: style.labelColor, display: 'flex', justifyContent: 'space-between' });
      labels.append(el('span', {}, down), el('span', {}, up));
      wrap.appendChild(labels);
      return wrap;
    }
    case 'eloToday': {
      if (!s) return null;
      const c = s.eloChange > 0 ? style.positiveColor : s.eloChange < 0 ? style.negativeColor : color;
      return el('div', { fontWeight: 700, color: widget.color || c }, signed(s.eloChange));
    }
    case 'sessionRecord': {
      if (!s) return null;
      // Feste Breite für „0W - 0L“, rechtsbündig: Bei zweistelligen Zahlen wächst die Bilanz nach links,
      // im Standard-Layout (x 336, Schrift 18) bleibt das rechte Ende bündig mit dem Elo-Balken bei x 400
      const wrap = el('div', { fontWeight: 700, display: 'flex', justifyContent: 'flex-end', width: `${size * 3.56}px` });
      wrap.append(el('span', { color: style.positiveColor }, `${s.wins}W`), el('span', {}, '\u00a0-\u00a0'), el('span', { color: style.negativeColor }, `${s.losses}L`));
      return wrap;
    }
    case 'matches':
      return v ? el('div', { fontWeight: 600 }, String(v.matches)) : null;
    case 'winRate':
      return p ? el('div', { fontWeight: 600 }, `${p.winRate}%`) : null;
    case 'seasonWinRate':
      return v ? el('div', { fontWeight: 600 }, `${v.winRate}%`) : null;
    case 'kd':
      return v ? el('div', { fontWeight: 600 }, v.kd == null ? '–' : v.kd.toFixed(2)) : null;
    case 'hsPercent':
      return v ? el('div', { fontWeight: 600 }, v.hsPercent == null ? '–' : `${v.hsPercent}%`) : null;
    case 'adr':
      return v ? el('div', { fontWeight: 600 }, v.adr == null ? '–' : v.adr.toFixed(1)) : null;
    case 'currentStreak':
      return p ? el('div', { fontWeight: 600 }, String(p.currentStreak)) : null;
    case 'longestStreak':
      return p ? el('div', { fontWeight: 600 }, String(p.longestStreak)) : null;
    case 'recentResults': {
      if (!p) return null;
      // Ältere Server liefern noch keine recentMatches: dann nur Striche
      const recent = state?.recentMatches?.length ? state.recentMatches : p.recentResults.map((result) => ({ result, eloChange: null }));
      const row = el('div', { display: 'flex', gap: `${size * 0.25}px` });
      // Im Standard-Layout (x 240, Schrift 14) enden die fünf Kästen genau mit dem Elo-Balken bei x 400
      const [w, h] = [size * 2.086, size * 1.4];
      for (const m of recent) {
        const color = m.result === 'W' ? style.positiveColor : style.negativeColor;
        // Nur die Zahl ohne Vorzeichen, Sieg/Niederlage zeigt die Farbe. Ohne bekannte Elo-Änderung ein Strich.
        const text = m.eloChange == null ? '–' : String(Math.abs(m.eloChange));
        // Geschätzte Werte etwas blasser, bis die echte Zahl im Editor nachgetragen ist
        const textColor = m.estimated ? hexToRgba(color, 0.55) : color;
        row.appendChild(
          el(
            'div',
            {
              width: `${w}px`, height: `${h}px`, borderRadius: '4px', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: `${size * 0.95}px`, lineHeight: 1,
              background: hexToRgba(color, 0.25), color: textColor,
            },
            text,
          ),
        );
      }
      return row;
    }
    default:
      return null;
  }
}

const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/**
 * Wechsel Season ↔ All-Time: Der alte Wert rollt nach oben weg, der neue kommt von unten nach,
 * von links nach rechts leicht versetzt. Die Beschriftung blendet über.
 */
function rollIn(slot, before, index, accent) {
  const delay = index * 70;
  const box = el('div', { position: 'relative', overflow: 'hidden', paddingBottom: '0.08em', marginBottom: '-0.08em' });
  const current = slot.firstChild;
  box.appendChild(current);
  const old = el('div', { position: 'absolute', left: 0, top: 0, pointerEvents: 'none' });
  old.appendChild(before);
  box.appendChild(old);
  slot.appendChild(box);
  const timing = { duration: 520, delay, easing: EASE, fill: 'both' };
  old.animate([{ transform: 'translateY(0)', opacity: 1, filter: 'blur(0)' }, { transform: 'translateY(-90%)', opacity: 0, filter: 'blur(3px)' }], timing);
  current.animate(
    [
      { transform: 'translateY(90%)', opacity: 0, filter: 'blur(3px)', textShadow: `0 0 0 ${accent}` },
      { transform: 'translateY(0)', opacity: 1, filter: 'blur(0)', textShadow: `0 0 12px ${accent}`, offset: 0.7 },
      { transform: 'translateY(0)', opacity: 1, filter: 'blur(0)', textShadow: `0 0 0 ${hexToRgba(accent, 0)}` },
    ],
    { ...timing, duration: 760 },
  ).finished.then(() => {
    // Danach wieder ein schlichtes Element ohne Clipping
    if (box.isConnected) box.replaceWith(current);
  }, () => {});
}

function fadeLabel(label, beforeText, index) {
  const delay = index * 70;
  const old = el('span', { position: 'absolute', left: 0, top: 0 }, beforeText);
  const text = el('span', {}, label.textContent);
  label.style.position = 'relative';
  label.replaceChildren(text, old);
  old.animate([{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-60%)' }], { duration: 360, delay, easing: EASE, fill: 'both' });
  text.animate([{ opacity: 0, transform: 'translateY(60%)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 420, delay: delay + 120, easing: EASE, fill: 'both' });
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Zeichnet ein Overlay in `container`.
 * Mit `editable` bekommen die Widgets data-Attribute, damit der Editor sie verschieben kann.
 * Wechseln die Stats zwischen Season und All-Time, zeichnet sich das Overlay zum Wechsel selbst neu;
 * mit `redraw` übernimmt das stattdessen der Aufrufer (z. B. wenn er danach noch etwas anpasst).
 */
export function renderOverlay(container, overlay, state, options = {}) {
  const { editable = false, selectedId = null, redraw = null } = options;
  const { style } = overlay;
  loadFont(style.fontFamily);

  const period = statsPeriod(style, state);
  const before = container.__fwPeriod;
  const animate = before !== undefined && before !== period && !reducedMotion();
  container.__fwPeriod = period;
  clearTimeout(container.__fwTimer);
  if ((style.statsPeriod ?? 'cycle') === 'cycle' && state?.season) {
    const ms = cycleMs(style);
    container.__fwTimer = setTimeout(() => (redraw ? redraw() : renderOverlay(container, overlay, state, options)), ms - (Date.now() % ms) + 20);
  }
  const rolled = [];

  const root = el('div', {
    position: 'relative',
    width: `${style.width}px`,
    height: `${style.height}px`,
    background: hexToRgba(style.background, style.backgroundOpacity),
    borderRadius: `${style.borderRadius}px`,
    border: style.borderWidth ? `${style.borderWidth}px solid ${style.borderColor}` : 'none',
    boxSizing: 'border-box',
    fontFamily: `'${style.fontFamily}', sans-serif`,
    color: style.textColor,
    overflow: 'hidden',
  });

  for (const widget of overlay.widgets) {
    if (!widget.enabled) continue;
    const content = widgetContent(widget, style, state, period);
    const node = el('div', {
      position: 'absolute',
      left: `${widget.x}px`,
      top: `${widget.y}px`,
      fontSize: `${widget.fontSize}px`,
      lineHeight: 1.1,
      color: widget.color || style.textColor,
      whiteSpace: 'nowrap',
    });
    const labelText = widgetLabel(widget, period);
    let label = null;
    if (widget.showLabel && labelText) {
      label = el('div', { fontSize: '0.6em', color: style.labelColor, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }, labelText);
      node.appendChild(label);
    }
    const slot = el('div');
    slot.appendChild(content ?? el('div', { opacity: 0.4 }, '–'));
    node.appendChild(slot);
    if (animate && PERIOD_WIDGETS.has(widget.type)) rolled.push({ widget, slot, label });
    if (editable) {
      node.dataset.widgetId = widget.id;
      node.style.cursor = 'move';
      node.style.userSelect = 'none';
      if (widget.id === selectedId) node.style.outline = `1px dashed ${style.accentColor}`;
    }
    root.appendChild(node);
  }

  container.replaceChildren(root);
  rolled
    .sort((a, b) => a.widget.x - b.widget.x)
    .forEach(({ widget, slot, label }, i) => {
      const old = widgetContent(widget, style, state, before) ?? el('div', { opacity: 0.4 }, '–');
      rollIn(slot, old, i, widget.color || style.accentColor);
      const oldLabel = widgetLabel(widget, before);
      if (label && oldLabel !== label.textContent) fadeLabel(label, oldLabel, i);
    });
  return root;
}
