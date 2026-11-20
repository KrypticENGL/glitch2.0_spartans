import { GeoJsonPoint, LatLngInput, PaginationQuery, csvEnum, pageOf } from "../../lib/schemas.js";
import { z } from "../../lib/zod.js";
import { HAZARD_SEVERITIES, HAZARD_SOURCES, HAZARD_TYPES, HAZARD_VERIFICATIONS, ROAD_STATUSES } from "../../types/enums.js";

const AppliedRoadStatus = z.enum(["restricted", "blocked", "unknown"]);

export const HazardCreateBody = z
  .object({
    location: LatLngInput,
    hazardType: z.enum(HAZARD_TYPES),
    severity: z.enum(HAZARD_SEVERITIES),
    description: z.string().trim().min(3).max(1000),
    verified: z.boolean().optional().openapi({ description: "Admin only: record as already verified" }),
    appliedRoadStatus: AppliedRoadStatus.optional().openapi({ description: "Admin only, requires verified=true: road status applied to the snapped road edge" }),
  })
  .strict()
  .refine((b) => !b.appliedRoadStatus || b.verified === true, { message: "appliedRoadStatus requires verified=true", path: ["appliedRoadStatus"] })
  .openapi("HazardCreateRequest");

export const HazardListQuery = PaginationQuery.extend({
  status: csvEnum(HAZARD_VERIFICATIONS).optional().openapi({ description: "Comma-separated verification statuses (staff only; public sees verified)" }),
});

export const HazardVerifyBody = z
  .object({
    decision: z.enum(["verified", "rejected"]),
    appliedRoadStatus: AppliedRoadStatus.nullable().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((b) => b.decision === "verified" || !b.appliedRoadStatus, { message: "appliedRoadStatus only applies to verified hazards", path: ["appliedRoadStatus"] })
  .openapi("HazardVerifyRequest");

export const HazardStatusBody = z
  .object({
    status: z.literal("resolved"),
    reopenRoad: z.boolean().default(false).openapi({ description: "Set the linked road back to open (skipped if another verified hazard still affects it)" }),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .openapi("HazardStatusRequest");

export const Hazard = z
  .object({
    id: z.uuid(),
    location: GeoJsonPoint,
    roadEdgeId: z.number().int().nullable(),
    hazardType: z.enum(HAZARD_TYPES),
    severity: z.enum(HAZARD_SEVERITIES),
    description: z.string(),
    source: z.enum(HAZARD_SOURCES),
    verificationStatus: z.enum(HAZARD_VERIFICATIONS),
    appliedRoadStatus: z.enum(ROAD_STATUSES).nullable(),
    reportedAt: z.string(),
    verifiedAt: z.string().nullable(),
    reportedBy: z.uuid().nullable().optional().openapi({ description: "Staff only" }),
    verifiedBy: z.uuid().nullable().optional().openapi({ description: "Staff only" }),
  })
  .openapi("Hazard");

export const HazardPage = pageOf(Hazard).openapi("HazardPage");

export const HazardChangeResult = z
  .object({
    hazard: Hazard,
    road: z
      .object({ edgeId: z.number().int(), status: z.enum(ROAD_STATUSES), changed: z.boolean(), graphVersion: z.number().int(), invalidatedRouteCount: z.number().int() })
      .nullable(),
    note: z.string().optional(),
  })
  .openapi("HazardChangeResult");
