"""Thread-safe holder of the current Snapshot."""
import threading

from app.graph.snapshot import Snapshot


class GraphUnavailable(Exception):
    pass


class GraphCache:
    def __init__(self, source):
        self.source = source          # anything with fetch_version() -> int and load() -> Snapshot
        self._snapshot: Snapshot | None = None
        self._lock = threading.Lock()

    @property
    def snapshot(self) -> Snapshot | None:
        return self._snapshot

    def get(self) -> Snapshot:
        snap = self._snapshot
        if snap is not None:
            return snap
        return self.reload()[0]

    def reload(self, force: bool = False) -> tuple[Snapshot, bool]:
        """Reload when the DB version differs from the cache. Returns (snapshot, reloaded)."""
        with self._lock:
            try:
                current = self._snapshot
                if current is not None and not force and self.source.fetch_version() == current.version:
                    return current, False
                self._snapshot = self.source.load()
                return self._snapshot, True
            except Exception as exc:  # DB unreachable, bad data, ... (the old snapshot stays cached)
                raise GraphUnavailable(f"graph load failed: {exc}") from exc
