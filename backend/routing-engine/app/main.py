import logging
from contextlib import asynccontextmanager

from fastapi import Body, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.config import Settings, get_settings
from app.errors import ApiError
from app.graph.cache import GraphCache, GraphUnavailable
from app.graph.loader import PostgresGraphSource
from app.models import EvaluateRequest, ReloadRequest
from app.services.evaluate import evaluate, iso

log = logging.getLogger("routing-engine")


def create_app(settings: Settings | None = None, source=None) -> FastAPI:
    settings = settings or get_settings()
    cache = GraphCache(source or PostgresGraphSource(settings))

    @asynccontextmanager
    async def lifespan(_app):
        try:
            snap = cache.get()
            log.info("graph v%s loaded: %d nodes, %d edges", snap.version, len(snap.nodes), len(snap.edges))
        except GraphUnavailable as exc:   # keep serving; retried lazily on the next request
            log.warning("initial graph load failed: %s", exc)
        yield

    app = FastAPI(title="SURAKSHA routing engine", version="0.1.0", lifespan=lifespan)
    app.state.cache, app.state.settings = cache, settings

    @app.exception_handler(ApiError)
    async def api_error(_r: Request, exc: ApiError):
        return JSONResponse(exc.body(), status_code=exc.status)

    @app.exception_handler(GraphUnavailable)
    async def unavailable(_r: Request, exc: GraphUnavailable):
        return JSONResponse({"error": {"code": "GRAPH_UNAVAILABLE", "message": str(exc)}}, status_code=503)

    @app.exception_handler(RequestValidationError)
    async def invalid(_r: Request, exc: RequestValidationError):
        errors = [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]
        on_origin = any(e["loc"][:2] == ["body", "origin"] for e in errors)
        code = "INVALID_COORDINATES" if on_origin else "VALIDATION_ERROR"
        return JSONResponse({"error": {"code": code, "message": "invalid request", "details": {"errors": errors}}},
                            status_code=422)

    @app.get("/health")
    def health():
        try:
            snap = cache.get()
        except GraphUnavailable as exc:
            return JSONResponse({"status": "unavailable", "reason": str(exc)}, status_code=503)
        return {"status": "ok", "graphVersion": snap.version, "nodes": len(snap.nodes), "edges": len(snap.edges),
                "loadedAt": iso(snap.loaded_at)}

    @app.post("/graph/reload")
    def reload(body: ReloadRequest | None = Body(None)):
        snap, reloaded = cache.reload()
        if body and body.expected_version is not None and snap.version != body.expected_version:
            raise ApiError(409, "GRAPH_VERSION_MISMATCH", "database graph version differs from expectedVersion",
                           {"currentVersion": snap.version, "expectedVersion": body.expected_version})
        return {"graphVersion": snap.version, "reloaded": reloaded, "nodes": len(snap.nodes),
                "edges": len(snap.edges), "excludedEdges": snap.excluded_count}

    @app.post("/routes/evaluate")
    def evaluate_routes(req: EvaluateRequest):
        snap = cache.get()
        if req.graph_version is not None and req.graph_version != snap.version:
            snap, _ = cache.reload()
            if snap.version != req.graph_version:
                raise ApiError(409, "GRAPH_VERSION_MISMATCH", "requested graph version is not current",
                               {"currentVersion": snap.version, "requestedVersion": req.graph_version})
        return evaluate(req, snap, settings)

    return app


app = create_app()
