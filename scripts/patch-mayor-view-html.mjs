import fs from 'node:fs';

const toggle = `<div id="maker-mayor-view" class="maker-mayor-view" role="group" aria-label="Mayoral view" hidden><button type="button" data-mayor-view="map" aria-pressed="true">Map</button><button type="button" data-mayor-view="list" aria-pressed="false">List</button></div>`;
const board = `<section id="maker-mayor-board" class="maker-mayor-board" aria-label="Mayoral city list" hidden><header class="maker-mayor-board-head"><strong>Mayoral races</strong><p id="maker-mayor-board-caption">Click a city to cycle ratings · double-click or right-click for detail</p></header><div id="maker-mayor-list" class="maker-mayor-list"></div></section>`;

for (const year of ['2026', '2027', '2028']) {
  const file = `features/map-maker/${year}.html`;
  let html = fs.readFileSync(file, 'utf8');
  if (!html.includes('id="maker-mayor-view"')) {
    html = html.replace(
      '<div id="maker-interaction"',
      `${toggle}<div id="maker-interaction"`
    );
  }
  if (!html.includes('id="maker-mayor-board"')) {
    html = html.replace(
      '<div id="maker-map">',
      `${board}<div id="maker-map">`
    );
  }
  html = html.replaceAll('?v=20261121-desk2', '?v=20261121-mayor3');
  fs.writeFileSync(file, html);
  console.log('patched', file);
}
