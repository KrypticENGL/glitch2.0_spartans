"""Yen's k-shortest loopless paths (spur searches via the custom Dijkstra/A*) and a diversity filter."""
import itertools
import time
from heapq import heappop, heappush

from app.algorithms.dijkstra import shortest_path


def arc_key(u, arc):
    return (u, arc[0], arc[2])


def yen_k_shortest(adj, source, target, k, spur_search=None, deadline=None):
    """Up to k loopless paths in nondecreasing cost: list of (cost, nodes, arcs).

    spur_search(adj, s, t, banned_nodes, banned_arcs) -> (cost, nodes, arcs) | None; defaults to Dijkstra.
    Stops early (returning what it has) once time.monotonic() > deadline.
    """
    if k < 1:
        raise ValueError("k must be >= 1")
    search = spur_search or shortest_path
    first = search(adj, source, target, frozenset(), frozenset())
    if first is None:
        return []
    found = [first]
    seen = {tuple(arc_key(u, a) for u, a in zip(first[1], first[2]))}
    pool, tie = [], itertools.count()
    while len(found) < k:
        _, last_nodes, last_arcs = found[-1]
        root_cost = 0.0
        for i in range(len(last_nodes) - 1):
            if deadline is not None and time.monotonic() > deadline:
                return found
            spur = last_nodes[i]
            root_nodes = last_nodes[: i + 1]
            banned_arcs = {arc_key(p[1][i], p[2][i]) for p in found
                           if len(p[1]) > i + 1 and p[1][: i + 1] == root_nodes}
            res = search(adj, spur, target, frozenset(root_nodes[:-1]), banned_arcs)
            if res is not None:
                nodes = root_nodes[:-1] + res[1]
                arcs = last_arcs[:i] + res[2]
                key = tuple(arc_key(u, a) for u, a in zip(nodes, arcs))
                if key not in seen:
                    seen.add(key)
                    heappush(pool, (root_cost + res[0], next(tie), nodes, arcs))
            root_cost += last_arcs[i][1]
        if not pool:
            break
        cost, _, nodes, arcs = heappop(pool)
        found.append((cost, nodes, arcs))
    return found


def edge_intervals(arcs):
    """edge_id -> merged list of [lo, hi] length-fraction intervals covered by the path."""
    out = {}
    for arc in arcs:
        a, b = sorted((arc[3], arc[4]))
        out.setdefault(arc[2], []).append([a, b])
    for ivs in out.values():
        ivs.sort()
        merged = [ivs[0]]
        for lo, hi in ivs[1:]:
            if lo <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], hi)
            else:
                merged.append([lo, hi])
        ivs[:] = merged
    return out


def shared_length(iv1, iv2, lengths):
    total = 0.0
    for eid in iv1.keys() & iv2.keys():
        for lo1, hi1 in iv1[eid]:
            for lo2, hi2 in iv2[eid]:
                total += max(0.0, min(hi1, hi2) - max(lo1, lo2)) * lengths[eid]
    return total


def diverse_select(candidates, limit, threshold, chosen=()):
    """Greedy pick in the given order; reject a candidate whose length overlap with any already-chosen
    route exceeds `threshold` (overlap = shared length / candidate length).
    candidates: objects with .intervals (edge_intervals), .distance and .lengths (edge id -> metres)."""
    picked = list(chosen)
    out = []
    for c in candidates:
        if len(out) >= limit:
            break
        if all(overlap(c, p) <= threshold for p in picked):
            picked.append(c)
            out.append(c)
    return out


def overlap(a, b) -> float:
    if a.distance <= 0:
        return 1.0
    return shared_length(a.intervals, b.intervals, a.lengths) / a.distance
