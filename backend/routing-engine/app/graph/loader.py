"""Loads a Snapshot from PostGIS: version + nodes + edges in one REPEATABLE READ transaction."""
import json

import psycopg

from app.config import Settings
from app.graph.snapshot import RawEdge, Snapshot

EDGE_SQL = """
SELECT id, source_node_id, target_node_id, ST_AsGeoJSON(geom), travel_time_seconds, road_type, name,
       status::text, oneway, flood_risk, access_risk, travel_modes, wheelchair_ok
FROM road_edges
"""


class PostgresGraphSource:
    def __init__(self, settings: Settings):
        self.settings = settings

    def _connect(self):
        return psycopg.connect(self.settings.database_url, connect_timeout=self.settings.db_connect_timeout_seconds,
                               autocommit=True)

    def fetch_version(self) -> int:
        with self._connect() as conn:
            return int(conn.execute("SELECT version FROM graph_state").fetchone()[0])

    def load(self) -> Snapshot:
        with self._connect() as conn:
            conn.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
            conn.autocommit = False
            with conn.transaction():
                version = int(conn.execute("SELECT version FROM graph_state").fetchone()[0])
                nodes = {r[0]: (r[1], r[2]) for r in
                         conn.execute("SELECT id, ST_X(location), ST_Y(location) FROM road_nodes")}
                rows = conn.execute(EDGE_SQL).fetchall()
        raw = [RawEdge(r[0], r[1], r[2], json.loads(r[3])["coordinates"], r[4], r[5], r[6], r[7], r[8],
                       r[9], r[10], tuple(r[11] or ()), r[12]) for r in rows]
        return Snapshot.build(version, nodes, raw)
