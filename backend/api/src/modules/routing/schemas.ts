import { GeoJsonLineString, GeoJsonPoint, LatLngInput } from "../../lib/schemas.js";
import { z } from "../../lib/zod.js";
import { ROUTE_RECORD_STATUSES, TRAVEL_MODES } from "../../types/enums.js";

export const RouteEvaluateBody = z
  .object({
    origin: LatLngInput,
    peopleCount: z.number().int().min(1).max(500),
    travelMode: z.enum(TRAVEL_MODES).default("walking"),
    needsAccessibleRoute: z.boolean().default(false),
    maxAlternatives: z.number().int().min(0).max(5).default(2),
    population: z
      .object({
        children: z.number().int().min(0).max(500).default(0),
        elderly: z.number().int().min(0).max(500).default(0),
        disabled: z.number().int().min(0).max(500).default(0),
        medicalNeeds: z.boolean().default(false),
      })
      .strict()
      .optional(),
  })
  .strict()
  .openapi("RouteEvaluateRequest");

const LonLat = z.tuple([z.number(), z.number()]);

export const EvaluatedRoute = z
  .object({
    routeRecordId: z.uuid().openapi({ description: "Persisted route record; subscribe to socket room route:<id> for invalidation" }),
    id: z.string(),
    rank: z.number().int(),
    shelterId: z.uuid(),
    shelterCode: z.string(),
    shelterName: z.string(),
    geometry: GeoJsonLineString,
    edgeIds: z.array(z.number().int()),
    distanceMeters: z.number(),
    durationSeconds: z.number(),
    riskScore: z.number(),
    riskBreakdown: z.record(z.string(), z.number()),
    weightedContributions: z.record(z.string(), z.number()).optional(),
    maxFloodRisk: z.number().optional(),
    roadStatusCounts: z.record(z.string(), z.number()).optional(),
    sharedWithRecommended: z.number().optional(),
    explanation: z.array(z.string()).optional(),
  })
  .openapi("EvaluatedRoute");

export const RouteEvaluateResponse = z
  .object({
    status: z.enum(["ok", "no_route", "insufficient_data"]).openapi({ description: "no_route is returned with HTTP 200" }),
    graphVersion: z.number().int(),
    calculatedAt: z.string(),
    algorithm: z.string().optional(),
    origin: z.object({ input: LonLat, snapped: LonLat, edgeId: z.number().int(), snapDistanceMeters: z.number() }).nullable().optional(),
    candidates: z.array(z.unknown()).optional(),
    recommended: EvaluatedRoute.nullable(),
    alternatives: z.array(EvaluatedRoute),
    excludedRoads: z.array(z.unknown()).optional(),
    explanation: z.array(z.string()).optional(),
    weights: z.record(z.string(), z.number()).optional(),
    policy: z.record(z.string(), z.string()).optional(),
    routeRecordExpiresAt: z.string().nullable(),
    sourceClassification: z.string(),
    disclaimer: z.string(),
  })
  .openapi("RouteEvaluateResponse");

export const RouteRecord = z
  .object({
    id: z.uuid(),
    status: z.enum(ROUTE_RECORD_STATUSES),
    origin: GeoJsonPoint,
    destinationShelterId: z.uuid(),
    geometry: GeoJsonLineString,
    edgeIds: z.array(z.number().int()),
    riskScore: z.number(),
    riskBreakdown: z.record(z.string(), z.unknown()),
    peopleCount: z.number().int(),
    travelMode: z.string(),
    graphVersion: z.number().int(),
    currentGraphVersion: z.number().int(),
    calculatedAt: z.string(),
    expiresAt: z.string(),
    invalidatedAt: z.string().nullable(),
    invalidationReason: z.string().nullable(),
  })
  .openapi("RouteRecord");
