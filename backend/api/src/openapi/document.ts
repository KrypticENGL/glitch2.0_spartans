import { OpenAPIRegistry, OpenApiGeneratorV31, type RouteConfig } from "@asteasolutions/zod-to-openapi";
import { ErrorResponse, UuidParam } from "../lib/schemas.js";
import { z } from "../lib/zod.js";
import { AdminAlert, Alert, AlertCreateBody, AlertDraftResponse, AlertListQuery, AlertSendBody, DeliveryReport, DispatchSummary } from "../modules/alerts/schemas.js";
import { PreferencesPatch, PushConfigResponse, PushHeaders, PushSubscriptionView, SubscribeBody, SubscribeResponse } from "../modules/push/schemas.js";
import { AuthResponse, LoginBody, RegisterBody, User } from "../modules/auth/schemas.js";
import { HazardChangeResult, HazardCreateBody, HazardListQuery, HazardPage, Hazard, HazardStatusBody, HazardVerifyBody } from "../modules/hazards/schemas.js";
import { Incident, IncidentListQuery, IncidentPage, IncidentStatusBody, PriorityOverrideBody, SosCreateBody } from "../modules/incidents/schemas.js";
import { Mission, MissionCreateBody, MissionListQuery, MissionPage, MissionStatusBody, RescueTeam, TeamListQuery } from "../modules/rescue/schemas.js";
import { Road, RoadIdParam, RoadListQuery, RoadPage, RoadStatusBody, RoadStatusResult } from "../modules/roads/schemas.js";
import { RouteEvaluateBody, RouteEvaluateResponse, RouteRecord } from "../modules/routing/schemas.js";
import { Occupancy, ReservationBody, ReservationResponse, Shelter, ShelterListQuery, ShelterPage, ShelterPatchBody } from "../modules/shelters/schemas.js";

type Access = "public" | "optional" | "user" | "staff" | "admin";

const json = (schema: z.ZodType, description = "OK") => ({ description, content: { "application/json": { schema } } });
const err = (description: string) => json(ErrorResponse, description);

const DashboardSummary = z
  .object({
    incidents: z.object({ active: z.number(), unassigned: z.number(), peopleAwaiting: z.number(), byPriority: z.record(z.string(), z.number()) }),
    shelters: z.object({ total: z.number(), accepting: z.number(), totalCapacity: z.number(), occupancy: z.number(), reserved: z.number(), available: z.number() }),
    roads: z.record(z.string(), z.number()),
    activeMissions: z.number(),
    teams: z.record(z.string(), z.number()),
    graphVersion: z.number(),
    generatedAt: z.string(),
  })
  .openapi("DashboardSummary");

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  registry.registerComponent("securitySchemes", "bearerAuth", { type: "http", scheme: "bearer", bearerFormat: "JWT" });

  const add = (
    method: RouteConfig["method"],
    path: string,
    tag: string,
    summary: string,
    access: Access,
    opts: { params?: z.ZodObject; query?: z.ZodType; body?: z.ZodType; headers?: z.ZodObject; ok?: z.ZodType; okStatus?: number; extra?: RouteConfig["responses"] } = {},
  ) => {
    const responses: RouteConfig["responses"] = {
      [opts.okStatus ?? 200]: opts.ok ? json(opts.ok) : { description: "OK" },
      ...(opts.body || opts.query || opts.params ? { 400: err("Validation error") } : {}),
      ...(access === "user" || access === "staff" || access === "admin" ? { 401: err("Authentication required") } : {}),
      ...(access === "staff" || access === "admin" ? { 403: err("Insufficient role") } : {}),
      ...opts.extra,
    };
    registry.registerPath({
      method,
      path: `/api/v1${path}`,
      tags: [tag],
      summary: access === "admin" ? `${summary} (admin)` : access === "staff" ? `${summary} (admin/responder)` : summary,
      ...(access !== "public" && { security: access === "optional" ? [{}, { bearerAuth: [] }] : [{ bearerAuth: [] }] }),
      request: {
        ...(opts.params && { params: opts.params }),
        ...(opts.query && { query: opts.query as z.ZodObject }),
        ...(opts.headers && { headers: opts.headers }),
        ...(opts.body && { body: { content: { "application/json": { schema: opts.body } } } }),
      },
      responses,
    });
  };

  // Auth
  add("post", "/auth/register", "auth", "Register a citizen account", "public", { body: RegisterBody, ok: AuthResponse, okStatus: 201, extra: { 409: err("Account exists") } });
  add("post", "/auth/login", "auth", "Log in", "public", { body: LoginBody, ok: AuthResponse, extra: { 401: err("Invalid credentials") } });
  add("get", "/auth/me", "auth", "Current user", "user", { ok: User });

  // Shelters
  add("get", "/shelters", "shelters", "List shelters (geo filter, availability, facilities)", "public", { query: ShelterListQuery, ok: ShelterPage });
  add("get", "/shelters/{id}", "shelters", "Get a shelter", "public", { params: UuidParam, ok: Shelter, extra: { 404: err("Not found") } });
  add("get", "/shelters/{id}/occupancy", "shelters", "Shelter occupancy", "public", { params: UuidParam, ok: Occupancy });
  add("patch", "/shelters/{id}", "shelters", "Update capacity/occupancy/open-closed", "admin", { params: UuidParam, body: ShelterPatchBody, ok: Shelter, extra: { 409: err("Capacity exceeded") } });
  add("post", "/shelters/{id}/reservations", "shelters", "Reserve shelter capacity (expires after 2 h)", "user", {
    params: UuidParam,
    body: ReservationBody,
    ok: ReservationResponse,
    okStatus: 201,
    extra: { 409: err("Shelter not accepting / insufficient capacity") },
  });

  // Routing
  add("post", "/routes/evaluate", "routes", "Evaluate evacuation routes to shelters", "optional", {
    body: RouteEvaluateBody,
    ok: RouteEvaluateResponse,
    extra: { 422: err("Origin not routable / invalid coordinates"), 503: err("Routing engine unavailable") },
  });
  add("get", "/routes/{id}", "routes", "Get a route record and its validity", "public", { params: UuidParam, ok: RouteRecord, extra: { 404: err("Not found") } });

  // Roads
  add("get", "/roads", "roads", "List road edges (bbox/status; format=geojson for a FeatureCollection)", "public", { query: RoadListQuery, ok: RoadPage });
  add("get", "/roads/{id}", "roads", "Get a road edge", "public", { params: RoadIdParam, ok: Road });
  add("patch", "/roads/{id}/status", "roads", "Change road status (bumps graph version, invalidates routes)", "admin", { params: RoadIdParam, body: RoadStatusBody, ok: RoadStatusResult });

  // Hazards
  add("post", "/hazards", "hazards", "Report a hazard (citizen reports start unverified)", "optional", { body: HazardCreateBody, ok: HazardChangeResult, okStatus: 201 });
  add("get", "/hazards", "hazards", "List hazards (public: verified only)", "optional", { query: HazardListQuery, ok: HazardPage });
  add("get", "/hazards/{id}", "hazards", "Get a hazard", "optional", { params: UuidParam, ok: Hazard });
  add("patch", "/hazards/{id}/verify", "hazards", "Verify or reject a hazard, optionally applying a road status", "admin", {
    params: UuidParam,
    body: HazardVerifyBody,
    ok: HazardChangeResult,
    extra: { 409: err("Invalid transition"), 422: err("Hazard not on a road") },
  });
  add("patch", "/hazards/{id}/status", "hazards", "Resolve a hazard (optionally re-open road)", "admin", { params: UuidParam, body: HazardStatusBody, ok: HazardChangeResult });

  // SOS / incidents
  add("post", "/sos", "incidents", "Submit an SOS (Idempotency-Key supported; duplicate returns 200 with the original)", "optional", {
    body: SosCreateBody,
    headers: z.object({ "idempotency-key": z.string().optional() }),
    ok: Incident,
    okStatus: 201,
    extra: { 200: json(Incident, "Duplicate submission (same Idempotency-Key)"), 409: err("Idempotency key reused"), 429: err("Rate limited") },
  });
  add("get", "/sos/{id}", "incidents", "Get an SOS (requester, admin or responder)", "user", { params: UuidParam, ok: Incident });
  add("get", "/incidents", "incidents", "List incidents (priority then age)", "staff", { query: IncidentListQuery, ok: IncidentPage });
  add("patch", "/incidents/{id}/status", "incidents", "Resolve/cancel/re-open an incident", "admin", { params: UuidParam, body: IncidentStatusBody, ok: Incident });
  add("patch", "/incidents/{id}/priority", "incidents", "Override priority with a reason", "admin", { params: UuidParam, body: PriorityOverrideBody, ok: Incident });
  add("post", "/incidents/{id}/reevaluate", "incidents", "Re-run priority rules (waiting time, nearby hazards)", "admin", { params: UuidParam, ok: Incident });

  // Rescue
  add("get", "/rescue-teams", "rescue", "List rescue teams", "staff", { query: TeamListQuery, ok: z.object({ data: z.array(RescueTeam) }) });
  add("get", "/rescue-teams/{id}", "rescue", "Get a rescue team", "staff", { params: UuidParam, ok: RescueTeam });
  add("post", "/missions", "rescue", "Assign a team to an incident (cancels any active mission)", "admin", { body: MissionCreateBody, ok: Mission, okStatus: 201, extra: { 409: err("Incident closed / team off duty") } });
  add("get", "/missions", "rescue", "List missions (responders: own team)", "staff", { query: MissionListQuery, ok: MissionPage });
  add("get", "/missions/{id}", "rescue", "Get a mission", "staff", { params: UuidParam, ok: Mission });
  add("patch", "/missions/{id}/status", "rescue", "Advance mission status", "staff", { params: UuidParam, body: MissionStatusBody, ok: Mission, extra: { 409: err("Invalid transition") } });

  // Dashboard
  add("get", "/dashboard/summary", "dashboard", "Operational summary", "staff", { ok: DashboardSummary });
  add("get", "/dashboard/incidents", "dashboard", "Active incidents", "staff", { ok: IncidentPage });
  add("get", "/dashboard/shelters", "dashboard", "All shelters with occupancy", "staff", { ok: ShelterPage });
  add("get", "/dashboard/operations", "dashboard", "Teams and active missions", "staff", { ok: z.object({ teams: z.array(RescueTeam), activeMissions: z.array(Mission) }) });

  // Push & alerts
  const pushHeaders = PushHeaders;
  add("get", "/push/config", "push", "VAPID public key and subscribable areas", "public", { ok: PushConfigResponse });
  add("post", "/push/subscribe", "push", "Store a browser push subscription (idempotent per endpoint; renews the old one when its headers are sent)", "optional", {
    body: SubscribeBody,
    ok: SubscribeResponse,
    okStatus: 201,
    extra: { 200: json(SubscribeResponse, "Existing subscription updated"), 422: err("Endpoint is not a supported push service"), 503: err("Push not configured") },
  });
  add("post", "/push/unsubscribe", "push", "Revoke a subscription (manage token or signed-in owner)", "optional", { headers: pushHeaders, ok: z.object({ id: z.uuid(), unsubscribed: z.boolean() }), extra: { 404: err("Not found") } });
  add("get", "/push/preferences", "push", "Read a subscription's areas and preferences", "optional", { headers: pushHeaders, ok: PushSubscriptionView, extra: { 404: err("Not found") } });
  add("patch", "/push/preferences", "push", "Change areas or minimum severity", "optional", { headers: pushHeaders, body: PreferencesPatch, ok: PushSubscriptionView, extra: { 404: err("Not found") } });
  add("get", "/alerts", "alerts", "Published in-app alerts (active only unless includeExpired)", "public", { query: AlertListQuery, ok: z.object({ data: z.array(Alert), generatedAt: z.string() }) });
  add("get", "/alerts/{id}", "alerts", "A published alert", "public", { params: UuidParam, ok: Alert, extra: { 404: err("Not found") } });
  add("get", "/admin/alerts", "alerts", "Recent alerts with dispatch summaries", "admin", { ok: z.object({ data: z.array(AdminAlert) }) });
  add("post", "/admin/alerts", "alerts", "Create a draft alert and preview it (always [DEMO] in this build)", "admin", { body: AlertCreateBody, ok: AlertDraftResponse, okStatus: 201 });
  add("get", "/admin/alerts/{id}", "alerts", "Draft preview with eligible subscription count", "admin", { params: UuidParam, ok: AlertDraftResponse });
  add("post", "/admin/alerts/{id}/send", "alerts", "Send an alert once (Idempotency-Key required; push runs in the background)", "admin", {
    params: UuidParam,
    body: AlertSendBody,
    headers: z.object({ "idempotency-key": z.string() }),
    ok: z.object({ alert: Alert, dispatch: DispatchSummary, replay: z.boolean() }),
    okStatus: 202,
    extra: { 200: json(z.object({ alert: Alert, dispatch: DispatchSummary, replay: z.boolean() }), "Replay of the same Idempotency-Key"), 409: err("Already sent / expired"), 429: err("Rate limited"), 503: err("Push not configured") },
  });
  add("get", "/admin/alerts/{id}/delivery", "alerts", "Dispatch counts and per-subscription results", "admin", { params: UuidParam, ok: DeliveryReport });

  // Health (also mounted at /health)
  add("get", "/health/live", "health", "Liveness", "public");
  add("get", "/health/ready", "health", "Readiness (DB gates; routing engine reported separately)", "public", { extra: { 503: { description: "Database unavailable" } } });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "SURAKSHA API",
      version: "0.1.0",
      description:
        "Flood evacuation and rescue coordination (Darbhanga, Bihar). Coordinates in GeoJSON are [longitude, latitude]. Errors: { error: { code, message, details?, requestId } }. Realtime events via Socket.IO at /socket.io.",
    },
    servers: [{ url: "/" }],
  });
}
