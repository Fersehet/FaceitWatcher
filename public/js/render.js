// Gemeinsamer Renderer für das OBS-Overlay und die Editor-Vorschau.

const LEVEL_THRESHOLDS = [0, 501, 751, 901, 1051, 1201, 1351, 1531, 1751, 2001];
const SYSTEM_FONTS = ['Arial', 'Verdana', 'Tahoma', 'Segoe UI', 'Impact'];
export const FONTS = ['Play', 'Rajdhani', 'Inter', 'Roboto', 'Montserrat', 'Oswald', 'Bebas Neue', 'Teko', 'Exo 2', ...SYSTEM_FONTS];

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

/** Baut den Inhalt eines einzelnen Widgets. Gibt null zurück, wenn (noch) keine Daten da sind. */
function widgetContent(widget, style, state) {
  const p = state?.player;
  const s = state?.session;
  const size = widget.fontSize;
  const color = widget.color || style.textColor;

  switch (widget.type) {
    case 'avatar': {
      const frame = style.showAvatarFrame && p?.avatarFrame ? p.avatarFrame : '';
      // Mit Faceit-Rahmen übernimmt der Rahmen die Umrandung
      const box = { width: `${size}px`, height: `${size}px`, borderRadius: '50%', border: frame ? 'none' : `2px solid ${style.accentColor}`, boxSizing: 'border-box' };
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
      wrap.appendChild(
        el('div', { marginTop: '3px', color: style.labelColor, display: 'flex', justifyContent: 'space-between' }, next ? `${next - p.elo} bis Level ${p.level + 1}` : `Level 10, +${p.elo - min}`),
      );
      return wrap;
    }
    case 'eloToday': {
      if (!s) return null;
      const c = s.eloChange > 0 ? style.positiveColor : s.eloChange < 0 ? style.negativeColor : color;
      return el('div', { fontWeight: 700, color: widget.color || c }, signed(s.eloChange));
    }
    case 'sessionRecord': {
      if (!s) return null;
      const wrap = el('div', { fontWeight: 700 });
      wrap.append(el('span', { color: style.positiveColor }, `${s.wins}W`), el('span', {}, ' - '), el('span', { color: style.negativeColor }, `${s.losses}L`));
      return wrap;
    }
    case 'matches':
      return p ? el('div', { fontWeight: 600 }, String(p.matches)) : null;
    case 'winRate':
      return p ? el('div', { fontWeight: 600 }, `${p.winRate}%`) : null;
    case 'seasonWinRate':
      return state?.season ? el('div', { fontWeight: 600 }, `${state.season.winRate}%`) : null;
    case 'kd':
      return p ? el('div', { fontWeight: 600 }, p.kd.toFixed(2)) : null;
    case 'hsPercent':
      return p ? el('div', { fontWeight: 600 }, `${p.hsPercent}%`) : null;
    case 'adr':
      return p ? el('div', { fontWeight: 600 }, p.adr == null ? '–' : p.adr.toFixed(1)) : null;
    case 'currentStreak':
      return p ? el('div', { fontWeight: 600 }, String(p.currentStreak)) : null;
    case 'longestStreak':
      return p ? el('div', { fontWeight: 600 }, String(p.longestStreak)) : null;
    case 'recentResults': {
      if (!p) return null;
      // Ältere Server liefern noch keine recentMatches: dann nur W/L ohne Elo
      const recent = state?.recentMatches?.length ? state.recentMatches : p.recentResults.map((result) => ({ result, eloChange: null }));
      const row = el('div', { display: 'flex', gap: `${size * 0.4}px` });
      for (const m of recent) {
        const color = m.result === 'W' ? style.positiveColor : style.negativeColor;
        const text = m.eloChange == null ? m.result : `${m.eloChange > 0 ? '+' : ''}${m.eloChange}`;
        const cell = el('div', { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: `${size * 0.25}px`, minWidth: `${size * 1.8}px` });
        cell.append(
          el('div', { fontWeight: 700, color, lineHeight: 1 }, text),
          el('div', { alignSelf: 'stretch', height: `${Math.max(2, size * 0.2)}px`, borderRadius: '2px', background: color }),
        );
        row.appendChild(cell);
      }
      return row;
    }
    default:
      return null;
  }
}

/**
 * Zeichnet ein Overlay in `container`.
 * Mit `editable` bekommen die Widgets data-Attribute, damit der Editor sie verschieben kann.
 */
export function renderOverlay(container, overlay, state, { editable = false, selectedId = null } = {}) {
  const { style } = overlay;
  loadFont(style.fontFamily);

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
    const content = widgetContent(widget, style, state);
    const node = el('div', {
      position: 'absolute',
      left: `${widget.x}px`,
      top: `${widget.y}px`,
      fontSize: `${widget.fontSize}px`,
      lineHeight: 1.1,
      color: widget.color || style.textColor,
      whiteSpace: 'nowrap',
    });
    if (widget.showLabel && widget.label) {
      node.appendChild(el('div', { fontSize: '0.6em', color: style.labelColor, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }, widget.label));
    }
    node.appendChild(content ?? el('div', { opacity: 0.4 }, '–'));
    if (editable) {
      node.dataset.widgetId = widget.id;
      node.style.cursor = 'move';
      node.style.userSelect = 'none';
      if (widget.id === selectedId) node.style.outline = `1px dashed ${style.accentColor}`;
    }
    root.appendChild(node);
  }

  container.replaceChildren(root);
  return root;
}
