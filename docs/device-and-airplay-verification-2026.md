# Device and AirPlay verification — October 28, 2026

The board passed the local layout and interaction checks below after fixes for short landscape screens and narrow phones. This is **not** certification on every device or a completed physical AirPlay test. The browser checks used the desktop in-app Chromium browser with viewport overrides, not physical iOS Safari, Android hardware, or a TV receiver.

## What was fixed

- Landscape phones now put office selection and chamber control side by side. The previous stacked header covered northern states and intercepted map selection.
- National map fitting clears the measured header. SVG dimensions use the actual short viewport instead of forcing a minimum height of 360 pixels.
- Selected phone geography fits into the space above a portrait sheet or beside a landscape race window. A large state no longer remains largely behind the window after rotation.
- Landscape race windows remain on screen, with scrollable results, accessible tabs, search, and zoom controls. The saved desktop size does not force the window outside the short viewport.
- Narrow phones keep party totals on one line, suppress the pin tray while a race is open, and omit the redundant watch selector when it would force controls into two rows over the map.
- Short landscape screens show one projection card plus the queued count. View race navigation and dismissal remain available. Lab controls scroll within the short viewport.

## Layout matrix

Selected race/map layouts were captured and checked at these 16 CSS-pixel viewport sizes. Each orientation was allowed to finish rendering its SVG before capture.

| Class | Sizes |
|---|---|
| Phone portrait | 320×568, 375×667, 390×844, 430×932 |
| Phone landscape | 568×320, 667×375, 844×390, 932×430 |
| Tablet portrait | 768×1024, 820×1180 |
| Tablet landscape | 1024×768, 1180×820 |
| Laptop/desktop/TV viewport | 1366×768, 1920×1080, 2560×1440, 3840×2160 |

There was no document horizontal overflow, and each selected-race panel stayed inside the viewport. Measurements are checked in as `docs/device-layout-measurements.json`. A small landscape panel intentionally scrolls; every candidate is not expected to fit on screen simultaneously. The prior Night/Light multi-state screenshot matrix remains useful additional coverage; it is not a substitute for physical-device testing.

Additional functional checks exercised Results, Counties, Trends, and real ACS Demographics at 390×844, 844×390, 820×1180, and 3840×2160. Light-theme selection and Appearance controls worked at 844×390. The 320-pixel phone sheet expanded correctly. Search across offices, zoom, pinning, governor selection, and projection View race navigation were also exercised. A selected Montana race, Beaverhead county lock, and active Counties tab remained identical after landscape-to-portrait rotation. Browser error checks were clean during the completed flows.

**Automated checks: 65/65 results tests and 2/2 ratings regression tests pass.** The new geometry tests cover the actual short viewport, header clearance, and fitting geography clear of both portrait and landscape controls.

Evidence is saved locally under `C:/Users/zydlo/.codex/visualizations/2026/10/27/01a17d06-6512-70b0-ad31-769e92589290/bigboard-qa/devices/`, including layout measurements, interaction text, rotation-state comparison, and screenshots. Election-night screenshots use explicitly simulated results; demographic views used the real checked-in Census artifact.

## iPhone/iPad to TV

The supported approach to try is **AirPlay Screen Mirroring**, which mirrors the web page displayed by Safari. This dashboard does not provide a dedicated video AirPlay button, remote-control pairing, or an independent TV receiver app.

1. Connect the iPhone/iPad and Apple TV or AirPlay-compatible TV to the same Wi-Fi network.
2. Open the published Results page in Safari and rotate the device to landscape.
3. Open Control Center → Screen Mirroring → choose the TV. Enter the displayed AirPlay code if requested.
4. Leave Safari showing the board and keep the device awake. For a long session, keep it powered.

Apple documents this mirroring procedure in [Use AirPlay to stream video or mirror the screen of your iPhone or iPad](https://support.apple.com/en-us/102661).

Based on screen mirroring's behavior and the checked landscape layout, the board should be usable this way. **The actual wireless connection, lag, dropped frames, Safari rendering, battery/thermal behavior, and long-session stability have not been tested on an iPhone/iPad and TV.** Those remain hardware acceptance checks.

Mirroring preserves the phone/tablet layout and aspect ratio; it does not turn the page into a separate 1920×1080 desktop board. A portrait phone produces a narrow TV image. Landscape uses the TV more effectively, though black borders may remain. For the full desktop layout, use a laptop connected to the TV or another device that opens the page at a desktop-sized viewport.

## Remaining hardware acceptance check

On the intended iPhone/iPad and TV, verify: landscape orientation; readable candidate names from the intended viewing distance; map pan/pinch; search and all tabs; scrolling long candidate lists; rotation with a county locked; recovery after a Wi-Fi interruption; and at least 30 minutes with Safari in the foreground. No claim is made that these hardware checks have already passed.
