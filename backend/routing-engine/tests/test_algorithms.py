import random
from types import SimpleNamespace

import networkx as nx
import pytest

from app.algorithms.alternatives import diverse_select, edge_intervals, yen_k_shortest
from app.algorithms.astar import astar, haversine_heuristic
from app.algorithms.dijkstra import NegativeWeightError, dijkstra, reconstruct, shortest_path
from app.config import Settings
from app.graph.geometry import haversine
from app.graph.snapshot import RawEdge, Snapshot


def arc(v, c, eid):
    return (v, c, eid, 0.0, 1.0)


SIMPLE = {
    "a": [arc("b", 1, 1), arc("c", 4, 2)],
    "b": [arc("c", 1, 3), arc("d", 5, 4)],
    "c": [arc("d", 1, 5)],
    "d": [],
}


def test_shortest_path_simple():
    dist, prev = dijkstra(SIMPLE, "a")
    assert dist == {"a": 0, "b": 1, "c": 2, "d": 3}
    nodes, arcs = reconstruct(prev, "d")
    assert nodes == ["a", "b", "c", "d"] and [x[2] for x in arcs] == [1, 3, 5]


def test_disconnected_nodes_are_unreachable():
    adj = {**SIMPLE, "z": []}
    dist, prev = dijkstra(adj, "a", targets=["z"])
    assert "z" not in dist and reconstruct(prev, "z") is None
    assert shortest_path(adj, "a", "z") is None
    assert astar(adj, "a", "z", lambda n: 0.0) is None


def test_invalid_input_raises():
    with pytest.raises(ValueError):
        dijkstra(SIMPLE, "nope")
    with pytest.raises(NegativeWeightError):
        dijkstra({"a": [arc("b", -1, 1)], "b": []}, "a")
    with pytest.raises(NegativeWeightError):
        astar({"a": [arc("b", -1, 1)], "b": []}, "a", "b", lambda n: 0)


def random_snapshot(seed, n=120, m=360):
    rnd = random.Random(seed)
    nodes = {i: (85.88 + rnd.random() * 0.04, 26.13 + rnd.random() * 0.04) for i in range(n)}
    edges, eid = [], 0
    for _ in range(m):
        u, v = rnd.sample(range(n), 2)
        eid += 1
        length = haversine(*nodes[u], *nodes[v])
        edges.append(RawEdge(eid, u, v, [nodes[u], nodes[v]], travel_time=length / rnd.uniform(3, 15),
                             oneway=rnd.random() < 0.3, flood_risk=rnd.randint(0, 100),
                             access_risk=rnd.randint(0, 100), status=rnd.choice(["open"] * 6 + ["restricted", "unknown", "blocked"])))
    return Snapshot.build(1, nodes, edges)


@pytest.mark.parametrize("seed", range(6))
@pytest.mark.parametrize("mode", ["walking", "driving"])
def test_astar_equals_dijkstra_equals_networkx(seed, mode):
    snap = random_snapshot(seed)
    prof = snap.profile(mode, False, Settings())
    g = prof.to_networkx()
    rnd = random.Random(seed + 100)
    src = rnd.choice(list(snap.nodes))
    dist, _ = dijkstra(prof.adj, src)
    ref = nx.single_source_dijkstra_path_length(g, src, weight="weight")
    assert set(dist) == set(ref)
    for t in rnd.sample(list(snap.nodes), 25):
        res = astar(prof.adj, src, t, haversine_heuristic(snap.nodes, t, prof.max_speed))
        if t not in ref:
            assert res is None
            continue
        assert dist[t] == pytest.approx(ref[t]) and res[0] == pytest.approx(ref[t])


def test_yen_matches_networkx_simple_paths():
    rnd = random.Random(7)
    g = nx.gnm_random_graph(40, 120, seed=7, directed=True)
    adj = {n: [] for n in g}
    for i, (u, v) in enumerate(g.edges):
        w = rnd.uniform(1, 10)
        g[u][v]["weight"] = w
        adj[u].append(arc(v, w, i))
    src, dst = 0, 39
    ours = yen_k_shortest(adj, src, dst, 6)
    ref = []
    for p in nx.shortest_simple_paths(g, src, dst, weight="weight"):
        ref.append(nx.path_weight(g, p, "weight"))
        if len(ref) == 6:
            break
    assert [round(c, 9) for c, _, _ in ours] == [round(c, 9) for c in ref]
    for _, nodes, _ in ours:
        assert len(nodes) == len(set(nodes))  # loopless


def route(arcs, lengths):
    return SimpleNamespace(intervals=edge_intervals(arcs), distance=sum(lengths[a[2]] * abs(a[4] - a[3]) for a in arcs),
                           lengths=lengths)


def test_alternative_diversity_overlap_filter():
    lengths = {i: 100.0 for i in range(1, 10)}
    rec = route([arc(0, 1, 1), arc(0, 1, 2), arc(0, 1, 3), arc(0, 1, 4)], lengths)
    near_dup = route([arc(0, 1, 1), arc(0, 1, 2), arc(0, 1, 3), arc(0, 1, 5)], lengths)   # 75 % shared
    diverse = route([arc(0, 1, 1), arc(0, 1, 6), arc(0, 1, 7), arc(0, 1, 8)], lengths)    # 25 % shared
    partial = route([(0, 1, 1, 0.0, 0.5), arc(0, 1, 9)], lengths)                      # 50/150 shared
    assert diverse_select([near_dup, diverse, partial], 5, 0.7, chosen=[rec]) == [diverse, partial]
    assert diverse_select([near_dup, diverse], 5, 0.8, chosen=[rec]) == [near_dup, diverse]
    assert diverse_select([near_dup, diverse, partial], 1, 0.7, chosen=[rec]) == [diverse]
