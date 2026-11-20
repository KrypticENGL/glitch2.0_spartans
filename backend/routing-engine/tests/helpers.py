"""Tiny hand-built graphs (no DB). Grid node id = 10*i + j at (85.90 + i*STEP, 26.15 + j*STEP); STEP ~ 200 m."""
from fastapi.testclient import TestClient

from app.config import Settings
from app.graph.snapshot import RawEdge, Snapshot
from app.main import create_app

STEP = 0.002
X0, Y0 = 85.90, 26.15


def xy(n):
    i, j = divmod(n, 10)
    return (X0 + i * STEP, Y0 + j * STEP)


def edge(eid, u, v, **kw):
    kw.setdefault("travel_time", 20.0)
    return RawEdge(eid, u, v, [xy(u), xy(v)], **kw)


def snapshot(edges, version=1, extra_nodes=()):
    nodes = {n: xy(n) for e in edges for n in (e.source, e.target)}
    nodes.update({n: xy(n) for n in extra_nodes})
    return Snapshot.build(version, nodes, edges)


class FakeSource:
    def __init__(self, snap):
        self.snap = snap
        self.fail = False

    def fetch_version(self):
        if self.fail:
            raise ConnectionError("db down")
        return self.snap.version

    def load(self):
        if self.fail:
            raise ConnectionError("db down")
        return self.snap


def client(snap, **settings):
    src = FakeSource(snap)
    app = create_app(Settings(**settings), src)
    return TestClient(app), src


def shelter(sid, node, total=100, available=50, status="open", accessible=True, offset=(0.0, 0.0)):
    x, y = xy(node)
    return {"id": sid, "code": sid, "name": f"Shelter {sid}", "longitude": x + offset[0], "latitude": y + offset[1],
            "totalCapacity": total, "availableCapacity": available, "status": status, "accessible": accessible}


def request(origin_node, shelters, **kw):
    x, y = xy(origin_node)
    body = {"origin": {"longitude": x, "latitude": y}, "peopleCount": 4, "travelMode": "walking",
            "maxAlternatives": 3, "shelters": shelters}
    body.update(kw)
    return body
