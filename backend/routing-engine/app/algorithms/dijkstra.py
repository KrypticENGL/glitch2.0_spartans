"""Custom binary-heap Dijkstra over the arc adjacency (see app.graph.snapshot for the arc format)."""
from heapq import heappop, heappush

EMPTY = frozenset()


class NegativeWeightError(ValueError):
    pass


def dijkstra(adj, source, targets=None, banned_nodes=EMPTY, banned_arcs=EMPTY):
    """Single-source shortest paths.

    Returns (dist, prev): dist[v] is the final cost of every settled node; prev[v] = (u, arc) or None for
    the source. Unreachable nodes are simply absent. With `targets`, stops once all of them are settled.
    banned_nodes / banned_arcs ((u, v, edge_id) keys) support Yen's spur searches.
    Raises ValueError for an unknown source and NegativeWeightError on a negative arc cost.
    """
    if source not in adj:
        raise ValueError(f"source node {source!r} is not in the graph")
    remaining = set(targets) if targets is not None else None
    dist, prev = {}, {}
    best = {source: 0.0}
    parent = {source: None}
    heap = [(0.0, 0, source)]
    tie = 1  # insertion counter: node ids may be of mixed/uncomparable types
    while heap:
        d, _, u = heappop(heap)
        if u in dist:
            continue
        dist[u] = d
        prev[u] = parent[u]
        if remaining is not None:
            remaining.discard(u)
            if not remaining:
                break
        for arc in adj.get(u, ()):
            v, c = arc[0], arc[1]
            if c < 0:
                raise NegativeWeightError(f"negative cost {c} on arc {u!r}->{v!r}")
            if v in dist or v in banned_nodes or (banned_arcs and (u, v, arc[2]) in banned_arcs):
                continue
            nd = d + c
            if nd < best.get(v, float("inf")):
                best[v] = nd
                parent[v] = (u, arc)
                heappush(heap, (nd, tie, v))
                tie += 1
    return dist, prev


def reconstruct(prev, target):
    """-> (nodes, arcs) from the source to target, or None if target was not reached."""
    if target not in prev:
        return None
    nodes, arcs = [target], []
    step = prev[target]
    while step is not None:
        u, arc = step
        nodes.append(u)
        arcs.append(arc)
        step = prev[u]
    return nodes[::-1], arcs[::-1]


def shortest_path(adj, source, target, banned_nodes=EMPTY, banned_arcs=EMPTY):
    """-> (cost, nodes, arcs) or None. Plain Dijkstra spur search for Yen."""
    dist, prev = dijkstra(adj, source, [target], banned_nodes, banned_arcs)
    path = reconstruct(prev, target)
    return None if path is None else (dist[target], path[0], path[1])
