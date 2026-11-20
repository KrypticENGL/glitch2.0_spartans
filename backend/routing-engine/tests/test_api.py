import pytest

from app.graph.geometry import haversine
from tests.helpers import client, edge, request, shelter, snapshot, xy

GRID = [0, 1, 2, 10, 11, 12, 20, 21, 22]


def grid_edges(overrides=None):
    """3x3 grid; overrides: {edge_id: kwargs}. Edge ids are 1000*u + v (u < v)."""
    out = []
    for n in GRID:
        for m in (n + 1, n + 10):
            if m in GRID:
                eid = 1000 * n + m
                out.append(edge(eid, n, m, **(overrides or {}).get(eid, {})))
    return out


def test_health_and_reload():
    c, src = client(snapshot(grid_edges(), version=3))
    h = c.get("/health").json()
    assert h["status"] == "ok" and h["graphVersion"] == 3 and h["edges"] == 12 and h["nodes"] == 9
    r = c.post("/graph/reload", json={}).json()
    assert r == {"graphVersion": 3, "reloaded": False, "nodes": 9, "edges": 12, "excludedEdges": 0}


def test_health_503_when_db_unreachable():
    c, src = client(snapshot(grid_edges()))
    src.fail = True
    r = c.get("/health")
    assert r.status_code == 503 and r.json()["status"] == "unavailable"
    r = c.post("/routes/evaluate", json=request(0, [shelter("a", 22)]))
    assert r.status_code == 503 and r.json()["error"]["code"] == "GRAPH_UNAVAILABLE"


def test_multiple_shelter_comparison_and_route_shape():
    c, _ = client(snapshot(grid_edges()))
    body = request(0, [shelter("near", 20, available=50), shelter("far", 22, available=50)])
    j = c.post("/routes/evaluate", json=body).json()
    assert j["status"] == "ok" and j["algorithm"] == "astar"
    scores = {x["shelterId"]: x["bestRiskScore"] for x in j["candidates"]}
    assert all(x["reachable"] for x in j["candidates"])
    rec = j["recommended"]
    assert rec["shelterId"] == "near" and rec["riskScore"] == min(scores.values())
    assert abs(rec["distanceMeters"] - haversine(*xy(0), *xy(20))) < 0.5
    coords = rec["geometry"]["coordinates"]
    assert coords[0] == j["origin"]["snapped"] and len(coords) >= 2
    for a, b in zip(coords, coords[1:]):   # continuous polyline (no jumps between edge pieces)
        assert haversine(*a, *b) < 250
    assert rec["sharedWithRecommended"] == 1.0 and rec["rank"] == 1
    for alt in j["alternatives"]:
        assert alt["sharedWithRecommended"] <= 0.7 and alt["rank"] >= 2
    assert sum(rec["weightedContributions"].values()) == pytest.approx(rec["riskScore"], abs=0.06)


def test_insufficient_capacity_and_closed_excluded():
    c, _ = client(snapshot(grid_edges()))
    body = request(0, [shelter("tiny", 20, available=2), shelter("shut", 21, status="closed"),
                       shelter("ok", 22)])
    j = c.post("/routes/evaluate", json=body).json()
    by = {x["shelterId"]: x for x in j["candidates"]}
    assert by["tiny"]["eligible"] is False and by["tiny"]["excludedReason"] == "insufficient_capacity"
    assert by["shut"]["excludedReason"] == "closed"
    assert j["recommended"]["shelterId"] == "ok"
    assert all(r["shelterId"] == "ok" for r in j["alternatives"])


def test_accessible_route_excludes_inaccessible_shelter():
    c, _ = client(snapshot(grid_edges()))
    body = request(0, [shelter("stairs", 20, accessible=False), shelter("ramp", 22)], needsAccessibleRoute=True)
    j = c.post("/routes/evaluate", json=body).json()
    by = {x["shelterId"]: x for x in j["candidates"]}
    assert by["stairs"]["excludedReason"] == "not_accessible" and j["recommended"]["shelterId"] == "ramp"


def test_weight_configuration_changes_ranking():
    c, _ = client(snapshot(grid_edges()))
    shelters = [shelter("close-but-full", 20, total=100, available=5), shelter("far-but-empty", 22, total=100, available=100)]
    w_dist = {"flood": 0, "access": 0, "distance": 1, "capacity": 0, "population": 0}
    w_cap = {"flood": 0, "access": 0, "distance": 0, "capacity": 1, "population": 0}
    a = c.post("/routes/evaluate", json=request(0, shelters, weights=w_dist)).json()
    b = c.post("/routes/evaluate", json=request(0, shelters, weights=w_cap)).json()
    assert a["recommended"]["shelterId"] == "close-but-full"
    assert b["recommended"]["shelterId"] == "far-but-empty"
    bad = c.post("/routes/evaluate", json=request(0, shelters, weights={"flood": -1}))
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_WEIGHTS"


def test_flood_exposure_drives_choice_and_explanation():
    # direct bottom row 0-10-20 is deeply flooded; top detour is dry
    flooded = {10: {"flood_risk": 95}, 10020: {"flood_risk": 95}}
    c, _ = client(snapshot(grid_edges(flooded)))
    j = c.post("/routes/evaluate", json=request(0, [shelter("s", 20)])).json()
    rec = j["recommended"]
    assert 10 not in rec["edgeIds"] and rec["riskBreakdown"]["flood"] == 0
    assert any(e.startswith("Adds ") for e in j["explanation"])
    assert any(e.startswith("Lower modeled flood exposure (F=0.0)") for e in j["explanation"])


def test_snapping_max_distance_and_invalid_coordinates():
    c, _ = client(snapshot(grid_edges()))
    far = request(0, [shelter("s", 22)])
    far["origin"] = {"longitude": xy(0)[0] - 0.01, "latitude": xy(0)[1]}     # ~1 km west
    r = c.post("/routes/evaluate", json=far)
    assert r.status_code == 422 and r.json()["error"]["code"] == "ORIGIN_NOT_ROUTABLE"
    assert 950 < r.json()["error"]["details"]["nearestDistanceMeters"] < 1050
    for origin in ({"longitude": 85.9, "latitude": 95}, {"longitude": 200, "latitude": 26},
                   {"longitude": "x", "latitude": 26}):
        r = c.post("/routes/evaluate", json={**far, "origin": origin})
        assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_COORDINATES"


def test_shelter_not_connected_and_no_route():
    edges = grid_edges() + [edge(9999, 50, 51)]      # isolated component ~1 km east
    c, _ = client(snapshot(edges))
    body = request(0, [shelter("island", 50), shelter("nowhere", 22, offset=(0.05, 0))])
    j = c.post("/routes/evaluate", json=body).json()
    by = {x["shelterId"]: x for x in j["candidates"]}
    assert j["status"] == "no_route" and j["recommended"] is None and j["alternatives"] == []
    assert by["island"]["eligible"] and not by["island"]["reachable"]
    assert by["island"]["excludedReason"] == "no_path_in_graph"
    assert by["nowhere"]["excludedReason"] == "not_connected_to_network"
    none = c.post("/routes/evaluate", json=request(0, [shelter("x", 22, status="full")])).json()
    assert none["status"] == "insufficient_data" and none["recommended"] is None


def test_dynamic_graph_update_changes_path_and_version():
    c, src = client(snapshot(grid_edges(), version=1))
    body = request(0, [shelter("s", 10)], graphVersion=1)
    j1 = c.post("/routes/evaluate", json=body).json()
    assert j1["graphVersion"] == 1 and 10 in j1["recommended"]["edgeIds"]
    src.snap = snapshot(grid_edges({10: {"status": "blocked"}}), version=2)
    j2 = c.post("/routes/evaluate", json={**body, "graphVersion": 2}).json()
    assert j2["graphVersion"] == 2 and 10 not in j2["recommended"]["edgeIds"]
    assert j2["recommended"]["distanceMeters"] > j1["recommended"]["distanceMeters"]
    assert any(r["edgeId"] == 10 and r["status"] == "blocked" for r in j2["excludedRoads"])
    assert any(e.startswith("Avoids 1 blocked road segments") for e in j2["explanation"])
    assert c.get("/health").json()["graphVersion"] == 2


def test_graph_version_mismatch():
    c, _ = client(snapshot(grid_edges(), version=2))
    r = c.post("/routes/evaluate", json=request(0, [shelter("s", 22)], graphVersion=5))
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "GRAPH_VERSION_MISMATCH"
    assert r.json()["error"]["details"]["currentVersion"] == 2
    r = c.post("/graph/reload", json={"expectedVersion": 5})
    assert r.status_code == 409


def test_non_admissible_config_falls_back_to_dijkstra():
    c, _ = client(snapshot(grid_edges()), alpha_flood=-0.5)
    j = c.post("/routes/evaluate", json=request(0, [shelter("s", 22)])).json()
    assert j["status"] == "ok" and j["algorithm"] == "dijkstra"


def test_driving_respects_oneway_end_to_end():
    one = {10: {"oneway": True}}   # edge 0 -> 10 only
    c, _ = client(snapshot(grid_edges(one)))
    walk = c.post("/routes/evaluate", json=request(10, [shelter("s", 0)], maxAlternatives=0)).json()
    drive = c.post("/routes/evaluate", json=request(10, [shelter("s", 0)], maxAlternatives=0,
                                                    travelMode="driving")).json()
    assert walk["recommended"]["distanceMeters"] < 250
    assert drive["recommended"]["distanceMeters"] > 550
