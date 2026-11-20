"""Immutable graph snapshot (one per graph_state.version) and per-travel-profile routing graphs.

Arc representation used by all algorithms: (v, cost, edge_id, frac_from, frac_to).
A full forward traversal is (target, c, id, 0.0, 1.0); a reverse one is (source, c, id, 1.0, 0.0);
partial arcs created by snapping use intermediate fractions. adjacency: dict[node, list[arc]].
"""
from __future__ import annotations

import math
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone

import networkx as nx

from app.config import Settings
from app.graph.geometry import cumulative_lengths, haversine
from app.scoring.edge_cost import base_speed, exclusion_reason, is_admissible_config, stage_a_cost

GRID_DEG = 0.004  # ~440 m cells for the edge-segment spatial index


@dataclass(frozen=True, slots=True)
class Edge:
    id: int
    source: int
    target: int
    coords: tuple            # ((lon, lat), ...) oriented source -> target
    cum: tuple               # cumulative haversine length per vertex
    travel_time: float       # driving baseline seconds (from DB)
    road_type: str
    name: str | None
    status: str              # open | restricted | blocked | unknown
    oneway: bool
    flood_risk: float
    access_risk: float
    travel_modes: tuple
    wheelchair_ok: bool

    @property
    def length(self) -> float:
        return self.cum[-1]


@dataclass(frozen=True)
class RawEdge:
    id: int
    source: int
    target: int
    coords: list
    travel_time: float
    road_type: str = "residential"
    name: str | None = None
    status: str = "open"
    oneway: bool = False
    flood_risk: float = 0
    access_risk: float = 0
    travel_modes: tuple = ("walking", "driving")
    wheelchair_ok: bool = True


@dataclass
class Profile:
    """Routing graph for one (travel mode, accessibility) combination under the current policies."""
    mode: str
    accessible: bool
    adj: dict
    rev: dict
    eligible: frozenset          # edge ids usable by this profile
    excluded: dict               # edge id -> reason (blocked, restricted_excluded, ...)
    edge_cost: dict              # edge id -> full-traversal Stage-A cost
    max_speed: float             # m/s upper bound used by the A* heuristic
    admissible: bool             # all multipliers >= 1, so haversine/max_speed never overestimates

    def to_networkx(self) -> nx.MultiDiGraph:
        g = nx.MultiDiGraph()
        for u, arcs in self.adj.items():
            g.add_node(u)
            for v, c, eid, a, b in arcs:
                g.add_edge(u, v, key=(eid, a, b), weight=c)
        return g


@dataclass
class Snapshot:
    version: int
    nodes: dict                  # id -> (lon, lat)
    edges: dict                  # id -> Edge (topologically valid only)
    issues: dict                 # edge id -> reason it was dropped
    reoriented: int = 0
    loaded_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    grid: dict = field(default_factory=dict)       # (ix, iy) -> list[(edge_id, seg_idx)]
    _profiles: dict = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @classmethod
    def build(cls, version: int, nodes: dict, raw_edges) -> "Snapshot":
        edges, issues, reoriented = {}, {}, 0
        for r in raw_edges:
            if r.source not in nodes or r.target not in nodes:
                issues[r.id] = "missing_node"; continue
            if r.source == r.target:
                issues[r.id] = "self_loop"; continue
            coords = [tuple(map(float, c)) for c in r.coords]
            if len(coords) < 2 or not all(math.isfinite(x) for c in coords for x in c):
                issues[r.id] = "bad_geometry"; continue
            if not (r.travel_time and r.travel_time > 0):
                issues[r.id] = "non_positive_travel_time"; continue
            # Orient geometry source -> target (imports occasionally store it reversed).
            s, t = nodes[r.source], nodes[r.target]
            d_fwd = haversine(*coords[0], *s) + haversine(*coords[-1], *t)
            d_rev = haversine(*coords[0], *t) + haversine(*coords[-1], *s)
            if d_rev < d_fwd:
                coords.reverse(); reoriented += 1
            cum = cumulative_lengths(coords)
            if cum[-1] <= 0.01:
                issues[r.id] = "zero_length"; continue
            edges[r.id] = Edge(r.id, r.source, r.target, tuple(coords), tuple(cum), float(r.travel_time),
                               r.road_type, r.name, r.status, bool(r.oneway), float(r.flood_risk),
                               float(r.access_risk), tuple(r.travel_modes), bool(r.wheelchair_ok))
        snap = cls(version=version, nodes=dict(nodes), edges=edges, issues=issues, reoriented=reoriented)
        snap._build_grid()
        return snap

    def _build_grid(self):
        grid = self.grid
        for e in self.edges.values():
            for i, ((x1, y1), (x2, y2)) in enumerate(zip(e.coords, e.coords[1:])):
                for ix in range(math.floor(min(x1, x2) / GRID_DEG), math.floor(max(x1, x2) / GRID_DEG) + 1):
                    for iy in range(math.floor(min(y1, y2) / GRID_DEG), math.floor(max(y1, y2) / GRID_DEG) + 1):
                        grid.setdefault((ix, iy), []).append((e.id, i))

    @property
    def excluded_count(self) -> int:
        """Edges never routable: blocked plus topologically invalid ones."""
        return sum(1 for e in self.edges.values() if e.status == "blocked") + len(self.issues)

    def profile(self, mode: str, accessible: bool, settings: Settings) -> Profile:
        key = (mode, accessible, settings.unknown_road_policy, settings.restricted_policy,
               settings.alpha_flood, settings.alpha_access, settings.restricted_multiplier,
               settings.unknown_multiplier, settings.walking_speed_mps, settings.accessible_walking_speed_mps)
        with self._lock:
            p = self._profiles.get(key)
            if p is None:
                p = self._profiles[key] = build_profile(self, mode, accessible, settings)
            return p


def build_profile(snap: Snapshot, mode: str, accessible: bool, s: Settings) -> Profile:
    adj: dict = {n: [] for n in snap.nodes}
    rev: dict = {n: [] for n in snap.nodes}
    eligible, excluded, costs = set(), {}, {}
    max_speed = 0.0
    for e in snap.edges.values():
        reason = exclusion_reason(e, mode, accessible, s)
        if reason:
            excluded[e.id] = reason
            continue
        c = stage_a_cost(e, mode, accessible, s)
        if not (c > 0 and math.isfinite(c)):
            excluded[e.id] = "invalid_cost"
            continue
        eligible.add(e.id)
        costs[e.id] = c
        max_speed = max(max_speed, base_speed(e, mode, accessible, s))
        adj[e.source].append((e.target, c, e.id, 0.0, 1.0))
        rev[e.target].append((e.source, c, e.id, 0.0, 1.0))
        if mode == "walking" or not e.oneway:   # walking ignores oneway; driving respects it
            adj[e.target].append((e.source, c, e.id, 1.0, 0.0))
            rev[e.source].append((e.target, c, e.id, 1.0, 0.0))
    return Profile(mode, accessible, adj, rev, frozenset(eligible), excluded, costs,
                   max_speed or 1.0, is_admissible_config(s))
