# Result Comparison Baselines

Election-night comparison modes are listed in `data/result-comparison-baselines.json`.
The map code can read state, district, and county baselines when these files are added.

Use certified returns or a maintained historical election dataset. Good starting points:

- MIT Election Data and Science Lab: https://electionlab.mit.edu/data
- MEDSL GitHub datasets: https://github.com/MEDSL

## County Presidential Baselines

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

- `house-2022-districts.json`

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

## FEA Forecast Comparison

The FEA forecast comparison is race-level only. It intentionally does not color county pieces because FEA forecasts do not project counties.
When this comparison mode is active in a county map, county pieces are dimmed and the tooltip explains that county comparison is unavailable.
