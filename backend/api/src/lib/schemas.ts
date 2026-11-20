import { z } from "./zod.js";

/** Service area guard (Bihar, generous bounds). Requests outside are rejected before touching PostGIS or the engine. */
export const BOUNDS = { minLat: 24, maxLat: 27.6, minLon: 83, maxLon: 88.3 } as const;

export const Latitude = z.number().min(BOUNDS.minLat).max(BOUNDS.maxLat).openapi({ example: 26.1542 });
export const Longitude = z.number().min(BOUNDS.minLon).max(BOUNDS.maxLon).openapi({ example: 85.896 });

export const LatLngInput = z
  .object({ latitude: Latitude, longitude: Longitude })
  .strict()
  .openapi("LatLngInput", { description: "WGS84 point inside the Bihar service area" });

export const GeoJsonPoint = z
  .object({ type: z.literal("Point"), coordinates: z.tuple([z.number(), z.number()]) })
  .openapi("GeoJsonPoint", { description: "GeoJSON point, coordinates [longitude, latitude]" });

export const GeoJsonLineString = z
  .object({ type: z.literal("LineString"), coordinates: z.array(z.tuple([z.number(), z.number()])) })
  .openapi("GeoJsonLineString");

export const UuidParam = z.object({ id: z.uuid() });

export const PaginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ data: z.array(item), page: z.number().int(), pageSize: z.number().int(), total: z.number().int() });

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "VALIDATION_ERROR" }),
      message: z.string(),
      details: z.unknown().optional(),
      requestId: z.string().optional(),
    }),
  })
  .openapi("ErrorResponse");

/** Accepts "true"/"false" query strings. */
export const QueryBool = z.enum(["true", "false"]).transform((v) => v === "true");

/** Comma-separated enum list in a query string, e.g. ?status=new,assigned */
export const csvEnum = <const T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .transform((s) => s.split(",").map((v) => v.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).min(1));
