import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { topology } from "topojson-server";
import { presimplify, quantile, simplify } from "topojson-simplify";
import { feature, quantize } from "topojson-client";
export function buildBoardAssets(root = process.cwd()) {
  const directory = resolve(root, "data/results/maps");
  mkdirSync(directory, { recursive: true });
  const manifest = {
    version: 2,
    precision: 4,
    note: "Display geometry rounded to four decimals. National House topology retains the top 20% of weighted arc points; selected-race county geometry and original sources remain unchanged. Not a district-baseline certification.",
    counties: {},
  };
  const read = (file) => JSON.parse(readFileSync(resolve(root, file), "utf8"));
  const round = (value) =>
    Array.isArray(value)
      ? value.map(round)
      : typeof value === "number"
        ? Number(value.toFixed(4))
        : value;
  const compact = (collection) => ({
    ...collection,
    features: collection.features.map((feature) => ({
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: round(feature.geometry.coordinates),
      },
    })),
  });
  const write = (name, data) => {
    const text = JSON.stringify(data),
      hash = createHash("sha256").update(text).digest("hex").slice(0, 12),
      path = `data/results/maps/${name}.${hash}.json.gz`;
    writeFileSync(resolve(root, path), gzipSync(text, { level: 9 }));
    return path;
  };
  manifest.states = write(
    "states",
    compact(read("data/result-us-states.geojson")),
  );
  const originalHouse = compact(read("data/house-districts-119.geojson"));
  const weighted = presimplify(topology({ districts: originalHouse }));
  const displayHouse = quantize(
    simplify(weighted, quantile(weighted, 0.8)),
    1e6,
  );
  const decoded = feature(displayHouse, displayHouse.objects.districts);
  const ids = (collection) =>
    collection.features
      .map((f) => f.properties.id)
      .sort()
      .join(",");
  if (
    ids(decoded) !== ids(originalHouse) ||
    decoded.features.some((f) => !f.geometry)
  )
    throw Error("House display topology lost a district");
  manifest.house = write("house", displayHouse);
  const roads = read("data/result-major-highways.geojson");
  // Douglas-Peucker is used only for decorative road lines, never election polygons.
  function simplifyLine(points, tolerance = 0.01) {
    if (points.length < 3) return points;
    const keep = new Set([0, points.length - 1]),
      stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(),
        [x, y] = points[a],
        [xx, yy] = points[b],
        dx = xx - x,
        dy = yy - y;
      let best = tolerance * tolerance,
        index = -1;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = points[i],
          t =
            dx || dy
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy),
                  ),
                )
              : 0;
        const distance = (px - x - t * dx) ** 2 + (py - y - t * dy) ** 2;
        if (distance > best) {
          best = distance;
          index = i;
        }
      }
      if (index >= 0) {
        keep.add(index);
        stack.push([a, index], [index, b]);
      }
    }
    return [...keep].sort((a, b) => a - b).map((i) => points[i]);
  }
  manifest.highways = write(
    "highways-national",
    compact({
      ...roads,
      features: roads.features.map((f) => ({
        ...f,
        geometry: {
          ...f.geometry,
          coordinates:
            f.geometry.type === "LineString"
              ? simplifyLine(f.geometry.coordinates)
              : f.geometry.coordinates.map((line) => simplifyLine(line)),
        },
      })),
    }),
  );
  manifest.highwaysByState = {};
  for (const state of new Set(
    roads.features.map((f) => f.properties.feaStateQuery).filter(Boolean),
  ))
    manifest.highwaysByState[state] = write(
      `highways-${state}`,
      compact({
        ...roads,
        features: roads.features.filter(
          (f) => f.properties.feaStateQuery === state,
        ),
      }),
    );
  const groups = new Map();
  for (const feature of read("data/result-counties.geojson").features) {
    const fips = String(feature.properties.GEOID || "").slice(0, 2);
    if (!groups.has(fips)) groups.set(fips, []);
    groups.get(fips).push(feature);
  }
  for (const [fips, features] of groups)
    manifest.counties[fips] = write(
      `counties-${fips}`,
      compact({ type: "FeatureCollection", features }),
    );
  writeFileSync(
    resolve(root, "data/results/map-assets.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(buildBoardAssets(), null, 2));
