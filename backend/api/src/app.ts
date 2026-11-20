import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import type { AppDeps } from "./deps.js";
import { authenticate } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";
import { authRouter } from "./modules/auth/router.js";
import { dashboardRouter } from "./modules/dashboard/router.js";
import { hazardsRouter } from "./modules/hazards/router.js";
import { healthRouter } from "./modules/health/router.js";
import { incidentsRouter, sosRouter } from "./modules/incidents/router.js";
import { missionsRouter, teamsRouter } from "./modules/rescue/router.js";
import { roadsRouter } from "./modules/roads/router.js";
import { routesRouter } from "./modules/routing/router.js";
import { sheltersRouter } from "./modules/shelters/router.js";
import { buildOpenApiDocument } from "./openapi/document.js";

const REQUEST_ID_RE = /^[A-Za-z0-9._-]{8,128}$/;

export function createApp(deps: AppDeps) {
  const { config } = deps;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url?.startsWith("/health") ?? false },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS, credentials: true, exposedHeaders: ["X-Request-Id"] }));
  app.use(express.json({ limit: "100kb" }));

  const limiter = (max: number, code: string) =>
    rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      limit: max,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json({ error: { code, message: "Too many requests; please slow down" } });
      },
    });

  const health = healthRouter(deps);
  app.use("/health", health);

  const openapi = buildOpenApiDocument();
  app.get("/api/docs/openapi.json", (_req, res) => {
    res.json(openapi);
  });
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapi));

  const v1 = Router();
  v1.use(limiter(config.RATE_LIMIT_MAX, "RATE_LIMITED"));
  v1.use(authenticate(config.JWT_SECRET));
  v1.use("/health", health);
  v1.use("/auth", authRouter(deps, limiter(config.RATE_LIMIT_AUTH_MAX, "RATE_LIMITED")));
  v1.use("/shelters", sheltersRouter(deps));
  v1.use("/routes", routesRouter(deps));
  v1.use("/roads", roadsRouter(deps));
  v1.use("/hazards", hazardsRouter(deps));
  v1.use("/sos", sosRouter(deps, limiter(config.RATE_LIMIT_SOS_MAX, "RATE_LIMITED")));
  v1.use("/incidents", incidentsRouter(deps));
  v1.use("/rescue-teams", teamsRouter(deps));
  v1.use("/missions", missionsRouter(deps));
  v1.use("/dashboard", dashboardRouter(deps));
  app.use("/api/v1", v1);

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}
