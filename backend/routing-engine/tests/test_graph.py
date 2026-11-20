from app.algorithms.dijkstra import dijkstra, reconstruct
from app.config import Settings
from app.graph.snapshot import RawEdge, Snapshot
from app.services.snapping import snap_point
from tests.helpers import edge, snapshot, xy


def test_topology_validation_drops_bad_edges_and_reorients():
    nodes = {1: xy(0), 2: xy(10)}
    snap = Snapshot.build(1, nodes, [
        RawEdge(1, 1, 2, [xy(10), xy(0)], 10),        # reversed geometry -> reoriented
        RawEdge(2, 1, 99, [xy(0), xy(20)], 10),       # missing node
        RawEdge(3, 1, 1, [xy(0), xy(1)], 10),         # self loop
        RawEdge(4, 1, 2, [xy(0), xy(0)], 10),         # zero length
        RawEdge(5, 1, 2, [xy(0)], 10),                # bad geometry
    ])
    assert set(snap.edges) == {1}
    assert snap.issues == {2: "missing_node", 3: "self_loop", 4: "zero_length", 5: "bad_geometry"}
    assert snap.reoriented == 1 and snap.edges[1].coords[0] == xy(0)


def path_edges(prof, s, t):
    dist, prev = dijkstra(prof.adj, s, [t])
    p = reconstruct(prev, t)
    return None if p is None else [a[2] for a in p[1]]


def test_oneway_respected_for_driving_not_walking():
    # 0 -> 10 oneway (direct); 10 -> 0 driving must detour 10-11-1-0
    snap = snapshot([edge(1, 0, 10, oneway=True), edge(2, 10, 11), edge(3, 11, 1), edge(4, 1, 0)])
    s = Settings()
    assert path_edges(snap.profile("walking", False, s), 10, 0) == [1]
    assert path_edges(snap.profile("driving", False, s), 10, 0) == [2, 3, 4]
    assert path_edges(snap.profile("driving", False, s), 0, 10) == [1]


def test_blocked_edges_excluded_never_penalised():
    snap = snapshot([edge(1, 0, 10, status="blocked"), edge(2, 0, 1), edge(3, 1, 11), edge(4, 11, 10)])
    for mode in ("walking", "driving"):
        prof = snap.profile(mode, False, Settings())
        assert 1 not in prof.eligible and prof.excluded[1] == "blocked"
        assert path_edges(prof, 0, 10) == [2, 3, 4]
    only_blocked = snapshot([edge(1, 0, 10, status="blocked")])
    assert path_edges(only_blocked.profile("walking", False, Settings()), 0, 10) is None


def test_restricted_penalty_changes_choice():
    # direct restricted edge (1 hop) vs 3-hop open detour
    edges = [edge(1, 0, 10, status="restricted"), edge(2, 0, 1), edge(3, 1, 11), edge(4, 11, 10)]
    snap = snapshot(edges)
    assert path_edges(snap.profile("walking", False, Settings(restricted_multiplier=1.0)), 0, 10) == [1]
    assert path_edges(snap.profile("walking", False, Settings(restricted_multiplier=4.0)), 0, 10) == [2, 3, 4]
    assert path_edges(snap.profile("walking", False, Settings(restricted_policy="exclude",
                                                              restricted_multiplier=1.0)), 0, 10) == [2, 3, 4]
    # accessible routes always exclude restricted edges
    assert 1 not in snap.profile("walking", True, Settings(restricted_multiplier=1.0)).eligible


def test_snapping_to_edge_not_node_and_max_distance():
    snap = snapshot([edge(1, 0, 20)])                       # 0 -> 20 along longitude, ~400 m
    prof = snap.profile("walking", False, Settings())
    mid_x = (xy(0)[0] + xy(20)[0]) / 2
    s, d = snap_point(snap, prof.eligible, mid_x, xy(0)[1] + 0.0005, 400)   # ~55 m north of the middle
    assert s.edge_id == 1 and abs(s.frac - 0.5) < 1e-6 and 50 < s.distance < 60
    s, nearest = snap_point(snap, prof.eligible, mid_x, xy(0)[1] + 0.006, 400)  # ~670 m away
    assert s is None and 600 < nearest < 700
