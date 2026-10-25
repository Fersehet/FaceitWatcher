import { randomUUID } from 'node:crypto';
import type { Overlay, OverlayStyle, Widget, WidgetType } from './types.ts';

const LABELS: Record<WidgetType, string> = {
  avatar: 'Avatar',
  nickname: 'Nickname',
  level: 'Level',
  elo: 'Elo',
  eloProgress: 'Fortschritt zum nächsten Level',
  eloToday: 'Elo heute',
  sessionRecord: 'Heute',
  matches: 'Matches',
  winRate: 'Winrate',
  seasonWinRate: 'Season WR',
  kd: 'K/D',
  hsPercent: 'HS %',
  adr: 'ADR',
  currentStreak: 'Siegesserie',
  longestStreak: 'Längste Serie',
  recentResults: 'Letzte Matches',
};

/** Beschriftung der Season WR, während das Overlay die All-Time-Werte zeigt */
const ALL_TIME_WR = 'All-Time WR';

type Layout = Partial<Pick<Widget, 'x' | 'y' | 'fontSize' | 'enabled' | 'showLabel'>>;

// Die fünf Stats unten verteilen sich gleichmäßig über die Breite des Fortschrittsbalkens (x 16 bis 400)
const LAYOUT: Record<WidgetType, Layout> = {
  avatar: { x: 16, y: 16, fontSize: 56, enabled: true, showLabel: false },
  nickname: { x: 90, y: 11, fontSize: 22, enabled: true, showLabel: false },
  level: { x: 88, y: 42, fontSize: 20, enabled: true, showLabel: false },
  elo: { x: 124, y: 46, fontSize: 22, enabled: true, showLabel: false },
  eloProgress: { x: 16, y: 88, fontSize: 12, enabled: true, showLabel: false },
  eloToday: { x: 240, y: 18, fontSize: 18, enabled: true, showLabel: true },
  sessionRecord: { x: 336, y: 32, fontSize: 18, enabled: true, showLabel: false },
  matches: { x: 353, y: 120, fontSize: 16, enabled: true, showLabel: true },
  winRate: { x: 300, y: 120, fontSize: 16, enabled: false, showLabel: true },
  seasonWinRate: { x: 16, y: 120, fontSize: 16, enabled: true, showLabel: true },
  kd: { x: 120, y: 120, fontSize: 16, enabled: true, showLabel: true },
  hsPercent: { x: 197, y: 120, fontSize: 16, enabled: true, showLabel: true },
  adr: { x: 275, y: 120, fontSize: 16, enabled: true, showLabel: true },
  currentStreak: { x: 240, y: 120, fontSize: 16, enabled: false, showLabel: true },
  longestStreak: { x: 320, y: 120, fontSize: 16, enabled: false, showLabel: true },
  recentResults: { x: 240, y: 58, fontSize: 14, enabled: true, showLabel: false },
};

export function defaultWidgets(): Widget[] {
  return (Object.keys(LAYOUT) as WidgetType[]).map((type) => ({
    id: type,
    type,
    enabled: false,
    x: 0,
    y: 0,
    fontSize: 16,
    color: '',
    label: LABELS[type],
    showLabel: true,
    ...LAYOUT[type],
    ...(type === 'seasonWinRate' ? { altLabel: ALL_TIME_WR } : {}),
  }));
}

export function defaultStyle(): OverlayStyle {
  return {
    width: 420,
    height: 170,
    background: '#14161a',
    backgroundOpacity: 0.85,
    borderRadius: 12,
    borderColor: '#ff5500',
    borderWidth: 0,
    fontFamily: 'Geist',
    textColor: '#ffffff',
    labelColor: '#9aa0a6',
    accentColor: '#ff5500',
    positiveColor: '#32d74b',
    negativeColor: '#ff453a',
    levelIcon: 'badge',
    showAvatarFrame: true,
    statsPeriod: 'cycle',
    statsCycleSeconds: 10,
  };
}


export function createDefaultOverlay(name = 'Standard'): Overlay {
  return {
    id: randomUUID().slice(0, 8),
    ownerId: 'local',
    name,
    style: defaultStyle(),
    widgets: defaultWidgets(),
    updatedAt: new Date().toISOString(),
  };
}

/** Bringt gespeicherte Overlays auf den Stand neuer Versionen, ohne eigene Anpassungen zu überschreiben. */
export function upgradeOverlay(overlay: Overlay): Overlay {
  overlay.style = { ...defaultStyle(), ...overlay.style };
  const known = new Set(overlay.widgets.map((w) => w.type));
  overlay.widgets.push(...defaultWidgets().filter((w) => !known.has(w.type)).map((w) => ({ ...w, enabled: false })));
  // Alte Standardposition der letzten Matches lag über der ADR
  const recent = overlay.widgets.find((w) => w.type === 'recentResults');
  if (recent && recent.x === 260 && recent.y === 124) {
    recent.x = LAYOUT.recentResults.x!;
    recent.y = LAYOUT.recentResults.y!;
    recent.autoPlace = true;
  }
  // Früher stand über der Tagesbilanz die Beschriftung „Heute“; ohne sie rutscht der Wert auf die Höhe von „Elo heute“
  const record = overlay.widgets.find((w) => w.type === 'sessionRecord');
  if (record && record.x === 320 && record.y === 18 && record.showLabel) {
    record.showLabel = false;
    record.y = LAYOUT.sessionRecord.y!;
  }
  // Level und Elo standen im Standard-Layout zuerst 4 px weiter links
  const level = overlay.widgets.find((w) => w.type === 'level');
  const elo = overlay.widgets.find((w) => w.type === 'elo');
  if (level && elo && level.x === 84 && level.y === 42 && elo.x === 120 && elo.y === 46) {
    level.x = LAYOUT.level.x!;
    elo.x = LAYOUT.elo.x!;
  }
  // Season WR wechselt jetzt mit All-Time und braucht dafür eine zweite Beschriftung
  const season = overlay.widgets.find((w) => w.type === 'seasonWinRate');
  if (season && season.altLabel === undefined) season.altLabel = ALL_TIME_WR;
  // Die Tagesbilanz endet seit der festen Breite bei x 336 bündig mit dem Elo-Balken
  if (record && record.x === 320 && record.y === 32) record.x = LAYOUT.sessionRecord.x!;
  return overlay;
}

/**
 * Ersetzt die Gesamt-Winrate durch die Season-Winrate an derselben Stelle.
 * Gibt true zurück, wenn sich etwas geändert hat.
 */
export function useSeasonWinRate(overlay: Overlay): boolean {
  const total = overlay.widgets.find((w) => w.type === 'winRate');
  const season = overlay.widgets.find((w) => w.type === 'seasonWinRate');
  if (!total?.enabled || !season || season.enabled) return false;
  Object.assign(season, {
    enabled: true,
    x: total.x,
    y: total.y,
    fontSize: total.fontSize,
    color: total.color,
    showLabel: total.showLabel,
    label: season.label === 'Season Winrate' ? LABELS.seasonWinRate : season.label,
  });
  total.enabled = false;
  return true;
}

export { LABELS as WIDGET_LABELS };
