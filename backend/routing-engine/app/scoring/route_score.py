"""Stage B: route + shelter score R = wF*F + wA*A + wD*D + wC*C + wP*P, every factor on 0..100 (lower is better).

F = length-weighted mean edge flood_risk along the route.
A = length-weighted mean of (edge access_risk + status penalty points: restricted / unknown), capped at 100.
D = min(100, distance / D_max(mode) * 100).
C = projected shelter occupancy after the group arrives: 100 * (total - available + people) / total.
P = group vulnerability: min(100, 50 * (children + elderly + 2*disabled) / peopleCount + (30 if medicalNeeds)).
    P does not depend on the route; it shifts every option equally but keeps R comparable across requests.
Scores are experimental rankings, not probabilities of safety.
"""
from dataclasses import dataclass

from app.algorithms.alternatives import edge_intervals
from app.config import Settings

FACTORS = ("flood", "access", "distance", "capacity", "population")


def default_weights(s: Settings) -> dict:
    return {"flood": s.weight_flood, "access": s.weight_access, "distance": s.weight_distance,
            "capacity": s.weight_capacity, "population": s.weight_population}


def normalize_weights(w: dict) -> dict:
    """Weights must be finite and >= 0 with a positive sum; rescaled to sum to 1 so R stays in 0..100."""
    if any(not (v >= 0) for v in w.values()):
        raise ValueError("weights must be non-negative numbers")
    total = sum(w.values())
    if total <= 0:
        raise ValueError("weights must not all be zero")
    return {k: w[k] / total for k in FACTORS}


def population_factor(people: int, children: int, elderly: int, disabled: int, medical: bool) -> float:
    return min(100.0, 50.0 * (children + elderly + 2 * disabled) / people + (30.0 if medical else 0.0))


def capacity_factor(total: int, available: int, people: int) -> float:
    return min(100.0, 100.0 * (total - available + people) / total)


@dataclass
class RouteMetrics:
    distance: float
    duration: float
    flood: float          # F
    access: float         # A
    max_flood: float
    status_counts: dict
    edge_ids: list
    intervals: dict       # edge id -> merged fraction intervals (for overlap)


def route_metrics(arcs, snapshot, mode, accessible, s: Settings) -> RouteMetrics:
    dist = dur = f_sum = a_sum = max_flood = 0.0
    counts = {"open": 0, "restricted": 0, "unknown": 0}
    edge_ids, seen = [], set()
    speed = s.accessible_walking_speed_mps if accessible else s.walking_speed_mps
    for arc in arcs:
        e = snapshot.edges[arc[2]]
        frac = abs(arc[4] - arc[3])
        length = e.length * frac
        dist += length
        dur += length / speed if mode == "walking" else e.travel_time * frac
        f_sum += e.flood_risk * length
        penalty = (s.restricted_access_points if e.status == "restricted"
                   else s.unknown_access_points if e.status == "unknown" else 0.0)
        a_sum += min(100.0, e.access_risk + penalty) * length
        if length <= 0:
            continue   # zero-length snap piece (point exactly at a node): not part of the travelled route
        max_flood = max(max_flood, e.flood_risk)
        if e.id not in seen:
            seen.add(e.id)
            edge_ids.append(e.id)
            counts[e.status] = counts.get(e.status, 0) + 1
    return RouteMetrics(dist, dur, f_sum / dist if dist else 0.0, a_sum / dist if dist else 0.0,
                        max_flood, counts, edge_ids, edge_intervals(arcs))


def score(m: RouteMetrics, d_max: float, capacity: float, population: float, weights: dict):
    """-> (R, breakdown, weighted contributions)."""
    breakdown = {"flood": m.flood, "access": m.access, "distance": min(100.0, m.distance / d_max * 100.0),
                 "capacity": capacity, "population": population}
    contrib = {k: weights[k] * breakdown[k] for k in FACTORS}
    return sum(contrib.values()), breakdown, contrib
