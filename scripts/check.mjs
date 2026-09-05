import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'scripts', 'tests', 'public'];
const files = [];
for (const root of roots) await walk(root);
let failed = false;
for (const file of files.filter((name) => name.endsWith('.js') || name.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
if (failed) process.exit(1);
console.log(`Syntax check passed for ${files.length} project files.`);

async function walk(dir) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full); else files.push(full);
  }
}
