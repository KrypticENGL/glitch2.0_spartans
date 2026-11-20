import { GeoJsonPoint, Latitude, Longitude, PaginationQuery, QueryBool, csvEnum, pageOf } from "../../lib/schemas.js";
import { z } from "../../lib/zod.js";
import { RESERVATION_STATUSES, SHELTER_STATUSES } from "../../types/enums.js";

export const ShelterListQuery = PaginationQuery.extend({
  lat: z.coerce.number().pipe(Latitude).optional(),
  lng: z.coerce.number().pipe(Longitude).optional(),
  radiusMeters: z.coerce.number().int().min(1).max(100_000).optional(),
  status: csvEnum(SHELTER_STATUSES).optional().openapi({ description: "Comma-separated statuses" }),
  available: QueryBool.optional().openapi({ description: "true: only shelters accepting people (open/near_capacity with free capacity)" }),
  facility: z.string().max(200).optional().openapi({ description: "Comma-separated facilities that must all be present, e.g. medical,water" }),
  accessible: QueryBool.optional(),
}).refine((q) => (q.lat === undefined) === (q.lng === undefined), { message: "lat and lng must be given together", path: ["lat"] })
  .refine((q) => q.radiusMeters === undefined || q.lat !== undefined, { message: "radiusMeters requires lat and lng", path: ["radiusMeters"] });

export const ShelterPatchBody = z
  .object({
    totalCapacity: z.number().int().min(0).max(100_000).optional(),
    currentOccupancy: z.number().int().min(0).max(100_000).optional(),
    status: z.enum(["open", "closed"]).optional().openapi({ description: "closed closes the shelter; open re-opens it. near_capacity/full are always derived from occupancy." }),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((b) => b.totalCapacity !== undefined || b.currentOccupancy !== undefined || b.status !== undefined, { message: "Nothing to update" })
  .openapi("ShelterPatchRequest");

export const ReservationBody = z
  .object({ peopleCount: z.number().int().min(1).max(100), routeRecordId: z.uuid().optional() })
  .strict()
  .openapi("ReservationRequest");

export const Occupancy = z
  .object({
    shelterId: z.uuid(),
    totalCapacity: z.number().int(),
    currentOccupancy: z.number().int(),
    reservedCount: z.number().int(),
    availableCapacity: z.number().int(),
    occupancyPercent: z.number(),
    status: z.enum(SHELTER_STATUSES),
    updatedAt: z.string(),
  })
  .openapi("ShelterOccupancy");

export const Shelter = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    location: GeoJsonPoint,
    address: z.string().nullable(),
    area: z.string().nullable(),
    totalCapacity: z.number().int(),
    currentOccupancy: z.number().int(),
    reservedCount: z.number().int(),
    availableCapacity: z.number().int(),
    occupancyPercent: z.number(),
    status: z.enum(SHELTER_STATUSES),
    facilities: z.array(z.string()),
    accessible: z.boolean(),
    accessibilityNotes: z.string().nullable(),
    contactPhone: z.string().nullable(),
    source: z.string(),
    updatedAt: z.string(),
    distanceMeters: z.number().optional(),
  })
  .openapi("Shelter");

export const ShelterPage = pageOf(Shelter).openapi("ShelterPage");

export const Reservation = z
  .object({
    id: z.uuid(),
    shelterId: z.uuid(),
    peopleCount: z.number().int(),
    status: z.enum(RESERVATION_STATUSES),
    expiresAt: z.string(),
    createdAt: z.string(),
  })
  .openapi("Reservation");

export const ReservationResponse = z.object({ reservation: Reservation, occupancy: Occupancy }).openapi("ReservationResponse");
