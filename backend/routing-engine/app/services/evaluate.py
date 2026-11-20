"""POST /routes/evaluate orchestration.

snap origin -> one multi-target Dijkstra (Stage-A cost) to every eligible snapped shelter -> top-N reachable
shelters by cost -> per shelter: A* best path + Yen alternatives -> Stage-B score every (shelter, path)
-> recommended = min R, alternatives = next best routes passing the overlap (diversity) filter.
"""
import hashlib
import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.algorithms.alternatives import diverse_select, overlap, yen_k_shortest
from app.algorithms.astar import astar, haversine_heuristic
from app.algorithms.dijkstra import dijkstra, reconstruct
from app.config import Settings
from app.errors import ApiError
from app.graph.geometry import DEG, EARTH_R, slice_polyline
from app.models import EvaluateRequest
from app.scoring.route_score import (capacity_factor, default_weights, normalize_weights, population_factor,
                                     route_metrics, score)
from app.services.snapping import snap_point, splice

ORIGIN = -1


def shelter_node(i: int) -> int:
    return -(i + 2)


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def valid_lonlat(lon, lat) -> bool:
    return math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90


@dataclass
class Option:
    shelter_index: int
    cost: float
    nodes: list
    arcs: list
    metrics: object = None
    r: float = 0.0
    breakdown: dict = field(default_factory=dict)
    contrib: dict = field(default_factory=dict)
    lengths: dict = None

    @property
    def distance(self):
        return self.metrics.distance

    @property
    def intervals(self):
        return self.metrics.intervals


def shelter_reason(sh, people: int, accessible: bool) -> str | None:
    if not valid_lonlat(sh.longitude, sh.latitude):
        return "invalid_coordinates"
    if sh.status in ("closed", "full"):
        return sh.status
    if sh.total_capacity <= 0 or sh.available_capacity < people:
        return "insufficient_capacity"
    if accessible and not sh.accessible:
        return "not_accessible"
    return None


def geometry(arcs, snap) -> dict:
    coords = []
    for arc in arcs:
        e = snap.edges[arc[2]]
        piece = slice_polyline(e.coords, e.cum, arc[3], arc[4])
        if coords and coords[-1] == piece[0]:
            piece = piece[1:]
        coords.extend(piece)
    return {"type": "LineString", "coordinates": [[round(x, 7), round(y, 7)] for x, y in coords]}


def evaluate(req: EvaluateRequest, snap, s: Settings) -> dict:
    started = time.monotonic()
    deadline = started + s.routing_time_budget_seconds
    mode, acc, people = req.travel_mode, req.needs_accessible_route, req.people_count
    lon, lat = req.origin.longitude, req.origin.latitude
    if not valid_lonlat(lon, lat):
        raise ApiError(422, "INVALID_COORDINATES", "origin latitude/longitude out of range",
                       {"latitude": lat, "longitude": lon})
    given = req.weights.model_dump(exclude_none=True) if req.weights else {}
    try:
        weights = normalize_weights({**default_weights(s), **given})
    except ValueError as exc:
        raise ApiError(422, "INVALID_WEIGHTS", str(exc)) from exc

    profile = snap.profile(mode, acc, s)
    algorithm = "astar" if profile.admissible else "dijkstra"
    out = {
        "status": "ok", "graphVersion": snap.version, "calculatedAt": iso(datetime.now(timezone.utc)),
        "algorithm": algorithm,
        "origin": {"input": [lon, lat], "snapped": None, "edgeId": None, "snapDistanceMeters": None},
        "candidates": [], "recommended": None, "alternatives": [], "excludedRoads": [], "explanation": [],
        "weights": weights,
        "policy": {"unknownRoad": s.unknown_road_policy,
                   "restrictedRoad": "exclude" if acc else s.restricted_policy, "blocked": "exclude"},
    }
    if not profile.eligible:
        out["status"] = "insufficient_data"
        out["explanation"].append(f"The road graph (version {snap.version}) has no passable edges for {mode}.")
        return out

    origin, nearest = snap_point(snap, profile.eligible, lon, lat, s.snap_max_meters)
    if origin is None:
        raise ApiError(422, "ORIGIN_NOT_ROUTABLE",
                       f"origin is farther than {s.snap_max_meters:.0f} m from any road usable for {mode}",
                       {"nearestDistanceMeters": None if nearest is None else round(nearest, 1)})
    out["origin"].update(snapped=[round(origin.lon, 7), round(origin.lat, 7)], edgeId=origin.edge_id,
                         snapDistanceMeters=round(origin.distance, 1))

    # Shelter eligibility (business rules first, then network snapping).
    cands, targets = [], {}
    for i, sh in enumerate(req.shelters):
        reason = shelter_reason(sh, people, acc)
        if reason is None:
            t, _ = snap_point(snap, profile.eligible, sh.longitude, sh.latitude, s.snap_max_meters)
            if t is None:
                reason = "not_connected_to_network"
            else:
                targets[shelter_node(i)] = t
        cands.append({"shelterId": sh.id, "code": sh.code, "eligible": reason is None, "reachable": False,
                      "excludedReason": reason, "bestRiskScore": None, "distanceMeters": None})
    out["candidates"] = cands
    excluded_summary = summarize_reasons(cands)
    if not targets:
        out["status"] = "insufficient_data"
        out["explanation"] += [f"None of the {len(cands)} shelters is eligible for this group."] + excluded_summary
        return out

    adj, rev, coords = splice(profile, snap, ORIGIN, origin, targets)
    dist, prev = dijkstra(adj, ORIGIN, targets=list(targets))
    reachable = sorted((dist[n], n) for n in targets if n in dist)
    for n in targets:
        if n not in dist:
            cands[-n - 2]["excludedReason"] = "no_path_in_graph"
    if not reachable:
        out["status"] = "no_route"
        out["explanation"] += [f"No eligible shelter is reachable from the origin on currently passable roads "
                               f"for {mode}."] + excluded_summary
        return out

    pop = population_factor(people, req.population.children, req.population.elderly,
                            req.population.disabled, req.population.medical_needs)
    d_max = s.d_max_walking_meters if mode == "walking" else s.d_max_driving_meters
    lengths = {}

    def make_option(i, cost, nodes, arcs):
        sh = req.shelters[i]
        o = Option(i, cost, nodes, arcs, lengths=lengths)
        for a in arcs:
            lengths[a[2]] = snap.edges[a[2]].length
        o.metrics = route_metrics(arcs, snap, mode, acc, s)
        o.r, o.breakdown, o.contrib = score(o.metrics, d_max, capacity_factor(
            sh.total_capacity, sh.available_capacity, people), pop, weights)
        return o

    def record(o):
        c = cands[o.shelter_index]
        if c["bestRiskScore"] is None or o.r < c["bestRiskScore"]:
            c["bestRiskScore"], c["distanceMeters"] = round(o.r, 1), round(o.distance, 1)

    # Reachable shelters beyond the top-N still get their least-cost (Dijkstra tree) path scored for `candidates`.
    top = reachable[: max(1, s.candidate_shelters)]
    for cost, n in reachable:
        cands[-n - 2]["reachable"] = True
    for cost, n in reachable[len(top):]:
        nodes, arcs = reconstruct(prev, n)
        record(make_option(-n - 2, cost, nodes, arcs))

    options = []
    k = 1 if req.max_alternatives == 0 else max(1, s.yen_paths_per_shelter)
    for cost, n in top:
        h = haversine_heuristic(coords, n, profile.max_speed) if profile.admissible else (lambda _n: 0.0)
        best = astar(adj, ORIGIN, n, h)
        if best is None or abs(best[0] - cost) > 1e-6 * max(1.0, cost):
            raise RuntimeError(f"A* disagrees with Dijkstra for shelter node {n}: {best and best[0]} vs {cost}")
        paths = [best]
        if k > 1:
            rdist, _ = dijkstra(rev, n)   # exact cost-to-go: consistent heuristic for the spur searches

            def spur(a, src, tgt, bn, ba, rdist=rdist):
                return astar(a, src, tgt, lambda v: rdist.get(v, math.inf), bn, ba)
            paths += yen_k_shortest(adj, ORIGIN, n, k, spur, deadline)[1:]
        for c_, nodes, arcs in paths:
            o = make_option(-n - 2, c_, nodes, arcs)
            record(o)
            options.append(o)

    options.sort(key=lambda o: (o.r, o.distance))
    rec = options[0]
    limit = min(req.max_alternatives, s.max_alternatives)
    alts = diverse_select(options[1:], limit, s.overlap_threshold, chosen=[rec])

    shelters = req.shelters
    out["recommended"] = route_json(rec, 1, snap, shelters, rec, mode)
    out["alternatives"] = [route_json(o, i + 2, snap, shelters, rec, mode) for i, o in enumerate(alts)]

    routes = [out["recommended"]] + out["alternatives"]
    excluded, blocked_n = excluded_roads(routes, snap, profile, s)
    out["excludedRoads"] = excluded

    sh = shelters[rec.shelter_index]
    expl = [f"Compared {len(options)} candidate routes to {min(len(reachable), s.candidate_shelters)} of "
            f"{len(reachable)} reachable shelters ({len(targets)} of {len(cands)} shelters eligible)."]
    if blocked_n:
        expl.append(f"Avoids {blocked_n} blocked road segments within the search area")
    expl.append(f"Selected shelter has {sh.available_capacity} spaces for a group of {people}")
    shortest = min(options, key=lambda o: o.distance)
    if shortest is rec or shortest.distance >= rec.distance - 0.5:
        expl.append("Is also the shortest feasible route evaluated")
    else:
        expl.append(f"Adds {rec.distance - shortest.distance:.0f} m compared with the shortest feasible route")
        if rec.metrics.flood < shortest.metrics.flood:
            expl.append(f"Lower modeled flood exposure (F={rec.metrics.flood:.1f}) than the shortest alternative "
                        f"(F={shortest.metrics.flood:.1f})")
    if not profile.admissible:
        expl.append("A cost multiplier is below 1, so the A* heuristic is not admissible; Dijkstra was used.")
    out["explanation"] = expl + excluded_summary
    out["computeMs"] = round((time.monotonic() - started) * 1000, 1)
    return out


def summarize_reasons(cands) -> list:
    counts = {}
    for c in cands:
        if c["excludedReason"]:
            counts[c["excludedReason"]] = counts.get(c["excludedReason"], 0) + 1
    if not counts:
        return []
    return [f"{sum(counts.values())} shelter(s) excluded: " +
            ", ".join(f"{k} ({v})" for k, v in sorted(counts.items()))]


def route_json(o: Option, rank, snap, shelters, rec: Option, mode) -> dict:
    sh = shelters[o.shelter_index]
    m = o.metrics
    shared = 1.0 if o is rec else overlap(o, rec)
    expl = [f"{m.distance:.0f} m, about {m.duration / 60:.0f} min {mode} to {sh.name}",
            f"Mean modeled flood exposure F={m.flood:.1f} (highest edge flood risk {m.max_flood:.0f})"]
    if m.status_counts.get("restricted") or m.status_counts.get("unknown"):
        expl.append(f"Uses {m.status_counts.get('restricted', 0)} restricted and "
                    f"{m.status_counts.get('unknown', 0)} unknown-status road segments")
    expl.append(f"Projected shelter occupancy after arrival: {o.breakdown['capacity']:.0f}%")
    if o is not rec:
        expl.append(f"Shares {shared * 100:.0f}% of its length with the recommended route")
    edge_part = ",".join(map(str, m.edge_ids))
    return {
        "id": hashlib.sha1(f"{sh.id}|{edge_part}".encode()).hexdigest(),
        "rank": rank, "shelterId": sh.id, "shelterCode": sh.code, "shelterName": sh.name,
        "geometry": geometry(o.arcs, snap), "edgeIds": m.edge_ids,
        "distanceMeters": round(m.distance, 1), "durationSeconds": round(m.duration, 1),
        "riskScore": round(o.r, 1),
        "riskBreakdown": {k: round(v, 1) for k, v in o.breakdown.items()},
        "weightedContributions": {k: round(v, 2) for k, v in o.contrib.items()},
        "maxFloodRisk": m.max_flood, "roadStatusCounts": m.status_counts,
        "sharedWithRecommended": round(shared, 3), "explanation": expl,
    }


def excluded_roads(routes, snap, profile, s: Settings):
    """Edges excluded from this profile whose bbox meets the routes' bbox (buffered). -> (list<=cap, blocked count)."""
    xs = [c[0] for r in routes for c in r["geometry"]["coordinates"]]
    ys = [c[1] for r in routes for c in r["geometry"]["coordinates"]]
    dlat = s.excluded_roads_buffer_meters / (EARTH_R * DEG)
    dlon = dlat / max(math.cos((min(ys) + max(ys)) / 2 * DEG), 1e-6)
    x0, x1, y0, y1 = min(xs) - dlon, max(xs) + dlon, min(ys) - dlat, max(ys) + dlat
    hits = []
    for eid, reason in profile.excluded.items():
        e = snap.edges[eid]
        ex = [c[0] for c in e.coords]
        ey = [c[1] for c in e.coords]
        if max(ex) >= x0 and min(ex) <= x1 and max(ey) >= y0 and min(ey) <= y1:
            hits.append((reason != "blocked", eid, e, reason))
    hits.sort(key=lambda h: (h[0], h[1]))
    blocked_n = sum(1 for h in hits if not h[0])
    return [{"edgeId": eid, "name": e.name, "status": e.status, "roadType": e.road_type, "reason": reason}
            for _, eid, e, reason in hits[: s.excluded_roads_cap]], blocked_n
