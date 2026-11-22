import { readFileSync, writeFileSync } from "node:fs";

const slimMenu = `<div class="board-overflow"><button id="maker-menu-button" type="button" aria-label="Map maker menu" aria-expanded="false" aria-controls="board-menu">⋯</button><div id="board-menu" hidden>
<a href="/">Home</a>
<a href="/features/map-maker">All Map Makers</a>
<a href="/archive">Archive</a>
<hr class="board-menu-rule">
<label class="maker-detail-switch"><input type="checkbox" id="maker-detail-enabled"> Inspect / right-click for detail</label>
<label class="maker-detail-switch"><input type="checkbox" id="maker-labels" checked> Map labels</label>
<button type="button" id="maker-open-detail" hidden>Open selected race</button>
<button type="button" id="maker-appearance">Appearance</button>
</div></div>`;

const menuRe = /<div class="board-overflow">[\s\S]*?<\/div><\/div>/;

for (const year of ["2026", "2027", "2028"]) {
  const path = `features/map-maker/${year}.html`;
  let html = readFileSync(path, "utf8");
  if (!menuRe.test(html)) {
    console.error("menu not found", year);
    continue;
  }
  html = html.replace(menuRe, slimMenu);
  html = html.replaceAll("20261121-rebuild1", "20261121-rebuild2");
  // Seat caption only under badge — drop competing "YOUR SCENARIO" noise next to Paint.
  html = html.replace(
    '<p data-seat-caption>YOUR SCENARIO</p>',
    '<p data-seat-caption class="maker-seat-caption">Your scenario</p>',
  );
  writeFileSync(path, html);
  console.log(year, html.includes("All Map Makers"), html.includes("rebuild2"));
}
