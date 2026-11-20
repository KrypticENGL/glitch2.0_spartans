"""Custom A*. With a consistent heuristic (haversine / max speed, or an exact reverse-Dijkstra distance)
the first time a node is popped its cost is final, so a closed set is safe."""
import math
from heapq import heappop, heappush

from app.algorithms.dijkstra import EMPTY, NegativeWeightError
from app.graph.geometry import haversine


def astar(adj, source, target, h, banned_nodes=EMPTY, banned_arcs=EMPTY):
    """-> (cost, nodes, arcs) or None. h(node) -> lower bound to target (math.inf prunes the node)."""
    if source not in adj:
        raise ValueError(f"source node {source!r} is not in the graph")
    g = {source: 0.0}
    parent = {source: None}
    closed = set()
    heap = [(h(source), 0, source)]
    tie = 1
    while heap:
        _, _, u = heappop(heap)
        if u in closed:
            continue
        if u == target:
            nodes, arcs, step = [u], [], parent[u]
            while step is not None:
                p, arc = step
                nodes.append(p); arcs.append(arc)
                step = parent[p]
            return g[u], nodes[::-1], arcs[::-1]
        closed.add(u)
        gu = g[u]
        for arc in adj.get(u, ()):
            v, c = arc[0], arc[1]
            if c < 0:
                raise NegativeWeightError(f"negative cost {c} on arc {u!r}->{v!r}")
            if v in closed or v in banned_nodes or (banned_arcs and (u, v, arc[2]) in banned_arcs):
                continue
            nd = gu + c
            if nd < g.get(v, math.inf):
                hv = h(v)
                if hv == math.inf:
                    continue
                g[v] = nd
                parent[v] = (u, arc)
                heappush(heap, (nd + hv, tie, v))
                tie += 1
    return None


def haversine_heuristic(coords, target, max_speed):
    """Remaining great-circle distance / fastest speed in the mode. Admissible because every arc cost is
    >= its polyline length / max_speed (all cost multipliers >= 1) and polyline length >= chord."""
    tx, ty = coords[target]
    inv = 0.999 / max_speed  # tiny slack absorbs float rounding

    def h(n):
        x, y = coords[n]
        return haversine(x, y, tx, ty) * inv
    return h
