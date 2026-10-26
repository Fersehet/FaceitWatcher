// Statistik-Tab im Editor: Elo-Verlauf, aktuelle Season und Level-Grenzen.
// Die Zahlen kommen aus /api/stats, also aus allen gespeicherten Faceit-Matches (keine eigene Faceit-Abfrage).
// Matches ohne Elo (Hubs, Turniere) zählen mit, nur Ø pro Match rechnet der Server ohne sie.
import { locale, t } from './i18n.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';

/** Faceit CS2 Level-Grenzen und Farben wie auf der Website */
const LEVELS = [0, 501, 751, 901, 1051, 1201, 1351, 1531, 1751, 2001];
const LEVEL_COLORS = ['#b8c1d1', '#46d3b0', '#46d3b0', '#ffd84d', '#ffd84d', '#ffd84d', '#ffd84d', '#ff9a3d', '#ff9a3d', '#ff6b6b'];

let data = null;

const num = (n, digits = 0) => n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (n, digits = 0) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${num(Math.abs(n), digits)}`;
const trendClass = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const mapName = (map) => map.replace(/^de_/, '').replace(/^\w/, (c) => c.toUpperCase());
const shortDate = (iso) => new Date(iso).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' });

function svg(tag, attrs, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
}

function setValue(id, text, cls = '') {
  const node = $(id);
  node.textContent = text;
  node.className = cls;
}

export async function loadStats() {
  try {
    const res = await fetch('/api/stats?count=20', { cache: 'no-store' });
    if (res.ok) data = await res.json();
  } catch {}
  renderStats();
}

export function renderStats() {
  renderChart();
  renderSeason();
  renderLevels();
}

function renderChart() {
  const chart = $('eloChart');
  chart.replaceChildren();
  const points = data?.history ?? [];
  const matches = points.length - 1;
  $('chartHead').textContent = t('chartHead', { n: Math.max(matches, 0) });
  $('chartElo').textContent = data ? num(data.elo) : '–';
  setValue('chartChange', data && matches > 0 ? signed(data.change) : '', trendClass(data?.change ?? 0));
  setValue('trPeak', data && matches > 0 ? num(data.peak) : '–');
  setValue('trLow', data && matches > 0 ? num(data.low) : '–');
  // Ø nur über Matches mit Elo, ältere Server liefern eloMatches noch nicht
  const eloMatches = data?.eloMatches ?? matches;
  setValue('trAvg', data && eloMatches > 0 ? signed(data.avgPerMatch, 1) : '–', trendClass(data?.avgPerMatch ?? 0));

  const W = 600, H = 220, left = 44, right = 8, top = 22, bottom = 28;
  if (matches < 1) {
    svg('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'empty' }, chart).textContent = t(data ? 'noMatches' : 'noPlayer');
    chart.setAttribute('aria-label', t('noMatches'));
    $('chartNote').textContent = '';
    return;
  }

  // Wertebereich: Verlauf plus nahe Level-Grenze, auf runde Schritte erweitert
  let lo = data.low, hi = data.peak;
  const next = data.nextLevel;
  if (next && next.elo - hi <= 150) hi = next.elo;
  const step = [25, 50, 100, 200, 500].find((s) => (hi - lo) / s <= 4) ?? 1000;
  lo = Math.floor((lo - step / 4) / step) * step;
  hi = Math.ceil((hi + step / 4) / step) * step;
  const x = (i) => left + (i / matches) * (W - left - right);
  const y = (elo) => top + (1 - (elo - lo) / (hi - lo)) * (H - top - bottom);

  for (let v = lo; v <= hi; v += step) {
    svg('line', { x1: left, x2: W - right, y1: y(v), y2: y(v), class: 'grid-line' }, chart);
    svg('text', { x: left - 8, y: y(v) + 4, 'text-anchor': 'end' }, chart).textContent = String(v);
  }

  // Gestrichelt: Grenzen zum nächsten Level und zum Level darunter, sofern im Bild
  const levelLines = LEVELS.map((min, i) => ({ min, level: i + 1 })).filter((l) => l.min > 0 && l.min > lo && l.min < hi);
  for (const l of levelLines) {
    svg('line', { x1: left, x2: W - right, y1: y(l.min), y2: y(l.min), class: 'level-line' }, chart);
    svg('text', { x: W - right, y: y(l.min) - 6, 'text-anchor': 'end' }, chart).textContent = `Level ${l.level}`;
  }

  const defs = svg('defs', {}, chart);
  const grad = svg('linearGradient', { id: 'eloFill', x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
  svg('stop', { offset: 0, 'stop-color': '#ff5500', 'stop-opacity': 0.35 }, grad);
  svg('stop', { offset: 1, 'stop-color': '#ff5500', 'stop-opacity': 0 }, grad);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.elo).toFixed(1)}`).join('');
  svg('path', { d: `${line}L${x(matches)},${H - bottom}L${x(0)},${H - bottom}Z`, fill: 'url(#eloFill)' }, chart);
  svg('path', { d: line, fill: 'none', stroke: '#ff5500', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }, chart);

  points.forEach((p, i) => {
    if (!p.result) return;
    // Matches ohne Elo (Hub, Turnier) grau, sie lassen die Linie flach
    const color = p.ranked === false ? 'var(--muted)' : p.result === 'W' ? '#46d3b0' : '#ff5500';
    const dot = svg('circle', {
      cx: x(i), cy: y(p.elo), r: i === matches ? 5.5 : 3.5,
      fill: p.estimated ? 'var(--panel)' : color,
      stroke: color,
      class: `dot${p.estimated ? ' estimated' : ''}`,
    }, chart);
    const parts = [p.result, mapName(p.map), new Date(p.finishedAt).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })];
    const note = p.ranked === false ? ` (${t('noElo')})` : p.estimated ? ` (${t('estimated')})` : '';
    svg('title', {}, dot).textContent = `${parts.filter(Boolean).join(' · ')}\n${signed(p.change)} → ${num(p.elo)} Elo${note}`;
  });

  svg('text', { x: left, y: H - 8 }, chart).textContent = shortDate(points[1].finishedAt);
  svg('text', { x: W - right, y: H - 8, 'text-anchor': 'end' }, chart).textContent = shortDate(points[matches].finishedAt);
  chart.setAttribute('aria-label', t('chartAria', { n: matches, a: num(points[0].elo), b: num(data.elo) }));

  const notes = [t('chartSource')];
  if (points.some((p) => p.estimated)) notes.push(t('chartEstimated'));
  if (next) notes.push(t('chartLevelLine', { l: next.level, e: num(next.elo) }));
  $('chartNote').textContent = notes.join(' ');
}

function renderSeason() {
  const s = data?.season;
  $('seasonSince').textContent = s ? t('seasonSince', { d: shortDate(s.start) }) : '';
  setValue('ssElo', s?.eloChange != null ? signed(s.eloChange) : '–', trendClass(s?.eloChange ?? 0));
  setValue('ssWL', s ? `${s.wins} – ${s.losses}` : '–');
  setValue('ssWr', s?.matches ? `${s.winRate} %` : '–');
  setValue('ssKd', s?.kd != null ? num(s.kd, 2) : '–');
  setValue('ssMap', s?.bestMap ? mapName(s.bestMap) : '–');
  const next = data?.nextLevel;
  $('ssNextLabel').textContent = next || !data ? t('dtLvl', { l: next?.level ?? '' }).trim() : t('dtMaxLvl');
  setValue('ssNext', next ? `${num(next.missing)} Elo` : data ? `${num(data.elo)} Elo` : '–');

  let note = '';
  if (data && !s) note = t('seasonNoStart');
  else if (s) {
    // Eigene Daten erst ab dem ersten gespeicherten Stand, z. B. wenn FaceitWatchr nach Season-Start eingerichtet wurde
    const late = s.trackedSince && s.trackedSince.slice(0, 10) > s.start;
    const key = (late ? 'seasonNoteLate' : 'seasonNote') + (s.statsFromFaceit ? 'Faceit' : '');
    note = t(key, { n: s.trackedMatches, d: late ? shortDate(s.trackedSince) : '' });
  }
  $('seasonNote').textContent = note;
}

function renderLevels() {
  const tiles = $('levelTiles');
  tiles.setAttribute('aria-label', t('levelsAria'));
  tiles.replaceChildren(
    ...LEVELS.map((min, i) => {
      const tile = document.createElement('div');
      tile.setAttribute('role', 'listitem');
      tile.style.setProperty('--lc', LEVEL_COLORS[i]);
      if (data?.level === i + 1) tile.className = 'current';
      const max = LEVELS[i + 1];
      const range = max ? `${i ? min : 100}–${max - 1}` : `${min}+`;
      tile.innerHTML = `<b>${i + 1}</b><span>${range}</span>`;
      if (data?.level === i + 1) tile.title = t('levelCurrent');
      return tile;
    }),
  );
}
