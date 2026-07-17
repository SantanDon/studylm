import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const assetsDir = path.resolve('dist/assets');
const budgets = [
  { label: 'initial app', pattern: /^index-[^.]+\.js$/, maxBytes: 600 * 1024, choose: 'largest' },
  { label: 'notebook route', pattern: /^Notebook-[^.]+\.js$/, maxBytes: 1_850 * 1024, choose: 'largest' },
  { label: 'studio route', pattern: /^StudioSidebar-[^.]+\.js$/, maxBytes: 500 * 1024, choose: 'largest' },
];

const files = await readdir(assetsDir);
let failed = false;

for (const budget of budgets) {
  const candidates = [];
  for (const file of files.filter((name) => budget.pattern.test(name))) {
    const fileStat = await stat(path.join(assetsDir, file));
    candidates.push({ file, bytes: fileStat.size });
  }

  if (candidates.length === 0) {
    console.error(`[bundle-budget] Missing expected ${budget.label} chunk.`);
    failed = true;
    continue;
  }

  candidates.sort((a, b) => b.bytes - a.bytes);
  const selected = candidates[0];
  const sizeKb = selected.bytes / 1024;
  const maxKb = budget.maxBytes / 1024;
  const status = selected.bytes <= budget.maxBytes ? 'PASS' : 'FAIL';
  console.log(`[bundle-budget] ${status} ${budget.label}: ${sizeKb.toFixed(1)} KB / ${maxKb.toFixed(0)} KB (${selected.file})`);
  if (selected.bytes > budget.maxBytes) failed = true;
}

if (failed) process.exit(1);
