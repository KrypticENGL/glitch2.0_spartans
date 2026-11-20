import { createServer } from "node:http";
import { createApp } from "./app.js";
import { loadConfig } from "./config/index.js";
import { createPool } from "./db/pool.js";
import { createLogger } from "./lib/logger.js";
import { sweepExpiredReservations } from "./modules/shelters/service.js";
import { RealtimeHub } from "./realtime/hub.js";
import { WebPushSender } from "./services/push-sender.js";
import { HttpRoutingClient } from "./services/routing-client.js";

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const pool = createPool(config.DATABASE_URL, config.DB_POOL_MAX);
pool.on("error", (err) => logger.error({ err }, "idle database client error"));

const realtime = new RealtimeHub(config.JWT_SECRET, config.CORS_ORIGINS, logger);
const routing = new HttpRoutingClient(config.ROUTING_ENGINE_URL, config.ROUTING_TIMEOUT_MS, logger);
const push = config.push ? new WebPushSender(config.push, config.PUSH_TIMEOUT_MS) : undefined;
if (!push) logger.warn("Web Push disabled: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT and PUSH_ENCRYPTION_KEY (npm run vapid:generate)");
const deps = { config, pool, logger, routing, realtime, push };
const server = createServer(createApp(deps));
realtime.attach(server);

const sweep =
  config.RESERVATION_SWEEP_INTERVAL_MS > 0
    ? setInterval(() => {
        sweepExpiredReservations(deps).catch((err: unknown) => logger.warn({ err }, "reservation sweep failed"));
      }, config.RESERVATION_SWEEP_INTERVAL_MS)
    : null;
sweep?.unref();

server.listen(config.PORT, config.HOST, () => logger.info({ port: config.PORT, host: config.HOST }, "SURAKSHA API listening"));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");
  const force = setTimeout(() => {
    logger.error("forced exit after shutdown timeout");
    process.exit(1);
  }, 10_000);
  force.unref();
  if (sweep) clearInterval(sweep);
  try {
    await realtime.close(); // disconnects sockets and closes the HTTP server
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "error during shutdown");
    process.exit(1);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error({ err }, "unhandled rejection"));
