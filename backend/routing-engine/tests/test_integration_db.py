"""Runs against the real PostGIS graph; skipped when DATABASE_URL is unreachable."""
import json
import random
from pathlib import Path

import networkx as nx
import psycopg
import pytest
from fastapi.testclient import TestClient

from app.algorithms.astar import astar, haversine_heuristic
from app.algorithms.dijkstra import dijkstra
from app.config import Settings
from app.graph.loader import PostgresGraphSource
from app.main import create_app

pytestmark = pytest.mark.integration
SCENARIO = Path(__file__).resolve().parents[2] / "simulation-data" / "demo-scenario.json"


@pytest.fixture(scope="module")
def settings():
    s = Settings()
    try:
        psycopg.connect(s.database_url, connect_timeout=2).close()
    except Exception as exc:
        pytest.skip(f"DATABASE_URL unreachable: {exc}")
    return s


@pytest.fixture(scope="module")
def snap(settings):
    return PostgresGraphSource(settings).load()


def demo_shelters():
    d = json.loads(SCENARIO.read_text())
    return d["demoOrigin"]["location"], [
        {"id": f"id-{x['code']}", "code": x["code"], "name": x["name"], "longitude": x["location"][0],
         "latitude": x["location"][1], "totalCapacity": x["capacity"],
         "availableCapacity": x["capacity"] - x["occupancy"], "status": x["status"], "accessible": x["accessible"]}
        for x in d["shelters"]]


@pytest.mark.parametrize("mode", ["walking", "driving"])
def test_real_graph_astar_dijkstra_networkx_agree(snap, settings, mode):
    prof = snap.profile(mode, False, settings)
    g = prof.to_networkx()
    rnd = random.Random(42)
    nodes = [n for n in prof.adj if prof.adj[n]]
    for src in rnd.sample(nodes, 3):
        dist, _ = dijkstra(prof.adj, src)
        ref = nx.single_source_dijkstra_path_length(g, src, weight="weight")
        assert set(dist) == set(ref)
        for t in rnd.sample(list(ref), 10):
            res = astar(prof.adj, src, t, haversine_heuristic(snap.nodes, t, prof.max_speed))
            assert res[0] == pytest.approx(ref[t]) and dist[t] == pytest.approx(ref[t])


def test_real_demo_origin_route(snap, settings):
    origin, shelters = demo_shelters()
    c = TestClient(create_app(settings))
    body = {"graphVersion": snap.version, "origin": {"longitude": origin[0], "latitude": origin[1]},
            "peopleCount": 4, "travelMode": "walking", "maxAlternatives": 3,
            "population": {"children": 1, "elderly": 1, "disabled": 0, "medicalNeeds": False}, "shelters": shelters}
    j = c.post("/routes/evaluate", json=body).json()
    assert j["status"] == "ok" and j["recommended"] is not None
    blocked = {eid for eid, e in snap.edges.items() if e.status == "blocked"}
    for r in [j["recommended"]] + j["alternatives"]:
        assert not blocked & set(r["edgeIds"])
        assert r["geometry"]["coordinates"][0] == j["origin"]["snapped"]
