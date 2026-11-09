"""Detect individual square tiles in the NYT reference cartogram."""
from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

REF = Path(
    r"C:\Users\zydlo\.cursor\projects\c-Users-zydlo-cursor-worktrees-federalelections-visual-revamp"
    r"\assets\image-ba2617b1-ee26-46fe-826a-d77bc7cc2552.png"
)
OUT = Path(r"C:\Users\zydlo\OneDrive\Desktop\federalelections\tools")


def main() -> None:
    img = Image.open(REF).convert("RGB")
    arr = np.asarray(img).astype(np.int16)
    h, w, _ = arr.shape
    # Non-white mask; hatches still count as colored
    white = (arr[:, :, 0] > 235) & (arr[:, :, 1] > 235) & (arr[:, :, 2] > 235)
    colored = ~white

    # Find tile size: look at horizontal run lengths of colored pixels on many rows
    runs = []
    for y in range(0, h, 3):
        x = 0
        row = colored[y]
        while x < w:
            if not row[x]:
                x += 1
                continue
            x2 = x
            while x2 < w and row[x2]:
                x2 += 1
            length = x2 - x
            if 8 <= length <= 28:
                runs.append(length)
            x = x2
    tile = int(np.median(runs)) if runs else 16
    print("median run", tile, "n", len(runs), "p10/90", np.percentile(runs, [10, 90]))

    # Gap between tiles within a state is usually 1-3px white; between states larger.
    # Detect tile centers by scanning for nearly-square solid-ish blocks.
    # Use integral image of colored for fast box sums.
    integ = np.pad(colored.astype(np.int32), ((1, 0), (1, 0))).cumsum(0).cumsum(1)

    def box_sum(x0, y0, x1, y1):
        x0 = max(0, x0); y0 = max(0, y0)
        x1 = min(w, x1); y1 = min(h, y1)
        if x1 <= x0 or y1 <= y0:
            return 0
        return int(integ[y1, x1] - integ[y0, x1] - integ[y1, x0] + integ[y0, x0])

    # Candidate centers: for each colored pixel that starts a run of ~tile length
    candidates = []
    step = max(2, tile // 4)
    for y in range(0, h - tile, step):
        for x in range(0, w - tile, step):
            area = tile * tile
            s = box_sum(x, y, x + tile, y + tile)
            fill = s / area
            if fill < 0.45:
                continue
            # Prefer squares that have white-ish border just outside (gutter)
            # left gutter
            left = box_sum(x - 2, y, x, y + tile) / max(1, 2 * tile)
            right = box_sum(x + tile, y, x + tile + 2, y + tile) / max(1, 2 * tile)
            top = box_sum(x, y - 2, x + tile, y) / max(1, 2 * tile)
            bot = box_sum(x, y + tile, x + tile, y + tile + 2) / max(1, 2 * tile)
            # Within-state tiles touch — gutters may be tiny. Score by fill mainly.
            score = fill - 0.05 * (left + right + top + bot)
            candidates.append((score, x + tile / 2, y + tile / 2, fill))

    candidates.sort(reverse=True)
    print("candidates", len(candidates))

    # Non-max suppression: keep centers at least ~0.7*tile apart
    kept = []
    min_dist2 = (tile * 0.72) ** 2
    for score, cx, cy, fill in candidates:
        ok = True
        for kx, ky in kept:
            if (cx - kx) ** 2 + (cy - ky) ** 2 < min_dist2:
                ok = False
                break
        if ok:
            kept.append((cx, cy))
        if len(kept) >= 500:
            break
    print("kept tiles", len(kept))

    # Snap to grid using estimated pitch (tile + small gutter)
    # Estimate pitch from nearest-neighbor distances
    dists = []
    for i, (cx, cy) in enumerate(kept):
        best = 1e18
        for j, (ox, oy) in enumerate(kept):
            if i == j:
                continue
            d = (cx - ox) ** 2 + (cy - oy) ** 2
            if d < best:
                best = d
        dists.append(best ** 0.5)
    pitch = float(np.median(dists))
    print("pitch", pitch)

    ox = min(c[0] for c in kept)
    oy = min(c[1] for c in kept)
    grid_pts = {}
    for cx, cy in kept:
        gx = int(round((cx - ox) / pitch))
        gy = int(round((cy - oy) / pitch))
        # keep first / closest
        key = (gx, gy)
        if key not in grid_pts:
            grid_pts[key] = (cx, cy)

    print("unique grid cells", len(grid_pts))

    # Cluster into states: adjacent 4-connected cells belong to same state
    cells = set(grid_pts.keys())
    visited = set()
    clusters = []
    for c in sorted(cells):
        if c in visited:
            continue
        q = deque([c])
        visited.add(c)
        cl = []
        while q:
            x, y = q.popleft()
            cl.append((x, y))
            for n in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if n in cells and n not in visited:
                    visited.add(n)
                    q.append(n)
        clusters.append(sorted(cl))
    clusters.sort(key=lambda c: -len(c))
    print("clusters", len(clusters), "sizes", [len(c) for c in clusters])

    def ascii(cl):
        xs = [p[0] for p in cl]
        ys = [p[1] for p in cl]
        s = set(cl)
        return "\n".join(
            "".join("#" if (x, y) in s else "." for x in range(min(xs), max(xs) + 1))
            for y in range(min(ys), max(ys) + 1)
        )

    seats = {
        52: "CA", 38: "TX", 28: "FL", 26: "NY", 17: ["PA", "IL"], 15: "OH",
        14: ["GA", "NC"], 13: "MI", 12: "NJ", 11: "VA", 10: "WA", 9: ["AZ", "TN", "MA", "IN"],
        8: ["MD", "MO", "WI", "MN", "CO"], 7: ["SC", "AL"], 6: ["LA", "KY", "OR"],
        5: ["OK", "CT"], 4: ["UT", "IA", "NV", "AR", "MS", "KS"], 3: ["NM", "NE"],
        2: ["ID", "WV", "HI", "NH", "ME", "RI", "MT"], 1: ["DE", "SD", "ND", "AK", "VT", "WY"],
    }

    # Assign by size + position
    # Convert cluster center to image coords for geo
    labeled = []
    used_multi = {k: 0 for k in seats if isinstance(seats[k], list)}
    for cl in clusters:
        n = len(cl)
        xs = [grid_pts[p][0] for p in cl]
        ys = [grid_pts[p][1] for p in cl]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        target = seats.get(n)
        st = None
        if isinstance(target, str):
            st = target
        elif isinstance(target, list):
            idx = used_multi.get(n, 0)
            # order candidates by geography for ambiguous counts
            cands = list(target)
            if n == 17:
                # PA further east than IL
                cands = sorted(cands, key=lambda s: 0 if (s == "IL" and cx < 500) or (s == "PA" and cx >= 500) else 1)
            if n == 14:
                cands = sorted(cands, key=lambda s: 0 if (s == "GA" and cy > 350) or (s == "NC" and cy <= 350) else 1)
            if n == 9:
                # AZ west/south, TN center, MA east/north, IN midwest
                def score9(s):
                    if s == "AZ":
                        return abs(cx - 250) + abs(cy - 400)
                    if s == "TN":
                        return abs(cx - 550) + abs(cy - 350)
                    if s == "MA":
                        return abs(cx - 850) + abs(cy - 120)
                    if s == "IN":
                        return abs(cx - 600) + abs(cy - 280)
                    return 1e9
                cands = sorted(cands, key=score9)
            if n == 8:
                def score8(s):
                    if s == "CO":
                        return abs(cx - 350) + abs(cy - 300)
                    if s == "MN":
                        return abs(cx - 520) + abs(cy - 120)
                    if s == "WI":
                        return abs(cx - 580) + abs(cy - 160)
                    if s == "MO":
                        return abs(cx - 520) + abs(cy - 320)
                    if s == "MD":
                        return abs(cx - 780) + abs(cy - 260)
                    return 1e9
                cands = sorted(cands, key=score8)
            if n == 7:
                cands = sorted(cands, key=lambda s: 0 if (s == "AL" and cx < 650) or (s == "SC" and cx >= 650) else 1)
            if n == 6:
                def score6(s):
                    if s == "OR":
                        return abs(cx - 120) + abs(cy - 160)
                    if s == "LA":
                        return abs(cx - 520) + abs(cy - 480)
                    if s == "KY":
                        return abs(cx - 620) + abs(cy - 320)
                    return 1e9
                cands = sorted(cands, key=score6)
            if n == 5:
                cands = sorted(cands, key=lambda s: 0 if (s == "OK" and cx < 500) or (s == "CT" and cx >= 500) else 1)
            if n == 4:
                def score4(s):
                    if s == "UT":
                        return abs(cx - 250) + abs(cy - 280)
                    if s == "IA":
                        return abs(cx - 500) + abs(cy - 220)
                    if s == "NV":
                        return abs(cx - 180) + abs(cy - 250)
                    if s == "AR":
                        return abs(cx - 500) + abs(cy - 380)
                    if s == "MS":
                        return abs(cx - 560) + abs(cy - 420)
                    if s == "KS":
                        return abs(cx - 420) + abs(cy - 300)
                    return 1e9
                cands = sorted(cands, key=score4)
            if n == 3:
                cands = sorted(cands, key=lambda s: 0 if (s == "NM" and cx < 400) or (s == "NE" and cx >= 400) else 1)
            if n == 2:
                def score2(s):
                    if s == "ID":
                        return abs(cx - 220) + abs(cy - 160)
                    if s == "MT":
                        return abs(cx - 320) + abs(cy - 100)
                    if s == "WV":
                        return abs(cx - 720) + abs(cy - 280)
                    if s == "NH":
                        return abs(cx - 860) + abs(cy - 80)
                    if s == "ME":
                        return abs(cx - 900) + abs(cy - 60)
                    if s == "RI":
                        return abs(cx - 900) + abs(cy - 150)
                    if s == "HI":
                        return abs(cx - 180) + abs(cy - 520)
                    return 1e9
                cands = sorted(cands, key=score2)
            if n == 1:
                def score1(s):
                    if s == "AK":
                        return abs(cx - 80) + abs(cy - 520)
                    if s == "VT":
                        return abs(cx - 840) + abs(cy - 70)
                    if s == "DE":
                        return abs(cx - 820) + abs(cy - 240)
                    if s == "ND":
                        return abs(cx - 400) + abs(cy - 80)
                    if s == "SD":
                        return abs(cx - 400) + abs(cy - 140)
                    if s == "WY":
                        return abs(cx - 300) + abs(cy - 180)
                    return 1e9
                cands = sorted(cands, key=score1)
            st = cands[idx] if idx < len(cands) else cands[-1]
            used_multi[n] = idx + 1
        labeled.append((st or f"?{n}", cl, cx, cy))
        print(f"\n=== {st or '?'} n={n} img=({cx:.0f},{cy:.0f}) ===")
        print(ascii(cl))

    # Debug draw
    dbg = img.copy()
    draw = ImageDraw.Draw(dbg)
    for cx, cy in kept:
        draw.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=(0, 255, 0))
    for st, cl, cx, cy in labeled:
        draw.text((cx, cy), st or "?", fill=(0, 0, 0))
    dbg.save(OUT / "cartogram_tiles_detected.png")
    print("wrote", OUT / "cartogram_tiles_detected.png")

    # If we got ~435 tiles, emit shapes with absolute coords
    if len(grid_pts) >= 400:
        shapes = {st: cl for st, cl, _, _ in labeled if st and not st.startswith("?")}
        allc = [p for cl in shapes.values() for p in cl]
        minx = min(p[0] for p in allc)
        miny = min(p[1] for p in allc)
        lines = [
            "// NYT-style House cartogram silhouettes (tile-detected from reference).",
            "window.FEA_ATLAS_CARTOGRAM_SHAPES = {",
        ]
        for st in sorted(shapes, key=lambda s: (-len(shapes[s]), s)):
            cells = sorted((x - minx, y - miny) for x, y in shapes[st])
            body = ",".join(f"[{x},{y}]" for x, y in cells)
            lines.append(f"  {st}:[{body}],")
        lines.append("};")
        out_js = Path(r"C:\Users\zydlo\OneDrive\Desktop\federalelections\assets\atlas-cartogram-shapes.js")
        out_js.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("wrote shapes", sum(len(v) for v in shapes.values()), "states", len(shapes))


if __name__ == "__main__":
    main()
