# Result Comparison Baselines

Election-night comparison modes are listed in `data/result-comparison-baselines.json`.
The map code reads these as `current result margin - selected baseline margin`, so positive values show a Democratic shift from the comparison point and negative values show a Republican shift.

Use certified returns or a maintained historical election dataset. Good starting points:

- MIT Election Data and Science Lab: https://electionlab.mit.edu/data
- MEDSL GitHub datasets: https://github.com/MEDSL

## County Presidential Baselines

Generate these with:

```powershell
npm run build:comparison-baselines -- --pres=data/baselines/source/countypres_2000-2024.csv
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
npm run build:comparison-baselines -- --house=data/baselines/source/1976-2024-house.csv
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

## FEA Forecast Comparison

The FEA forecast comparison is race-level only. It intentionally does not color county pieces because FEA forecasts do not project counties.
When this comparison mode is active in a county map, county pieces are dimmed and the tooltip explains that county comparison is unavailable.
