import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const src = path.join(root, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl-worker.mjs');
const destDir = path.join(root, 'public');
const dest = path.join(destDir, 'maplibre-gl-worker.mjs');

if (!fs.existsSync(src)) {
  console.warn('[sync-maplibre-worker] Source worker not found at', src);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
const nextBytes = fs.readFileSync(src);
if (fs.existsSync(dest) && Buffer.compare(fs.readFileSync(dest), nextBytes) === 0) {
  process.exit(0);
}

fs.writeFileSync(dest, nextBytes);
console.log('[sync-maplibre-worker] Synced public/maplibre-gl-worker.mjs');
