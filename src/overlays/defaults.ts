import { randomUUID } from 'node:crypto';
import type { Overlay, Widget, WidgetType } from './types.ts';

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
  seasonWinRate: 'Season Winrate',
  kd: 'K/D',
  hsPercent: 'HS %',
  adr: 'ADR',
  currentStreak: 'Siegesserie',
  longestStreak: 'Längste Serie',
  recentResults: 'Letzte Matches',
};

type Layout = Partial<Pick<Widget, 'x' | 'y' | 'fontSize' | 'enabled' | 'showLabel'>>;

const LAYOUT: Record<WidgetType, Layout> = {
  avatar: { x: 16, y: 16, fontSize: 56, enabled: true, showLabel: false },
  nickname: { x: 88, y: 18, fontSize: 22, enabled: true, showLabel: false },
  level: { x: 88, y: 50, fontSize: 20, enabled: true, showLabel: false },
  elo: { x: 124, y: 50, fontSize: 22, enabled: true, showLabel: false },
  eloProgress: { x: 16, y: 88, fontSize: 12, enabled: true, showLabel: false },
  eloToday: { x: 240, y: 18, fontSize: 18, enabled: true, showLabel: true },
  sessionRecord: { x: 320, y: 18, fontSize: 18, enabled: true, showLabel: true },
  matches: { x: 16, y: 120, fontSize: 16, enabled: false, showLabel: true },
  winRate: { x: 16, y: 120, fontSize: 16, enabled: true, showLabel: true },
  seasonWinRate: { x: 300, y: 120, fontSize: 16, enabled: false, showLabel: true },
  kd: { x: 100, y: 120, fontSize: 16, enabled: true, showLabel: true },
  hsPercent: { x: 170, y: 120, fontSize: 16, enabled: true, showLabel: true },
  adr: { x: 240, y: 120, fontSize: 16, enabled: false, showLabel: true },
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
  }));
}

export function createDefaultOverlay(name = 'Standard'): Overlay {
  return {
    id: randomUUID().slice(0, 8),
    ownerId: 'local',
    name,
    style: {
      width: 420,
      height: 170,
      background: '#14161a',
      backgroundOpacity: 0.85,
      borderRadius: 12,
      borderColor: '#ff5500',
      borderWidth: 0,
      fontFamily: 'Rajdhani',
      textColor: '#ffffff',
      labelColor: '#9aa0a6',
      accentColor: '#ff5500',
      positiveColor: '#32d74b',
      negativeColor: '#ff453a',
    },
    widgets: defaultWidgets(),
    updatedAt: new Date().toISOString(),
  };
}

/** Bringt gespeicherte Overlays auf den Stand neuer Versionen, ohne eigene Anpassungen zu überschreiben. */
export function upgradeOverlay(overlay: Overlay): Overlay {
  const known = new Set(overlay.widgets.map((w) => w.type));
  overlay.widgets.push(...defaultWidgets().filter((w) => !known.has(w.type)).map((w) => ({ ...w, enabled: false })));
  // Alte Standardposition der letzten Matches lag über der ADR
  const recent = overlay.widgets.find((w) => w.type === 'recentResults');
  if (recent && recent.x === 260 && recent.y === 124) {
    recent.x = LAYOUT.recentResults.x!;
    recent.y = LAYOUT.recentResults.y!;
    recent.autoPlace = true;
  }
  return overlay;
}

export { LABELS as WIDGET_LABELS };
