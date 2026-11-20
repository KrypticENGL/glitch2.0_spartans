// MapLibre v6 loads its web worker from a sibling file that bundlers don't emit.
// Copy it into public/ (served at /maplibre-gl-worker.mjs) so it always matches the installed version.
import { copyFile, mkdir } from "node:fs/promises";

const src = new URL("../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url);
const dest = new URL("../public/maplibre-gl-worker.mjs", import.meta.url);
await mkdir(new URL("../public/", import.meta.url), { recursive: true });
await copyFile(src, dest);
console.log("maplibre worker copied to public/");
