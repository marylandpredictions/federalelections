# Result Comparison Baselines

Election-night comparison modes are listed in `data/result-comparison-baselines.json`.
The map code reads these as `current result margin - selected baseline margin`, so positive values show a Democratic shift from the comparison point and negative values show a Republican shift.

Use certified returns or a maintained historical election dataset. Good starting points:

- MIT Election Data and Science Lab: https://electionlab.mit.edu/data
- MEDSL GitHub datasets: https://github.com/MEDSL

Official current MIT/MEDSL Dataverse files:

- County Presidential Election Returns 2000-2024: https://doi.org/10.7910/DVN/VOQCHQ
  - file: `countypres_2000-2024.tab`
- U.S. House 1976-2024: https://doi.org/10.7910/DVN/IG0UN2
  - file: `1976-2024-house.tab`
- U.S. Senate statewide 1976-2024: https://doi.org/10.7910/DVN/PEJ5QU
  - file: `1976-2024-senate-state.tab`

Harvard Dataverse currently requires a guestbook response before downloading these two public files. If an automated fetch receives `You may not download this file without the required Guestbook response`, download the two `.tab` files in a browser, place them in `data/baselines/source`, then run the build command below.

## County Presidential Baselines

Generate these with:

```powershell
npm run build:comparison-baselines -- --pres=data/baselines/source/countypres_2000-2024.tab
```

Expected file names:

- `pres-2024-counties.json`
- `pres-2020-counties.json`

Expected shape:

```json
{
  "source": "MIT Election Data and Science Lab / official certified returns",
  "updatedAt": "2026-06-13",
  "rows": [
    {
      "fips": "06037",
      "state": "CA",
      "county": "Los Angeles",
      "demVotes": 0,
      "repVotes": 0,
      "totalVotes": 0,
      "demShare": 0,
      "repShare": 0,
      "margin": 0
    }
  ]
}
```

`margin` is Democratic margin in percentage points. Positive means Democratic, negative means Republican.

## State Presidential Baselines

Expected file names:

- `pres-2024-states.json`
- `pres-2020-states.json`

Expected shape:

```json
{
  "source": "MIT Election Data and Science Lab / official certified returns",
  "updatedAt": "2026-06-13",
  "states": [
    {
      "state": "CA",
      "demVotes": 0,
      "repVotes": 0,
      "totalVotes": 0,
      "demShare": 0,
      "repShare": 0,
      "margin": 0
    }
  ]
}
```

## House District Baselines

Expected file name:

- `house-2024-districts.json`

Generate it with:

```powershell
npm run build:comparison-baselines -- --house=data/baselines/source/1976-2024-house.tab
```

Expected shape:

```json
{
  "source": "Official certified returns or normalized historical House returns",
  "updatedAt": "2026-06-13",
  "districts": [
    {
      "id": "CA-22",
      "state": "CA",
      "district": "22",
      "demVotes": 0,
      "repVotes": 0,
      "totalVotes": 0,
      "demShare": 0,
      "repShare": 0,
      "margin": 0
    }
  ]
}
```

House comparison is only shown on the House map because the baseline is district-level.

## Senate and Governor Baselines

Expected file names:

- `senate-last-states.json`
- `governor-last-states.json`

Expected shape:

```json
{
  "source": "Official certified returns",
  "updatedAt": "2026-06-13",
  "states": [
    {
      "state": "OH",
      "baselineRace": "2024 Senate",
      "notes": "Most recent comparable Senate general election.",
      "demVotes": 0,
      "repVotes": 0,
      "totalVotes": 0,
      "demShare": 0,
      "repShare": 0,
      "margin": 0
    }
  ]
}
```

Senate and governor baselines are state-level only. They are unique comparison modes because previous Senate and governor elections can be non-comparable after special elections, appointed incumbents, or open-seat changes.

`senate-last-states.json` is generated from `1976-2024-senate-state.tab`. For current 2026 coverage, the builder prefers the comparable same-seat-cycle baseline instead of blindly using the latest Senate race in the state. This avoids unfair comparisons such as using Angus King's 2024 Maine margin for Susan Collins's 2026 race; Maine uses Collins's 2020 race instead. Special-election states can override the default cycle year in `scripts/build-result-comparison-baselines.mjs`. If the cycle baseline is unavailable, the builder falls back to the latest usable Senate election. Major independent/non-Republican candidates such as Bernie Sanders and Dan Osborn are counted on the non-Republican side when needed and noted in the output.

`governor-last-states.json` is generated from `data/governor-forecast.json` for now because that model already stores the previous governor margin used by each race. This keeps the election-night comparison mode wired while still documenting that it should be replaced by a complete certified governor returns source when one is added.

## FEA Forecast Comparison

The FEA forecast comparison is race-level only. It intentionally does not color county pieces because FEA forecasts do not project counties.
When this comparison mode is active in a county map, county pieces are dimmed and the tooltip explains that county comparison is unavailable.
