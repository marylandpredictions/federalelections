import { createHash } from "node:crypto";
const base =
  "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/";
const standardGeo = (id) => /^0400000US\d{2}$|^0500000US\d{5}$/.test(id);
export function summaryVariableName(name) {
  return name.replace(
    /^(B\d+)_([EM])(\d+)$/,
    (_, table, kind, line) => `${table}_${line}${kind}`,
  );
}
// The public Census bulk files are ordered by summary level. Stop after the
// complete county block; never download the nationwide tract/block-group tail.
async function readCountyPrefix(url, geography = false) {
  const rows = new Map(),
    hash = createHash("sha256");
  let offset = 0,
    carry = "",
    header = null,
    done = false,
    bytes = 0,
    metadata = {},
    national = null;
  const decoder = new TextDecoder();
  for (let part = 0; part < 32 && !done; part++) {
    const response = await fetch(url, {
      headers: {
        Range: `bytes=${offset}-${offset + 1048575}`,
        "Accept-Encoding": "identity",
      },
      signal: AbortSignal.timeout(60000),
    });
    if (
      response.status !== 206 ||
      !response.headers.get("content-range")?.startsWith(`bytes ${offset}-`)
    )
      throw Error("Census bulk server did not honor bounded range request");
    const body = Buffer.from(await response.arrayBuffer());
    hash.update(body);
    bytes += body.length;
    if (!part)
      metadata = {
        url,
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
    const lines = (carry + decoder.decode(body, { stream: true })).split(
      /\r?\n/,
    );
    carry = lines.pop();
    for (const line of lines) {
      const cells = line.split("|");
      if (!header) {
        header = cells;
        continue;
      }
      const id = cells[geography ? header.indexOf("GEO_ID") : 0];
      if (!id) continue;
      if (id === "0100000US") national = cells;
      if (Number(id.slice(0, 3)) > 50 && rows.size) {
        done = true;
        break;
      }
      if (standardGeo(id)) rows.set(id, cells);
    }
    offset += body.length;
    if (!body.length)
      throw Error("Census bulk download ended before county block");
  }
  const states = [...rows.keys()].filter((id) => id.startsWith("040")).length,
    counties = rows.size - states;
  if (!done || states !== 52 || counties !== 3222)
    throw Error(
      `Incomplete 2024 Census geography block: ${states} states, ${counties} counties. Existing artifact preserved.`,
    );
  return {
    header,
    rows,
    national,
    provenance: {
      ...metadata,
      bytesRead: bytes,
      prefixSha256: hash.digest("hex"),
      stateRows: states,
      countyRows: counties,
    },
  };
}
export async function fetchCensusSummary(variables) {
  const names = await readCountyPrefix(
      base + "documentation/Geos20245YR.txt",
      true,
    ),
    nameColumn = names.header.indexOf("NAME");
  const merged = new Map(
    [...names.rows].map(([id, cells]) => [id, { NAME: cells[nameColumn] }]),
  );
  const sourceFiles = [names.provenance],
    controls = { stateRows: 52, countyRows: 3222 },
    tables = [
      ...new Set(
        variables.filter((v) => v !== "NAME").map((v) => v.split("_")[0]),
      ),
    ];
  for (const table of tables) {
    const data = await readCountyPrefix(
      base + `data/5YRData/acsdt5y2024-${table.toLowerCase()}.dat`,
    );
    const columns = data.header
      .map(summaryVariableName)
      .map((name, index) => ({ name, index }))
      .filter(({ name }) => variables.includes(name));
    const wanted = variables.filter((v) => v.startsWith(table + "_"));
    if (columns.length !== wanted.length)
      throw Error(`Missing Census variables in ${table}`);
    if (table === "B01003")
      controls.usPopulation = Number(
        data.national[data.header.indexOf("B01003_E001")],
      );
    for (const [id, row] of merged) {
      const cells = data.rows.get(id);
      if (!cells) throw Error(`Missing Census geography in ${table}`);
      for (const column of columns) row[column.name] = cells[column.index];
    }
    sourceFiles.push(data.provenance);
    console.log(
      `Read ${table}: ${data.provenance.countyRows} county rows (${data.provenance.bytesRead} bounded bytes).`,
    );
  }
  const headers = [...variables, "state", "county"],
    counties = [headers],
    states = [headers.filter((k) => k !== "county")];
  for (const [id, row] of merged) {
    const fips = id.split("US")[1],
      isCounty = id.startsWith("050");
    const cells = variables.map((v) => row[v]);
    if (isCounty) counties.push([...cells, fips.slice(0, 2), fips.slice(2)]);
    else states.push([...cells, fips]);
  }
  return { counties, states, sourceFiles, controls };
}
