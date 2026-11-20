// npm run openapi:generate — writes backend/shared/openapi/openapi.json (types.ts is generated from it by openapi-typescript).
import { mkdirSync, writeFileSync } from "node:fs";
import { buildOpenApiDocument } from "../openapi/document.js";

const dir = new URL("../../../shared/openapi/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("openapi.json", dir), `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`);
console.log(`wrote ${new URL("openapi.json", dir).pathname}`);
