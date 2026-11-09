"""
Hand-authored NYT-style House cartogram silhouettes.

Each state is a polyomino whose outline echoes the geographic silhouette.
States sit on one absolute grid with a single empty-cell barrier between neighbors.
"""
from __future__ import annotations

from pathlib import Path

# Local polyominoes — '#' = seat. Counts MUST match SEATS.
LOCAL: dict[str, list[str]] = {
    # CA 52 — coastal slant, wider mid/south like the reference
    "CA": [
        ".###....",  # 3
        "####....",  # 4 = 7
        "####....",  # 4 = 11
        "#####...",  # 5 = 16
        "#####...",  # 5 = 21
        ".#####..",  # 5 = 26
        ".######.",  # 6 = 32
        "..#####.",  # 5 = 37
        "..#####.",  # 5 = 42
        "...####.",  # 4 = 46
        "...####.",  # 4 = 50
        "....##..",  # 2 = 52
    ],
    "OR": ["###", "###"],
    "WA": ["####", "####", ".##."],
    "NV": ["##", "##"],
    "ID": ["#", "#"],
    "MT": ["##"],
    "WY": ["#"],
    "UT": ["##", "##"],
    "AZ": [".##", "###", "####"],
    "NM": ["##", "#."],
    "CO": ["###", "###", ".##"],
    # TX 38 — broad + South Texas tip
    "TX": [
        ".#####..",  # 5
        "#######.",  # 7 = 12
        "########",  # 8 = 20
        "########",  # 8 = 28
        ".######.",  # 6 = 34
        "..###...",  # 3 = 37
        "...#....",  # 1 = 38
    ],
    "OK": ["#.####"],
    "KS": ["####"],
    "NE": ["###"],
    "SD": ["#"],
    "ND": ["#"],
    "MN": ["##", "##", "##", "##"],
    "IA": ["##", "##"],
    "MO": ["###", "###", ".##"],
    "AR": ["##", "##"],
    "LA": ["###", "##.", ".#."],
    "WI": ["###", "###", ".##"],
    "IL": [".##", "###", "###", "###", "###", ".###"],
    "MI": ["..##", ".###", "####", "####"],
    "IN": ["###", "###", "###"],
    "OH": ["####", "####", "####", ".###"],
    "KY": ["######"],
    "TN": ["#########"],
    "MS": ["##", "##"],
    "AL": ["###", "###", ".#."],
    "GA": ["####", "####", "####", ".##."],
    # FL 28 — panhandle west + peninsula south
    "FL": [
        "######....",  # 6
        "...#######",  # 7 = 13
        ".....#####",  # 5 = 18
        "......####",  # 4 = 22
        "......###.",  # 3 = 25
        ".......##.",  # 2 = 27
        ".......#..",  # 1 = 28
    ],
    "SC": ["###", "###", ".#."],
    "NC": ["#######", "#######"],
    "VA": ["####", "####", ".###"],
    "WV": ["##"],
    "MD": ["##.###", "..###."],
    "DE": ["#"],
    "PA": ["#####", "#####", "#####", ".##.."],
    "NJ": ["##", "##", "##", "##", "##", "##"],
    # NY 26 — upstate block + Long Island
    "NY": [
        ".####.",  # 4
        "######",  # 6 = 10
        "######",  # 6 = 16
        ".####.",  # 4 = 20
        "..##..",  # 2 = 22
        "..####",  # 4 = 26
    ],
    "CT": ["###", ".##"],
    "RI": ["##"],
    "MA": ["#####", ".##.#", "....#"],
    "VT": ["#"],
    "NH": ["#", "#"],
    "ME": ["#", "#"],
    "AK": ["#"],
    "HI": ["##"],
}

# Tight anchors — ~1 empty cell between neighboring state bounds
ANCHOR: dict[str, tuple[int, int]] = {
    "WA": (1, 1),
    "ID": (7, 2),
    "MT": (10, 1),
    "ND": (14, 1),
    "MN": (17, 1),
    "WI": (21, 2),
    "MI": (26, 1),
    "VT": (38, 0),
    "NH": (44, 0),
    "ME": (52, 0),
    "OR": (1, 5),
    "NV": (7, 6),
    "WY": (11, 4),
    "SD": (14, 4),
    "IA": (19, 6),
    "IL": (23, 6),
    "IN": (28, 6),
    "OH": (32, 5),
    "PA": (37, 7),
    "NY": (38, 1),
    "MA": (46, 1),
    "RI": (53, 4),
    "CT": (46, 4),
    "CA": (0, 8),
    "UT": (8, 9),
    "CO": (12, 8),
    "NE": (15, 7),
    "MO": (20, 12),
    "KY": (28, 12),
    "WV": (35, 11),
    "MD": (40, 14),
    "NJ": (45, 7),
    "DE": (48, 14),
    "AZ": (8, 14),
    "NM": (12, 13),
    "KS": (16, 10),
    "OK": (14, 13),
    "AR": (20, 15),
    "TN": (24, 14),
    "VA": (36, 12),
    "NC": (36, 16),
    "TX": (11, 16),
    "LA": (20, 20),
    "MS": (23, 17),
    "AL": (26, 17),
    "GA": (30, 17),
    "SC": (37, 20),
    "FL": (33, 24),
    "AK": (1, 31),
    "HI": (5, 31),
}

SEATS = {
    "AL": 7, "AK": 1, "AZ": 9, "AR": 4, "CA": 52, "CO": 8, "CT": 5, "DE": 1,
    "FL": 28, "GA": 14, "HI": 2, "ID": 2, "IL": 17, "IN": 9, "IA": 4, "KS": 4,
    "KY": 6, "LA": 6, "ME": 2, "MD": 8, "MA": 9, "MI": 13, "MN": 8, "MS": 4,
    "MO": 8, "MT": 2, "NE": 3, "NV": 4, "NH": 2, "NJ": 12, "NM": 3, "NY": 26,
    "NC": 14, "ND": 1, "OH": 15, "OK": 5, "OR": 6, "PA": 17, "RI": 2, "SC": 7,
    "SD": 1, "TN": 9, "TX": 38, "UT": 4, "VT": 1, "VA": 11, "WA": 10, "WV": 2,
    "WI": 8, "WY": 1,
}


def cells_from_ascii(rows: list[str]) -> list[tuple[int, int]]:
    out = []
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == "#":
                out.append((x, y))
    return out


def main() -> None:
    shapes: dict[str, list[tuple[int, int]]] = {}
    errors = []
    for st, rows in LOCAL.items():
        local = cells_from_ascii(rows)
        n = len(local)
        want = SEATS[st]
        if n != want:
            errors.append(f"{st}: got {n}, want {want}")
        ax, ay = ANCHOR[st]
        shapes[st] = [(x + ax, y + ay) for x, y in local]
    if errors:
        raise SystemExit("Errors:\n" + "\n".join(errors))

    owner: dict[tuple[int, int], str] = {}
    overlaps = []
    for st, cells in shapes.items():
        for p in cells:
            if p in owner:
                overlaps.append(f"{p}: {owner[p]} vs {st}")
            else:
                owner[p] = st
    if overlaps:
        raise SystemExit("Overlaps:\n" + "\n".join(overlaps[:60]))

    # Soft adjacency check: warn if any two states share an edge (no barrier)
    touching = []
    for st, cells in shapes.items():
        for x, y in cells:
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                other = owner.get((nx, ny))
                if other and other != st:
                    pair = tuple(sorted((st, other)))
                    if pair not in touching:
                        touching.append(pair)
    if touching:
        print("TOUCHING (no barrier):", touching)

    minx = min(p[0] for p in owner)
    miny = min(p[1] for p in owner)
    for st in shapes:
        shapes[st] = sorted((x - minx, y - miny) for x, y in shapes[st])

    maxx = max(p[0] for cells in shapes.values() for p in cells)
    maxy = max(p[1] for cells in shapes.values() for p in cells)
    grid = [["." for _ in range(maxx + 1)] for _ in range(maxy + 1)]
    for st, cells in shapes.items():
        ch = st[0]
        for x, y in cells:
            grid[y][x] = ch
    print("MAP PREVIEW")
    for row in grid:
        print("".join(row))
    print("tiles", sum(len(v) for v in shapes.values()), "bbox", maxx + 1, "x", maxy + 1)

    for st in ("CA", "TX", "FL", "NY"):
        cells = shapes[st]
        xs = [c[0] for c in cells]
        ys = [c[1] for c in cells]
        s = set(cells)
        print(f"\n{st}")
        for y in range(min(ys), max(ys) + 1):
            print("".join("#" if (x, y) in s else "." for x in range(min(xs), max(xs) + 1)))

    lines = [
        "// Hand-sculpted NYT-style House cartogram silhouettes.",
        "// Squares form state shapes (CA slant, TX tip, FL peninsula, NY Long Island).",
        "window.FEA_ATLAS_CARTOGRAM_SHAPES = {",
    ]
    for st in sorted(shapes, key=lambda s: (-len(shapes[s]), s)):
        body = ",".join(f"[{x},{y}]" for x, y in shapes[st])
        lines.append(f"  {st}:[{body}],")
    lines.append("};")
    text = "\n".join(lines) + "\n"
    out = Path(r"C:\Users\zydlo\OneDrive\Desktop\federalelections\assets\atlas-cartogram-shapes.js")
    out.write_text(text, encoding="utf-8")
    wt = Path(r"C:\Users\zydlo\.cursor\worktrees\federalelections-visual-revamp\assets\atlas-cartogram-shapes.js")
    if wt.parent.exists():
        wt.write_text(text, encoding="utf-8")
    print("wrote", out)


if __name__ == "__main__":
    main()
