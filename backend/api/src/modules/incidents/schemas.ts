import { GeoJsonPoint, LatLngInput, PaginationQuery, csvEnum, pageOf } from "../../lib/schemas.js";
import { z } from "../../lib/zod.js";
import { INCIDENT_STATUSES, INCIDENT_TYPES, MISSION_STATUSES, PRIORITY_LEVELS } from "../../types/enums.js";

const Count = z.number().int().min(0).max(500).default(0);

export const SosCreateBody = z
  .object({
    location: LatLngInput,
    emergencyType: z.enum(INCIDENT_TYPES),
    peopleCount: z.number().int().min(1).max(500),
    medicalNeeded: z.boolean().default(false),
    trapped: z.boolean().default(false),
    lifeThreatening: z.boolean().default(false),
    childrenCount: Count,
    elderlyCount: Count,
    disabledCount: Count,
    notes: z.string().trim().max(1000).optional(),
    contactPhone: z.string().regex(/^\+?[0-9 -]{7,20}$/).optional(),
    area: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine((b) => b.childrenCount <= b.peopleCount && b.elderlyCount <= b.peopleCount && b.disabledCount <= b.peopleCount, {
    message: "childrenCount, elderlyCount and disabledCount cannot exceed peopleCount",
    path: ["peopleCount"],
  })
  .openapi("SosCreateRequest");

export const IdempotencyKeyHeader = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{8,128}$/, "Idempotency-Key must be 8-128 characters of [A-Za-z0-9_.:-]")
  .optional();

export const IncidentListQuery = PaginationQuery.extend({
  status: csvEnum(INCIDENT_STATUSES).optional().openapi({ description: "Comma-separated statuses" }),
  priority: csvEnum(PRIORITY_LEVELS).optional().openapi({ description: "Comma-separated priorities" }),
});

export const IncidentStatusBody = z
  .object({
    status: z.enum(["resolved", "cancelled", "new"]).openapi({
      description: "resolved/cancelled close the incident (cancelling any active mission); new re-opens a closed incident. Field progress (assigned, en_route, on_site) is driven by mission status.",
    }),
    reason: z.string().trim().min(3).max(500),
  })
  .strict()
  .openapi("IncidentStatusRequest");

export const PriorityOverrideBody = z
  .object({ priority: z.enum(PRIORITY_LEVELS), reason: z.string().trim().min(3).max(500) })
  .strict()
  .openapi("PriorityOverrideRequest");

export const PriorityFactor = z.object({ factor: z.string(), points: z.number(), reason: z.string() }).openapi("PriorityFactor");

export const Incident = z
  .object({
    id: z.uuid(),
    code: z.string(),
    status: z.enum(INCIDENT_STATUSES),
    priority: z.enum(PRIORITY_LEVELS),
    suggestedPriority: z.enum(PRIORITY_LEVELS),
    priorityScore: z.number().int(),
    priorityBreakdown: z.array(PriorityFactor),
    priorityOverridden: z.boolean(),
    emergencyType: z.enum(INCIDENT_TYPES),
    peopleCount: z.number().int(),
    childrenCount: z.number().int(),
    elderlyCount: z.number().int(),
    disabledCount: z.number().int(),
    medicalNeeded: z.boolean(),
    trapped: z.boolean(),
    lifeThreatening: z.boolean(),
    notes: z.string().nullable(),
    contactPhone: z.string().nullable(),
    area: z.string().nullable(),
    location: GeoJsonPoint,
    source: z.string(),
    requesterId: z.uuid().nullable(),
    waitingMinutes: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
    activeMission: z.object({ id: z.uuid(), code: z.string(), status: z.enum(MISSION_STATUSES), rescueTeamId: z.uuid() }).nullable(),
  })
  .openapi("Incident");

export const IncidentPage = pageOf(Incident).openapi("IncidentPage");
