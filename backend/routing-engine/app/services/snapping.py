"""Snap a point to the nearest edge eligible for a profile (not the nearest node) using the snapshot's
grid index over edge segments, and splice virtual nodes into the routing graph."""
import math
from dataclasses import dataclass

from app.graph.geometry import EARTH_R, DEG, project_to_segment
from app.graph.snapshot import GRID_DEG

NEAREST_REPORT_RADIUS_M = 5000.0


@dataclass
class Snap:
    edge_id: int
    frac: float            # length fraction along the edge (source -> target)
    lon: float
    lat: float
    distance: float        # metres from the input point


def nearest_edge(snapshot, eligible, lon, lat, radius_m) -> Snap | None:
    dlat = radius_m / (EARTH_R * DEG)
    dlon = dlat / max(math.cos(lat * DEG), 1e-6)
    best = None
    grid = snapshot.grid
    checked = set()
    for ix in range(math.floor((lon - dlon) / GRID_DEG), math.floor((lon + dlon) / GRID_DEG) + 1):
        for iy in range(math.floor((lat - dlat) / GRID_DEG), math.floor((lat + dlat) / GRID_DEG) + 1):
            for item in grid.get((ix, iy), ()):
                if item in checked or item[0] not in eligible:
                    continue
                checked.add(item)
                eid, i = item
                e = snapshot.edges[eid]
                (ax, ay), (bx, by) = e.coords[i], e.coords[i + 1]
                d, t = project_to_segment(lon, lat, ax, ay, bx, by)
                if d <= radius_m and (best is None or d < best[0]):
                    best = (d, eid, i, t)
    if best is None:
        return None
    d, eid, i, t = best
    e = snapshot.edges[eid]
    (ax, ay), (bx, by) = e.coords[i], e.coords[i + 1]
    frac = (e.cum[i] + t * (e.cum[i + 1] - e.cum[i])) / e.length
    return Snap(eid, min(1.0, max(0.0, frac)), ax + t * (bx - ax), ay + t * (by - ay), d)


def snap_point(snapshot, eligible, lon, lat, max_m):
    """-> (Snap | None, nearest distance found within a 5 km report radius or None)."""
    s = nearest_edge(snapshot, eligible, lon, lat, max_m)
    if s is not None:
        return s, s.distance
    far = nearest_edge(snapshot, eligible, lon, lat, max(max_m, NEAREST_REPORT_RADIUS_M))
    return None, (far.distance if far else None)


def splice(profile, snapshot, origin_id, origin: Snap, targets: dict):
    """Overlay virtual nodes on a copy of the profile graph (the cached profile is never mutated).

    origin node only has outgoing arcs, target nodes only incoming arcs, so no route passes through them.
    Partial costs are the edge's Stage-A cost times the split fraction; driving respects oneway.
    Returns (adj, rev, coords).
    """
    adj, rev = dict(profile.adj), dict(profile.rev)
    coords = dict(snapshot.nodes)
    bidir = profile.mode == "walking"

    def add(u, arc):
        adj[u] = adj.get(u, []) + [arc]
        rev[arc[0]] = rev.get(arc[0], []) + [(u,) + arc[1:]]

    def two_way(e):
        return bidir or not e.oneway

    e = snapshot.edges[origin.edge_id]
    c = profile.edge_cost[e.id]
    coords[origin_id] = (origin.lon, origin.lat)
    adj.setdefault(origin_id, [])
    rev.setdefault(origin_id, [])
    add(origin_id, (e.target, c * (1 - origin.frac), e.id, origin.frac, 1.0))
    if two_way(e):
        add(origin_id, (e.source, c * origin.frac, e.id, origin.frac, 0.0))
    for node_id, t in targets.items():
        te = snapshot.edges[t.edge_id]
        tc = profile.edge_cost[te.id]
        coords[node_id] = (t.lon, t.lat)
        adj.setdefault(node_id, [])
        rev.setdefault(node_id, [])
        add(te.source, (node_id, tc * t.frac, te.id, 0.0, t.frac))
        if two_way(te):
            add(te.target, (node_id, tc * (1 - t.frac), te.id, 1.0, t.frac))
        if te.id == e.id and (two_way(e) or t.frac >= origin.frac):
            add(origin_id, (node_id, c * abs(t.frac - origin.frac), e.id, origin.frac, t.frac))
    return adj, rev, coords
