export const EVENT_TYPES = [
  "road.status.updated",
  "hazard.reported",
  "hazard.verified",
  "route.invalidated",
  "shelter.occupancy.updated",
  "sos.created",
  "mission.assigned",
  "mission.status.updated",
  "alert.published",
  "alert.dispatch.updated",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface RealtimeEvent {
  eventId: string;
  type: EventType;
  timestamp: string;
  entityId: string;
  status?: string;
  graphVersion?: number;
  data: Record<string, unknown>;
}

export type ServerToClientEvents = { [K in EventType]: (event: RealtimeEvent) => void };

export interface SubscribeAck {
  ok: boolean;
  error?: string;
}

export interface ClientToServerEvents {
  subscribe: (payload: { room: string }, ack: (res: SubscribeAck) => void) => void;
  unsubscribe: (payload: { room: string }, ack: (res: SubscribeAck) => void) => void;
}

export const rooms = {
  admins: "admins",
  public: "public",
  team: (id: string) => `team:${id}`,
  user: (id: string) => `user:${id}`,
  route: (id: string) => `route:${id}`,
} as const;

export interface PublishInput {
  entityId: string;
  status?: string;
  graphVersion?: number;
  data: Record<string, unknown>;
}

/** Services publish only after their DB transaction has committed. */
export interface Publisher {
  publish(type: EventType, targetRooms: string[], input: PublishInput): void;
}

export const noopPublisher: Publisher = { publish: () => undefined };
