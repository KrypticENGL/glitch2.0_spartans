"""Benchmark against the real DB graph: graph load time and /routes/evaluate latency (p50/p95).

usage: DATABASE_URL=... uv run python scripts/benchmark.py [requests=30]
"""
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.graph.loader import PostgresGraphSource  # noqa: E402
from app.main import create_app  # noqa: E402

SCENARIO = Path(__file__).resolve().parents[2] / "simulation-data" / "demo-scenario.json"


def main(n=30):
    s = Settings()
    d = json.loads(SCENARIO.read_text())
    shelters = [{"id": f"id-{x['code']}", "code": x["code"], "name": x["name"], "longitude": x["location"][0],
                 "latitude": x["location"][1], "totalCapacity": x["capacity"],
                 "availableCapacity": x["capacity"] - x["occupancy"], "status": x["status"],
                 "accessible": x["accessible"]} for x in d["shelters"]]
    origins = [d["demoOrigin"]["location"]] + [i["location"] for i in d["incidents"]][:4]

    t = time.perf_counter()
    snap = PostgresGraphSource(s).load()
    load_ms = (time.perf_counter() - t) * 1000
    t = time.perf_counter()
    snap.profile("walking", False, s)
    snap.profile("driving", False, s)
    prof_ms = (time.perf_counter() - t) * 1000
    print(f"graph v{snap.version}: {len(snap.nodes)} nodes, {len(snap.edges)} edges, {len(snap.issues)} dropped")
    print(f"graph load (DB + validation + grid index): {load_ms:.0f} ms; walking+driving profiles: {prof_ms:.0f} ms")

    class Src:
        def fetch_version(self):
            return snap.version

        def load(self):
            return snap

    c = TestClient(create_app(s, Src()))
    for mode in ("walking", "driving"):
        lat, statuses = [], {}
        for i in range(n):
            o = origins[i % len(origins)]
            body = {"graphVersion": snap.version, "origin": {"longitude": o[0], "latitude": o[1]},
                    "peopleCount": 4, "travelMode": mode, "maxAlternatives": 3, "shelters": shelters,
                    "population": {"children": 1, "elderly": 1}}
            t = time.perf_counter()
            r = c.post("/routes/evaluate", json=body)
            lat.append((time.perf_counter() - t) * 1000)
            key = r.json().get("status") or r.json()["error"]["code"]
            statuses[key] = statuses.get(key, 0) + 1
        lat.sort()
        p95 = lat[max(0, int(round(0.95 * len(lat))) - 1)]
        print(f"{mode}: {n} requests from {len(origins)} origins -> p50 {statistics.median(lat):.0f} ms, "
              f"p95 {p95:.0f} ms, max {lat[-1]:.0f} ms, statuses {statuses}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 30)
