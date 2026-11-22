import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const CLI_PATH = process.env.FIGCRAFT_CLI || 'C:\\Program Files\\FigCraft\\figcraft-cli.exe';
const OUT_FILE = path.join(ROOT, 'design', 'bpwi-design-system.figcraft');

const COLOR_TOKENS = [
  { name: 'bg', light: '#f1f5f9', dark: '#0b1120', hc: '#f1f5f9', desc: 'Page canvas background' },
  { name: 'surface', light: '#ffffff', dark: '#111827', hc: '#ffffff', desc: 'Card & sheet surface' },
  { name: 'surface-muted', light: '#f8fafc', dark: '#1e293b', hc: '#f8fafc', desc: 'Subtle track & muted surface' },
  { name: 'border', light: '#cbd5e1', dark: '#475569', hc: '#0f172a', desc: 'Primary control & container border' },
  { name: 'border-light', light: '#e2e8f0', dark: '#334155', hc: '#334155', desc: 'Hairline divider border' },
  { name: 'text', light: '#0f172a', dark: '#f8fafc', hc: '#000000', desc: 'Primary foreground text' },
  { name: 'text-secondary', light: '#475569', dark: '#cbd5e1', hc: '#0f172a', desc: 'Secondary label text' },
  { name: 'text-muted', light: '#64748b', dark: '#94a3b8', hc: '#1e293b', desc: 'Muted caption text' },
  { name: 'primary', light: '#0369a1', dark: '#0277bd', hc: '#075985', desc: 'Waterworks primary CTA surface' },
  { name: 'primary-hover', light: '#075985', dark: '#0369a1', hc: '#0c4a6e', desc: 'Primary CTA hover surface' },
  { name: 'primary-fg', light: '#ffffff', dark: '#ffffff', hc: '#ffffff', desc: 'Primary CTA foreground' },
  { name: 'accent', light: '#0369a1', dark: '#38bdf8', hc: '#075985', desc: 'Interactive link & focus ring' },
  { name: 'teal', light: '#0f766e', dark: '#2dd4bf', hc: '#0f766e', desc: 'PM marker accent' },
  { name: 'violet', light: '#7c3aed', dark: '#a78bfa', hc: '#7c3aed', desc: 'On-call indicator accent' },
  { name: 'danger', light: '#b91c1c', dark: '#f87171', hc: '#9f1239', desc: 'Destructive text & border' },
  { name: 'ok-bg', light: '#dcfce7', dark: '#14532d', hc: '#dcfce7', desc: 'Verified / passing fill' },
  { name: 'ok-fg', light: '#166534', dark: '#86efac', hc: '#14532d', desc: 'Verified / passing foreground' },
  { name: 'ok-border', light: '#bbf7d0', dark: '#16a34a', hc: '#166534', desc: 'Verified / passing border' },
  { name: 'warn-bg', light: '#fef3c7', dark: '#422006', hc: '#fef3c7', desc: 'Warning / offline queue fill' },
  { name: 'warn-fg', light: '#92400e', dark: '#fde68a', hc: '#78350f', desc: 'Warning foreground' },
  { name: 'warn-border', light: '#fde68a', dark: '#854d0e', hc: '#92400e', desc: 'Warning border' },
  { name: 'danger-bg', light: '#ffe4e6', dark: '#4c0519', hc: '#ffe4e6', desc: 'Error / overdue fill' },
  { name: 'danger-fg', light: '#9f1239', dark: '#fda4af', hc: '#881337', desc: 'Error foreground' },
  { name: 'danger-border', light: '#fecaca', dark: '#be123c', hc: '#9f1239', desc: 'Error border' },
  { name: 'info-bg', light: '#dbeafe', dark: '#1e3a8a', hc: '#dbeafe', desc: 'Info fill' },
  { name: 'info-fg', light: '#1e40af', dark: '#93c5fd', hc: '#1e3a8a', desc: 'Info foreground' },
  { name: 'info-border', light: '#bfdbfe', dark: '#2563eb', hc: '#1e40af', desc: 'Info border' },
  { name: 'violet-bg', light: '#f3e8ff', dark: '#3b0764', hc: '#f3e8ff', desc: 'Standby fill' },
  { name: 'violet-fg', light: '#6b21a8', dark: '#ddd6fe', hc: '#581c87', desc: 'Standby foreground' },
  { name: 'violet-border', light: '#d8b4fe', dark: '#7c3aed', hc: '#6b21a8', desc: 'Standby border' },
  { name: 'status-pending', light: '#d97706', dark: '#f59e0b', hc: '#b45309', desc: 'Pending counter dot/badge' },
  { name: 'status-alert', light: '#dc2626', dark: '#ef4444', hc: '#b91c1c', desc: 'Urgent admin badge' },
];

const SCALE_NUMBERS = [
  { name: 'space/1', value: 4, desc: 'Tight gap' },
  { name: 'space/2', value: 8, desc: 'Control & chip gap' },
  { name: 'space/3', value: 12, desc: 'Card padding & grid gap' },
  { name: 'space/4', value: 16, desc: 'Section gap' },
  { name: 'space/5', value: 20, desc: 'Modal sheet padding' },
  { name: 'space/6', value: 24, desc: 'Login container padding' },
  { name: 'radius/sm', value: 6, desc: 'Tab / small chip radius' },
  { name: 'radius/md', value: 8, desc: 'Button / input / alert radius' },
  { name: 'radius/lg', value: 10, desc: 'Card radius' },
  { name: 'radius/sheet', value: 14, desc: 'Modal sheet radius' },
  { name: 'radius/pill', value: 999, desc: 'Pill badge radius' },
  { name: 'text/xs', value: 11, desc: 'Badge & label uppercase' },
  { name: 'text/sm', value: 12, desc: 'Subtitle & helper text' },
  { name: 'text/base', value: 13.5, desc: 'Body & form input text' },
  { name: 'text/md', value: 15, desc: 'Card & section heading' },
  { name: 'text/lg', value: 18, desc: 'Page h1 title' },
  { name: 'text/xl', value: 22, desc: 'KPI metric value' },
];

function runFigcraft(commands, inFile = null) {
  const scriptPath = path.join(os.tmpdir(), `figcraft-ds-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(scriptPath, JSON.stringify(commands, null, 2), 'utf8');
  const args = ['run', '--no-system-fonts'];
  if (inFile) args.push('--in', inFile);
  args.push('--out', OUT_FILE, scriptPath);

  const res = spawnSync(CLI_PATH, args, { encoding: 'utf8' });
  fs.unlinkSync(scriptPath);

  if (res.status !== 0) {
    throw new Error(`figcraft-cli exited with ${res.status}:\n${res.stderr}\n${res.stdout}`);
  }
  const lines = res.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const failed = lines.find((l) => !l.ok);
  if (failed) {
    throw new Error(`FigCraft step failed: ${JSON.stringify(failed)}`);
  }
  return lines;
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

// Pass 1: Variable collections + top-level artboards
const pass1 = [
  { command: 'variable.createCollection', params: { name: 'BPWI Colors', modes: ['Light', 'Dark', 'High Contrast'] } },
  ...COLOR_TOKENS.map((t) => ({
    command: 'variable.create',
    params: {
      collection: 'BPWI Colors',
      name: t.name,
      type: 'color',
      values: { Light: t.light, Dark: t.dark, 'High Contrast': t.hc },
      description: t.desc,
    },
  })),
  { command: 'variable.createCollection', params: { name: 'BPWI Scale', modes: ['Default'] } },
  ...SCALE_NUMBERS.map((s) => ({
    command: 'variable.create',
    params: { collection: 'BPWI Scale', name: s.name, type: 'number', value: s.value, description: s.desc },
  })),
  {
    command: 'frame.create',
    params: {
      name: '01 · Color Tokens (Light & Dark)',
      x: 0,
      y: 0,
      width: 960,
      height: 820,
      props: { fill: { $var: 'bg' }, padding: 24, gap: 16, layout: 'vertical', sizingV: 'hug' },
    },
  },
  {
    command: 'frame.create',
    params: {
      name: '02 · Typography & Radius Scale',
      x: 1020,
      y: 0,
      width: 620,
      height: 540,
      props: { fill: { $var: 'surface' }, stroke: { $var: 'border-light' }, strokeWeight: 1, padding: 24, gap: 14, layout: 'vertical', sizingV: 'hug', cornerRadius: 10 },
    },
  },
  {
    command: 'frame.create',
    params: {
      name: '03 · UI Components & Variants',
      x: 1700,
      y: 0,
      width: 920,
      height: 820,
      props: { fill: { $var: 'bg' }, padding: 24, gap: 20, layout: 'vertical', sizingV: 'hug' },
    },
  },
];

const r1 = runFigcraft(pass1);
const artboards = r1.filter((x) => x.command === 'frame.create').map((x) => x.result.id);
const [tokensBoardId, typeBoardId, compsBoardId] = artboards;

// Pass 2: Build swatch panels (Light & Dark), typography specimens, and component variant frames
const SWATCH_KEYS = ['bg', 'surface', 'surface-muted', 'border', 'text', 'primary', 'accent', 'ok-bg', 'ok-fg', 'warn-bg', 'warn-fg', 'danger-bg', 'danger-fg', 'info-bg', 'info-fg', 'violet-bg'];
const TYPE_SPECS = [
  { style: 'Heading/Page', label: 'Page Title — Daily Employee Activity Monitor', size: 18, weight: 'Extra Bold' },
  { style: 'Heading/Section', label: 'Section Heading — Daily Field Footprints', size: 15, weight: 'Bold' },
  { style: 'Metric/KPI', label: '24.85 km · EST. ROAD DISTANCE', size: 22, weight: 'Extra Bold' },
  { style: 'Body/Base', label: 'Body Base — Schedule-linked field logs and PM tracking', size: 13.5, weight: 'Regular' },
  { style: 'Body/Secondary', label: 'Secondary Metadata — Updated 5 min ago', size: 12, weight: 'Regular' },
  { style: 'Label/Caption', label: 'BADGE / UPPERCASE LABEL', size: 11, weight: 'Bold' },
];
const BADGE_VARIANTS = [
  { variant: 'Tone=Neutral', sample: 'Neutral', bg: 'surface-muted', fg: 'text-secondary', border: 'border' },
  { variant: 'Tone=Ok', sample: 'Verified', bg: 'ok-bg', fg: 'ok-fg', border: 'ok-border' },
  { variant: 'Tone=Warn', sample: 'Pending', bg: 'warn-bg', fg: 'warn-fg', border: 'warn-border' },
  { variant: 'Tone=Danger', sample: 'Overdue', bg: 'danger-bg', fg: 'danger-fg', border: 'danger-border' },
  { variant: 'Tone=Info', sample: 'On Duty', bg: 'info-bg', fg: 'info-fg', border: 'info-border' },
  { variant: 'Tone=Violet', sample: 'Standby', bg: 'violet-bg', fg: 'violet-fg', border: 'violet-border' },
];
const ALERT_VARIANTS = [
  { variant: 'Tone=Ok', sample: '✓ Changes saved cleanly to schedule.', bg: 'ok-bg', fg: 'ok-fg', border: 'ok-border' },
  { variant: 'Tone=Warn', sample: '3 activity logs queued offline.', bg: 'warn-bg', fg: 'warn-fg', border: 'warn-border' },
  { variant: 'Tone=Danger', sample: 'Sign-in session expired. Please sign in again.', bg: 'danger-bg', fg: 'danger-fg', border: 'danger-border' },
  { variant: 'Tone=Info', sample: 'Viewing straight-line Haversine baseline.', bg: 'info-bg', fg: 'info-fg', border: 'info-border' },
];

const pass2 = [
  { command: 'text.create', params: { parent: tokensBoardId, text: 'BPWI Waterworks Design Tokens (Light & Dark)', x: 0, y: 0, props: { fontSize: 18, fontStyle: 'Bold', fill: { $var: 'text' } } } },
  { command: 'frame.create', params: { parent: tokensBoardId, name: 'Mode Preview · Light', x: 0, y: 0, width: 912, height: 220, props: { fill: { $var: 'surface' }, stroke: { $var: 'border-light' }, strokeWeight: 1, cornerRadius: 10, padding: 16, gap: 10, layout: 'horizontal', wrap: true, sizingH: 'fixed', sizingV: 'hug' } } },
  { command: 'frame.create', params: { parent: tokensBoardId, name: 'Mode Preview · Dark', x: 0, y: 0, width: 912, height: 220, props: { fill: { $var: 'surface' }, stroke: { $var: 'border-light' }, strokeWeight: 1, cornerRadius: 10, padding: 16, gap: 10, layout: 'horizontal', wrap: true, sizingH: 'fixed', sizingV: 'hug' } } },
  { command: 'text.create', params: { parent: typeBoardId, text: 'BPWI Typography Scale', x: 0, y: 0, props: { fontSize: 18, fontStyle: 'Bold', fill: { $var: 'text' } } } },
  ...TYPE_SPECS.map((sp) => ({
    command: 'text.create',
    params: { parent: typeBoardId, name: sp.style, text: sp.label, x: 0, y: 0, props: { fontSize: sp.size, fontStyle: sp.weight, fill: { $var: 'text' } } },
  })),
  { command: 'text.create', params: { parent: compsBoardId, text: 'Shared UI Components & Variants (Code Connected)', x: 0, y: 0, props: { fontSize: 18, fontStyle: 'Bold', fill: { $var: 'text' } } } },
  ...BADGE_VARIANTS.map((b, i) => ({
    command: 'frame.create',
    params: {
      parent: compsBoardId,
      name: b.variant,
      x: i * 110,
      y: 0,
      width: 96,
      height: 26,
      props: { fill: { $var: b.bg }, stroke: { $var: b.border }, strokeWeight: 1, cornerRadius: 999, padding: [3, 10, 3, 10], layout: 'horizontal', mainAlign: 'center', crossAlign: 'center', sizingH: 'hug', sizingV: 'hug' },
    },
  })),
  ...ALERT_VARIANTS.map((a, i) => ({
    command: 'frame.create',
    params: {
      parent: compsBoardId,
      name: a.variant,
      x: 0,
      y: i * 48,
      width: 420,
      height: 40,
      props: { fill: { $var: a.bg }, stroke: { $var: a.border }, strokeWeight: 1, cornerRadius: 8, padding: [9, 14, 9, 14], layout: 'horizontal', crossAlign: 'center', gap: 12, sizingV: 'hug' },
    },
  })),
  {
    command: 'frame.create',
    params: {
      parent: compsBoardId,
      name: 'StatCard',
      x: 0,
      y: 0,
      width: 240,
      height: 92,
      props: { fill: { $var: 'surface' }, stroke: { $var: 'border-light' }, strokeWeight: 1, cornerRadius: 10, padding: 12, gap: 4, layout: 'vertical', sizingV: 'hug' },
    },
  },
  {
    command: 'frame.create',
    params: {
      parent: compsBoardId,
      name: 'SegmentedTabs',
      x: 0,
      y: 0,
      width: 340,
      height: 44,
      props: { fill: { $var: 'surface-muted' }, stroke: { $var: 'border-light' }, strokeWeight: 1, cornerRadius: 10, padding: 4, gap: 4, layout: 'horizontal', crossAlign: 'center', sizingH: 'hug', sizingV: 'hug' },
    },
  },
  {
    command: 'frame.create',
    params: {
      parent: compsBoardId,
      name: 'EmptyState',
      x: 0,
      y: 0,
      width: 440,
      height: 160,
      props: { fill: { $var: 'surface-muted' }, stroke: { $var: 'border' }, strokeWeight: 1, dashes: [6, 4], cornerRadius: 8, padding: 20, gap: 6, layout: 'vertical', mainAlign: 'center', crossAlign: 'center' },
    },
  },
];

const r2 = runFigcraft(pass2, OUT_FILE);
const createdFrames2 = r2.filter((x) => x.command === 'frame.create').map((x) => x.result.id);
const createdTexts2 = r2.filter((x) => x.command === 'text.create').map((x) => x.result.id);

const lightPanelId = createdFrames2[0];
const darkPanelId = createdFrames2[1];
const badgeFrameIds = createdFrames2.slice(2, 2 + BADGE_VARIANTS.length);
const alertFrameIds = createdFrames2.slice(2 + BADGE_VARIANTS.length, 2 + BADGE_VARIANTS.length + ALERT_VARIANTS.length);
const statCardFrameId = createdFrames2[2 + BADGE_VARIANTS.length + ALERT_VARIANTS.length];
const segTabsFrameId = createdFrames2[3 + BADGE_VARIANTS.length + ALERT_VARIANTS.length];
const emptyStateFrameId = createdFrames2[4 + BADGE_VARIANTS.length + ALERT_VARIANTS.length];
const typeTextIds = createdTexts2.slice(1, 1 + TYPE_SPECS.length);

// Pass 3: Bind dark mode on darkPanel, add swatches & component inner layers, create styles & convert to components
const pass3 = [
  { command: 'variable.setMode', params: { ids: [darkPanelId], collection: 'BPWI Colors', mode: 'Dark' } },
  ...SWATCH_KEYS.flatMap((key) => [
    {
      command: 'frame.create',
      params: { parent: lightPanelId, name: key, width: 100, height: 52, props: { fill: { $var: key }, stroke: { $var: 'border' }, strokeWeight: 1, cornerRadius: 8 } },
    },
    {
      command: 'frame.create',
      params: { parent: darkPanelId, name: `${key} (Dark)`, width: 100, height: 52, props: { fill: { $var: key }, stroke: { $var: 'border' }, strokeWeight: 1, cornerRadius: 8 } },
    },
  ]),
  ...TYPE_SPECS.map((sp, i) => ({
    command: 'style.create',
    params: { type: 'text', name: sp.style, from: typeTextIds[i] },
  })),
  ...BADGE_VARIANTS.map((b, i) => ({
    command: 'text.create',
    params: { parent: badgeFrameIds[i], text: b.sample, x: 0, y: 0, props: { fontSize: 11, fontStyle: 'Bold', fill: { $var: b.fg } } },
  })),
  ...ALERT_VARIANTS.map((a, i) => ({
    command: 'text.create',
    params: { parent: alertFrameIds[i], text: a.sample, x: 0, y: 0, props: { fontSize: 12.5, fill: { $var: a.fg } } },
  })),
  { command: 'text.create', params: { parent: statCardFrameId, name: 'Label', text: 'EST. ROAD DISTANCE', x: 0, y: 0, props: { fontSize: 11.5, fontStyle: 'Bold', fill: { $var: 'text-secondary' } } } },
  { command: 'text.create', params: { parent: statCardFrameId, name: 'Value', text: '24.85 km', x: 0, y: 0, props: { fontSize: 22, fontStyle: 'Extra Bold', fill: { $var: 'text' } } } },
  { command: 'text.create', params: { parent: statCardFrameId, name: 'Subtitle', text: 'Driving OSRM route', x: 0, y: 0, props: { fontSize: 11.5, fill: { $var: 'text-secondary' } } } },
  { command: 'frame.create', params: { parent: segTabsFrameId, name: 'Active Tab', x: 0, y: 0, width: 110, height: 36, props: { fill: { $var: 'surface' }, stroke: { $var: 'border-light' }, strokeWeight: 1, cornerRadius: 8, padding: [6, 12, 6, 12], layout: 'horizontal', mainAlign: 'center', crossAlign: 'center' } } },
  { command: 'frame.create', params: { parent: segTabsFrameId, name: 'Inactive Tab', x: 114, y: 0, width: 110, height: 36, props: { fill: 'none', cornerRadius: 8, padding: [6, 12, 6, 12], layout: 'horizontal', mainAlign: 'center', crossAlign: 'center' } } },
  { command: 'text.create', params: { parent: emptyStateFrameId, name: 'Title', text: 'No GPS footprints recorded', x: 0, y: 0, props: { fontSize: 13, fontStyle: 'Bold', fill: { $var: 'text' } } } },
  { command: 'text.create', params: { parent: emptyStateFrameId, name: 'Description', text: 'Operators capture GPS inside Activity Logger.', x: 0, y: 0, props: { fontSize: 12.5, fill: { $var: 'text-secondary' } } } },
  { command: 'component.createMultiple', params: { ids: [...badgeFrameIds, ...alertFrameIds, statCardFrameId, segTabsFrameId, emptyStateFrameId] } },
];

const r3 = runFigcraft(pass3, OUT_FILE);
const createdTabFrames = r3.filter((x) => x.command === 'frame.create').map((x) => x.result.id);
const activeTabId = createdTabFrames[createdTabFrames.length - 2];
const inactiveTabId = createdTabFrames[createdTabFrames.length - 1];
const firstLightPrimaryIdx = SWATCH_KEYS.indexOf('primary') * 2;
const primarySwatchId = createdTabFrames[firstLightPrimaryIdx];
const surfaceSwatchId = createdTabFrames[SWATCH_KEYS.indexOf('surface') * 2];

// Pass 4: Populate SegmentedTab labels, combine Badge & AlertBanner variants, create Paint Styles
const pass4 = [
  { command: 'text.create', params: { parent: activeTabId, text: 'Active View', x: 0, y: 0, props: { fontSize: 12.5, fontStyle: 'Bold', fill: { $var: 'text' } } } },
  { command: 'text.create', params: { parent: inactiveTabId, text: 'Secondary View', x: 0, y: 0, props: { fontSize: 12.5, fontStyle: 'Bold', fill: { $var: 'text-secondary' } } } },
  { command: 'style.create', params: { type: 'paint', name: 'Brand/Primary', from: primarySwatchId } },
  { command: 'style.create', params: { type: 'paint', name: 'Surface/Base', from: surfaceSwatchId } },
  { command: 'component.combineVariants', params: { ids: badgeFrameIds } },
  { command: 'component.combineVariants', params: { ids: alertFrameIds } },
];

const r4 = runFigcraft(pass4, OUT_FILE);
const [badgeSetId, alertSetId] = r4.filter((x) => x.command === 'component.combineVariants').map((x) => x.result.id);

// Pass 5: Name Component Sets cleanly & apply Auto Layout to variant sets
runFigcraft(
  [
    { command: 'node.set', params: { ids: [badgeSetId], name: 'Badge', layout: 'horizontal', gap: 12, padding: 16, wrap: true } },
    { command: 'node.set', params: { ids: [alertSetId], name: 'AlertBanner', layout: 'vertical', gap: 10, padding: 16 } },
  ],
  OUT_FILE,
);

console.log(`Generated ${OUT_FILE} (${COLOR_TOKENS.length} colors x 3 modes, ${SCALE_NUMBERS.length} scale vars, 5 components/sets)`);
