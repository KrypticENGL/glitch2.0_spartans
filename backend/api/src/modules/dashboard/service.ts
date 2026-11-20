import type { AppDeps } from "../../deps.js";
import { listShelters } from "../shelters/service.js";
import { listIncidents } from "../incidents/service.js";
import { listMissions, listTeams } from "../rescue/service.js";
import type { AuthUser } from "../../middleware/auth.js";

const ACTIVE_INCIDENT = `status NOT IN ('resolved','cancelled')`;

export async function summary(deps: AppDeps) {
  const { rows } = await deps.pool.query<{
    incidents: { active: number; unassigned: number; peopleAwaiting: number; byPriority: Record<string, number> };
    shelters: { total: number; accepting: number; totalCapacity: number; occupancy: number; reserved: number; available: number };
    roads: Record<string, number>;
    missions_active: number;
    teams: Record<string, number>;
    graph_version: number;
  }>(
    `SELECT
      (SELECT json_build_object(
          'active', count(*) FILTER (WHERE ${ACTIVE_INCIDENT}),
          'unassigned', count(*) FILTER (WHERE status = 'new'),
          'peopleAwaiting', coalesce(sum(people_count) FILTER (WHERE status IN ('new','assigned','en_route')), 0),
          'byPriority', json_build_object(
             'critical', count(*) FILTER (WHERE ${ACTIVE_INCIDENT} AND priority = 'critical'),
             'high', count(*) FILTER (WHERE ${ACTIVE_INCIDENT} AND priority = 'high'),
             'medium', count(*) FILTER (WHERE ${ACTIVE_INCIDENT} AND priority = 'medium'),
             'low', count(*) FILTER (WHERE ${ACTIVE_INCIDENT} AND priority = 'low')))
       FROM sos_requests) AS incidents,
      (SELECT json_build_object(
          'total', count(*),
          'accepting', count(*) FILTER (WHERE operational_status IN ('open','near_capacity') AND total_capacity - current_occupancy - reserved_count > 0),
          'totalCapacity', coalesce(sum(total_capacity), 0),
          'occupancy', coalesce(sum(current_occupancy), 0),
          'reserved', coalesce(sum(reserved_count), 0),
          'available', coalesce(sum(greatest(0, total_capacity - current_occupancy - reserved_count)) FILTER (WHERE operational_status IN ('open','near_capacity')), 0))
       FROM shelters) AS shelters,
      (SELECT json_build_object(
          'open', count(*) FILTER (WHERE status = 'open'),
          'restricted', count(*) FILTER (WHERE status = 'restricted'),
          'blocked', count(*) FILTER (WHERE status = 'blocked'),
          'unknown', count(*) FILTER (WHERE status = 'unknown'))
       FROM road_edges) AS roads,
      (SELECT count(*)::int FROM rescue_missions WHERE status NOT IN ('completed','cancelled')) AS missions_active,
      (SELECT json_build_object(
          'available', count(*) FILTER (WHERE availability = 'available'),
          'onMission', count(*) FILTER (WHERE availability = 'on_mission'),
          'offDuty', count(*) FILTER (WHERE availability = 'off_duty'))
       FROM rescue_teams) AS teams,
      (SELECT version FROM graph_state) AS graph_version`,
  );
  const r = rows[0]!;
  return {
    incidents: r.incidents,
    shelters: r.shelters,
    roads: r.roads,
    activeMissions: r.missions_active,
    teams: r.teams,
    graphVersion: r.graph_version,
    generatedAt: new Date().toISOString(),
  };
}

export const incidents = (deps: AppDeps) =>
  listIncidents(deps, { page: 1, pageSize: 100, status: ["new", "assigned", "en_route", "on_site"], priority: undefined });

export const shelters = (deps: AppDeps) => listShelters(deps, { page: 1, pageSize: 100 });

export async function operations(deps: AppDeps, user: AuthUser) {
  const [teams, missions] = await Promise.all([
    listTeams(deps, {}),
    listMissions(deps, { page: 1, pageSize: 100, status: ["assigned", "accepted", "en_route", "on_site"], teamId: undefined }, user),
  ]);
  return { teams: teams.data, activeMissions: missions.data };
}
