import { readFileSync, writeFileSync } from "node:fs";

const base = readFileSync("features/map-maker/2026.html", "utf8");

function withShell(html) {
  let out = html
    .replaceAll("20261121-arrows1", "20261121-rebuild1")
    .replace("scenario-model.js?v=20261120-mayor2", "scenario-model.js?v=20261121-rebuild1")
    .replace("map-maker-theme.js?v=20261101-yapms2", "map-maker-theme.js?v=20261121-rebuild1")
    .replace("desk-theme.js?v=20261103-broadcast5", "desk-theme.js?v=20261121-rebuild1");
  out = out.replace(
    '<section id="maker-seat-summary" aria-label="Scenario seat distribution" hidden><svg id="maker-seat-ring" viewBox="0 0 220 220" role="img" aria-label="Seats by rating"></svg><p>YOUR SCENARIO</p></section>',
    '<section id="maker-seat-summary" aria-label="Scenario seat distribution" hidden><svg id="maker-seat-ring" viewBox="0 0 220 220" role="img" aria-label="Seats by rating"></svg><img class="maker-seat-badge" src="/assets/img/FEA_Badge.png" alt="FEA" width="120" height="120"><p data-seat-caption>YOUR SCENARIO</p></section>',
  );
  out = out.replace(
    '<div class="election-chamber-board"><div class="maker-totals" id="maker-totals" aria-label="Your rated races"></div>',
    '<div class="election-chamber-board"><div id="maker-ticket-bar" class="maker-ticket-bar" aria-label="Presidential tickets" hidden></div><div class="maker-totals" id="maker-totals" aria-label="Your rated races"></div>',
  );
  return out;
}

function build(year, label, desc) {
  let html = withShell(base)
    .replaceAll("2026 Map Maker", label)
    .replaceAll('data-map-cycle="2026"', `data-map-cycle="${year}"`)
    .replace(
      "Build your own House, Senate and governor ratings maps. Paint races, undo changes, save your scenario and download an image.",
      desc,
    )
    .replace('value="My 2026 election map"', `value="My ${year} election map"`);
  writeFileSync(`features/map-maker/${year}.html`, html);
  console.log(year, html.includes("FEA_Badge"), html.includes("maker-ticket-bar"), html.includes(`data-map-cycle="${year}"`));
}

build(
  "2027",
  "2027 Map Maker",
  "Build your own 2027 governor ratings map. Paint races, inspect counties and past elections, save your scenario.",
);
build(
  "2028",
  "2028 Map Maker",
  "Build your own 2028 presidential and congressional ratings maps. Split Maine and Nebraska electors, paint races, save your scenario.",
);
writeFileSync("features/map-maker/2026.html", withShell(base));
console.log("2026 patched");
