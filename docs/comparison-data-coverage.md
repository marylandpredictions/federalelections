# Historical comparisons and House Census coverage

Built October 31, 2026, starting from `2dca0c09`. Machine-readable counts and gaps:
`data/results/comparison-coverage.json`. Missing data stays blank; no forecast
margin is converted into invented historical vote counts.

| Comparison | Enabled coverage |
| --- | --- |
| Presidential 2024 | 51 state/DC rows, 3,103 exact county rows, 254 matching House districts |
| Presidential 2020 | 51 state/DC rows, 3,104 exact county rows, 254 matching House districts |
| Presidential 2016 | 51 state/DC rows, 3,104 exact county rows, 6 at-large House districts |
| Previous same-seat Senate | All 35 races; no county-level Senate source enabled |
| House 2024 | 253 matching districts; 433 published district vote returns retained |
| Previous governor | 8 states and 434 reconciled counties |
| House Census profiles | All 435 districts in the 119th Congress; 254 current-comparable, 181 explicitly historical-boundary profiles |

Governor coverage: CO, IA, NM, NH, PA, SD, WI, WY. Remaining last-governor gaps:
AL, AK, AZ, AR, CA, CT, FL, GA, HI, ID, IL, KS, ME, MD, MA, MI, MN, NE, NV, NY,
OH, OK, OR, RI, SC, TN, TX, VT. Presidential comparisons remain available in those
states. Investigated files with incomplete counties, mixed contests or unreconciled
certified totals were excluded. The eight governor sources include both official
and secondary verification controls; they are not all claimed as official-source
verified. Provenance and control totals are retained per state.

House current-map comparisons remain blocked in AL, CA, FL, LA, MO, NC, OH, TN,
TX and UT pending verified displayed 2026 geometry. The existing detailed maps
use Census 119th-Congress county-within-district shapes. A profile for an earlier
district remains useful context but is clearly marked as such. An exact SHA256
binds every accepted comparison to its displayed geometry. There is no statewide
House fallback. FL-20 and OK-03 had unopposed candidates with no published vote
counts in the Clerk's report; no totals were manufactured. AK House 2024 is labeled
first-choice votes; ME-02 is labeled final ranked-choice round.

County histories use exact unique FIPS only. Alaska legislative reporting
districts are not boroughs, municipalities are not arbitrarily assigned to old
counties, and a whole-county result is not a split-district portion. House county
references are labeled and do not produce a cross-scope shift. Municipality
historical returns and unmatched county vintages remain unavailable. Census
county demographics describe whole counties, including when viewed inside House.

## Sources and reproduction

- FEC official [2016 workbook](https://www.fec.gov/resources/cms-content/documents/federalelections2016.xlsx),
  [2020 workbook](https://www.fec.gov/documents/4228/federalelections2020.xlsx), and
  [2022 workbook](https://www.fec.gov/resources/cms-content/documents/federalelections2022.xlsx).
  `scripts/results/import-fec-comparisons.py YEAR WORKBOOK` reads these with
  openpyxl. National D/R/all-vote controls are checked before writing source JSON.
- The House Clerk's [2024 election statistics](https://clerk.house.gov/member_info/electionInfo/2024/statistics2024.pdf).
  Export page text with pypdf `page.extract_text(extraction_mode='layout')`, joined
  by newlines, then run `scripts/results/import-clerk-comparisons.py TEXT PDF`.
  Fusion ballot lines combine with the preceding named candidate once; invalid
  ballots are excluded. Extraction produced zero unparsed candidate lines.
- [The Downballot's district presidential compilation](https://docs.google.com/spreadsheets/d/1eZfaFI-c-PFOoKx1-zZA2MP0_dxRq_LVK0re3BOQqy0/edit?gid=1491069057).
  The retained public CSV includes 2024/2020 raw votes on 2026 lines. Only matching
  displayed boundaries are enabled. At-large districts use complete official FEC
  statewide totals, including scattered write-ins omitted by some compilations.
- Existing [MEDSL county presidential returns](https://doi.org/10.7910/DVN/VOQCHQ).
  TOTAL rows take priority over ballot-mode components; invalid and unmatched
  geographic rows are excluded, not redistributed.
- Governor county CSVs from public OpenElections repositories, independently
  reconciled to published controls. Per-file URLs, hashes, controls and authorities
  are retained in `data/baselines/source/reviewed-governor-returns.json`.
  The importer expects its downloaded CSVs and index under ignored
  `.runtime/source-audit/`; it is an acquisition/review tool, not a production
  startup dependency.
- Official [2024 ACS table-based summary files](https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/).
  `npm run build:house-demographics` downloads the 1-year district tables without
  requiring an API key, validates all 435 profiles, and writes a lazy compressed
  asset. It retains table URLs, hashes and variables. Existing county/state
  profiles use the 5-year product. Income is the direct district estimate, never
  an average of county medians. These estimates describe residents, not voters.

`npm run build:comparison-baselines` rebuilds public comparison files from the
retained source extracts. The legacy entry point delegates to this builder;
it no longer fabricates governor vote totals or relabels independents.
The legacy forecast inputs `house-2024-districts.json`, `senate-last-states.json`
and `governor-last-states.json` remain unchanged. New same-office display datasets
are isolated under `data/results/comparisons/`.

## Verification scope

Automated checks cover all enabled House rows through the public rendering gate,
exact geometry hashes, 435 Census profiles, same-seat Senate selection,
independent/same-party lead margins, county scope, fusion lines, official all-vote
controls and all 434 governor county sums. Browser checks exercised CO-04 district
and Lincoln County demographics, whole-county history, Ohio's 2022 Senate
comparison, NBC/NYT TV at 1920×1080, NYT 3840×2160 containment, and a 390×844 sheet.
Physical TVs, AirPlay and real OBS compositing were not tested in this pass.
