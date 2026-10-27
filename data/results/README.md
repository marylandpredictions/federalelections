# Election desk static data

Run builders from the repository root. Generated data is served by FEA; viewers do not contact Census or NBC directly.

## County and statewide demographics

```powershell
node scripts/results/build-county-demographics.mjs --bulk
```

This command works without an API key. It reads the official [2024 ACS table-based summary files](https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/) and [geography names](https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/documentation/Geos20245YR.txt). Bounded HTTP ranges stop after the complete state/county blocks; tract and block-group tails are not downloaded. All eight inputs must contain 52 standard state/territory rows and 3,222 standard county/county-equivalent rows. The population sum for the 50 states and DC must match the official U.S. population control. An incomplete build leaves the previous artifact intact.

The October 27 build downloaded 9 MiB of prefixes, including geography names. Only the compact output and source provenance are committed. The files contain no API credentials.

An optional `CENSUS_API_KEY` in the local, ignored `.env` file or environment enables the official API path when `--bulk` is omitted. Without a key, the builder uses bulk files. It also accepts official API JSON tables through `--counties=path/to/counties.json --states=path/to/states.json`.

The artifact contains 3,222 counties and 52 state/territory entries, including Puerto Rico. All county FIPS in the repository's county geometry match the artifact. Statewide values are direct ACS estimates, including income and education; they are not averages of county percentages.

| Interface field | ACS numerator / value | Denominator / definition |
| --- | --- | --- |
| Population | B01003_001E | Total population |
| White, non-Hispanic | B03002_003E | Total population |
| Black alone | B02001_003E | Total population, any ethnicity |
| Hispanic / Latino | B03003_003E | Total population, any race |
| Asian alone | B02001_005E | Total population, any ethnicity |
| Age 65+ | B01001_020E–025E and 044E–049E | Male and female age bins / total population |
| Bachelor's degree+ | B15003_022E–025E | Population age 25+ (B15003_001E) |
| Median household income | B19013_001E | 2024 inflation-adjusted dollars |

These are 2020–2024 ACS 5-year estimates, not a 2026 population count, party affiliation, party registration, or a description of the voters counted so far. Race and ethnicity overlap. Suppressed/sentinel values and invalid denominators become null and are omitted. Percentages are rounded to one decimal. No density or party-registration field is inferred. House county views describe the entire county, not the portion of the county inside a district.

Outputs:

- `county-demographics.min.json`: compact inspectable artifact with vintage, build date, variables, definitions, official URLs, input HTTP validators, downloaded-prefix hashes and national controls.
- `county-demographics.<hash>.json.gz`: precompressed, content-addressed public artifact (about 100 KB).
- `demographics.json`: small mutable manifest pointing to the current immutable artifact.

The interface loads the manifest and artifact only when Demographics is opened. Actual Census data is the default in the lab too. The explicit **Demographics fixture** scenario uses synthetic values and displays **Not Census data**.

## Map assets

```powershell
npm ci
node scripts/results/build-board-assets.mjs
```

The build-only TopoJSON packages are declared in `devDependencies`. They add no browser chart dependency. The browser already loads D3 and TopoJSON Client.

`map-assets.json` points to content-hashed, gzip-compressed files under `maps/`:

- State geometry retains its source features with coordinates rounded to four decimals.
- The national House topology shares arcs and retains the top 20% of weighted arc points, then quantizes coordinates. Every source feature is retained; tests check matching IDs and nonzero district polygons. This is display simplification, not a certification of 2026 boundaries or a historical district crosswalk. Original source geometry and the detailed district/county files remain intact.
- County geometry is partitioned by state FIPS and loaded when a statewide race is selected.
- Decorative highways have a small national display version and source-query subsets where the original dataset supplies them. The source's highway coverage is not expanded or represented as complete nationwide street data.

The server serves `.json.gz` as JSON with gzip content encoding, or decodes it for identity-only clients. These fingerprinted paths have a one-year immutable cache policy and are eligible for Render's Common static files edge-cache setting because the suffix is `.gz`. Mutable manifests and unversioned JSON remain short-lived. Keep hashes and manifests together in a deployment.

## Runtime history

Existing race `voteHistory` in `data/live-results-races/<race>.json` remains the state/race history. It records changed candidate totals and explicitly separated expected-vote/precinct-reporting values, with a 2,400-point limit. Identical detail files are not rewritten. Old ambiguous `reporting` fields are retained as legacy metadata and are not presented as expected vote in.

County history appends only changed counties to `.runtime/county-history/<race>/<county-fips>.ndjson`. It stores only timestamps, reporting fields and candidate totals. County history is served only for the requested race/county; it is absent from the national summary. These files are ignored by Git. The server records history on changed results independently of whether a viewer has that race open.

Use persistent storage for `.runtime`, call records and race-detail history on the deployed service. Provider vote updates do not create GitHub commits. The existing operator-call backup workflow is preserved.
