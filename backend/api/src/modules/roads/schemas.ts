import { GeoJsonLineString, PaginationQuery, csvEnum } from "../../lib/schemas.js";
import { z } from "../../lib/zod.js";
import { ROAD_STATUSES } from "../../types/enums.js";

const Bbox = z
  .string()
  .transform((s) => s.split(",").map(Number))
  .pipe(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number().min(-180).max(180), z.number().min(-90).max(90)]))
  .refine(([minLon, minLat, maxLon, maxLat]) => minLon < maxLon && minLat < maxLat, { message: "bbox must be minLon,minLat,maxLon,maxLat" });

export const RoadListQuery = PaginationQuery.extend({
  pageSize: z.coerce.number().int().min(1).max(2000).default(200),
  bbox: Bbox.optional().openapi({ description: "minLon,minLat,maxLon,maxLat", example: "85.88,26.13,85.92,26.17" }),
  status: csvEnum(ROAD_STATUSES).optional().openapi({ description: "Comma-separated statuses" }),
  format: z.enum(["json", "geojson"]).default("json"),
});

export const RoadIdParam = z.object({ id: z.coerce.number().int().positive() });

export const RoadStatusBody = z
  .object({ status: z.enum(ROAD_STATUSES), reason: z.string().trim().min(3).max(500) })
  .strict()
  .openapi("RoadStatusRequest");

export const Road = z
  .object({
    id: z.number().int(),
    name: z.string().nullable(),
    roadType: z.string(),
    status: z.enum(ROAD_STATUSES),
    oneway: z.boolean(),
    lengthMeters: z.number(),
    travelTimeSeconds: z.number(),
    floodRisk: z.number().int(),
    accessRisk: z.number().int(),
    travelModes: z.array(z.string()),
    wheelchairOk: z.boolean(),
    source: z.string(),
    updatedAt: z.string(),
    geometry: GeoJsonLineString,
  })
  .openapi("Road");

export const RoadPage = z
  .object({ data: z.array(Road), page: z.number().int(), pageSize: z.number().int(), total: z.number().int(), graphVersion: z.number().int() })
  .openapi("RoadPage");

export const RoadStatusResult = z
  .object({ road: Road, previousStatus: z.enum(ROAD_STATUSES), changed: z.boolean(), graphVersion: z.number().int(), invalidatedRouteCount: z.number().int() })
  .openapi("RoadStatusResult");
