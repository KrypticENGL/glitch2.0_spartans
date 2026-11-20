import { GeoJsonPoint, PaginationQuery, csvEnum, pageOf } from "../../lib/schemas.js";
import { z } from "../../lib/zod.js";
import { INCIDENT_STATUSES, INCIDENT_TYPES, MISSION_STATUSES, PRIORITY_LEVELS, TEAM_AVAILABILITIES } from "../../types/enums.js";

export const TeamListQuery = z.object({ availability: csvEnum(TEAM_AVAILABILITIES).optional() });

export const MissionCreateBody = z
  .object({ sosRequestId: z.uuid(), rescueTeamId: z.uuid(), notes: z.string().trim().max(1000).optional() })
  .strict()
  .openapi("MissionCreateRequest");

export const MissionStatusBody = z
  .object({ status: z.enum(MISSION_STATUSES).exclude(["assigned"]), notes: z.string().trim().max(1000).optional() })
  .strict()
  .openapi("MissionStatusRequest", { description: "assigned → accepted → en_route → on_site → completed; cancelled from any non-terminal state" });

export const MissionListQuery = PaginationQuery.extend({
  status: csvEnum(MISSION_STATUSES).optional(),
  teamId: z.uuid().optional().openapi({ description: "Admin only; responders always see their own team" }),
});

export const RescueTeam = z
  .object({
    id: z.uuid(),
    code: z.string(),
    name: z.string(),
    kind: z.string(),
    members: z.number().int(),
    availability: z.enum(TEAM_AVAILABILITIES),
    capabilities: z.array(z.string()),
    location: GeoJsonPoint,
    leadName: z.string().nullable(),
    leadPhone: z.string().nullable(),
    activeMissionCount: z.number().int(),
    updatedAt: z.string(),
  })
  .openapi("RescueTeam");

export const Mission = z
  .object({
    id: z.uuid(),
    code: z.string(),
    status: z.enum(MISSION_STATUSES),
    sosRequestId: z.uuid(),
    rescueTeamId: z.uuid(),
    teamName: z.string(),
    assignedBy: z.uuid().nullable(),
    assignedAt: z.string(),
    updatedAt: z.string(),
    completedAt: z.string().nullable(),
    notes: z.string().nullable(),
    incident: z.object({
      code: z.string(),
      status: z.enum(INCIDENT_STATUSES),
      priority: z.enum(PRIORITY_LEVELS),
      emergencyType: z.enum(INCIDENT_TYPES),
      peopleCount: z.number().int(),
      area: z.string().nullable(),
      location: GeoJsonPoint,
    }),
  })
  .openapi("Mission");

export const MissionPage = pageOf(Mission).openapi("MissionPage");
