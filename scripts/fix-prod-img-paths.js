#!/usr/bin/env node
// Rewrites image src paths in the production build output so all img references
// use the absolute /docs/img/ prefix instead of relative img/ or bare /img/.
// Only intended to run after `build:prod`.

const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const BASE = '/docs/';

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith('.html')) files.push(full);
  }
  return files;
}

function fix(content) {
  return content
    // relative: src="img/ → src="/docs/img/
    .replace(/src="img\//g, `src="${BASE}img/`)
    // absolute without base: src="/img/ → src="/docs/img/  (only if not already prefixed)
    .replace(/src="\/img\//g, `src="${BASE}img/`);
}

const files = walk(BUILD_DIR);
let changed = 0;

for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  const fixed = fix(original);
  if (fixed !== original) {
    fs.writeFileSync(file, fixed, 'utf8');
    changed++;
  }
}

console.log(`fix-prod-img-paths: patched ${changed} file(s) in ${BUILD_DIR}`);
