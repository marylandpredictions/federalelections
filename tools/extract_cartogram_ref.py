"""Extract NYT-style cartogram silhouettes from the reference PNG."""
from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

REF = Path(
    r"C:\Users\zydlo\.cursor\projects\c-Users-zydlo-cursor-worktrees-federalelections-visual-revamp"
    r"\assets\image-ba2617b1-ee26-46fe-826a-d77bc7cc2552.png"
)
OUT_DIR = Path(r"C:\Users\zydlo\OneDrive\Desktop\federalelections\tools")


def dilate(mask: np.ndarray, r: int = 2) -> np.ndarray:
    h, w = mask.shape
    out = mask.copy()
    ys, xs = np.where(mask)
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx == 0 and dy == 0:
                continue
            yy = ys + dy
            xx = xs + dx
            ok = (yy >= 0) & (yy < h) & (xx >= 0) & (xx < w)
            out[yy[ok], xx[ok]] = True
    return out


def components(mask: np.ndarray, min_pixels: int = 80) -> list[list[tuple[int, int]]]:
    h, w = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    comps: list[list[tuple[int, int]]] = []
    for y in range(h):
        for x in range(w):
            if not mask[y, x] or visited[y, x]:
                continue
            q = deque([(x, y)])
            visited[y, x] = True
            cells: list[tuple[int, int]] = []
            while q:
                cx, cy = q.popleft()
                cells.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        q.append((nx, ny))
            if len(cells) >= min_pixels:
                comps.append(cells)
    return comps


def estimate_local_pitch(sub: np.ndarray) -> int:
    """Estimate square pitch from a state silhouette crop."""
    # Prefer horizontal autocorrelation of column occupancy
    col = (sub.sum(axis=0) > 0).astype(float)
    row = (sub.sum(axis=1) > 0).astype(float)
    best_p, best_s = 12, -1.0
    for p in range(10, 40):
        s = 0.0
        for series in (col, row):
            if len(series) <= p:
                continue
            s += float(np.dot(series[:-p], series[p:]))
        # Prefer pitches that also match ~square tiles
        if s > best_s:
            best_s, best_p = s, p
    return best_p


def extract_cells(sub: np.ndarray, pitch: int, threshold: float = 0.28) -> list[tuple[int, int]]:
    h, w = sub.shape
    cells = []
    gy = 0
    y = 0
    while y + pitch * 0.55 < h:
        gx = 0
        x = 0
        while x + pitch * 0.55 < w:
            y1 = min(h, y + pitch)
            x1 = min(w, x + pitch)
            # inset a bit to avoid gutter bleed
            inset = max(1, pitch // 8)
            yy0, yy1 = y + inset, max(y + inset + 1, y1 - inset)
            xx0, xx1 = x + inset, max(x + inset + 1, x1 - inset)
            patch = sub[yy0:yy1, xx0:xx1]
            if patch.size and patch.mean() >= threshold:
                cells.append((gx, gy))
            gx += 1
            x += pitch
        gy += 1
        y += pitch
    return cells


def ascii(cells: list[tuple[int, int]]) -> str:
    if not cells:
        return ""
    xs = [c[0] for c in cells]
    ys = [c[1] for c in cells]
    s = set(cells)
    lines = []
    for y in range(min(ys), max(ys) + 1):
        row = []
        for x in range(min(xs), max(xs) + 1):
            row.append("#" if (x, y) in s else ".")
        lines.append("".join(row))
    return "\n".join(lines)


def main() -> None:
    img = Image.open(REF).convert("RGB")
    arr = np.asarray(img)
    h, w, _ = arr.shape
    r, g, b = arr[:, :, 0].astype(int), arr[:, :, 1].astype(int), arr[:, :, 2].astype(int)
    white = (r > 235) & (g > 235) & (b > 235)
    colored = ~white
    # Close hatch gaps so hatched tiles stay connected within a state
    closed = dilate(colored, 2)
    # Re-erode slightly by requiring original neighborhood density? Keep dilated for clustering.
    comps = components(closed, min_pixels=120)
    comps.sort(key=lambda c: -len(c))
    print("state-ish clusters", len(comps))

    # House seat targets by state (2020/2022 apportionment used by atlas)
    seat_targets = {
        "CA": 52, "TX": 38, "FL": 28, "NY": 26, "PA": 17, "IL": 17, "OH": 15,
        "GA": 14, "NC": 14, "MI": 13, "NJ": 12, "VA": 11, "WA": 10, "AZ": 9,
        "TN": 9, "MA": 9, "IN": 9, "MD": 8, "MO": 8, "WI": 8, "MN": 8,
        "CO": 8, "SC": 7, "AL": 7, "LA": 6, "KY": 6, "OR": 6, "OK": 5,
        "CT": 5, "UT": 4, "IA": 4, "NV": 4, "AR": 4, "MS": 4, "KS": 4,
        "NM": 3, "NE": 3, "ID": 2, "WV": 2, "HI": 2, "NH": 2, "ME": 2,
        "RI": 2, "MT": 2, "DE": 1, "SD": 1, "ND": 1, "AK": 1, "VT": 1, "WY": 1,
    }

    results = []
    debug = img.copy()
    draw = ImageDraw.Draw(debug)

    for i, cells in enumerate(comps):
        xs = [p[0] for p in cells]
        ys = [p[1] for p in cells]
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        # crop from ORIGINAL colored mask (not dilated) for occupancy
        sub = colored[y0 : y1 + 1, x0 : x1 + 1]
        # try a few pitches near estimate
        base = estimate_local_pitch(sub)
        best = None
        for pitch in range(max(10, base - 4), base + 6):
            grid = extract_cells(sub, pitch)
            n = len(grid)
            # score: prefer n matching a known seat count, else closeness
            match = None
            for st, cnt in seat_targets.items():
                if cnt == n:
                    match = st
                    break
            score = -abs(n - (match and seat_targets[match] or n))
            # prefer exact known counts strongly
            if match:
                score += 1000 - abs(pitch - base)
            else:
                # soft: nearest seat count
                nearest = min(seat_targets.values(), key=lambda c: abs(c - n))
                score += 200 - abs(n - nearest) * 5 - abs(pitch - base)
            if best is None or score > best[0]:
                best = (score, pitch, grid, match, n)
        score, pitch, grid, match, n = best
        results.append(
            {
                "i": i,
                "bbox": (x0, y0, x1, y1),
                "pitch": pitch,
                "n": n,
                "match": match,
                "grid": grid,
                "cx": (x0 + x1) / 2,
                "cy": (y0 + y1) / 2,
            }
        )
        draw.rectangle([x0, y0, x1, y1], outline=(0, 0, 0), width=1)
        draw.text((x0 + 2, y0 + 2), f"{match or '?'}{n}", fill=(0, 0, 0))

    # Greedy unique state assignment by size + geography
    used = set()
    assigned = {}
    # Sort by exact matches first then size
    order = sorted(results, key=lambda r: (-(r["match"] is not None), -r["n"]))
    # Re-match uniquely using seat counts + rough geography (left=CA, bottom-left=AK etc)
    # First pass: unique exact counts
    count_to_states = {}
    for st, cnt in seat_targets.items():
        count_to_states.setdefault(cnt, []).append(st)

    for r in results:
        cands = [st for st in count_to_states.get(r["n"], []) if st not in used]
        if len(cands) == 1:
            assigned[r["i"]] = cands[0]
            used.add(cands[0])
            r["match"] = cands[0]

    # Remaining: pick nearest unused seat count, break ties by position heuristics
    for r in sorted(results, key=lambda rr: -rr["n"]):
        if r["i"] in assigned:
            continue
        remaining = [(st, cnt) for st, cnt in seat_targets.items() if st not in used]
        if not remaining:
            break
        # score by count distance + crude geo priors
        best_st, best_sc = None, -1e18
        for st, cnt in remaining:
            sc = -abs(cnt - r["n"]) * 50
            # geo priors from reference layout
            if st == "CA" and r["cx"] < 200 and r["cy"] > 150:
                sc += 80
            if st == "TX" and 250 < r["cx"] < 550 and r["cy"] > 350:
                sc += 80
            if st == "FL" and r["cx"] > 550 and r["cy"] > 400:
                sc += 80
            if st == "NY" and r["cx"] > 600 and r["cy"] < 220:
                sc += 80
            if st == "AK" and r["cx"] < 120 and r["cy"] > 480:
                sc += 80
            if st == "HI" and 100 < r["cx"] < 220 and r["cy"] > 480:
                sc += 40
            if sc > best_sc:
                best_sc, best_st = sc, st
        assigned[r["i"]] = best_st
        used.add(best_st)
        r["match"] = best_st

    print("\nAssigned clusters:")
    shapes = {}
    for r in sorted(results, key=lambda rr: -rr["n"]):
        st = assigned.get(r["i"], r["match"])
        print(f"  {st or '?':4} n={r['n']:2} pitch={r['pitch']} bbox={r['bbox']}")
        if st:
            # normalize local cells to 0-origin
            xs = [c[0] for c in r["grid"]]
            ys = [c[1] for c in r["grid"]]
            if not xs:
                continue
            local = sorted({(x - min(xs), y - min(ys)) for x, y in r["grid"]})
            shapes[st] = {
                "cells": local,
                "cx": r["cx"],
                "cy": r["cy"],
                "n": len(local),
            }
            if st in ("CA", "TX", "FL", "NY", "MI", "LA", "IL", "PA", "OH", "WA"):
                print(f"--- {st} silhouette ---")
                print(ascii(local))

    debug.save(OUT_DIR / "cartogram_ref_labeled.png")
    print("wrote labeled debug")

    # Place states on a shared grid using relative centers
    # Scale centers into grid units using median pitch ~18
    if not shapes:
        return
    med_pitch = float(np.median([r["pitch"] for r in results]))
    print("median pitch", med_pitch)

    # Use absolute placement: map image coords -> grid
    placed = {}
    for st, info in shapes.items():
        # place local shape so its bbox center maps near image center / pitch
        cells = info["cells"]
        xs = [c[0] for c in cells]
        ys = [c[1] for c in cells]
        local_cx = (min(xs) + max(xs)) / 2
        local_cy = (min(ys) + max(ys)) / 2
        gx = info["cx"] / med_pitch - local_cx
        gy = info["cy"] / med_pitch - local_cy
        ox, oy = int(round(gx)), int(round(gy))
        placed[st] = [(x + ox, y + oy) for x, y in cells]

    # Normalize so min coords near 0
    allc = [p for cells in placed.values() for p in cells]
    minx = min(p[0] for p in allc)
    miny = min(p[1] for p in allc)
    for st in placed:
        placed[st] = sorted((x - minx, y - miny) for x, y in placed[st])

    # Resolve overlaps by shifting later (smaller) states — keep larger fixed
    occupied = {}
    for st, cells in sorted(placed.items(), key=lambda kv: -len(kv[1])):
        # find shift if needed
        shift = (0, 0)
        for dx, dy in [(0, 0)] + [(a, b) for a in range(-3, 4) for b in range(-3, 4) if (a, b) != (0, 0)]:
            ok = all((x + dx, y + dy) not in occupied for x, y in cells)
            if ok:
                shift = (dx, dy)
                break
        final = [(x + shift[0], y + shift[1]) for x, y in cells]
        for p in final:
            occupied[p] = st
        placed[st] = sorted(final)

    # Trim to exact seat counts if over-extracted
    for st, cnt in seat_targets.items():
        if st not in placed:
            continue
        cells = placed[st]
        if len(cells) > cnt:
            # drop farthest from centroid
            cx = sum(c[0] for c in cells) / len(cells)
            cy = sum(c[1] for c in cells) / len(cells)
            cells = sorted(cells, key=lambda c: (c[0] - cx) ** 2 + (c[1] - cy) ** 2)[:cnt]
            placed[st] = sorted(cells)
        elif len(cells) < cnt:
            print(f"WARN {st} under-extracted {len(cells)}/{cnt}")

    # Emit JS
    lines = [
        "// NYT-style House cartogram silhouettes extracted from reference.",
        "window.FEA_ATLAS_CARTOGRAM_SHAPES = {",
    ]
    for st in sorted(placed.keys(), key=lambda s: (-len(placed[s]), s)):
        cells = placed[st]
        body = ",".join(f"[{x},{y}]" for x, y in cells)
        lines.append(f"  {st}:[{body}],")
    lines.append("};")
    out_js = Path(r"C:\Users\zydlo\OneDrive\Desktop\federalelections\assets\atlas-cartogram-shapes.js")
    out_js.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("wrote", out_js, "states", len(placed), "tiles", sum(len(v) for v in placed.values()))

    # ASCII whole map
    maxx = max(p[0] for cells in placed.values() for p in cells)
    maxy = max(p[1] for cells in placed.values() for p in cells)
    grid = [["." for _ in range(maxx + 1)] for _ in range(maxy + 1)]
    for st, cells in placed.items():
        ch = st[0]
        for x, y in cells:
            grid[y][x] = ch
    print("\nFULL MAP:")
    for row in grid:
        print("".join(row))


if __name__ == "__main__":
    main()
