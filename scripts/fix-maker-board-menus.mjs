import fs from 'node:fs';

const menu = [
  '<a href="/">Home</a>',
  '<a href="/2026-results">Live results board</a>',
  '<a href="/features/polling-bias">State polling bias</a>',
  '<a href="/polling/trump-approval">Trump Approval</a>',
  '<a href="/polling/2028-primary">2028 Primary</a>',
  '<a href="/features/map-maker/2028">2028 Map Maker</a>',
  '<a href="/features/map-maker/2027">2027 Map Maker</a>',
  '<a href="/archive">Archive</a>',
  '<label class="maker-detail-switch"><input type="checkbox" id="maker-detail-enabled"> County detail: Inspect mode / right-click</label>',
  '<button type="button" id="maker-open-detail" hidden>Open selected race detail</button>',
  '<label class="maker-detail-switch"><input type="checkbox" id="maker-labels" checked> Map labels</label>',
  '<button type="button" id="maker-appearance">Appearance</button>',
].join('');

for (const year of ['2026', '2027', '2028']) {
  const file = `features/map-maker/${year}.html`;
  let html = fs.readFileSync(file, 'utf8');
  const next = html.replace(
    /<div id="board-menu"[^>]*>[\s\S]*?<\/div><\/div>/,
    `<div id="board-menu" hidden>${menu}</div></div>`
  );
  if (next === html) throw new Error(`board-menu not updated: ${file}`);
  html = next.replaceAll('?v=20261121-revamp1', '?v=20261121-desk2');
  fs.writeFileSync(file, html);
  console.log('updated', file);
}
