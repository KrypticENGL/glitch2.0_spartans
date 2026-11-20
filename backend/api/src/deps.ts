import type { Config } from "./config/index.js";
import type { Pool } from "./db/pool.js";
import type { Logger } from "./lib/logger.js";
import type { Publisher } from "./realtime/events.js";
import type { PushSender } from "./services/push-sender.js";
import type { RoutingClient } from "./services/routing-client.js";

export interface AppDeps {
  config: Config;
  pool: Pool;
  logger: Logger;
  routing: RoutingClient;
  realtime: Publisher;
  /** Present only when VAPID is configured. */
  push?: PushSender;
}
