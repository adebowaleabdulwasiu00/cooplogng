import { readdirSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const releaseDir = path.join(root, 'release');
const updatesDir = path.join(root, 'updates');

if (!existsSync(releaseDir)) {
  console.error('[stage] release/ not found. Run: npx electron-builder --win --publish never');
  process.exit(1);
}
mkdirSync(updatesDir, { recursive: true });

const files = readdirSync(releaseDir);
const wanted = files.filter((f) => f === 'latest.yml' || f.endsWith('.exe') || f.endsWith('.blockmap'));

if (wanted.length === 0) {
  console.error('[stage] No installer artifacts in release/. Files seen: ' + (files.join(', ') || '(empty)'));
  process.exit(1);
}

for (const f of wanted) {
  copyFileSync(path.join(releaseDir, f), path.join(updatesDir, f));
  console.log('[stage] copied ' + f + ' -> updates/');
}
console.log('[stage] Done. Deploy with: firebase deploy --only hosting');
