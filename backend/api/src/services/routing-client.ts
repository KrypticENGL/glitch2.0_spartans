import { AppError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { TravelMode } from "../types/enums.js";

// Types mirror backend/shared/routing-contract.md.
export type LonLat = [number, number];

export interface EngineShelter {
  id: string;
  code: string;
  name: string;
  longitude: number;
  latitude: number;
  totalCapacity: number;
  availableCapacity: number;
  status: string;
  accessible: boolean;
}

export interface EngineEvaluateRequest {
  graphVersion: number;
  origin: { latitude: number; longitude: number };
  peopleCount: number;
  travelMode: TravelMode;
  needsAccessibleRoute: boolean;
  maxAlternatives: number;
  population?: { children: number; elderly: number; disabled: number; medicalNeeds: boolean };
  shelters: EngineShelter[];
}

export interface EngineRoute {
  id: string;
  rank: number;
  shelterId: string;
  shelterCode: string;
  shelterName: string;
  geometry: { type: "LineString"; coordinates: LonLat[] };
  edgeIds: number[];
  distanceMeters: number;
  durationSeconds: number;
  riskScore: number;
  riskBreakdown: Record<string, number>;
  weightedContributions?: Record<string, number>;
  maxFloodRisk?: number;
  roadStatusCounts?: Record<string, number>;
  sharedWithRecommended?: number;
  explanation?: string[];
}

export interface EngineEvaluateResponse {
  status: "ok" | "no_route" | "insufficient_data";
  graphVersion: number;
  calculatedAt: string;
  algorithm?: string;
  origin?: { input: LonLat; snapped: LonLat; edgeId: number; snapDistanceMeters: number } | null;
  candidates?: unknown[];
  recommended: EngineRoute | null;
  alternatives: EngineRoute[];
  excludedRoads?: unknown[];
  explanation?: string[];
  weights?: Record<string, number>;
  policy?: Record<string, string>;
}

export interface EngineHealth {
  status: string;
  graphVersion?: number;
  [key: string]: unknown;
}

export interface RoutingClient {
  /** Evaluates routes; on GRAPH_VERSION_MISMATCH reloads the engine and retries once with `refreshVersion()`. */
  evaluate(req: EngineEvaluateRequest, refreshVersion: () => Promise<number>): Promise<EngineEvaluateResponse>;
  reload(expectedVersion?: number): Promise<unknown>;
  health(timeoutMs?: number): Promise<EngineHealth>;
}

export class RoutingEngineError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Maps engine failures onto public API errors without leaking internals. */
export function toPublicRoutingError(err: unknown): AppError {
  if (err instanceof RoutingEngineError) {
    if (err.status === 0 || err.status >= 500 || err.code === "GRAPH_VERSION_MISMATCH") {
      return new AppError(503, "ROUTING_UNAVAILABLE", "Routing engine is temporarily unavailable; please retry shortly");
    }
    if (err.code === "INVALID_COORDINATES" || err.code === "ORIGIN_NOT_ROUTABLE") {
      return new AppError(422, err.code, err.message, err.details);
    }
    return new AppError(502, "ROUTING_ENGINE_ERROR", "Routing engine rejected the request");
  }
  return new AppError(503, "ROUTING_UNAVAILABLE", "Routing engine is temporarily unavailable; please retry shortly");
}

export class HttpRoutingClient implements RoutingClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
  ) {}

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    let res: Response;
    try {
      res = await fetch(new URL(path, this.baseUrl), {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      this.logger.warn({ err, path }, "routing engine unreachable");
      throw new RoutingEngineError(0, "ENGINE_UNREACHABLE", "Routing engine unreachable");
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new RoutingEngineError(res.status || 502, "ENGINE_BAD_RESPONSE", "Routing engine returned invalid JSON");
    }
    if (!res.ok) {
      const e = (json as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      throw new RoutingEngineError(res.status, e?.code ?? "ENGINE_ERROR", e?.message ?? `Engine responded ${res.status}`, e?.details);
    }
    return json as T;
  }

  async evaluate(req: EngineEvaluateRequest, refreshVersion: () => Promise<number>): Promise<EngineEvaluateResponse> {
    try {
      return await this.call<EngineEvaluateResponse>("POST", "/routes/evaluate", req);
    } catch (err) {
      if (!(err instanceof RoutingEngineError) || err.code !== "GRAPH_VERSION_MISMATCH") throw err;
      this.logger.info({ requested: req.graphVersion, details: err.details }, "graph version mismatch; reloading engine and retrying once");
      const graphVersion = await refreshVersion();
      await this.reload(graphVersion);
      return this.call<EngineEvaluateResponse>("POST", "/routes/evaluate", { ...req, graphVersion });
    }
  }

  reload(expectedVersion?: number): Promise<unknown> {
    return this.call("POST", "/graph/reload", expectedVersion === undefined ? {} : { expectedVersion });
  }

  health(timeoutMs = 2000): Promise<EngineHealth> {
    return this.call<EngineHealth>("GET", "/health", undefined, timeoutMs);
  }
}
