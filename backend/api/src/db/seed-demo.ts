import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import type { Pool } from "./pool.js";
import { withTransaction } from "./pool.js";
import type { PriorityConfig } from "../modules/incidents/priority.js";
import { insertSos } from "../modules/incidents/service.js";
import { INCIDENT_STATUS_FOR_MISSION, syncTeamAvailability } from "../modules/rescue/service.js";
import type { IncidentType, MissionStatus } from "../types/enums.js";

interface Scenario {
  teams: { code: string; name: string }[];
  incidents: {
    code: string;
    location: [number, number];
    area: string;
    emergencyType: IncidentType;
    peopleCount: number;
    childrenCount: number;
    elderlyCount: number;
    disabledCount: number;
    medicalNeeded: boolean;
    trapped: boolean;
    lifeThreatening: boolean;
    notes: string;
    minutesAgo: number;
  }[];
  missions: { code: string; incident: string; team: string; status: MissionStatus }[];
}

export const SCENARIO_URL = new URL("../../../simulation-data/demo-scenario.json", import.meta.url);

/** Demo-only accounts. Responder emails derive from team codes: team-ndrf-1 → ndrf-1@suraksha.demo. */
export function demoAccounts(scenario: Pick<Scenario, "teams">) {
  return [
    { email: "admin@suraksha.demo", name: "Control Room Admin (demo)", role: "admin" as const, teamCode: null },
    { email: "citizen@suraksha.demo", name: "Demo Citizen", role: "citizen" as const, teamCode: null },
    ...scenario.teams.map((t) => ({ email: `${t.code.replace(/^team-/, "")}@suraksha.demo`, name: `${t.name} responder (demo)`, role: "responder" as const, teamCode: t.code })),
  ];
}

/** Idempotent: users are upserted, incidents/missions are inserted once by code, then team availability is re-synced. */
export async function seedDemo(pool: Pool, opts: { password: string; bcryptRounds: number; priority: PriorityConfig; log?: (msg: string) => void }) {
  const log = opts.log ?? (() => undefined);
  const scenario = JSON.parse(readFileSync(SCENARIO_URL, "utf8")) as Scenario;
  const hash = await bcrypt.hash(opts.password, opts.bcryptRounds);

  await withTransaction(pool, async (c) => {
    const teams = new Map((await c.query<{ id: string; code: string }>(`SELECT id, code FROM rescue_teams`)).rows.map((t) => [t.code, t.id]));
    for (const a of demoAccounts(scenario)) {
      const teamId = a.teamCode ? teams.get(a.teamCode) : null;
      if (a.teamCode && !teamId) throw new Error(`Team ${a.teamCode} missing; run db:reset first`);
      await c.query(
        `INSERT INTO users (name, email, password_hash, role, rescue_team_id) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
           rescue_team_id = EXCLUDED.rescue_team_id, updated_at = now()`,
        [a.name, a.email, hash, a.role, teamId ?? null],
      );
    }
    log(`users: ${demoAccounts(scenario).length}`);

    let inserted = 0;
    for (const inc of scenario.incidents) {
      const exists = await c.query(`SELECT 1 FROM sos_requests WHERE code = $1`, [inc.code]);
      if (exists.rowCount) continue;
      await insertSos(
        c,
        {
          location: { longitude: inc.location[0], latitude: inc.location[1] },
          emergencyType: inc.emergencyType,
          peopleCount: inc.peopleCount,
          childrenCount: inc.childrenCount,
          elderlyCount: inc.elderlyCount,
          disabledCount: inc.disabledCount,
          medicalNeeded: inc.medicalNeeded,
          trapped: inc.trapped,
          lifeThreatening: inc.lifeThreatening,
          notes: inc.notes,
          area: inc.area,
        },
        { config: opts.priority, requesterId: null, idempotencyKey: null, source: "simulated", code: inc.code, minutesAgo: inc.minutesAgo },
      );
      inserted++;
    }
    log(`incidents inserted: ${inserted}`);

    const admin = await c.query<{ id: string }>(`SELECT id FROM users WHERE email = 'admin@suraksha.demo'`);
    for (const m of scenario.missions) {
      const teamId = teams.get(m.team);
      if (!teamId) throw new Error(`Team ${m.team} missing`);
      const terminal = m.status === "completed" || m.status === "cancelled";
      const res = await c.query(
        `INSERT INTO rescue_missions (code, sos_request_id, rescue_team_id, assigned_by, status, completed_at)
         SELECT $1, s.id, $2, $3, $4, CASE WHEN $5 THEN now() END FROM sos_requests s WHERE s.code = $6
         ON CONFLICT (code) DO NOTHING`,
        [m.code, teamId, admin.rows[0]?.id ?? null, m.status, terminal, m.incident],
      );
      if (res.rowCount) {
        await c.query(`UPDATE sos_requests SET status = $2, updated_at = now() WHERE code = $1`, [m.incident, INCIDENT_STATUS_FOR_MISSION[m.status]]);
      }
    }
    for (const teamId of teams.values()) await syncTeamAvailability(c, teamId);
    log(`missions: ${scenario.missions.length}`);
  });
}
