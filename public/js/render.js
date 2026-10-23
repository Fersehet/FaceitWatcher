// Gemeinsamer Renderer für das OBS-Overlay und die Editor-Vorschau.

const LEVEL_THRESHOLDS = [0, 501, 751, 901, 1051, 1201, 1351, 1531, 1751, 2001];
const SYSTEM_FONTS = ['Arial', 'Verdana', 'Tahoma', 'Segoe UI', 'Impact'];
export const FONTS = ['Rajdhani', 'Inter', 'Roboto', 'Montserrat', 'Oswald', 'Bebas Neue', 'Teko', 'Exo 2', ...SYSTEM_FONTS];

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
      const box = { width: `${size}px`, height: `${size}px`, borderRadius: '50%', border: `2px solid ${style.accentColor}` };
      if (p?.avatar) {
        const img = el('img', { ...box, objectFit: 'cover', display: 'block' });
        img.src = p.avatar;
        return img;
      }
      return el(
        'div',
        { ...box, background: style.accentColor, display: 'grid', placeItems: 'center', fontSize: `${size * 0.45}px`, fontWeight: 700, color: '#fff' },
        (p?.nickname ?? '?').charAt(0).toUpperCase(),
      );
    }
    case 'nickname':
      return p ? el('div', { fontWeight: 700 }, p.nickname) : null;
    case 'level': {
      if (!p) return null;
      return el(
        'div',
        {
          width: `${size * 1.4}px`, height: `${size * 1.4}px`, borderRadius: '50%', display: 'grid', placeItems: 'center',
          border: `${Math.max(2, size / 8)}px solid ${levelColor(p.level)}`, color: levelColor(p.level), fontWeight: 700, background: 'rgba(0,0,0,0.35)',
        },
        String(p.level),
      );
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
      const row = el('div', { display: 'flex', gap: `${size * 0.25}px` });
      for (const r of p.recentResults) {
        row.appendChild(
          el(
            'div',
            {
              width: `${size * 1.4}px`, height: `${size * 1.4}px`, borderRadius: '4px', display: 'grid', placeItems: 'center', fontWeight: 700,
              background: hexToRgba(r === 'W' ? style.positiveColor : style.negativeColor, 0.25), color: r === 'W' ? style.positiveColor : style.negativeColor,
            },
            r,
          ),
        );
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
