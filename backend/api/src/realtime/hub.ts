import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { Logger } from "../lib/logger.js";
import { verifyToken, type AuthUser } from "../middleware/auth.js";
import { rooms, type ClientToServerEvents, type EventType, type PublishInput, type Publisher, type RealtimeEvent, type ServerToClientEvents } from "./events.js";

interface SocketData {
  user: AuthUser | null;
}

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns null when the user may join the room, otherwise the reason. */
export function roomAccessError(user: AuthUser | null, room: string): string | null {
  if (room === rooms.public) return null;
  if (room === rooms.admins) return user?.role === "admin" ? null : "FORBIDDEN";
  const [kind, id, ...rest] = room.split(":");
  if (!id || rest.length || !UUID_RE.test(id)) return "INVALID_ROOM";
  switch (kind) {
    case "route":
      return null; // knowing the unguessable route record id is the capability
    case "team":
      return user && (user.role === "admin" || (user.role === "responder" && user.teamId === id)) ? null : "FORBIDDEN";
    case "user":
      return user?.id === id ? null : "FORBIDDEN";
    default:
      return "INVALID_ROOM";
  }
}

export class RealtimeHub implements Publisher {
  private io: IoServer | null = null;

  constructor(
    private readonly jwtSecret: string,
    private readonly corsOrigins: string[],
    private readonly logger: Logger,
  ) {}

  attach(server: HttpServer): IoServer {
    const io: IoServer = new Server(server, { path: "/socket.io", cors: { origin: this.corsOrigins, credentials: true } });
    io.use((socket, next) => {
      const token: unknown = socket.handshake.auth?.token;
      if (token === undefined || token === null || token === "") {
        socket.data.user = null; // anonymous: public and route rooms only
        return next();
      }
      try {
        if (typeof token !== "string") throw new Error("bad token");
        socket.data.user = verifyToken(token, this.jwtSecret);
        next();
      } catch {
        next(new Error("UNAUTHORIZED"));
      }
    });
    io.on("connection", (socket) => this.onConnection(socket));
    this.io = io;
    return io;
  }

  private onConnection(socket: IoSocket) {
    const user = socket.data.user;
    const auto: string[] = [rooms.public];
    if (user) {
      auto.push(rooms.user(user.id));
      if (user.role === "admin") auto.push(rooms.admins);
      if (user.role === "responder" && user.teamId) auto.push(rooms.team(user.teamId));
    }
    void socket.join(auto);

    socket.on("subscribe", (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => undefined;
      const room = typeof payload?.room === "string" ? payload.room : "";
      const error = roomAccessError(user, room);
      if (error) return reply({ ok: false, error });
      void socket.join(room);
      reply({ ok: true });
    });
    socket.on("unsubscribe", (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => undefined;
      if (typeof payload?.room === "string") void socket.leave(payload.room);
      reply({ ok: true });
    });
  }

  publish(type: EventType, targetRooms: string[], input: PublishInput): void {
    if (!this.io || targetRooms.length === 0) return;
    const event: RealtimeEvent = { eventId: randomUUID(), type, timestamp: new Date().toISOString(), ...input };
    this.io.to(targetRooms).emit(type, event);
    this.logger.debug({ type, rooms: targetRooms, entityId: input.entityId }, "realtime event");
  }

  async close(): Promise<void> {
    await this.io?.close();
    this.io = null;
  }
}
