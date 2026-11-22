import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === '.runtime') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function rebuildMenu(inner) {
  const hasBias = /polling-bias/.test(inner);
  const hasAtlas = /2026-atlas|Election Atlas/.test(inner);
  const hasMaker = /map-maker/.test(inner);
  const parts = [];
  if (hasBias) parts.push('<a href="/features/polling-bias">State polling bias</a>');
  // Active makers only — 2026 lives under Archive.
  if (hasMaker) {
    parts.push('<a href="/features/map-maker/2028">2028 Map Maker</a>');
    parts.push('<a href="/features/map-maker/2027">2027 Map Maker</a>');
  }
  if (hasAtlas) parts.push('<a href="/2026-atlas">Election Atlas</a>');
  const extras = [...inner.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)]
    .map((m) => ({ href: m[1], label: m[2] }))
    .filter((l) => !/polling-bias|map-maker|\/archive|2026-atlas/i.test(l.href));
  for (const link of extras) parts.push(`<a href="${link.href}">${link.label}</a>`);
  parts.push('<a href="/archive">Archive</a>');
  return parts.join('');
}

let changed = 0;
for (const file of walk(process.cwd())) {
  const html = fs.readFileSync(file, 'utf8');
  if (!html.includes('nav-dropdown-menu')) continue;
  const next = html.replace(/<div class="nav-dropdown-menu">([\s\S]*?)<\/div>/g, (full, inner) => {
    if (!/map-maker|Archive|polling-bias|2026-atlas/.test(inner)) return full;
    if (/trump-approval|2028-primary/.test(inner) && !/map-maker|polling-bias|Archive/.test(inner)) return full;
    return `<div class="nav-dropdown-menu">${rebuildMenu(inner)}</div>`;
  });
  if (next !== html) {
    fs.writeFileSync(file, next);
    changed += 1;
    console.log('updated', path.relative(process.cwd(), file));
  }
}
console.log('files changed', changed);
