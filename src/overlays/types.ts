export const WIDGET_TYPES = [
  'avatar',
  'nickname',
  'level',
  'elo',
  'eloProgress',
  'eloToday',
  'sessionRecord',
  'matches',
  'winRate',
  'seasonWinRate',
  'kd',
  'hsPercent',
  'adr',
  'currentStreak',
  'longestStreak',
  'recentResults',
] as const;

export type WidgetType = (typeof WIDGET_TYPES)[number];

export interface Widget {
  id: string;
  type: WidgetType;
  enabled: boolean;
  x: number;
  y: number;
  fontSize: number;
  /** Leer = globale Textfarbe */
  color: string;
  label: string;
  showLabel: boolean;
  /** Vom Server gesetzt: der Editor soll das Widget auf einen freien Platz schieben. */
  autoPlace?: boolean;
}

export interface OverlayStyle {
  width: number;
  height: number;
  background: string;
  backgroundOpacity: number;
  borderRadius: number;
  borderColor: string;
  borderWidth: number;
  fontFamily: string;
  textColor: string;
  labelColor: string;
  accentColor: string;
  positiveColor: string;
  negativeColor: string;
}

export interface Overlay {
  id: string;
  /** Für die spätere Web-App mit mehreren Nutzern; lokal immer "local". */
  ownerId: string;
  name: string;
  style: OverlayStyle;
  widgets: Widget[];
  updatedAt: string;
}
